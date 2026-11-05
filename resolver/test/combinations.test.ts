// SPDX-License-Identifier: MIT
// A query that names a substance ("efferalgan codéine", "paracétamol codéine")
// never ranks a product without that substance before one that has it, and a
// query made only of substance names finds the products that hold them all.
import { describe, expect, it } from 'vitest';
import { buildIndex, entriesFromPack, namedSubstances, search } from '../src/index.js';
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
