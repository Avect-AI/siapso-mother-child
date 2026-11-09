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
// attacker. The code is never stored, only its verifier (domain/code.ts).
// The profiles, their history and the contacts are sealed at rest
// (domain/crypto.ts): the code's wrapping key is held in this page's memory
// while the session is open (data/vault.ts), and forgotten at every lock, the
// quick exit, a lock from another tab, the erase and another code. The first
// unlock after the update seals what an older version kept in clear and makes
// the verifier again (data/migration.ts). Wrong codes are counted in storage,
// shared by every tab, before the code is worked out.
//
// Answers typed in a form and not saved yet (a profile half filled when the
// two minutes run out) are kept in this page's memory only, never stored,
// hidden while locked, and given back to the same screen once the code opens
// the session again; the quick exit, a lock from another tab, the erase and
// another code drop them. While they are not saved, the screen warns shortly
// before the auto-lock, and a touch puts it off.
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
import { CodeExistsError, codeFingerprint, codeOpened, NoCodeError } from '../data/code-guard.js';
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
} from '../data/db.js';
import { forgetVisit } from '../data/history.js';
import { sealStoredData, storeNewCode, type SealOptions } from '../data/migration.js';
import { closeVault, openVault } from '../data/vault.js';
import {
  AUTO_LOCK_MS,
  claimTry,
  codeLength as lengthOf,
  createCodeKeys,
  isCode,
  LOCK_WARNING_MS,
  VERIFIER_VERSION,
  NO_LOCKOUT,
  openCode,
  type CodeClaim,
  type CodeKeys,
  type CodeVerifier,
  type LockoutState,
  type OpenedCode,
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
 * not counted. 'failed': the code is right, but what an older version kept in
 * clear could not be sealed on this phone: nothing opens, everything stays as
 * it was, and the next try starts again. 'cancelled': the session was locked
 * (the quick exit, a lock from another tab, the erase, another code) while the
 * code was worked out: nothing opens. 'unsupported': the code's verifier was
 * made by a newer version of the app: nothing is tried, nothing counted.
 */
export type UnlockResult =
  'ok' | 'wrong' | 'locked' | 'unavailable' | 'failed' | 'cancelled' | 'unsupported';

/**
 * 'made': the code is stored and the session open. 'exists': a code was
 * already on the phone (made in another tab, or before a welcome cut short):
 * nothing is replaced, and this tab asks for that code. 'unsaved': the phone
 * did not keep the code: nothing is opened, the welcome asks again.
 */
export type CodeMade = 'made' | 'exists' | 'unsaved' | 'cancelled';

/** A screen the session locked, held in memory (never in the address) until the code is given. */
export interface HeldScreen {
  path: string;
  state: unknown;
}

/** The answers of a form being filled, for the screen `key`, in memory only. */
interface Draft {
  key: string;
  value: unknown;
  /** Some answer differs from what is saved: the screen warns before the auto-lock. */
  unsaved: boolean;
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
   * The length of the code on the phone, kept with its verifier (SCRUM-56):
   * the code screen tries the code once that many digits are in. Null when
   * none is kept (a code made before) or the code is not known.
   */
  codeLength: number | null;
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
  /** The wrapping key of the open session (data/vault.ts), null while locked. */
  keyMaterial: () => CryptoKey | null;
  /** Keeps in memory the screen the session locked on, to give it back after the code. */
  holdScreen: (path: string, state: unknown) => void;
  /** The screen held, once; null when none is. */
  takeHeldScreen: () => HeldScreen | null;
  /**
   * Keeps in memory (never stored) the answers of the form of the screen
   * `key` as they are typed; `unsaved` when some answer is not saved yet.
   */
  keepDraft: (key: string, value: unknown, unsaved: boolean) => void;
  /**
   * The answers kept for the screen `key`, null when none are. They stay
   * while that screen shows (its form keeps them up to date), and go once
   * another screen shows (dropDraft).
   */
  draftFor: (key: string) => { value: unknown } | null;
  /** Drops the answers kept, unless they are those of the screen `key` (the one shown). */
  dropDraft: (key: string) => void;
  /**
   * The auto-lock comes in LOCK_WARNING_MS while a form has answers not saved:
   * the screen says so, and a touch (or `touch`) puts it off.
   */
  lockSoon: boolean;
}

export interface SessionOptions {
  /**
   * Tests only: start open (the test opens the vault itself, as storeTestCode
   * does: no code is given here). The app always starts locked.
   */
  startUnlocked?: boolean;
}

/**
 * The draft key of a passer-by's questions ("Regarder sans enregistrer",
 * the `quick` screen of App.tsx): warned about before the auto-lock like any
 * form, but let go at every lock with her, never given back after the code.
 */
export const PASSER_BY_DRAFT = 'quick';

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

/**
 * How many storage timeouts the stored code is given to answer after a new
 * code could not be stored (another tab may hold the storage).
 */
const STORE_SETTLE_FACTOR = 3;

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
  const [lockSoon, setLockSoon] = useState(false);
  const verifier = useRef<CodeVerifier | null>(null);
  const [codeLength, setCodeLength] = useState<number | null>(null);
  /** The code as stored now, known to this tab, and its length for the code screen. */
  const knowVerifier = useCallback((known: CodeVerifier | null) => {
    verifier.current = known;
    setCodeLength(known === null ? null : lengthOf(known));
  }, []);
  const failures = useRef<LockoutState>(NO_LOCKOUT);
  const key = useRef<CryptoKey | null>(null);
  const held = useRef<HeldScreen | null>(null);
  const draft = useRef<Draft | null>(null);
  /** Locked from another tab: the screen it locked on is not held. */
  const holdNothing = useRef(false);
  const attempt = useRef<Promise<UnlockResult> | null>(null);
  /** Tries claimed in this tab: a count read before the last one is out of date. */
  const claims = useRef(0);
  const restartIdle = useRef<() => void>(() => undefined);
  /** Counts the locks, exits, erases and other codes: an unlock under way when one comes opens nothing. */
  const closings = useRef(0);
  const tabs = useRef<TabLink | null>(null);

  useEffect(() => {
    let live = true;
    withTimeout(Promise.all([getStoredVerifier(), getStoredLockout()]), storageTimeoutMs).then(
      ([stored, storedLockout]) => {
        if (!live) return;
        // A code made while this was read is the one that counts.
        if (verifier.current === null) knowVerifier(stored ?? null);
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
  }, [storageTimeoutMs, startUnlocked, knowVerifier]);

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
  const open = useCallback(
    (material: CryptoKey, opened: CodeVerifier) => {
      key.current = material;
      openVault(material);
      codeOpened(opened);
      knowVerifier(opened);
      holdNothing.current = false;
      setExited(false);
      setCodeRefused(false);
      setStatus('unlocked');
    },
    [knowVerifier],
  );

  /** A new epoch: what a profile left on an entry and the danger signs ticked are no longer read. */
  const renewEpoch = useCallback(() => {
    newEpoch();
    setEpoch(epochToken());
  }, []);

  /**
   * What a lock forgets of the visit: the lists waiting for the other women,
   * and a passer-by (her screen is then not held: the code opens the start)
   * with the answers typed for her and not used yet. The list of a woman on
   * screen stays with the screen held.
   */
  const forgetAtLock = useCallback(() => {
    if (passerBy.current) holdNothing.current = true;
    if (draft.current?.key === PASSER_BY_DRAFT) draft.current = null;
    forgetOthers();
    forgetQuick();
  }, [forgetOthers, forgetQuick]);

  /**
   * Locks this tab only (its own two minutes are over): its keys are
   * forgotten, with the passer-by and the other women's lists (memory only).
   */
  const lockHere = useCallback(() => {
    closings.current += 1;
    key.current = null;
    closeVault();
    setLockSoon(false);
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
        knowVerifier(stored);
        setCodeUnavailable(false);
      }
      return stored ?? null;
    } catch (failure) {
      console.warn('Code still not read on this device', failure);
      return null;
    }
  }, [storageTimeoutMs, knowVerifier]);

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

  /**
   * Makes the verifier again and seals, or sweeps what was written in clear
   * (data/migration.ts). Each storage step has its time; the encryption has
   * none, so a slow phone never fails for being slow.
   */
  const sealData = useCallback(
    (options: SealOptions) => sealStoredData({ ...options, storageTimeoutMs }),
    [storageTimeoutMs],
  );

  /**
   * The verifier and key the session opens with, once the right code opened
   * `stored`. A version 2 verifier opens with its key, after a sweep of what
   * was written in clear into the storage. A verifier of the format before
   * SCRUM-39 (no key) or with fewer iterations is made again with a new salt,
   * stored in the same transaction as the sealed data with every data key
   * wrapped for its key; after any failure the stored verifier is read again,
   * and the new key opens only when its verifier is the one stored (the
   * transaction committed anyway). When storage holds another verifier (made
   * again in another tab), the code is tried on that one, once: 'wrong' when
   * it does not open it. Null when nothing can be opened safely: nothing
   * opens, and storage stays as it was.
   */
  const openData = useCallback(
    (
      code: string,
      first: CodeVerifier,
      firstOpened: OpenedCode,
    ): Promise<CodeKeys | 'wrong' | null> => {
      const attempt = async (
        stored: CodeVerifier,
        opened: OpenedCode,
        again: boolean,
      ): Promise<CodeKeys | 'wrong' | null> => {
        const current = { fingerprint: codeFingerprint(stored), wrappingKey: opened.wrappingKey };
        /** The code tried on the verifier stored now, when it is another one. */
        const reopen = async (now: CodeVerifier | null): Promise<CodeKeys | 'wrong' | null> => {
          if (now === null || codeFingerprint(now) === current.fingerprint) return null;
          const reopened = await openCode(code, now);
          return reopened === null ? 'wrong' : attempt(now, reopened, false);
        };
        if (!opened.renew && opened.wrappingKey !== null) {
          // A code kept without its length gets it now (SCRUM-56), with the sweep.
          const length = lengthOf(stored) === null && isCode(code) ? code.length : undefined;
          try {
            await sealData(length === undefined ? { current } : { current, codeLength: length });
          } catch (failure) {
            // Never open with a verifier storage no longer holds.
            if (failure instanceof NoCodeError) {
              return again ? reopen(await readVerifierAgain()) : null;
            }
            // Only a sweep of records nobody reads, and a length: the next unlock does it.
            console.warn('Records in clear not swept on this device yet', failure);
            return { verifier: stored, wrappingKey: opened.wrappingKey };
          }
          return {
            verifier: length === undefined ? stored : { ...stored, length },
            wrappingKey: opened.wrappingKey,
          };
        }
        const next = await createCodeKeys(code);
        try {
          await sealData({ current, next });
          knowVerifier(next.verifier);
          // The other tabs hold the verifier made again: they lock and ask for the code.
          tabs.current?.announceCode();
          return next;
        } catch (failure) {
          // What storage holds now decides: the write may have committed anyway.
          const now = await readVerifierAgain();
          if (now !== null && codeFingerprint(now) === codeFingerprint(next.verifier)) {
            tabs.current?.announceCode();
            return next;
          }
          if (failure instanceof NoCodeError) {
            // Another tab made the verifier again meanwhile: the same code opens it.
            return again ? reopen(now) : null;
          }
          console.warn('Code not made again on this device', failure);
          // The new key opens nothing stored: it is not kept.
          return opened.wrappingKey === null
            ? null
            : { verifier: stored, wrappingKey: opened.wrappingKey };
        }
      };
      return attempt(first, firstOpened, true);
    },
    [readVerifierAgain, sealData, knowVerifier],
  );

  const unlock = useCallback(
    (code: string): Promise<UnlockResult> => {
      // A second tap while the code is being worked out gives the same answer.
      if (attempt.current) return attempt.current;
      // A lock, an exit, an erase or another code while the code is worked
      // out (seconds, the first time after the update), or while another tab
      // tries one: nothing opens then.
      const since = closings.current;
      const tried = aloneAmongTabs(async (): Promise<UnlockResult> => {
        const stored = verifier.current ?? (await readVerifierAgain());
        // The code cannot be read: nothing to compare with, so the try does not count.
        if (stored === null) return 'unavailable';
        // Made by a newer version of the app: this one cannot open it, and the try does not count.
        if (stored.version !== undefined && stored.version !== VERIFIER_VERSION) {
          return 'unsupported';
        }
        const claimed = await claim();
        failures.current = claimed.after;
        if (!claimed.allowed) {
          setLockout(claimed.before);
          return 'locked';
        }
        const opened = await openCode(code, stored);
        if (opened === null) {
          // Counted already, in storage, by the claim.
          setLockout(claimed.after);
          return 'wrong';
        }
        keepLockout(NO_LOCKOUT);
        const keys = await openData(code, stored, opened);
        if (keys === 'wrong') {
          // Not the code on the phone now: the try counts.
          keepLockout(claimed.after);
          return 'wrong';
        }
        if (keys === null) return 'failed';
        if (closings.current !== since) return 'cancelled';
        open(keys.wrappingKey, keys.verifier);
        return 'ok';
      }).finally(() => {
        attempt.current = null;
      });
      attempt.current = tried;
      return tried;
    },
    [claim, keepLockout, open, openData, readVerifierAgain],
  );

  /**
   * Forgets what memory holds about profiles: the check, the visit's checks,
   * the held screen, the answers not saved.
   */
  const forgetMemory = useCallback(() => {
    reset();
    forgetVisit();
    newVisit();
    held.current = null;
    draft.current = null;
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
    closings.current += 1;
    key.current = null;
    closeVault();
    setLockSoon(false);
    knowVerifier(null);
    codeOpened(null);
    failures.current = NO_LOCKOUT;
    setLockout(NO_LOCKOUT);
    setCodeUnavailable(false);
    setExited(false);
    renewEpoch();
    forgetMemory();
    setStatus('new');
  }, [forgetMemory, renewEpoch, knowVerifier]);

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
    if (known !== null && codeFingerprint(known) === codeFingerprint(stored)) {
      // The same code; another tab may have kept its length meanwhile (SCRUM-56).
      if (lengthOf(known) !== lengthOf(stored)) knowVerifier(stored);
      return;
    }
    knowVerifier(stored);
    closings.current += 1;
    key.current = null;
    closeVault();
    setLockSoon(false);
    // Nothing of this tab comes back after another code: no screen, no answer is held.
    held.current = null;
    draft.current = null;
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
  }, [forgetAll, forgetAtLock, renewEpoch, setSettings, storageTimeoutMs, knowVerifier]);

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
      // A lock, an exit, an erase or another code while it is made: it is
      // kept, and nothing opens.
      const since = closings.current;
      const keys = await createCodeKeys(code);
      const { verifier: made, wrappingKey } = keys;
      // The verifier, and in the same transaction what a phone from before
      // codes existed kept in clear, sealed (data/migration.ts). Each storage
      // step has its time, the encryption none: a step that does not end in
      // time is given up for good (aborted unless it committed), never left
      // to land later.
      try {
        await storeNewCode(keys, { storageTimeoutMs });
      } catch (failure) {
        // Another tab made the code first: it stays, and this tab asks for it.
        if (failure instanceof CodeExistsError) return refuseCode();
        console.warn('Code not stored on this device', failure);
        // Nothing opens on a code storage may not hold: storage alone decides,
        // given a while longer to answer (another tab may hold it).
        let stored: CodeVerifier | undefined;
        try {
          stored = await withTimeout(getStoredVerifier(), STORE_SETTLE_FACTOR * storageTimeoutMs);
        } catch {
          return 'unsaved';
        }
        if (stored === undefined) return 'unsaved';
        if (codeFingerprint(stored) !== codeFingerprint(made)) return refuseCode();
      }
      knowVerifier(made);
      keepLockout(NO_LOCKOUT);
      setCodeUnavailable(false);
      tabs.current?.announceCode();
      if (closings.current !== since) {
        // The code is on the phone: it is asked.
        setStatus((now) => (now === 'loading' ? now : 'locked'));
        return 'cancelled';
      }
      open(wrappingKey, made);
      return 'made';
    },
    [keepLockout, open, refuseCode, storageTimeoutMs, knowVerifier],
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
        draft.current = null;
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

  const keepDraft = useCallback((key: string, value: unknown, unsaved: boolean) => {
    draft.current = { key, value, unsaved };
    if (!unsaved) setLockSoon(false);
  }, []);

  const draftFor = useCallback((key: string) => {
    const kept = draft.current;
    return kept?.key === key ? { value: kept.value } : null;
  }, []);

  const dropDraft = useCallback((key: string) => {
    if (draft.current?.key !== key) draft.current = null;
  }, []);

  // Two minutes without interaction, or more than two minutes hidden: while
  // open, the session locks (in this tab only); while locked, a new epoch
  // starts, so the danger signs ticked without the code are forgotten. The
  // clock is read again when the page comes back, because a hidden page on a
  // phone may run no timer at all. While open with answers not saved, the
  // screen warns LOCK_WARNING_MS before.
  useEffect(() => {
    const open = status === 'unlocked';
    const idle = open ? lockHere : renewEpoch;
    let last = Date.now();
    let hiddenAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let warning: ReturnType<typeof setTimeout> | undefined;
    const warn = () => {
      if (draft.current?.unsaved === true) setLockSoon(true);
    };
    const restart = () => {
      last = Date.now();
      clearTimeout(timer);
      clearTimeout(warning);
      setLockSoon(false);
      timer = setTimeout(expire, AUTO_LOCK_MS);
      if (open) warning = setTimeout(warn, AUTO_LOCK_MS - LOCK_WARNING_MS);
    };
    const expire = () => {
      idle();
      restart();
    };
    timer = setTimeout(expire, AUTO_LOCK_MS);
    if (open) warning = setTimeout(warn, AUTO_LOCK_MS - LOCK_WARNING_MS);
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
      clearTimeout(warning);
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
      codeLength,
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
      keepDraft,
      draftFor,
      dropDraft,
      lockSoon,
    }),
    [
      status,
      mode,
      exited,
      lockout,
      codeUnavailable,
      codeRefused,
      codeLength,
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
      keepDraft,
      draftFor,
      dropDraft,
      lockSoon,
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
