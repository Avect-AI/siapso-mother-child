// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { appName } from './app-name.js';

it('uses the configured name, trimmed', () => {
  expect(appName('  Yaay  ')).toBe('Yaay');
});

it('falls back to "Carnet" when no name is configured', () => {
  expect(appName(undefined)).toBe('Carnet');
  expect(appName('   ')).toBe('Carnet');
});
