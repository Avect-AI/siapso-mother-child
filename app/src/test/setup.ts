// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library cleans up by itself only when Vitest globals are on; they
// are off here, so unmount after every test and start each from an empty page.
afterEach(() => {
  cleanup();
});
