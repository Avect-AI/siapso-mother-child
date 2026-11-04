// SPDX-License-Identifier: MIT
// App-wide state: settings (kept in IndexedDB), the knowledge pack with where
// it came from, and the connection status. Later tasks add the session and the
// current check.
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
import { loadPack, type LoadedPack } from '../data/pack-loader.js';
import type { Settings } from '../domain/types.js';

export interface AppState {
  settings: Settings;
  /** False until the stored settings are read, or until the read is given up. */
  settingsReady: boolean;
  /** The settings could not be read or stored on this phone: choices may not be kept. */
  settingsUnavailable: boolean;
  /** Changes the settings at once, then stores them; resolves when stored or given up. */
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  pack: Pack | null;
  /** Why no pack could be loaded (null while loading and once loaded). */
  packError: string | null;
  /** Where the pack came from: downloaded or served by the service worker, or IndexedDB. */
  packSource: LoadedPack['source'] | null;
  /** Why the downloaded pack was not used, when the source is 'cache'. */
  packFallbackReason: string | null;
  /** The pack works but could not be stored on the device. */
  packStoreError: string | null;
  online: boolean;
  /** How long a screen waits for IndexedDB before saying it could not read or store. */
  storageTimeoutMs: number;
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
}

const NO_PACK: PackState = {
  pack: null,
  error: null,
  source: null,
  fallbackReason: null,
  storeError: null,
};

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

/** Asks the browser not to evict our data under storage pressure; a refusal changes nothing. */
function requestPersistentStorage(): void {
  if (!('storage' in navigator)) return;
  try {
    navigator.storage.persist().catch(() => undefined);
  } catch {
    // Some browsers expose storage without persist: nothing to do.
  }
}

export function AppProvider({
  children,
  packLoader = loadPack,
  storageTimeoutMs = STORAGE_TIMEOUT_MS,
}: {
  children: ReactNode;
  /** Replaced in tests; loads from /pack/ with a fallback to IndexedDB by default. */
  packLoader?: () => Promise<LoadedPack>;
  storageTimeoutMs?: number;
}) {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);
  const latest = useRef<Settings>(DEFAULT_SETTINGS);
  const [packState, setPackState] = useState<PackState>(NO_PACK);
  const online = useSyncExternalStore(subscribeOnline, isOnline);

  useEffect(() => {
    let settled = false;
    // Only ever called asynchronously, once `timer` below is set.
    const finish = (stored: Settings | undefined, unavailable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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

  useEffect(() => {
    let live = true;
    packLoader().then(
      (result) => {
        if (!live) return;
        setPackState({
          pack: result.pack,
          error: null,
          source: result.source,
          fallbackReason: result.fallbackReason,
          storeError: null,
        });
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

  const setSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const before = latest.current;
      const next = { ...before, ...patch };
      latest.current = next;
      // The screen follows the choice at once; storage never holds it up.
      setSettingsState(next);
      if (!before.onboarded && next.onboarded) requestPersistentStorage();
      try {
        await withTimeout(storeSettings(next), storageTimeoutMs);
      } catch (error) {
        console.warn('Settings not stored on this device', error);
        setSettingsUnavailable(true);
      }
    },
    [storageTimeoutMs],
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
      online,
      storageTimeoutMs,
    }),
    [
      settings,
      settingsReady,
      settingsUnavailable,
      setSettings,
      packState,
      online,
      storageTimeoutMs,
    ],
  );

  return <AppContext value={value}>{children}</AppContext>;
}

export function useApp(): AppState {
  const app = useContext(AppContext);
  if (app === null) throw new Error('useApp needs an AppProvider');
  return app;
}
