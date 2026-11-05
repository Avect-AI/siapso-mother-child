// SPDX-License-Identifier: MIT
// A query that names a substance ("efferalgan codéine", "paracétamol codéine")
// never ranks a product without that substance before one that has it, and a
// query made only of substance names finds the products that hold them all.
import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  entriesFromPack,
  namedSubstances,
  queryMentions,
  search,
} from '../src/index.js';
import type { PackNames } from '../src/index.js';

const product = (
  id: string,
  fr: string,
  brands: string[],
  components: PackNames['products'][number]['components'],
): PackNames['products'][number] => ({
  id,
  names: { fr, en: fr },
  brands,
  localNames: [],
  components,
});

const PACK: PackNames = {
  substances: [
    { id: 'paracetamol', names: { fr: 'Paracétamol', en: 'Paracetamol' } },
    { id: 'codeine', names: { fr: 'Codéine', en: 'Codeine' } },
    { id: 'tramadol', names: { fr: 'Tramadol', en: 'Tramadol' } },
    { id: 'ascorbic-acid', names: { fr: 'Acide ascorbique (vitamine C)', en: 'Vitamin C' } },
  ],
  products: [
    product('paracetamol-generic', 'Paracétamol (générique)', [], [{ substance: 'paracetamol' }]),
    product(
      'efferalgan-500',
      'EFFERALGAN 500 mg, comprimé',
      ['EFFERALGAN'],
      [{ substance: 'paracetamol', strengthMg: 500 }],
    ),
    product(
      'dafalgan-500',
      'DAFALGAN 500 mg, gélule',
      ['DAFALGAN'],
      [{ substance: 'paracetamol', strengthMg: 500 }],
    ),
    product(
      'dafalgan-codeine',
      'DAFALGAN CODEINE, comprimé pelliculé',
      ['DAFALGAN CODEINE'],
      [
        { substance: 'paracetamol', strengthMg: 500 },
        { substance: 'codeine', strengthMg: 30 },
      ],
    ),
    product(
      'codoliprane',
      'CODOLIPRANE 500 mg/30 mg, comprimé',
      ['CODOLIPRANE'],
      [
        { substance: 'paracetamol', strengthMg: 500 },
        { substance: 'codeine', strengthMg: 30 },
      ],
    ),
    product(
      'ixprim',
      'IXPRIM 37,5 mg/325 mg, comprimé pelliculé',
      ['IXPRIM'],
      [
        { substance: 'tramadol', strengthMg: 37.5 },
        { substance: 'paracetamol', strengthMg: 325 },
      ],
    ),
    product('tramadol-generic', 'Tramadol (générique)', [], [{ substance: 'tramadol' }]),
    product(
      'efferalgan-vitamine-c',
      'EFFERALGAN VITAMINE C 500 mg/200 mg',
      ['EFFERALGAN VITAMINE C'],
      [
        { substance: 'paracetamol', strengthMg: 500 },
        { substance: 'ascorbic-acid', strengthMg: 200 },
      ],
    ),
  ],
  plants: [],
};

const index = buildIndex(entriesFromPack(PACK));
const ids = (query: string): string[] => search(index, query).map((candidate) => candidate.id);

describe('namedSubstances', () => {
  it('gives the substances a query names, by any of their names, sorted', () => {
    expect(namedSubstances(index, 'efferalgan codéine')).toEqual(['codeine']);
    expect(namedSubstances(index, 'Paracetamol/Codeine 500 mg')).toEqual([
      'codeine',
      'paracetamol',
    ]);
    expect(namedSubstances(index, 'efferalgan vitamine c')).toEqual(['ascorbic-acid']);
    expect(namedSubstances(index, 'tramadol et paracétamol')).toEqual(['paracetamol', 'tramadol']);
  });

  it('gives none for a brand alone, a form or an empty query', () => {
    expect(namedSubstances(index, 'efferalgan')).toEqual([]);
    expect(namedSubstances(index, 'comprimé')).toEqual([]);
    expect(namedSubstances(index, '')).toEqual([]);
  });
});

