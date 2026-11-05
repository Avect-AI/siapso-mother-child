// SPDX-License-Identifier: MIT
// Text as written on a box or said at a sale: carrier words (huile, feuille,
// mousse) that name nothing, box abbreviations of forms (cpr, eff, gél), salt
// words that are a substance of their own, and a name contained in a longer
// text ("Advil pour les douleurs").
import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  entriesFromPack,
  formWords,
  normalize,
  search,
  withoutStopWords,
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

const plant = (id: string, fr: string, local: string[] = []): PackNames['plants'][number] => ({
  id,
  latinName: `${fr} latina`,
  names: { fr, en: fr },
  localNames: local.map((text) => ({ text, lang: 'wo' as const })),
});

const PACK: PackNames = {
  substances: [
    { id: 'ibuprofen', names: { fr: 'Ibuprofène', en: 'Ibuprofen' } },
    { id: 'misoprostol', names: { fr: 'Misoprostol', en: 'Misoprostol' } },
    { id: 'aspirin', names: { fr: 'Aspirine (acide acétylsalicylique)', en: 'Aspirin' } },
    { id: 'paracetamol', names: { fr: 'Paracétamol', en: 'Paracetamol' } },
    { id: 'codeine', names: { fr: 'Codéine', en: 'Codeine' } },
    { id: 'clobetasol', names: { fr: 'Clobétasol', en: 'Clobetasol' } },
    { id: 'calcium', names: { fr: 'Calcium', en: 'Calcium' } },
    { id: 'valproic-acid', names: { fr: 'Acide valproïque (valproate)', en: 'Valproic acid' } },
  ],
  products: [
    product(
      'advil-400',
      'ADVIL 400 mg, comprimé enrobé',
      ['ADVIL'],
      [{ substance: 'ibuprofen', strengthMg: 400 }],
    ),
    product(
      'misoprostol-generic',
      'Misoprostol (générique)',
      ['Cytotec'],
      [{ substance: 'misoprostol' }],
    ),
    product('aspirin-generic', 'Aspirine (générique)', [], [{ substance: 'aspirin' }]),
    product(
      'efferalgan-1000-pellicule',
      'EFFERALGAN 1000 mg, comprimé pelliculé',
      ['EFFERALGAN'],
      [{ substance: 'paracetamol', strengthMg: 1000 }],
    ),
    product(
      'efferalgan-1000-eff',
      'EFFERALGAN 1000 mg, comprimé effervescent',
      ['EFFERALGAN'],
      [{ substance: 'paracetamol', strengthMg: 1000 }],
    ),
    product(
      'efferalgan-codeine',
      'Efferalgan codéine',
      ['Efferalgan codéine'],
      [{ substance: 'paracetamol' }, { substance: 'codeine' }],
    ),
    product(
      'clarelux',
      'CLARELUX 500 microgrammes/g, mousse pour application cutanée',
      ['CLARELUX'],
      [{ substance: 'clobetasol' }],
    ),
    product('calcium-generic', 'Calcium (générique)', [], [{ substance: 'calcium' }]),
    product(
      'depakine-500',
      'DEPAKINE 500 mg, comprimé gastro-résistant',
      ['DEPAKINE'],
      [{ substance: 'valproic-acid', strengthMg: 500 }],
    ),
  ],
  plants: [
    plant('castor-oil', 'Huile de ricin'),
    plant('neem', 'Neem', ['nim']),
    plant('kinkeliba', 'Kinkéliba'),
    plant('bitter-leaf', 'Feuille amère'),
    plant('garcinia-kola', 'Kola amer'),
  ],
};

const index = buildIndex(entriesFromPack(PACK));
const ids = (query: string): string[] => search(index, query).map((candidate) => candidate.id);
const cleaned = (text: string): string => withoutStopWords(normalize(text));

