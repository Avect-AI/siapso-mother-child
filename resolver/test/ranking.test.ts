// SPDX-License-Identifier: MIT
// Ranking after the score: a strength written in the name, the form words of
// the query, products for newborns and children after the others, the plainest
// name of a family first, and generic plant words that name no remedy.
import { describe, expect, it } from 'vitest';
import { buildIndex, formWords, search } from '../src/index.js';
import type { IndexEntry } from '../src/index.js';

function product(
  id: string,
  family: string,
  name: string,
  extra: Partial<IndexEntry> = {},
): IndexEntry {
  const brand = family.replace(/^brand:/, '').toUpperCase();
  return {
    id,
    kind: 'product',
    family,
    display: { fr: name, en: name },
    names: [
      { text: name, lang: 'fr' },
      ...(family.startsWith('brand:') ? [{ text: brand, lang: 'brand' as const }] : []),
    ],
    priority: family.startsWith('brand:') ? 3 : 2,
    detail: '',
    componentCount: 1,
    ...extra,
  };
}

const index = buildIndex([
  product('iron-generic', 'substances:iron', 'Fer (générique)'),
  product('fer-ap-hp', 'brand:fer ap hp', 'FER AP-HP 0,5 mg NOUVEAU-NE, gélule', {
    names: [{ text: 'FER AP-HP 0,5 mg NOUVEAU-NE, gélule', lang: 'fr' }],
    strengths: [0.5],
  }),
  product('aspegic-500', 'brand:aspegic', 'ASPEGIC 500 mg, poudre en sachet-dose', {
    strengths: [500],
  }),
  product(
    'aspegic-adultes-1000',
    'brand:aspegic',
    'ASPEGIC ADULTES 1000 mg, poudre en sachet-dose',
  ),
  product('aspegic-enfants-250', 'brand:aspegic', 'ASPEGIC ENFANTS 250 mg, poudre en sachet-dose', {
    strengths: [250],
  }),
  product('doliprane-1000-c', 'brand:doliprane', 'DOLIPRANE 1000 mg, gélule', {
    strengths: [1000],
  }),
  product(
    'doliprane-1000-a',
    'brand:doliprane',
    'DOLIPRANE 1000 mg, comprimé effervescent sécable',
    {
      strengths: [1000],
    },
  ),
  product('doliprane-1000-b', 'brand:doliprane', 'DOLIPRANE 1000 mg, comprimé', {
    strengths: [1000],
  }),
  product('doliprane-500', 'brand:doliprane', 'DOLIPRANE 500 mg, comprimé', { strengths: [500] }),
  product('neo-codion', 'brand:neo-codion', 'Néo-Codion, comprimé enrobé', { strengths: [14.93] }),
  product('neo-codion-syrup', 'brand:neo-codion', 'Néo-Codion, sirop'),
  {
    id: 'castor-oil',
    kind: 'plant',
    family: 'castor-oil',
    display: { fr: 'Huile de ricin', en: 'Castor oil' },
    names: [{ text: 'Huile de ricin', lang: 'fr' }],
    priority: 2,
    detail: '',
  },
]);

const first = (query: string): string | undefined => search(index, query)[0]?.id;
const ids = (query: string): string[] => search(index, query).map((candidate) => candidate.id);

describe('products for newborns and children', () => {
  it('come after the others when the query names no age', () => {
    expect(ids('fer')).toEqual(['iron-generic', 'fer-ap-hp']);
    expect(first('aspegic')).not.toBe('aspegic-enfants-250');
  });

  it('come first when the query names their age', () => {
    expect(first('aspegic enfant')).toBe('aspegic-enfants-250');
  });
});

describe('a strength written in the name', () => {
  it('counts as the strength of a product that has none in mg', () => {
    expect(first('aspegic 1000')).toBe('aspegic-adultes-1000');
    expect(first('aspegic 1 g')).toBe('aspegic-adultes-1000');
  });
});

describe('form words of the query', () => {
  it('are exported as the normalised form words of a text', () => {
    expect(formWords('Doliprane 1000 comprimé effervescent')).toEqual(
      formWords('comprime efervescent'),
    );
    expect(formWords('doliprane')).toEqual([]);
    expect(formWords('Néo-Codion sirop')).toHaveLength(1);
  });

  it('choose the product of the family whose name has them', () => {
    expect(first('Doliprane 1000 comprimé effervescent')).toBe('doliprane-1000-a');
    expect(first('doliprane 1000 gélule')).toBe('doliprane-1000-c');
    expect(first('Neo-Codion sirop')).toBe('neo-codion-syrup');
  });

  it('leave the plainest name of the family first when none is typed', () => {
    expect(first('Doliprane 1000')).toBe('doliprane-1000-b');
    expect(first('neo-codion')).toBe('neo-codion');
  });
});

describe('the variants of a family', () => {
  it('are sorted by strength, then by name, the same way for every brand', () => {
    expect(search(index, 'doliprane 500')[0]?.variants).toEqual([
      'doliprane-1000-b',
      'doliprane-1000-a',
      'doliprane-1000-c',
    ]);
  });
});

describe('generic plant words', () => {
  it('name no remedy: a root or a bark alone gets no candidate', () => {
    for (const query of ['racine', 'racines', 'écorce', 'graine', 'tisane', 'plante', 'remède']) {
      expect(ids(query), query).toEqual([]);
    }
  });

  it('do not hide the name next to them', () => {
    expect(first('racine de ricin')).toBe('castor-oil');
  });
});