describe('a query that names a substance', () => {
  it('ranks the products without that substance after the products that hold it', () => {
    const found = ids('efferalgan codeine');
    expect(['dafalgan-codeine', 'codoliprane']).toContain(found[0]);
    // A product without codeine is kept only when its name matches as well (EFFERALGAN, contained).
    expect(found).toContain('efferalgan-500');
    const withoutCodeine = found.findIndex(
      (id) => !['dafalgan-codeine', 'codoliprane'].includes(id),
    );
    const lastWithCodeine = Math.max(
      found.indexOf('dafalgan-codeine'),
      found.indexOf('codoliprane'),
    );
    if (withoutCodeine >= 0) expect(withoutCodeine).toBeGreaterThan(lastWithCodeine);
  });

  it('finds the products holding every substance named, with no other word', () => {
    expect(ids('paracetamol codeine').sort()).toEqual(['codoliprane', 'dafalgan-codeine']);
    expect(ids('paracétamol codéine').sort()).toEqual(['codoliprane', 'dafalgan-codeine']);
    expect(ids('codéine paracétamol').sort()).toEqual(['codoliprane', 'dafalgan-codeine']);
    expect(ids('tramadol paracetamol')).toEqual(['ixprim']);
    expect(ids('paracetamol et tramadol')).toEqual(['ixprim']);
  });

  it('keeps a single substance query as it was: the generic first', () => {
    expect(ids('paracetamol')[0]).toBe('paracetamol-generic');
    expect(ids('tramadol')[0]).toBe('tramadol-generic');
  });

  it('finds a substance by the part of its name in brackets', () => {
    expect(namedSubstances(index, 'acide ascorbique')).toEqual(['ascorbic-acid']);
    expect(namedSubstances(index, 'vitamine c')).toEqual(['ascorbic-acid']);
    expect(ids('vitamine c')).toContain('efferalgan-vitamine-c');
    expect(ids('efferalgan vitamine c')[0]).toBe('efferalgan-vitamine-c');
  });

  it('does not make a part in brackets a name of its own', () => {
    const iron = buildIndex(
      entriesFromPack({
        substances: [{ id: 'iron', names: { fr: 'Fer (sels ferreux)', en: 'Iron' } }],
        products: [product('iron-generic', 'Fer (générique)', [], [{ substance: 'iron' }])],
        plants: [],
      }),
    );
    // "sel" is the start of "sels ferreux", not a name.
    expect(search(iron, 'sel')).toEqual([]);
    expect(namedSubstances(iron, 'fer')).toEqual(['iron']);
  });
});

// Live test round 2 (depot-keeper#1): "Advil codéine" names a brand of
// ibuprofen, so a codeine-only product must not come first, nor be taken
// without a word that Advil is ibuprofen.
describe('a brand named in the query', () => {
  const withBrands = (products: PackNames['products']) =>
    buildIndex(
      entriesFromPack({
        substances: [
          { id: 'ibuprofen', names: { fr: 'Ibuprofène', en: 'Ibuprofen' } },
          { id: 'codeine', names: { fr: 'Codéine', en: 'Codeine' } },
          { id: 'paracetamol', names: { fr: 'Paracétamol', en: 'Paracetamol' } },
        ],
        products,
        plants: [],
      }),
    );
  const advil = [
    product(
      'advil-200',
      'ADVIL 200 mg, comprimé enrobé',
      ['ADVIL'],
      [{ substance: 'ibuprofen', strengthMg: 200 }],
    ),
    product(
      'advil-400',
      'ADVIL 400 mg, comprimé enrobé',
      ['ADVIL'],
      [{ substance: 'ibuprofen', strengthMg: 400 }],
    ),
    product('codeine-generic', 'Codéine (générique)', [], [{ substance: 'codeine' }]),
    product(
      'neo-codion',
      'Néo-Codion, comprimé enrobé',
      ['Néo-Codion'],
      [{ substance: 'codeine' }],
    ),
  ];
  const antarene = product(
    'antarene-codeine',
    'ANTARENE CODEINE 200 mg/30 mg, comprimé pelliculé',
    ['ANTARENE CODEINE'],
    [
      { substance: 'ibuprofen', strengthMg: 200 },
      { substance: 'codeine', strengthMg: 30 },
    ],
  );

  it('says which brands and substances a query names, with the substances each stands for', () => {
    const brands = withBrands([...advil, antarene]);
    expect(queryMentions(brands, 'Advil codéine')).toEqual([
      { name: 'ADVIL', kind: 'brand', substances: ['ibuprofen'] },
      { name: 'Codéine', kind: 'substance', substances: ['codeine'] },
    ]);
    expect(queryMentions(brands, 'advil 400 mg')).toEqual([
      { name: 'ADVIL', kind: 'brand', substances: ['ibuprofen'] },
    ]);
    // The longest brand first: ANTARENE CODEINE, which also names codeine.
    expect(queryMentions(brands, 'antarene codeine')).toEqual([
      { name: 'ANTARENE CODEINE', kind: 'brand', substances: ['codeine', 'ibuprofen'] },
      { name: 'Codéine', kind: 'substance', substances: ['codeine'] },
    ]);
    expect(queryMentions(brands, 'sirop')).toEqual([]);
    // namedSubstances keeps to the substances named.
    expect(namedSubstances(brands, 'Advil codéine')).toEqual(['codeine']);
  });

  it('ranks first the product that holds the substances of the brand and of the name', () => {
    const found = search(withBrands([...advil, antarene]), 'Advil codéine').map((c) => c.id);
    expect(found[0]).toBe('antarene-codeine');
  });

  it('ranks a product lacking the substance the brand implies after the ones that hold it', () => {
    const found = search(withBrands([...advil, antarene]), 'Advil codéine', { limit: 5 }).map(
      (c) => c.id,
    );
    expect(found.indexOf('antarene-codeine')).toBeLessThan(found.indexOf('codeine-generic'));
  });

  it('keeps both when no product holds them all: the brand and the substance', () => {
    const found = search(withBrands(advil), 'Advil codéine', { limit: 5 }).map((c) => c.id);
    expect(found).toEqual(expect.arrayContaining(['codeine-generic']));
    expect(found.some((id) => id.startsWith('advil-'))).toBe(true);
  });
});
