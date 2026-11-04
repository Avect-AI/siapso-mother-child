// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { trigrams } from '../src/index.js';

describe('trigrams', () => {
  it('pads the boundaries so that the first and last letters weigh in', () => {
    expect([...trigrams('abc')].sort()).toEqual(['  a', ' ab', 'abc', 'bc '].sort());
  });

  it('returns a set without duplicates', () => {
    expect(trigrams('aaaa').size).toBe(4);
  });

  it('returns an empty set for an empty text', () => {
    expect(trigrams('').size).toBe(0);
  });

  it('is deterministic', () => {
    expect([...trigrams('kinkeliba')]).toEqual([...trigrams('kinkeliba')]);
  });
});
