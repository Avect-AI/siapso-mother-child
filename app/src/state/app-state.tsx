// SPDX-License-Identifier: MIT
// App-wide state: settings (kept in IndexedDB), the knowledge pack with where
// it came from, the connection status, and the check in progress (in memory,
// see check-state.ts, read with useCheck), and the session that the code
// opens (session.tsx, read with useSession).
import type { Pack } from '@siapso/engine';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { getStoredSettings, storeSettings } from '../data/db.js';
import {
  BUILD_TRUST,
  loadPack,
  previousPackVersion,
  rollbackPack,
  type LoadedPack,
  type PackFallback,
} from '../data/pack-loader.js';
import type { PackOrigin } from '../data/pack-verify.js';
import { phoneHints, type PhoneHints } from '../domain/country.js';
import type { Settings } from '../domain/types.js';
import { storageKeeper } from '../pwa/storage.js';
import { CheckContext, useCheckStore } from './check-state.js';
import { SessionProvider, type SessionOptions } from './session.js';

export interface AppState {
  settings: Settings;
  /** False until the stored settings are read, or until the read is given up. */
  settingsReady: boolean;
  /** The settings could not be read or stored on this phone: choices may not be kept. */
  settingsUnavailable: boolean;
  /**
   * Changes the settings at once, then stores them; resolves when stored or
   * given up. `store: false` changes them in memory only (another tab stored them).
   */
  setSettings: (patch: Partial<Settings>, options?: { store?: boolean }) => Promise<void>;
  pack: Pack | null;
  /** Why no pack could be loaded (null while loading and once loaded). */
  packError: string | null;
  /** Where the pack came from: downloaded or served by the service worker, or IndexedDB. */
  packSource: LoadedPack['source'] | null;
  /** Why the downloaded pack was not used, when the source is 'cache'. */
  packFallbackReason: string | null;
  /** The pack works but could not be stored on the device. */
  packStoreError: string | null;
  /** Who signed the pack, or why an unsigned one was accepted (a test or demo build). */
  packOrigin: PackOrigin | null;
  /** Why the stored copy is used, when the source is 'cache'. */
  packFallback: PackFallback | null;
  /**
   * Reads the version a rollback would restore (null: none). Only the Status
   * screen asks, in accompanied mode: nothing reads it after a load.
   */
  readPackPrevious: () => Promise<string | null>;
  /** Makes the previous pack active at once; rejects, changing nothing, when it cannot. */
  rollbackPack: () => Promise<void>;
  /** This build accepts unsigned packs: a test or demo build, never a release. */
  acceptsUnsigned: boolean;
  online: boolean;
  /** How long a screen waits for IndexedDB before saying it could not read or store. */
  storageTimeoutMs: number;
  /** What the phone says of where it is (its languages and time zone), read once, offline. */
  phone: PhoneHints;
}

export const DEFAULT_SETTINGS: Settings = { lang: 'fr', mode: null, onboarded: false };

/**
 * How long to wait for IndexedDB before going on with the default settings
 * (an open blocked by another tab, a storage that never answers). Generous,
 * because a cold start on an entry-level phone is slow; the danger signs
 * route does not wait at all.
 */
export const STORAGE_TIMEOUT_MS = 4000;

interface PackState {
  pack: Pack | null;
  error: string | null;
  source: LoadedPack['source'] | null;
  fallbackReason: string | null;
  storeError: string | null;
  origin: PackOrigin | null;
  fallback: PackFallback | null;
}

const NO_PACK: PackState = {
  pack: null,
  error: null,
  source: null,
  fallbackReason: null,
  storeError: null,
  origin: null,
  fallback: null,
};

/** The state of a pack handed back by the loader or by a rollback. */
function packStateOf(result: LoadedPack): PackState {
  return {
    pack: result.pack,
    error: null,
    source: result.source,
    fallbackReason: result.fallbackReason,
    storeError: null,
    origin: result.origin ?? null,
    fallback: result.fallback ?? null,
  };
}

const rollbackStoredPack = () => rollbackPack();
const storedPreviousVersion = () => previousPackVersion();

