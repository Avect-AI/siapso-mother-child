// SPDX-License-Identifier: MIT
// The session: whether the code was given, on a shared family phone where a
// pregnancy, an HIV status or a contraception can be a secret. The app starts
// locked; nothing about a profile shows until the code opens it (App.tsx keeps
// every profile screen behind it). It locks again after two minutes without
// interaction, when the page comes back after more than two minutes hidden,
// and at once with the quick exit, which also forgets the check in progress
// and leaves the neutral screen on the history entry. Every lock starts a new
// epoch (entry-state.ts): what a profile left on a history entry is no longer
// read.
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
import {
  claimCodeTry,
  eraseProfilesAndCode,
  getStoredLockout,
  getStoredVerifier,
  storeLockout,
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
import { newEpoch, newVisit } from './entry-state.js';

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
  unlock: (code: string) => Promise<UnlockResult>;
  /** Makes the code (only its verifier is stored) and opens the session. */
  createCode: (code: string) => Promise<void>;
  lock: () => void;
  /** Locks at once, forgets the check in progress, and puts the neutral screen on the history entry. */
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

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  children,
  startUnlocked = false,
}: SessionOptions & { children: ReactNode }) {
  const { settings, setSettings, storageTimeoutMs } = useApp();
  const { reset } = useCheck();
  const [status, setStatus] = useState<SessionStatus>(startUnlocked ? 'unlocked' : 'loading');
  const [exited, setExited] = useState(false);
  const [lockout, setLockout] = useState<LockoutState>(NO_LOCKOUT);
  const [codeUnavailable, setCodeUnavailable] = useState(false);
  const verifier = useRef<CodeVerifier | null>(null);
  const failures = useRef<LockoutState>(NO_LOCKOUT);
  const key = useRef<CryptoKey | null>(null);
  const held = useRef<HeldScreen | null>(null);
  const attempt = useRef<Promise<UnlockResult> | null>(null);
  const restartIdle = useRef<() => void>(() => undefined);

  useEffect(() => {
    let live = true;
    withTimeout(Promise.all([getStoredVerifier(), getStoredLockout()]), storageTimeoutMs).then(
      ([stored, storedLockout]) => {
        if (!live) return;
        // A code made while this was read is the one that counts.
        verifier.current ??= stored ?? null;
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
  }, [storageTimeoutMs]);

  /** Keeps a lockout in memory and on screen, and stores it (a failure to store is only logged). */
  const keepLockout = useCallback(
    (next: LockoutState) => {
      failures.current = next;
      setLockout(next);
      withTimeout(storeLockout(next), storageTimeoutMs).catch((failure: unknown) => {
        console.warn('Wrong codes not stored on this device', failure);
      });
    },
    [storageTimeoutMs],
  );

  const open = useCallback((material: CryptoKey) => {
    key.current = material;
    setExited(false);
    setStatus('unlocked');
  }, []);

  const lock = useCallback(() => {
    key.current = null;
    newEpoch();
    setStatus((now) => (now === 'unlocked' ? 'locked' : now));
  }, []);

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

  /** Claims the try in storage, shared by every tab; in memory alone when storage refuses. */
  const claim = useCallback(async (): Promise<CodeClaim> => {
    try {
      return await withTimeout(claimCodeTry(failures.current, Date.now()), storageTimeoutMs);
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
        if (stored.iterations < PBKDF2_ITERATIONS) void rehash(code);
        open(material);
        return 'ok';
      }).finally(() => {
        attempt.current = null;
      });
      attempt.current = tried;
      return tried;
    },
    [claim, keepLockout, open, readVerifierAgain, rehash],
  );

  const createCode = useCallback(
    async (code: string) => {
      const made = await createVerifier(code);
      const material = await codeKey(code);
      verifier.current = made;
      try {
        await withTimeout(storeVerifier(made), storageTimeoutMs);
      } catch (failure) {
        // As for the settings: the app goes on, the code holds until the app closes.
        console.warn('Code not stored on this device', failure);
      }
      keepLockout(NO_LOCKOUT);
      setCodeUnavailable(false);
      open(material);
    },
    [keepLockout, open, storageTimeoutMs],
  );

  /** Forgets what memory holds about profiles: the check, the visit's checks, the held screen. */
  const forgetMemory = useCallback(() => {
    reset();
    forgetVisit();
    newVisit();
    held.current = null;
  }, [reset]);

  const quickExit = useCallback(() => {
    lock();
    setExited(true);
    forgetMemory();
    // The neutral screen takes this entry's place; the state left on it goes too.
    navigate('/', { replace: true });
  }, [lock, forgetMemory]);

  const forgetCode = useCallback(async () => {
    await withTimeout(eraseProfilesAndCode(), storageTimeoutMs);
    key.current = null;
    verifier.current = null;
    failures.current = NO_LOCKOUT;
    setLockout(NO_LOCKOUT);
    setCodeUnavailable(false);
    setExited(false);
    newEpoch();
    forgetMemory();
    setStatus('new');
    await setSettings({ mode: null, onboarded: false });
  }, [forgetMemory, setSettings, storageTimeoutMs]);

  const touch = useCallback(() => {
    restartIdle.current();
  }, []);

  const keyMaterial = useCallback(() => key.current, []);

  const holdScreen = useCallback((path: string, state: unknown) => {
    held.current = { path, state };
  }, []);

  const takeHeldScreen = useCallback(() => {
    const screen = held.current;
    held.current = null;
    return screen;
  }, []);

  // While open: two minutes without interaction, or more than two minutes
  // hidden, and the session locks. The clock is read again when the page comes
  // back, because a hidden page on a phone may run no timer at all.
  useEffect(() => {
    if (status !== 'unlocked') return;
    let last = Date.now();
    let hiddenAt: number | null = null;
    let timer = setTimeout(lock, AUTO_LOCK_MS);
    const restart = () => {
      last = Date.now();
      clearTimeout(timer);
      timer = setTimeout(lock, AUTO_LOCK_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt ??= Date.now();
        return;
      }
      const now = Date.now();
      const away = hiddenAt === null ? 0 : now - hiddenAt;
      hiddenAt = null;
      if (away > AUTO_LOCK_MS || now - last >= AUTO_LOCK_MS) lock();
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
  }, [status, lock]);

  const mode: Mode = settings.mode ?? 'woman';
  const value = useMemo<Session>(
    () => ({
      status,
      unlocked: status === 'unlocked',
      mode,
      exited,
      lockout,
      codeUnavailable,
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
