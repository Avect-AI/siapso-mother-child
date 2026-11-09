// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach } from 'vitest';
import { codeOpened } from '../data/code-guard.js';
import { closeAppDb } from '../data/db.js';
import { forgetVisit } from '../data/history.js';
import { closeVault } from '../data/vault.js';
import { FRENCH_PHONE, phoneSetTo } from './phone.js';

// A code is worked out with PBKDF2 at 600 000 iterations, as on the phone: on a
// loaded machine with coverage, the screen it opens can take more than the
// default second to appear.
configure({ asyncUtilTimeout: 5000 });

// The test phone is set to French (jsdom says English): the app takes its
// first language from the phone, and most tests read the French interface.
// A test that needs another phone sets it (test/phone.ts).
beforeEach(() => {
  if (typeof window !== 'undefined') phoneSetTo(FRENCH_PHONE);
});

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
  // And a new page: it has opened no code yet, and holds no key.
  codeOpened(null);
  closeVault();
  globalThis.indexedDB = new IDBFactory();
});
