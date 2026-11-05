// SPDX-License-Identifier: MIT
// The session: whether the code was given, on a shared family phone where a
// pregnancy, an HIV status or a contraception can be a secret. The app starts
// locked; nothing about a profile shows until the code opens it (App.tsx keeps
// every profile screen behind it). It locks again after two minutes without
// interaction, when the page comes back after more than two minutes hidden,
// and at once with the quick exit, which also forgets the check in progress
// and leaves the neutral screen on the history entry. Every lock starts a new
// epoch (entry-state.ts): what a profile left on a history entry, and the
// danger signs ticked, are no longer read. While locked, the same two minutes
// without interaction or hidden start a new epoch too, so the danger signs
// ticked without the code do not stay on screen.
//
// The tabs of the app follow each other (tab-sync.ts): the quick exit and a
// lock asked for lock every tab, which forget the screen they held; the
// forgotten-code erase sends every tab back to the welcome. An auto-lock stays
// in its own tab: each tab counts its own two minutes.
//
// Threat model: casual access by someone else in the family, not a forensic
// attacker. The code is never stored, only its verifier (domain/code.ts). The
// session holds the code's key material in memory while open and drops it on
// lock: SCRUM-39 derives from it the key that encrypts the profiles at rest,
// never from the verifier's own derivation (see domain/code.ts). Wrong codes
// are counted in storage, shared by every tab, before the code is worked out.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { navigate } from 'wouter/use-hash-location';
import { CodeExistsError, codeFingerprint, codeOpened } from '../data/code-guard.js';
import {
  addTabMark,
  claimCodeTry,
  closeAppDb,
  eraseProfilesAndCode,
  getStoredLockout,
  getStoredSettings,
  getStoredVerifier,
  readTabMarks,
  storeLockout,
  storeNewVerifier,
  storeVerifier,
} from '../data/db.js';
import { forgetVisit } from '../data/history.js';
import {
  AUTO_LOCK_MS,
  claimTry,
  codeKey,
  createVerifier,
  NO_LOCKOUT,
  PBKDF2_ITERATIONS,
  unlockKey,
  type CodeClaim,
  type CodeVerifier,
  type LockoutState,
} from '../domain/code.js';
import type { Mode } from '../domain/types.js';
import { useApp, withTimeout } from './app-state.js';
import { useCheck } from './check-state.js';
import { epochToken, newEpoch, newVisit } from './entry-state.js';
import { joinTabs, type TabEvent, type TabLink } from './tab-sync.js';

/**
 * 'loading': the stored code is being read. 'new': no code on this phone yet
 * (the welcome makes one). 'locked' and 'unlocked': the code is asked, or was
 * given.
 */
export type SessionStatus = 'loading' | 'new' | 'locked' | 'unlocked';

/**
 * 'locked': a wait after too many wrong codes is running, so the code was not
 * even tried. 'unavailable': the stored code could not be read, so the try is
 * not counted.
 */
export type UnlockResult = 'ok' | 'wrong' | 'locked' | 'unavailable';

/**
 * 'made': the code is stored and the session open. 'exists': a code was
 * already on the phone (made in another tab, or before a welcome cut short):
 * nothing is replaced, and this tab asks for that code. 'unsaved': the phone
 * did not keep the code: nothing is opened, the welcome asks again.
 */
export type CodeMade = 'made' | 'exists' | 'unsaved';

/** A screen the session locked, held in memory (never in the address) until the code is given. */
export interface HeldScreen {
  path: string;
  state: unknown;
}

export interface Session {
  status: SessionStatus;
  unlocked: boolean;
  /** The mode of the settings (woman until one is chosen). */
  mode: Mode;
  /** Locked by the quick exit, until the code is given again: the neutral screen shows. */
  exited: boolean;
  /** The wrong codes in a row and the end of their wait, as last known. */
  lockout: LockoutState;
  /** The stored code could not be read on this phone. */
  codeUnavailable: boolean;
  /** A code made here was refused: one was already on the phone (the code screen says so). */
  codeRefused: boolean;
  /**
   * The epoch (entry-state.ts): it changes at every lock, and while locked
   * after two minutes without interaction or hidden. The screens open without
   * the code start again with it (the danger signs ticked are forgotten).
   */
  epoch: string;
  unlock: (code: string) => Promise<UnlockResult>;
  /**
   * Makes the code (only its verifier is stored) and opens the session, only
   * once storage shows that code stored (see CodeMade).
   */
  createCode: (code: string) => Promise<CodeMade>;
  /** Locks this tab and every other tab of the app. */
  lock: () => void;
  /**
   * Locks at once, here and in every other tab, forgets the check in progress
   * and the danger signs ticked, and puts the neutral screen on the history
   * entry. Also before the code, from the danger signs and who to call.
   */
  quickExit: () => void;
  /**
   * The code is forgotten: erases the profiles, their history, the saved
   * contacts and the code, keeps the language and the knowledge pack, and
   * goes back to the welcome.
   */
  forgetCode: () => Promise<void>;
  /** An interaction the window does not see: the two minutes start again. */
  touch: () => void;
  /** The key material of the open session, null while locked. */
  keyMaterial: () => CryptoKey | null;
  /** Keeps in memory the screen the session locked on, to give it back after the code. */
  holdScreen: (path: string, state: unknown) => void;
  /** The screen held, once; null when none is. */
  takeHeldScreen: () => HeldScreen | null;
}

