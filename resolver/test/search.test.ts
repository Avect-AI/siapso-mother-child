// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { buildIndex, search } from '../src/index.js';
import type { IndexEntry } from '../src/index.js';

function entry(partial: Partial<IndexEntry> & Pick<IndexEntry, 'id' | 'names'>): IndexEntry {
  return {
    kind: 'product',
    family: partial.id,
    display: { fr: partial.id, en: partial.id },
    priority: 2,
    detail: '',
    ...partial,
  };
}

const ENTRIES: IndexEntry[] = [
  entry({
    id: 'doliprane-1000',
    priority: 3,
    display: { fr: 'DOLIPRANE 1000 mg, comprimé', en: 'DOLIPRANE 1000 mg, tablet' },
    detail: 'paracétamol 1000 mg',
    names: [
      { text: 'DOLIPRANE 1000 mg, comprimé', lang: 'fr' },
      { text: 'DOLIPRANE', lang: 'brand' },
    ],
  }),
  entry({
    id: 'doliprane-500',
    priority: 3,
    names: [
      { text: 'DOLIPRANE 500 mg, gélule', lang: 'fr' },
      { text: 'DOLIPRANE', lang: 'brand' },
    ],
  }),
  entry({
    id: 'paracetamol-generic',
    names: [
      { text: 'Paracétamol (générique)', lang: 'fr' },
      { text: 'Paracétamol', lang: 'inn' },
    ],
  }),
  entry({
    id: 'paracetamol-inn-only',
    priority: 1,
    names: [{ text: 'Paracétamol', lang: 'inn' }],
  }),
  entry({
    id: 'moringa',
    kind: 'plant',
    names: [
      { text: 'Moringa', lang: 'fr' },
      { text: 'nebeday', lang: 'wo' },
      { text: 'Moringa oleifera', lang: 'latin' },
    ],
  }),
  entry({
    id: 'castor-oil',
    kind: 'plant',
    names: [
      { text: 'Huile de ricin', lang: 'fr' },
      { text: 'Ricinus communis', lang: 'latin' },
    ],
  }),
  entry({
    id: 'bactrim',
    priority: 3,
    names: [{ text: 'BACTRIM', lang: 'brand' }],
  }),
  entry({
    id: 'sp',
    names: [{ text: 'SP (sulfadoxine-pyriméthamine)', lang: 'fr' }],
  }),
];

const index = buildIndex(ENTRIES);

describe('buildIndex', () => {
  it('reports its size', () => {
    expect(index.size).toBe(ENTRIES.length);
    expect(buildIndex([]).size).toBe(0);
  });
});

