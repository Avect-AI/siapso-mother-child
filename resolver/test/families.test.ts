// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { buildIndex, search } from '../src/index.js';
import type { IndexEntry } from '../src/index.js';

function product(
  id: string,
  family: string,
  names: IndexEntry['names'],
  extra: Partial<IndexEntry> = {},
): IndexEntry {
  return {
    id,
    kind: 'product',
    family,
    display: { fr: id, en: id },
    names,
    priority: 3,
    detail: '',
    ...extra,
  };
}

const brand = (id: string, family: string, name: string, mg: number): IndexEntry =>
  product(
    id,
    family,
    [
      { text: name, lang: 'brand' },
      { text: `${name} ${String(mg)} mg, comprimé`, lang: 'fr' },
    ],
    { strengths: [mg], componentCount: 1 },
  );

const ENTRIES: IndexEntry[] = [
  brand('doliprane-1000-a', 'brand:doliprane', 'DOLIPRANE', 1000),
  brand('doliprane-1000-b', 'brand:doliprane', 'DOLIPRANE', 1000),
  brand('doliprane-500', 'brand:doliprane', 'DOLIPRANE', 500),
  brand('doliprane-100', 'brand:doliprane', 'DOLIPRANE', 100),
  product('fer-generic', 'substances:iron', [{ text: 'Fer (générique)', lang: 'fr' }], {
    priority: 2,
  }),
  brand('fer-ap-hp', 'brand:fer ap-hp', 'FER AP-HP', 0.5),
  brand('fertifol', 'brand:fertifol', 'FERTIFOL', 0.4),
  brand('fero-grad', 'brand:fero-grad', 'FERO-GRAD', 66),
  product(
    'paracetamol-generic',
    'substances:paracetamol',
    [
      { text: 'Paracétamol (générique)', lang: 'fr' },
      { text: 'paracétamol', lang: 'inn' },
    ],
    { priority: 2, componentCount: 1 },
  ),
  product(
    'cold-sachet-paracetamol',
    'substances:ascorbic-acid+paracetamol+pheniramine',
    [
      { text: 'Sachet contre le rhume', lang: 'fr' },
      { text: 'paracétamol', lang: 'inn' },
    ],
    { priority: 2, componentCount: 3, strengths: [500] },
  ),
  product('efferalgan-500', 'brand:efferalgan', [{ text: 'paracétamol', lang: 'inn' }], {
    priority: 1,
    strengths: [500],
    componentCount: 1,
  }),
  brand('efferalgan-500', 'brand:efferalgan', 'EFFERALGAN', 500),
  product(
    'ibuprofen-generic',
    'substances:ibuprofen',
    [
      { text: 'Ibuprofène (générique)', lang: 'fr' },
      { text: 'ibuprofène', lang: 'inn' },
    ],
    { priority: 2, componentCount: 1 },
  ),
  product('advil-200', 'brand:advil', [{ text: 'ibuprofène', lang: 'inn' }], {
    priority: 1,
    strengths: [200],
    componentCount: 1,
  }),
  brand('advil-200', 'brand:advil', 'ADVIL', 200),
  product('advil-400', 'brand:advil', [{ text: 'ibuprofène', lang: 'inn' }], {
    priority: 1,
    strengths: [400],
    componentCount: 1,
  }),
  brand('advil-400', 'brand:advil', 'ADVIL', 400),
  product('nurofen-400', 'brand:nurofen', [{ text: 'ibuprofène', lang: 'inn' }], {
    priority: 1,
    strengths: [400],
    componentCount: 1,
  }),
  brand('nurofen-400', 'brand:nurofen', 'NUROFEN', 400),
  product('nouveau-ne', 'brand:nn', [{ text: 'Soin du NOUVEAU-NE', lang: 'fr' }]),
  product('sp', 'substances:sp', [{ text: 'SP (sulfadoxine-pyriméthamine)', lang: 'fr' }], {
    priority: 2,
  }),
  {
    id: 'moringa',
    kind: 'plant',
    family: 'moringa',
    display: { fr: 'Moringa', en: 'Moringa' },
    names: [{ text: 'nebeday', lang: 'wo' }],
    priority: 2,
    detail: '',
  },
];

const index = buildIndex(ENTRIES);
const ids = (query: string, options = {}) =>
  search(index, query, options).map((candidate) => candidate.id);

describe('families', () => {
  it('returns one candidate per family, the best one', () => {
    const results = search(index, 'doli', { limit: 10 });
    expect(results.map((candidate) => candidate.family)).toEqual(['brand:doliprane']);
    expect(results[0]?.id).toBe('doliprane-100');
  });

  it('lists the other products of the family as variants: strength ascending, then id', () => {
    const [first] = search(index, 'doliprane');
    expect(first?.id).toBe('doliprane-100');
    expect(first?.variants).toEqual(['doliprane-500', 'doliprane-1000-a', 'doliprane-1000-b']);
  });

  it('counts the limit in families', () => {
    const results = search(index, 'fe', { limit: 2, minScore: 0 });
    expect(new Set(results.map((candidate) => candidate.family)).size).toBe(results.length);
    expect(search(index, 'ibuprofene', { limit: 2 })).toHaveLength(2);
  });

  it('gives a plant or a product without variants an empty list', () => {
    expect(search(index, 'nebeday')[0]?.variants).toEqual([]);
    expect(search(index, 'fertifol')[0]?.variants).toEqual([]);
  });
});