describe('carrier words', () => {
  it('name nothing: an oil, a leaf or a foam of what is named after them', () => {
    expect(ids('huile de nim')).toEqual(['neem']);
    expect(ids('huile de ricin')[0]).toBe('castor-oil');
    expect(ids('feuilles de kinkeliba')).toEqual(['kinkeliba']);
    expect(ids('feuille amère')[0]).toBe('bitter-leaf');
    expect(cleaned('huile de coco')).toBe(normalize('coco'));
  });

  it('reach nothing alone or with an unknown name: no castor oil for any oil, no foam for Moussa', () => {
    for (const query of ['huile', 'huiles', 'huile de coco', 'huile de lin', 'feuille', 'mousse']) {
      expect(ids(query), query).toEqual([]);
    }
    expect(ids('Moussa')).not.toContain('clarelux');
  });
});

describe('box abbreviations of forms', () => {
  it('are form words, read as the forms they stand for', () => {
    expect(formWords('Efferalgan 1g cpr eff')).toEqual(formWords('comprimé effervescent'));
    expect(formWords('cp sécable')).toEqual(formWords('comprimé sécable'));
    expect(formWords('sach')).toEqual(formWords('sachet'));
    expect(formWords('susp')).toEqual(formWords('suspension'));
    expect(formWords('sol buv')).toEqual(formWords('solution buvable'));
    expect(formWords('gél')).toContain(formWords('gélule')[0]);
  });

  it('name no medicine alone, and choose the form of the brand', () => {
    for (const query of ['cpr', 'cp', 'eff', 'sach', 'susp', 'sol buv', 'LP']) {
      expect(ids(query), query).toEqual([]);
    }
    expect(ids('Efferalgan 1g cpr eff')[0]).toBe('efferalgan-1000-eff');
    expect(ids('efferalgan 1000 cpr pellic')[0]).toBe('efferalgan-1000-pellicule');
  });
});

describe('salt words', () => {
  it('are kept when they are the whole query, or a substance of the registry', () => {
    expect(cleaned('sodium')).toBe('sodium');
    expect(ids('calcium')).toEqual(['calcium-generic']);
    expect(cleaned('valproate de magnésium')).toBe(normalize('valproate'));
  });
});

describe('a name contained in a longer text', () => {
  it('is found at 0.9 when its words follow one another in the text', () => {
    for (const [query, id] of [
      ['Advil 400 mg boîte de 20', 'advil-400'],
      ['Advil pour les douleurs', 'advil-400'],
      ['cytotec de la pharmacie', 'misoprostol-generic'],
      ['aspirine du Rhône', 'aspirin-generic'],
      ['huile de ricin du marché', 'castor-oil'],
      // Short extra words count too: the name is all there, one word after the other.
      ['huile de ricin bio', 'castor-oil'],
      ['mon cytotec', 'misoprostol-generic'],
      ['le cytotec', 'misoprostol-generic'],
      ['ma depakine', 'depakine-500'],
      ['un advil', 'advil-400'],
      ['cytotec x 4', 'misoprostol-generic'],
    ] as const) {
      const [first] = search(index, query);
      expect(first, query).toMatchObject({ id, score: 0.9, match: 'contained' });
    }
  });

  it('needs a name word of 4 characters or more to be contained', () => {
    // "nim" is a name of neem, too short to be found inside another text.
    expect(search(index, 'huile de nim bio')[0]?.match).not.toBe('contained');
  });

  it('says how every candidate matched', () => {
    expect(search(index, 'advil')[0]?.match).toBe('exact');
    expect(search(index, 'kola')[0]?.match).toBe('word');
    expect(search(index, 'misopro')[0]?.match).toBe('prefix');
    expect(search(index, 'misoproostool')[0]?.match).toBe('fuzzy');
  });

  it('says when the whole name is spelt within one edit of a name of 6 letters or more', () => {
    for (const [query, id] of [
      ['cytotek', 'misoprostol-generic'],
      ['cytoteck', 'misoprostol-generic'],
      ['misopristol', 'misoprostol-generic'],
    ] as const) {
      expect(search(index, query)[0], query).toMatchObject({ id, match: 'near' });
    }
    // A name of 5 letters: one edit is too much of the name ("rissin").
    expect(search(index, 'rissin')[0]?.match ?? 'none').not.toBe('near');
  });

  it('needs a word of 4 characters or more, and never the word "générique" alone', () => {
    expect(ids('un générique de la pharmacie')).toEqual([]);
    expect(ids('générique')).toEqual([]);
  });
});
