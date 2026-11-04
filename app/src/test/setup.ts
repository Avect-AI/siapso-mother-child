// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach } from 'vitest';
import { closeAppDb } from '../data/db.js';

// Testing Library cleans up by itself only when Vitest globals are on; they
// are off here, so unmount after every test and start each from an empty page
// at the root route, with an empty IndexedDB. A few tests run in the node
// environment, which has no window.
afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.history.replaceState(null, '', '/');
  closeAppDb();
  globalThis.indexedDB = new IDBFactory();
});
