// SPDX-License-Identifier: MIT
// Whether the browser keeps the app's data for good. By default it is
// "best effort": a phone short of space (an Android Go phone with little
// free storage) may evict it, which would erase the profiles, the contacts,
// the history and the offline app at once. The app asks the browser to keep
// it after the welcome, again at every launch until it is granted (Chrome
// grants it more easily once the app is installed), and when the app is
// installed. The status screen says what the browser answered.

export type StoragePersistence = 'persistent' | 'best-effort' | 'unknown';

/** What the keeper uses of navigator.storage. */
interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export interface StorageKeeper {
  /** Asks the browser to keep the data for good, unless it already does; resolves with its answer. */
  keep: () => Promise<StoragePersistence>;
  getSnapshot: () => StoragePersistence;
  subscribe: (listener: () => void) => () => void;
}

export function createStorageKeeper(manager: () => StorageManagerLike | undefined): StorageKeeper {
  let state: StoragePersistence = 'unknown';
  const listeners = new Set<() => void>();
  const set = (next: StoragePersistence) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    async keep() {
      const storage = manager();
      if (storage?.persist === undefined) {
        set('unknown');
        return state;
      }
      try {
        if ((await storage.persisted?.()) === true) set('persistent');
        else set((await storage.persist()) ? 'persistent' : 'best-effort');
      } catch {
        // Some browsers expose the API and refuse it: nothing is known.
        set('unknown');
      }
      return state;
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's data on this phone. */
export const storageKeeper = createStorageKeeper(() =>
  typeof navigator !== 'undefined' && 'storage' in navigator ? navigator.storage : undefined,
);