describe('a family holding a product without strength', () => {
  const generic = (id: string, strengths: number[]): IndexEntry =>
    product(
      id,
      'substances:paracetamol',
      [
        {
          text: `Paracétamol ${strengths.map((mg) => `${String(mg)} mg `).join('')}(générique)`,
          lang: 'fr',
        },
        { text: 'paracétamol', lang: 'inn' },
      ],
      { priority: 2, componentCount: 1, ...(strengths.length > 0 ? { strengths } : {}) },
    );
  const generics = buildIndex([
    generic('paracetamol-1000-generic', [1000]),
    generic('paracetamol-500-generic', [500]),
    generic('paracetamol-generic', []),
  ]);

  it('is shown by that product when no strength is typed, the strengths as variants', () => {
    const [first] = search(generics, 'paracetamol');
    expect(first?.id).toBe('paracetamol-generic');
    expect(first?.variants).toEqual(['paracetamol-500-generic', 'paracetamol-1000-generic']);
  });

  it('keeps the usual order in a brand family, where a product without strength is a liquid', () => {
    const syrup = product(
      'doliprane-syrup',
      'brand:doliprane',
      [{ text: 'DOLIPRANE', lang: 'brand' }],
      { componentCount: 1 },
    );
    const brands = buildIndex([brand('doliprane-100', 'brand:doliprane', 'DOLIPRANE', 100), syrup]);
    expect(search(brands, 'doliprane')[0]?.id).toBe('doliprane-100');
  });

  it('is shown by the product of the typed strength', () => {
    expect(search(generics, 'paracetamol 1 g')[0]?.id).toBe('paracetamol-1000-generic');
    expect(search(generics, 'paracetamol 500')[0]?.variants).toEqual([
      'paracetamol-1000-generic',
      'paracetamol-generic',
    ]);
  });
});

describe('scoring order: whole word above prefix', () => {
  it('ranks an exact whole word 0.95 above the prefix of another word 0.9', () => {
    const results = search(index, 'fer', { limit: 5 });
    const byId = new Map(results.map((candidate) => [candidate.id, candidate.score]));
    // "Fer (générique)" is "fer": "générique" names no medicine.
    expect(byId.get('fer-generic')).toBe(1);
    expect(byId.get('fer-ap-hp')).toBe(0.95);
    expect(byId.get('fertifol')).toBe(0.9);
    expect(byId.get('fero-grad')).toBe(0.9);
    expect(ids('fer', { limit: 3 })).toContain('fer-generic');
    expect(results.at(-1)?.score).toBe(0.9);
  });

  it('matches a prefix of a word of a multi-word name', () => {
    expect(search(index, 'nouv')[0]).toMatchObject({ id: 'nouveau-ne', score: 0.9 });
  });

  it('matches a two-letter query only as a whole name or a two-letter word, at 0.6', () => {
    expect(search(index, 'ne')).toMatchObject([{ id: 'nouveau-ne', score: 0.6 }]);
    expect(search(index, 'SP')).toMatchObject([{ id: 'sp', score: 0.6 }]);
    expect(search(index, 'nb')).toEqual([]);
  });
});

describe('strength in the query', () => {
  it('returns the variant whose strength matches', () => {
    expect(search(index, 'doliprane 1 g')[0]).toMatchObject({ id: 'doliprane-1000-a' });
    expect(search(index, 'doliprane 1000')[0]).toMatchObject({ id: 'doliprane-1000-a' });
    expect(search(index, 'doliprane 0,5 g')[0]).toMatchObject({ id: 'doliprane-500' });
    expect(search(index, 'doliprane 500 mg')[0]?.variants).not.toContain('doliprane-500');
    expect(search(index, 'doliprane 500')[0]?.variants).toEqual([
      'doliprane-100',
      'doliprane-1000-a',
      'doliprane-1000-b',
    ]);
  });

  it('ranks a product with the strength first for an INN query', () => {
    expect(ids('paracetamol 500')[0]).toBe('efferalgan-500');
    expect(ids('ibuprofene 400')[0]).toBe('advil-400');
    expect(ids('ibuprofene400')[0]).toBe('advil-400');
  });

  it('does not change the name matching when no variant has the strength', () => {
    expect(search(index, 'doliprane 777')[0]?.id).toBe('doliprane-100');
  });

  it('returns nothing for a query made only of a strength', () => {
    expect(search(index, '500 mg')).toEqual([]);
  });
});

describe('single-substance products before combinations', () => {
  it('puts the single-substance generic before the combination for an INN query', () => {
    const results = ids('paracetamol', { limit: 3 });
    expect(results.indexOf('paracetamol-generic')).toBeLessThan(
      results.indexOf('cold-sachet-paracetamol'),
    );
  });
});
