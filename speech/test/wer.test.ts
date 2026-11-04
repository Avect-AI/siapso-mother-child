// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { addCounts, errorRate, normalise, wordErrors } from '../eval/wer.js';

describe('normalise', () => {
  it('lowercases and removes punctuation', () => {
    expect(normalise('Bonjour, Madame !')).toEqual(['bonjour', 'madame']);
  });

  it('keeps French accents', () => {
    expect(normalise('Où est la pharmacie à côté ?')).toEqual([
      'où',
      'est',
      'la',
      'pharmacie',
      'à',
      'côté',
    ]);
  });

  it('keeps Wolof letters', () => {
    expect(normalise('Ñu dem ci dëkk bi.')).toEqual(['ñu', 'dem', 'ci', 'dëkk', 'bi']);
  });

  it('treats an apostrophe as a word break, like the quick check', () => {
    expect(normalise("l'eau d'ici")).toEqual(['l', 'eau', 'd', 'ici']);
  });

  it('gives the same words for composed and decomposed accents', () => {
    expect(normalise('été')).toEqual(normalise('été'));
  });

  it('returns no word for an empty or punctuation-only text', () => {
    expect(normalise('')).toEqual([]);
    expect(normalise(' ... ! ')).toEqual([]);
  });
});

describe('wordErrors', () => {
  it('counts nothing for identical texts', () => {
    expect(wordErrors('un deux trois', 'Un, deux trois.')).toEqual({
      substitutions: 0,
      deletions: 0,
      insertions: 0,
      referenceWords: 3,
    });
  });

  it('counts a substitution', () => {
    expect(wordErrors('un deux trois', 'un quatre trois')).toEqual({
      substitutions: 1,
      deletions: 0,
      insertions: 0,
      referenceWords: 3,
    });
  });

  it('counts a deletion', () => {
    expect(wordErrors('un deux trois', 'un trois')).toEqual({
      substitutions: 0,
      deletions: 1,
      insertions: 0,
      referenceWords: 3,
    });
  });

  it('counts an insertion', () => {
    expect(wordErrors('un trois', 'un deux trois')).toEqual({
      substitutions: 0,
      deletions: 0,
      insertions: 1,
      referenceWords: 2,
    });
  });

  it('counts a mix of the three', () => {
    const counts = wordErrors('a b c d e', 'a x c e y');
    // Three errors (more than one alignment has that cost), over five reference words.
    const total = counts.substitutions + counts.deletions + counts.insertions;
    expect(total).toBe(3);
    expect(counts.referenceWords).toBe(5);
  });

  it('counts every reference word as deleted for an empty hypothesis', () => {
    expect(wordErrors('un deux', '')).toEqual({
      substitutions: 0,
      deletions: 2,
      insertions: 0,
      referenceWords: 2,
    });
  });

  it('counts every hypothesis word as inserted for an empty reference', () => {
    expect(wordErrors('', 'un deux')).toEqual({
      substitutions: 0,
      deletions: 0,
      insertions: 2,
      referenceWords: 0,
    });
  });

  it('counts nothing when both are empty', () => {
    expect(wordErrors('', '')).toEqual({
      substitutions: 0,
      deletions: 0,
      insertions: 0,
      referenceWords: 0,
    });
  });

  it('treats a different accent as a different word', () => {
    expect(wordErrors('pâte', 'pate').substitutions).toBe(1);
  });
});

describe('errorRate', () => {
  it('divides the errors by the reference words', () => {
    const counts = wordErrors('un deux trois quatre', 'un deux');
    expect(errorRate(counts)).toBe(0.5);
  });

  it('can exceed 1 when the hypothesis is long', () => {
    expect(errorRate(wordErrors('un', 'a b c'))).toBe(3);
  });

  it('is null, never a number, for an empty reference', () => {
    expect(errorRate(wordErrors('', ''))).toBeNull();
    expect(errorRate(wordErrors('', 'un'))).toBeNull();
  });
});

describe('addCounts', () => {
  it('sums the counts, so the corpus rate weighs each word equally', () => {
    const total = addCounts([wordErrors('a b', 'a'), wordErrors('c d e f', 'c d e f')]);
    expect(total).toEqual({
      substitutions: 0,
      deletions: 1,
      insertions: 0,
      referenceWords: 6,
    });
    expect(errorRate(total)).toBeCloseTo(1 / 6);
  });

  it('is empty for no utterance', () => {
    expect(errorRate(addCounts([]))).toBeNull();
  });
});