describe('search scoring', () => {
  it('scores an exact normalised match of a whole name 1', () => {
    const [first] = search(index, 'Nebeday');
    expect(first).toMatchObject({
      id: 'moringa',
      kind: 'plant',
      matched: 'nebeday',
      matchedLang: 'wo',
      score: 1,
    });
  });

  it('scores a prefix of a name (3 characters or more) 0.9', () => {
    // "Moringa ole" holds the whole name "Moringa" too: contained, also 0.9.
    expect(search(index, 'Moringa ole')[0]).toMatchObject({ id: 'moringa', score: 0.9 });
    expect(search(index, 'morin')[0]).toMatchObject({ id: 'moringa', score: 0.9, match: 'prefix' });
  });

  it('does not use the prefix rule below 3 characters', () => {
    const results = search(index, 'mo', { minScore: 0.85 });
    expect(results).toEqual([]);
  });

  it('finds a misspelling through the spelling variants', () => {
    const [first] = search(index, 'doliprann');
    expect(first?.id).toBe('doliprane-1000');
    expect(first?.score).toBe(1);
  });

  it('finds a misspelling with an edit through trigrams and distance', () => {
    const [first] = search(index, 'baktrim');
    expect(first?.id).toBe('bactrim');
    expect(first?.score).toBeGreaterThan(0.6);
    expect(first?.score).toBeLessThan(1);
  });

  it('finds an exact word of a multi-word name at 0.95, below a whole-name match', () => {
    const [first] = search(index, 'communis');
    expect(first?.id).toBe('castor-oil');
    expect(first?.score).toBe(0.95);
    expect(first?.score).toBeGreaterThanOrEqual(0.45);
  });

  it('finds words split or merged as a speech model outputs them', () => {
    expect(search(index, 'huile de ricin')[0]?.id).toBe('castor-oil');
    expect(search(index, 'huiledericin')[0]?.id).toBe('castor-oil');
    expect(search(index, 'dolli prane')[0]?.id).toBe('doliprane-1000');
  });

  it('finds an abbreviation of 2 letters only as a whole word of a name', () => {
    const [first] = search(index, 'SP');
    expect(first).toMatchObject({ id: 'sp', score: 0.6 });
    expect(search(index, 'sq')).toEqual([]);
  });

  it('keeps scores in [0, 1]', () => {
    for (const query of ['nebeday', 'moringa', 'zzzz', 'doliprane', 'p']) {
      for (const candidate of search(index, query, { minScore: 0 })) {
        expect(candidate.score).toBeGreaterThanOrEqual(0);
        expect(candidate.score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('search ordering', () => {
  it('breaks ties by priority, then by id', () => {
    const results = search(index, 'paracetamol', { limit: 5 });
    expect(results.map((candidate) => candidate.id)).toEqual([
      'paracetamol-generic',
      'paracetamol-inn-only',
    ]);
    const brands = search(index, 'doliprane', { limit: 5 });
    expect(brands.map((candidate) => candidate.id)).toEqual(['doliprane-1000', 'doliprane-500']);
  });

  it('sorts by score descending first', () => {
    const results = search(index, 'moringa oleifer');
    const scores = results.map((candidate) => candidate.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('returns at most one candidate per id, with its best name', () => {
    const results = search(index, 'paracetamol', { limit: 10 });
    const ids = results.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(results[0]?.score).toBe(1);
  });

  it('is deterministic whatever the order of the entries', () => {
    const reversed = buildIndex([...ENTRIES].reverse());
    for (const query of ['doliprane', 'paracetamol', 'nebeday', 'ricin', 'baktrim']) {
      expect(search(reversed, query, { limit: 10 })).toEqual(search(index, query, { limit: 10 }));
    }
  });
});

describe('search options', () => {
  it('returns 3 candidates at most by default and honours limit', () => {
    const many = buildIndex(
      Array.from({ length: 6 }, (_, number) =>
        entry({ id: `brand-${String(number)}`, names: [{ text: 'Brandname', lang: 'brand' }] }),
      ),
    );
    expect(search(many, 'brandname')).toHaveLength(3);
    expect(search(many, 'brandname', { limit: 5 })).toHaveLength(5);
    expect(search(many, 'brandname', { limit: 1 })).toHaveLength(1);
  });

  it('returns nothing below minScore (0.55 by default)', () => {
    expect(search(index, 'xqzw')).toEqual([]);
    expect(search(index, 'paracet', { minScore: 0.95 })).toEqual([]);
    expect(search(index, 'paracet', { minScore: 0.9 })).not.toEqual([]);
  });

  it('filters by kind', () => {
    expect(search(index, 'moringa', { kinds: ['product'] })).toEqual([]);
    expect(search(index, 'moringa', { kinds: ['plant'] })[0]?.id).toBe('moringa');
    expect(search(index, 'moringa', { kinds: ['plant', 'product'] })[0]?.id).toBe('moringa');
  });

  it('returns nothing for an empty or symbol-only query', () => {
    expect(search(index, '')).toEqual([]);
    expect(search(index, ' - ')).toEqual([]);
  });

  it('carries display, detail and kind of the entry and never a level', () => {
    const [first] = search(index, 'doliprane 1000');
    expect(first).toMatchObject({
      id: 'doliprane-1000',
      kind: 'product',
      display: { fr: 'DOLIPRANE 1000 mg, comprimé', en: 'DOLIPRANE 1000 mg, tablet' },
      detail: 'paracétamol 1000 mg',
    });
    expect(Object.keys(first ?? {}).sort()).toEqual(
      [
        'detail',
        'display',
        'family',
        'id',
        'kind',
        'match',
        'matched',
        'matchedLang',
        'queryLength',
        'score',
        'variants',
      ].sort(),
    );
  });
});
