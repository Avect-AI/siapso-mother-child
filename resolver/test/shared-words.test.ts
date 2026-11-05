// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { buildIndex, search } from '../src/index.js';
import type { IndexEntry } from '../src/index.js';

function product(id: string, family: string, ...names: string[]): IndexEntry {
  return {
    id,
    kind: 'product',
    family,
    display: { fr: names[0] ?? id, en: names[0] ?? id },
    priority: 3,
    detail: '',
    names: names.map((text) => ({ text, lang: 'fr' as const })),
  };
}

const index = buildIndex([
  // One laboratory, two families: the word names neither.
  product('paracetamol-biogaran-500', 'paracetamol-biogaran', 'PARACETAMOL BIOGARAN 500 mg'),
  product('paracetamol-biogaran-1000', 'paracetamol-biogaran', 'PARACETAMOL BIOGARAN 1000 mg'),
  product('ibuprofene-biogaran-400', 'ibuprofene-biogaran', 'IBUPROFENE BIOGARAN 400 mg'),
  // One brand, two products of one family: its first word names that family.
  product('nurofen-tabs', 'nurofen', 'NUROFEN TABS 200 mg'),
  product('nurofen-rhume', 'nurofen', 'NUROFEN RHUME 200 mg'),
  // A qualifier and the words of a description, in one family only.
  product('depakine-chrono', 'depakine-chrono', 'DEPAKINE CHRONO 500 mg'),
  product('clarelux', 'clarelux', 'CLARELUX 500 microgrammes/g, mousse pour application cutanée'),
  // A brand whose other name starts with the word: the word leads one of its names.
  product('tetra', 'tetra', 'OPHTA TETRA 1 pour cent', 'TETRA 1 pour cent'),
  // A brand after the substance it holds, or after a short prefix joined to it:
  // the word is the brand (live test round 2 review).
  {
    id: 'isotretinoin-generic',
    kind: 'product',
    family: 'substances:isotretinoin',
    display: { fr: 'Isotrétinoïne', en: 'Isotretinoin' },
    priority: 1,
    detail: '',
    names: [{ text: 'Isotrétinoïne', lang: 'inn', substance: 'isotretinoin' }],
  },
  product('acnetrait-10', 'brand:isotretinoin acnetrait', 'ISOTRETINOINE ACNETRAIT 10 mg'),
  product('neo-codion', 'brand:neo codion', 'Néo-Codion, comprimé enrobé'),
  product('bi-profenid-100', 'brand:bi profenid lp', 'BI PROFENID LP 100 mg'),
  // A second name in brackets: its first word leads it.
  {
    id: 'bissap',
    kind: 'plant',
    family: 'bissap',
    display: { fr: 'Bissap (oseille de Guinée)', en: 'Roselle (bissap)' },
    priority: 2,
    detail: '',
    names: [{ text: 'Bissap (oseille de Guinée)', lang: 'fr' }],
  },
  // A word after the brand word of its own family: a qualifier of the brand.
  product('voltarene-emulgel', 'brand:voltaren emulgel', 'VOLTARENE EMULGEL 1 %, gel'),
  // A substance named in two words, the second the one people say alone
  // (live test round 2: "méfénamique").
  {
    id: 'mefenamic-acid-generic',
    kind: 'product',
    family: 'substances:mefenamic-acid',
    display: { fr: 'Acide méfénamique (générique)', en: 'Mefenamic acid (generic)' },
    priority: 2,
    detail: '',
    names: [
      { text: 'Acide méfénamique (générique)', lang: 'fr' },
      { text: 'Acide méfénamique', lang: 'inn', substance: 'mefenamic-acid' },
    ],
  },
]);

describe('a query equal to one word of a name', () => {
  it('is a shared word when the names of several families have it (a laboratory)', () => {
    const candidates = search(index, 'biogaran');
    expect(candidates.map((c) => c.family).sort()).toEqual([
      'ibuprofene-biogaran',
      'paracetamol-biogaran',
    ]);
    for (const candidate of candidates) {
      expect(candidate.match).toBe('word');
      expect(candidate.weakWord).toBe('shared');
    }
  });

  it.each([
    ['acnetrait', 'acnetrait-10'],
    ['codion', 'neo-codion'],
    ['profenid', 'bi-profenid-100'],
    ['oseille', 'bissap'],
  ])(
    'is the brand when only a substance or a short prefix comes before it, or it starts a name in brackets: %s',
    (query, id) => {
      const [best] = search(index, query);
      expect(best?.id).toBe(id);
      expect(best?.match).toBe('word');
      expect(best?.weakWord).toBeUndefined();
    },
  );

  it('is the substance for each word of a substance name of several words: méfénamique', () => {
    const [best] = search(index, 'méfénamique');
    expect(best?.id).toBe('mefenamic-acid-generic');
    expect(best?.match).toBe('word');
    expect(best?.weakWord).toBeUndefined();
  });

  it.each(['chrono', 'cutanée', 'application', 'emulgel'])(
    'is an inner word when it is not the first word of the name: %s',
    (query) => {
      const [best] = search(index, query);
      expect(best?.match).toBe('word');
      expect(best?.weakWord).toBe('inner');
    },
  );

  it('keeps the score and the order: only the caller weighs it', () => {
    expect(search(index, 'Biogaran 500')[0]).toMatchObject({
      id: 'paracetamol-biogaran-500',
      score: 0.95,
    });
    expect(search(index, 'chrono')[0]?.score).toBe(0.95);
  });

  it('is neither for the first word of the names of one family only (the brand)', () => {
    const [nurofen] = search(index, 'nurofen');
    expect(nurofen?.match).toBe('word');
    expect(nurofen?.weakWord).toBeUndefined();
    expect(search(index, 'depakine')[0]?.weakWord).toBeUndefined();
    // The first word of one of the names of the product is enough.
    expect(search(index, 'tetra')[0]?.weakWord).toBeUndefined();
  });

  it('is neither for any other kind of match', () => {
    expect(search(index, 'paracetamol biogaran')[0]?.weakWord).toBeUndefined();
    expect(search(index, 'biogara')[0]?.weakWord).toBeUndefined();
  });
});
