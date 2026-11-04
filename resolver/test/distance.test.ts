// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { damerauLevenshtein } from '../src/index.js';

describe('damerauLevenshtein (optimal string alignment)', () => {
  it('is 0 for equal strings and the length for an empty side', () => {
    expect(damerauLevenshtein('abc', 'abc')).toBe(0);
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abcd', '')).toBe(4);
    expect(damerauLevenshtein('', '')).toBe(0);
  });

  it('counts insertion, deletion and substitution as one each', () => {
    expect(damerauLevenshtein('doliprane', 'dolipran')).toBe(1);
    expect(damerauLevenshtein('doliprane', 'doliprann')).toBe(1);
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
  });

  it('counts an adjacent transposition as one', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
    expect(damerauLevenshtein('moringa', 'morigna')).toBe(1);
  });

  it('is the optimal string alignment distance, not the unrestricted one', () => {
    expect(damerauLevenshtein('ca', 'abc')).toBe(3);
  });

  it('is symmetric', () => {
    expect(damerauLevenshtein('bactrim', 'baktrim')).toBe(damerauLevenshtein('baktrim', 'bactrim'));
  });
});
