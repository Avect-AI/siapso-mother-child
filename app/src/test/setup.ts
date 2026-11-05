// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach } from 'vitest';
import { closeAppDb } from '../data/db.js';
import { forgetVisit } from '../data/history.js';

// A code is worked out with PBKDF2 at 600 000 iterations, as on the phone: on a
// loaded machine with coverage, the screen it opens can take more than the
// default second to appear.
configure({ asyncUtilTimeout: 5000 });

// Testing Library cleans up by itself only when Vitest globals are on; they
// are off here, so unmount after every test and start each from an empty page
// at the root route, with an empty IndexedDB. A few tests run in the node
// environment, which has no window.
afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.history.replaceState(null, '', '/');
  closeAppDb();
  // Each test is a new visit: the history records every check again.
  forgetVisit();
  globalThis.indexedDB = new IDBFactory();
});
