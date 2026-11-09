// SPDX-License-Identifier: MIT
// How clearly a text names a candidate: the rules the safety net of the
// result and the reading of a sentence share (SCRUM-51, SCRUM-61).
import { describe, expect, it } from 'vitest';
import { matchStrength } from '../src/index.js';
import type { Candidate } from '../src/index.js';

function candidate(extra: Partial<Candidate>): Candidate {
  return {
    id: 'x',
    kind: 'product',
    family: 'x',
    display: { fr: 'X', en: 'X' },
    detail: '',
    matched: 'x',
    matchedLang: 'brand',
    score: 1,
    match: 'exact',
    queryLength: 8,
    variants: [],
    ...extra,
  };
}

describe('matchStrength', () => {
  it('reads a whole name, a name inside a longer text or a score of 0.9 as very strong', () => {
    expect(matchStrength(candidate({ match: 'exact', score: 1 }))).toBe('very-strong');
    expect(matchStrength(candidate({ match: 'contained', score: 0.9 }))).toBe('very-strong');
    expect(matchStrength(candidate({ match: 'word', score: 0.95 }))).toBe('very-strong');
    expect(matchStrength(candidate({ match: 'prefix', score: 0.9, queryLength: 7 }))).toBe(
      'very-strong',
    );
  });

  it('reads a near spelling or a score of 0.8 as strong', () => {
    expect(matchStrength(candidate({ match: 'near', score: 0.71 }))).toBe('strong');
    expect(matchStrength(candidate({ match: 'fuzzy', score: 0.82 }))).toBe('strong');
  });

  it('reads a short prefix, a close word, a weak word or a low score as weak', () => {
    expect(matchStrength(candidate({ match: 'prefix', score: 0.9, queryLength: 4 }))).toBe('weak');
    expect(matchStrength(candidate({ match: 'fuzzy-word', score: 0.85 }))).toBe('weak');
    expect(matchStrength(candidate({ match: 'word', score: 0.95, weakWord: 'shared' }))).toBe(
      'weak',
    );
    expect(matchStrength(candidate({ match: 'word', score: 0.95, weakWord: 'inner' }))).toBe(
      'weak',
    );
    expect(matchStrength(candidate({ match: 'fuzzy', score: 0.7 }))).toBe('weak');
  });
});