export interface SessionOptions {
  /** Tests only: start open. The app always starts locked. */
  startUnlocked?: boolean;
}

/** What the user does: each one starts the two minutes again. */
const INTERACTIONS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Runs `work` alone among the tabs of the app when the browser can say so
 * (Web Locks), so two tabs never claim the same try; without it the claim's
 * single transaction still counts every try.
 */
function aloneAmongTabs<T>(work: () => Promise<T>): Promise<T> {
  // Older browsers and the test runner have no Web Locks.
  const locks = (navigator as { locks?: LockManager }).locks;
  return locks === undefined ? work() : locks.request('siapso-code-try', work);
}

/** How many storage timeouts a slow store of a new code is given to settle. */
const STORE_SETTLE_FACTOR = 3;

/** Resolves once `promise` settles, or after `ms`, whichever comes first; never rejects. */
function settledWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    promise.then(done, done);
  });
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  children,
  startUnlocked = false,
}: SessionOptions & { children: ReactNode }) {
  const { settings, setSettings, storageTimeoutMs } = useApp();
  const { reset, forgetOthers, forgetQuick, quick, profileId: checkProfileId } = useCheck();
  // Whether the check on screen is a passer-by's, read by the lock.
  const passerBy = useRef(false);
  useEffect(() => {
    passerBy.current = quick !== null && quick.id === checkProfileId;
  }, [quick, checkProfileId]);
  const [status, setStatus] = useState<SessionStatus>(startUnlocked ? 'unlocked' : 'loading');
  const [exited, setExited] = useState(false);
  const [lockout, setLockout] = useState<LockoutState>(NO_LOCKOUT);
  const [codeUnavailable, setCodeUnavailable] = useState(false);
  const [codeRefused, setCodeRefused] = useState(false);
  const [epoch, setEpoch] = useState(epochToken);
  const verifier = useRef<CodeVerifier | null>(null);
  const failures = useRef<LockoutState>(NO_LOCKOUT);
  const key = useRef<CryptoKey | null>(null);
  const held = useRef<HeldScreen | null>(null);
  /** Locked from another tab: the screen it locked on is not held. */
  const holdNothing = useRef(false);
  const attempt = useRef<Promise<UnlockResult> | null>(null);
  /** Tries claimed in this tab: a count read before the last one is out of date. */
  const claims = useRef(0);
  const restartIdle = useRef<() => void>(() => undefined);
  const tabs = useRef<TabLink | null>(null);

  useEffect(() => {
    let live = true;
    withTimeout(Promise.all([getStoredVerifier(), getStoredLockout()]), storageTimeoutMs).then(
      ([stored, storedLockout]) => {
        if (!live) return;
        // A code made while this was read is the one that counts.
        verifier.current ??= stored ?? null;
        // Tests that start open hold the stored code, as if it had just been given.
        if (startUnlocked && verifier.current) codeOpened(verifier.current);
        if (storedLockout) {
          failures.current = storedLockout;
          setLockout(storedLockout);
        }
        setStatus((now) => (now === 'loading' ? (verifier.current ? 'locked' : 'new') : now));
      },
      (failure: unknown) => {
        // Unmounted meanwhile (a storage that never answers): nothing to say.
        if (!live) return;
        console.warn('Code not read on this device', failure);
        setCodeUnavailable(true);
        setStatus((now) => (now === 'loading' ? 'locked' : now));
      },
    );
    return () => {
      live = false;
    };
  }, [storageTimeoutMs, startUnlocked]);

  /**
   * Keeps a lockout in memory and on screen, and stores it (a failure to
   * store is only logged); once stored, the other tabs read it again.
   */
  const keepLockout = useCallback(
    (next: LockoutState) => {
      failures.current = next;
      setLockout(next);
      withTimeout(storeLockout(next), storageTimeoutMs).then(
        () => {
          tabs.current?.announceLockout();
        },
        (failure: unknown) => {
          console.warn('Wrong codes not stored on this device', failure);
        },
      );
    },
    [storageTimeoutMs],
  );

  /** The wrong codes as stored now, shared by every tab (another tab may have counted some). */
  const readLockout = useCallback(() => {
    const before = claims.current;
    withTimeout(getStoredLockout(), storageTimeoutMs).then(
      (stored) => {
        // A try claimed meanwhile knows better; nothing stored: nothing to change.
        if (stored === undefined || claims.current !== before) return;
        failures.current = stored;
        setLockout(stored);
      },
      () => {
        // Unreadable: the count known stays, and the next try reads it anyway.
      },
    );
  }, [storageTimeoutMs]);

  /** Opens the session with the code of `opened`: this tab writes with that code only. */
  const open = useCallback((material: CryptoKey, opened: CodeVerifier) => {
    key.current = material;
    codeOpened(opened);
    holdNothing.current = false;
    setExited(false);
    setCodeRefused(false);
    setStatus('unlocked');
  }, []);

  /** A new epoch: what a profile left on an entry and the danger signs ticked are no longer read. */
  const renewEpoch = useCallback(() => {
    newEpoch();
    setEpoch(epochToken());
  }, []);

  /**
   * What a lock forgets of the visit: the lists waiting for the other women,
   * and a passer-by (her screen is then not held: the code opens the start).
   * The list of a woman on screen stays with the screen held.
   */
  const forgetAtLock = useCallback(() => {
    if (passerBy.current) holdNothing.current = true;
    forgetOthers();
    forgetQuick();
  }, [forgetOthers, forgetQuick]);

  /** Locks this tab only (its own two minutes are over). */
  const lockHere = useCallback(() => {
    key.current = null;
    renewEpoch();
    forgetAtLock();
    setStatus((now) => (now === 'unlocked' ? 'locked' : now));
  }, [renewEpoch, forgetAtLock]);

  const lock = useCallback(() => {
    lockHere();
    tabs.current?.announce('lock');
  }, [lockHere]);

  /** The stored code, read again after it could not be; null while it still cannot be. */
  const readVerifierAgain = useCallback(async (): Promise<CodeVerifier | null> => {
    try {
      const stored = await withTimeout(getStoredVerifier(), storageTimeoutMs);
      if (stored) {
        verifier.current = stored;
        setCodeUnavailable(false);
      }
      return stored ?? null;
    } catch (failure) {
      console.warn('Code still not read on this device', failure);
      return null;
    }
  }, [storageTimeoutMs]);

  /**
   * Claims the try in storage, shared by every tab, then tells the other tabs
   * the count changed; in memory alone when storage refuses.
   */
  const claim = useCallback(async (): Promise<CodeClaim> => {
    claims.current += 1;
    try {
      const claimed = await withTimeout(
        claimCodeTry(failures.current, Date.now()),
        storageTimeoutMs,
      );
      tabs.current?.announceLockout();
      return claimed;
    } catch (failure) {
      console.warn('Wrong codes not read on this device', failure);
      return claimTry(failures.current, undefined, Date.now());
    }
  }, [storageTimeoutMs]);

  /** A verifier from an older version, made with fewer iterations, made again at the full count. */
  const rehash = useCallback(
    async (code: string) => {
      try {
        const made = await createVerifier(code);
        verifier.current = made;
        await withTimeout(storeVerifier(made), storageTimeoutMs);
        // The same code, its new verifier: this tab writes with it now.
        codeOpened(made);
      } catch (failure) {
        console.warn('Code not made again on this device', failure);
      }
    },
    [storageTimeoutMs],
  );

  const unlock = useCallback(
    (code: string): Promise<UnlockResult> => {
      // A second tap while the code is being worked out gives the same answer.
      if (attempt.current) return attempt.current;
      const tried = aloneAmongTabs(async (): Promise<UnlockResult> => {
        const stored = verifier.current ?? (await readVerifierAgain());
        // The code cannot be read: nothing to compare with, so the try does not count.
        if (stored === null) return 'unavailable';
        const claimed = await claim();
        failures.current = claimed.after;
        if (!claimed.allowed) {
          setLockout(claimed.before);
          return 'locked';
        }
        const material = await unlockKey(code, stored);
        if (material === null) {
          // Counted already, in storage, by the claim.
          setLockout(claimed.after);
          return 'wrong';
        }
        keepLockout(NO_LOCKOUT);
        open(material, stored);
        if (stored.iterations < PBKDF2_ITERATIONS) void rehash(code);
        return 'ok';
      }).finally(() => {
        attempt.current = null;
      });
      attempt.current = tried;
      return tried;
    },
    [claim, keepLockout, open, readVerifierAgain, rehash],
  );

  /** Forgets what memory holds about profiles: the check, the visit's checks, the held screen. */
  const forgetMemory = useCallback(() => {
    reset();
    forgetVisit();
    newVisit();
    held.current = null;
  }, [reset]);

  /** The quick exit in this tab: locked, memory forgotten, the neutral screen on the entry. */
  const exitHere = useCallback(() => {
    lockHere();
    setExited(true);
    forgetMemory();
    // The neutral screen takes this entry's place; the state left on it goes too.
    navigate('/', { replace: true });
  }, [lockHere, forgetMemory]);

  const quickExit = useCallback(() => {
    exitHere();
    tabs.current?.announce('quick-exit');
  }, [exitHere]);

  /** No code any more, in this tab: everything in memory goes, and the welcome comes back. */
  const forgetAll = useCallback(() => {
    key.current = null;
    verifier.current = null;
    codeOpened(null);
    failures.current = NO_LOCKOUT;
    setLockout(NO_LOCKOUT);
    setCodeUnavailable(false);
    setExited(false);
    renewEpoch();
    forgetMemory();
    setStatus('new');
  }, [forgetMemory, renewEpoch]);

  /**
   * The code as stored now, which another tab may have erased or made: read
   * again when another tab says so and whenever this tab comes back, never
   * taken from a message alone (a forged one changes nothing). No code stored
   * while this tab had one: it was erased, and this tab goes back to the
   * welcome. Another code than the one this tab knows: this tab asks for it
   * (locked), with the settings stored with it.
   */
  const syncCode = useCallback(async () => {
    let stored: CodeVerifier | undefined;
    try {
      stored = await withTimeout(getStoredVerifier(), storageTimeoutMs);
    } catch {
      // Unreadable now: the next check reads it again.
      return;
    }
    const known = verifier.current;
    if (stored === undefined) {
      if (known === null) return;
      // This tab's connection goes too; the next use opens one again.
      closeAppDb();
      forgetAll();
      // The tab that erased stored these settings: here they change in memory.
      void setSettings({ mode: null, onboarded: false }, { store: false });
      navigate('/', { replace: true });
      return;
    }
    if (known !== null && codeFingerprint(known) === codeFingerprint(stored)) return;
    verifier.current = stored;
    key.current = null;
    // Nothing of this tab comes back after another code: no screen is held.
    held.current = null;
    holdNothing.current = true;
    forgetAtLock();
    renewEpoch();
    setCodeUnavailable(false);
    setStatus((now) => (now === 'loading' ? now : 'locked'));
    try {
      const settingsNow = await withTimeout(getStoredSettings(), storageTimeoutMs);
      // A code is stored: the welcome is over, whatever this tab answered on it.
      void setSettings({ ...settingsNow, onboarded: true }, { store: false });
    } catch {
      void setSettings({ onboarded: true }, { store: false });
    }
  }, [forgetAll, forgetAtLock, renewEpoch, setSettings, storageTimeoutMs]);

  /** A code made here was refused: this tab asks for the stored one, the welcome over. */
  const refuseCode = useCallback(async (): Promise<CodeMade> => {
    await syncCode();
    setStatus((now) => (now === 'loading' ? now : 'locked'));
    void setSettings({ onboarded: true }, { store: false });
    setCodeRefused(true);
    return 'exists';
  }, [setSettings, syncCode]);

  const createCode = useCallback(
    async (code: string): Promise<CodeMade> => {
      const made = await createVerifier(code);
      const material = await codeKey(code);
      const storing = storeNewVerifier(made);
      try {
        await withTimeout(storing, storageTimeoutMs);
      } catch (failure) {
        // Another tab made the code first: it stays, and this tab asks for it.
        if (failure instanceof CodeExistsError) return refuseCode();
        console.warn('Code not stored on this device at once', failure);
        // A slow or failed store: nothing opens on a code storage may not hold.
        // Once the store settles (or a while longer), storage alone decides.
        await settledWithin(storing, STORE_SETTLE_FACTOR * storageTimeoutMs);
        let stored: CodeVerifier | undefined;
        try {
          stored = await withTimeout(getStoredVerifier(), storageTimeoutMs);
        } catch {
          return 'unsaved';
        }
        if (stored === undefined) return 'unsaved';
        if (codeFingerprint(stored) !== codeFingerprint(made)) return refuseCode();
      }
      verifier.current = made;
      keepLockout(NO_LOCKOUT);
      setCodeUnavailable(false);
      open(material, made);
      tabs.current?.announceCode();
      return 'made';
    },
    [keepLockout, open, refuseCode, storageTimeoutMs],
  );
  const forgetCode = useCallback(async () => {
    await withTimeout(eraseProfilesAndCode(), storageTimeoutMs);
    tabs.current?.announce('erase');
    forgetAll();
    await setSettings({ mode: null, onboarded: false });
  }, [forgetAll, setSettings, storageTimeoutMs]);

  /** What another tab did, done here too (never told again); an erase only once storage shows it. */
  const followTab = useCallback(
    (event: TabEvent) => {
      if (event === 'erase') {
        void syncCode();
      } else if (event === 'quick-exit') {
        exitHere();
      } else {
        lockHere();
        held.current = null;
        holdNothing.current = true;
      }
    },
    [exitHere, lockHere, syncCode],
  );

  /** The stored code and wrong codes may have changed: read both again. */
  const recheck = useCallback(() => {
    readLockout();
    void syncCode();
  }, [readLockout, syncCode]);

  useEffect(() => {
    const link = joinTabs({
      onEvent: followTab,
      onRecheck: recheck,
      marks: { read: readTabMarks, add: addTabMark },
    });
    tabs.current = link;
    return () => {
      link.close();
      if (tabs.current === link) tabs.current = null;
    };
  }, [followTab, recheck]);
  const touch = useCallback(() => {
    restartIdle.current();
  }, []);

  const keyMaterial = useCallback(() => key.current, []);

  const holdScreen = useCallback((path: string, state: unknown) => {
    // Locked from another tab: the screen it was on is forgotten, not held.
    if (holdNothing.current) {
      holdNothing.current = false;
      return;
    }
    held.current = { path, state };
  }, []);

  const takeHeldScreen = useCallback(() => {
    const screen = held.current;
    held.current = null;
    return screen;
  }, []);

  // Two minutes without interaction, or more than two minutes hidden: while
  // open, the session locks (in this tab only); while locked, a new epoch
  // starts, so the danger signs ticked without the code are forgotten. The
  // clock is read again when the page comes back, because a hidden page on a
  // phone may run no timer at all.
  useEffect(() => {
    const idle = status === 'unlocked' ? lockHere : renewEpoch;
    let last = Date.now();
    let hiddenAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restart = () => {
      last = Date.now();
      clearTimeout(timer);
      timer = setTimeout(expire, AUTO_LOCK_MS);
    };
    const expire = () => {
      idle();
      restart();
    };
    timer = setTimeout(expire, AUTO_LOCK_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt ??= Date.now();
        return;
      }
      const now = Date.now();
      const away = hiddenAt === null ? 0 : now - hiddenAt;
      hiddenAt = null;
      if (away > AUTO_LOCK_MS || now - last >= AUTO_LOCK_MS) expire();
    };
    restartIdle.current = restart;
    for (const type of INTERACTIONS) {
      window.addEventListener(type, restart, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    return () => {
      clearTimeout(timer);
      restartIdle.current = () => undefined;
      for (const type of INTERACTIONS) {
        window.removeEventListener(type, restart, { capture: true });
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
    };
  }, [status, lockHere, renewEpoch]);

  const mode: Mode = settings.mode ?? 'woman';
  const value = useMemo<Session>(
    () => ({
      status,
      unlocked: status === 'unlocked',
      mode,
      exited,
      lockout,
      codeUnavailable,
      codeRefused,
      epoch,
      unlock,
      createCode,
      lock,
      quickExit,
      forgetCode,
      touch,
      keyMaterial,
      holdScreen,
      takeHeldScreen,
    }),
    [
      status,
      mode,
      exited,
      lockout,
      codeUnavailable,
      codeRefused,
      epoch,
      unlock,
      createCode,
      lock,
      quickExit,
      forgetCode,
      touch,
      keyMaterial,
      holdScreen,
      takeHeldScreen,
    ],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

/** The session of the app. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession needs an AppProvider');
  return session;
}