const AppContext = createContext<AppState | null>(null);

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function isOnline(): boolean {
  return navigator.onLine;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `promise`, or a rejection once `ms` have passed without an answer. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`no answer from storage after ${String(ms)} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Asks the browser not to evict our data under storage pressure (pwa/storage.ts);
 * a refusal changes nothing, the status screen says it.
 */
function requestPersistentStorage(): void {
  void storageKeeper.keep();
}

export function AppProvider({
  children,
  packLoader = loadPack,
  packRollback = rollbackStoredPack,
  packPrevious = storedPreviousVersion,
  acceptsUnsigned = BUILD_TRUST.allowUnsigned,
  storageTimeoutMs = STORAGE_TIMEOUT_MS,
  session = {},
  phone,
}: {
  children: ReactNode;
  /** Replaced in tests; loads from /pack/ with a fallback to IndexedDB by default. */
  packLoader?: () => Promise<LoadedPack>;
  /** Replaced in tests; restores the previous pack kept in IndexedDB by default. */
  packRollback?: () => Promise<LoadedPack>;
  /** Replaced in tests; the version of the previous pack kept in IndexedDB by default. */
  packPrevious?: () => Promise<string | null>;
  /** Replaced in tests; whether this build accepts unsigned packs (BUILD_TRUST) by default. */
  acceptsUnsigned?: boolean;
  storageTimeoutMs?: number;
  /** Set by tests only: the app always starts locked, with the full PBKDF2 count. */
  session?: SessionOptions;
  /** Replaced in tests; what the phone says of where it is (domain/country.ts) by default. */
  phone?: PhoneHints;
}) {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);
  const latest = useRef<Settings>(DEFAULT_SETTINGS);
  /** The stored settings were read: memory holds them, and a store keeps what it did not change. */
  const read = useRef(false);
  const [packState, setPackState] = useState<PackState>(NO_PACK);
  // Read once, on the phone only: no network, no location permission.
  const [phoneSays] = useState<PhoneHints>(() => phone ?? phoneHints());

  const online = useSyncExternalStore(subscribeOnline, isOnline);
  const check = useCheckStore();

  useEffect(() => {
    let settled = false;
    // Only ever called asynchronously, once `timer` below is set.
    const finish = (stored: Settings | undefined, unavailable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      read.current = !unavailable;
      latest.current = { ...DEFAULT_SETTINGS, ...stored };
      setSettingsState(latest.current);
      setSettingsUnavailable(unavailable);
      setSettingsReady(true);
    };
    const timer = setTimeout(() => {
      finish(undefined, true);
    }, storageTimeoutMs);
    getStoredSettings().then(
      (stored) => {
        finish(stored, false);
      },
      () => {
        finish(undefined, true);
      },
    );
    return () => {
      settled = true;
      clearTimeout(timer);
    };
  }, [storageTimeoutMs]);

  // At each launch after the welcome, and once the app is installed: the
  // browser is asked again to keep the data, until it does.
  useEffect(() => {
    if (settingsReady && latest.current.onboarded) requestPersistentStorage();
  }, [settingsReady]);
  useEffect(() => {
    window.addEventListener('appinstalled', requestPersistentStorage);
    return () => {
      window.removeEventListener('appinstalled', requestPersistentStorage);
    };
  }, []);

  useEffect(() => {
    let live = true;
    packLoader().then(
      (result) => {
        if (!live) return;
        setPackState(packStateOf(result));
        // The loader logs a store failure; the state keeps it for the status screen.
        result.stored.catch((error: unknown) => {
          if (live) setPackState((state) => ({ ...state, storeError: messageOf(error) }));
        });
      },
      (error: unknown) => {
        if (live) setPackState({ ...NO_PACK, error: messageOf(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [packLoader]);

  const rollback = useCallback(async () => {
    const result = await packRollback();
    setPackState(packStateOf(result));
  }, [packRollback]);

  const { forgetQuick } = check;
  const setSettings = useCallback(
    async (patch: Partial<Settings>, { store = true }: { store?: boolean } = {}) => {
      const before = latest.current;
      let next = { ...before, ...patch };
      latest.current = next;
      // A passer-by is looked up in accompanied mode only: any change of mode lets her go.
      if (next.mode !== before.mode) forgetQuick();
      // The screen follows the choice at once; storage never holds it up.
      setSettingsState(next);
      if (!store) return;
      if (!read.current) {
        // The first read gave up (a slow storage): memory holds the defaults,
        // not what is stored. The stored settings are read again first, so a
        // store never puts the defaults over her language and mode (the end of
        // a welcome cut short, stored after the code); while they still cannot
        // be read, nothing is stored.
        try {
          const stored = await withTimeout(getStoredSettings(), storageTimeoutMs);
          read.current = true;
          next = { ...DEFAULT_SETTINGS, ...stored, ...patch };
          latest.current = next;
          setSettingsState(next);
          setSettingsUnavailable(false);
        } catch (error) {
          console.warn('Settings not read on this device: nothing stored over them', error);
          setSettingsUnavailable(true);
          return;
        }
      }
      if (!before.onboarded && next.onboarded) requestPersistentStorage();
      try {
        await withTimeout(storeSettings(next), storageTimeoutMs);
      } catch (error) {
        console.warn('Settings not stored on this device', error);
        setSettingsUnavailable(true);
      }
    },
    [storageTimeoutMs, forgetQuick],
  );

  const value = useMemo<AppState>(
    () => ({
      settings,
      settingsReady,
      settingsUnavailable,
      setSettings,
      pack: packState.pack,
      packError: packState.error,
      packSource: packState.source,
      packFallbackReason: packState.fallbackReason,
      packStoreError: packState.storeError,
      packOrigin: packState.origin,
      packFallback: packState.fallback,
      readPackPrevious: packPrevious,
      rollbackPack: rollback,
      acceptsUnsigned,
      online,
      storageTimeoutMs,
      phone: phoneSays,
    }),
    [
      settings,
      settingsReady,
      settingsUnavailable,
      setSettings,
      packState,
      packPrevious,
      rollback,
      acceptsUnsigned,
      online,
      storageTimeoutMs,
      phoneSays,
    ],
  );

  return (
    <AppContext value={value}>
      <CheckContext value={check}>
        <SessionProvider {...session}>{children}</SessionProvider>
      </CheckContext>
    </AppContext>
  );
}

export function useApp(): AppState {
  const app = useContext(AppContext);
  if (app === null) throw new Error('useApp needs an AppProvider');
  return app;
}
