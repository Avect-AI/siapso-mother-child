// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { normalize } from '../src/index.js';

it('removes accents, case, punctuation and extra spaces', () => {
  expect(normalize('  Kinkéliba ')).toBe('kinkeliba');
  expect(normalize('Néo-Codion')).toBe('neo codion');
  expect(normalize("l'huile  de RICIN")).toBe('l huile de ricin');
});
