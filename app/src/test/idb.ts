// SPDX-License-Identifier: MIT
// IndexedDB in trouble, as on some phones: an open that never completes
// (blocked by another tab) or storage that refuses to open. The test setup
// puts a fresh fake IndexedDB back after every test.
import { IDBOpenDBRequest } from 'fake-indexeddb';

/** Every open waits forever, like a database blocked by another tab. */
export function hangIndexedDB(): void {
  globalThis.indexedDB = { open: () => new IDBOpenDBRequest() } as unknown as IDBFactory;
}

/** Every open fails at once with `message`. */
export function breakIndexedDB(message: string): void {
  globalThis.indexedDB = {
    open: () => {
      throw new Error(message);
    },
  } as unknown as IDBFactory;
}
