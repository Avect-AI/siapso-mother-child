// SPDX-License-Identifier: MIT
// IndexedDB in trouble, as on some phones: an open that never completes
// (blocked by another tab) or storage that refuses to open. The test setup
// puts a fresh fake IndexedDB back after every test.
import { IDBOpenDBRequest } from 'fake-indexeddb';
import { vi } from 'vitest';

/** Every open waits forever, like a database blocked by another tab. */
export function hangIndexedDB(): void {
  globalThis.indexedDB = { open: () => new IDBOpenDBRequest() } as unknown as IDBFactory;
}

type Put = (
  this: IDBObjectStore,
  ...args: Parameters<IDBObjectStore['put']>
) => IDBRequest<IDBValidKey>;

/**
 * Makes the writes (put) for which `fails` says so throw, as storage that
 * refuses a write or a tab closed in the middle of a transaction; the others
 * go through. `writes()` counts them; `restore()` puts the real put back.
 */
export function failWrites(fails: (store: IDBObjectStore, write: number) => boolean) {
  const realPut = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')?.value as Put;
  let writes = 0;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    writes += 1;
    if (fails(this, writes)) throw new DOMException('The write was refused', 'AbortError');
    return realPut.apply(this, args);
  });
  return {
    writes: () => writes,
    restore: () => {
      spy.mockRestore();
    },
  };
}

/** Every open fails at once with `message`. */
export function breakIndexedDB(message: string): void {
  globalThis.indexedDB = {
    open: () => {
      throw new Error(message);
    },
  } as unknown as IDBFactory;
}
