// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { normalize } from '../src/index.js';

describe('normalize: base rules', () => {
  it('removes accents, case, punctuation and extra spaces', () => {
    expect(normalize('  Kinkéliba ')).toBe('kinkeliba');
    expect(normalize('Néo-Codion')).toBe('neo codion');
    expect(normalize("l'huile  de RICIN")).toBe('l huil de ricin');
  });

  it('returns an empty string for text without letters or digits', () => {
    expect(normalize(' -- ')).toBe('');
  });
});

describe('normalize: spelling variants', () => {
  it('maps ph to f', () => {
    expect(normalize('phenytoine')).toBe(normalize('fenitoine'));
    expect(normalize('Pharmacie')).toBe('farmaci');
  });

  it('maps y to i', () => {
    expect(normalize('nebeday')).toBe('nebedai');
    expect(normalize('Kinkeliba')).toBe(normalize('Kinkelyba'));
  });

  it('collapses doubled consonants', () => {
    expect(normalize('doliprann')).toBe('dolipran');
    expect(normalize('Bissap')).toBe('bisap');
    expect(normalize('paracettamol')).toBe('paracetamol');
  });

  it('keeps doubled vowels and doubled digits', () => {
    expect(normalize('zoo')).toBe('zoo');
    expect(normalize('1000 mg')).toBe('1000 mg');
  });

  it('strips a trailing e in words of more than 4 letters only', () => {
    expect(normalize('ibuprofene')).toBe('ibuprofen');
    expect(normalize('Doliprane')).toBe('dolipran');
    expect(normalize('huile')).toBe('huil');
    expect(normalize('tube')).toBe('tube');
    expect(normalize('moye')).toBe('moie');
  });

  it('applies to every word', () => {
    expect(normalize('huile de ricine')).toBe('huil de ricin');
  });

  it('maps qu to k (the French spelling of the k sound)', () => {
    expect(normalize('quinquéliba')).toBe(normalize('kinkéliba'));
    expect(normalize('Nivaquine')).toBe(normalize('nivakine'));
    expect(normalize('quinine')).toBe('kinin');
  });

  it('does not map kh to x because it changes the meaning', () => {
    expect(normalize('dakhar')).toBe('dakhar');
    expect(normalize('dakhar')).not.toBe(normalize('daxar'));
  });

  it('is idempotent', () => {
    for (const text of ['Doliprane', 'phénytoïne', 'huile de ricin', 'Bactrim Forte']) {
      expect(normalize(normalize(text))).toBe(normalize(text));
    }
  });
});
