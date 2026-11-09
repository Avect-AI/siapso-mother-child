// SPDX-License-Identifier: MIT
// Noise: form and packaging words are ignored, a query made only of them gets
// no candidate, and weak candidates far below the best one are dropped.
import { describe, expect, it } from 'vitest';
import {
  buildIndex,
  DEFAULT_MIN_SCORE,
  DEFAULT_RELATIVE_CUTOFF,
  normalize,
  search,
  STOP_WORDS,
  withoutStopWords,
} from '../src/index.js';
import type { IndexEntry } from '../src/index.js';

function entry(
  id: string,
  names: IndexEntry['names'],
  extra: Partial<IndexEntry> = {},
): IndexEntry {
  return {
    id,
    kind: 'product',
    family: id,
    display: { fr: id, en: id },
    names,
    priority: 3,
    detail: '',
    ...extra,
  };
}

const index = buildIndex([
  entry('doliprane-500', [
    { text: 'DOLIPRANE 500 mg, comprimé', lang: 'fr' },
    { text: 'DOLIPRANE', lang: 'brand' },
  ]),
  entry('doliprane-syrup', [
    { text: 'DOLIPRANE 2,4 POUR CENT, suspension buvable en flacon', lang: 'fr' },
    { text: 'DOLIPRANE', lang: 'brand' },
  ]),
  entry('acide-folique', [{ text: 'ACIDE FOLIQUE 5 mg, comprimé sécable', lang: 'fr' }]),
  entry('depakine-sirop', [{ text: 'DEPAKINE 57,64 mg/ml, sirop', lang: 'fr' }]),
  entry('amoxicilline', [
    { text: 'AMOXICILLINE 500 mg, gélule', lang: 'fr' },
    { text: 'Amoxicillin 500 mg capsule', lang: 'en' },
  ]),
  entry('lightening-cream', [
    { text: 'Crème éclaircissante au clobétasol', lang: 'fr' },
    { text: 'Skin-lightening cream with clobetasol', lang: 'en' },
  ]),
  entry('only-forms', [{ text: 'Sirop', lang: 'fr' }]),
  entry('advilmed', [{ text: 'ADVILMED ENFANTS ET NOURRISSONS', lang: 'fr' }]),
  entry('neo-codion', [{ text: 'Néo-Codion, coated tablet', lang: 'en' }]),
]);

const ids = (query: string, options = {}): string[] =>
  search(index, query, options).map((candidate) => candidate.id);

describe('stop-words', () => {
  it('cover the forms and packaging words, in French and English', () => {
    for (const word of [
      'comprimé',
      'comprimés',
      'pelliculé',
      'sécable',
      'effervescent',
      'orodispersible',
      'gélule',
      'capsule',
      'sirop',
      'solution',
      'suspension',
      'buvable',
      'poudre',
      'sachet',
      'granulés',
      'crème',
      'pommade',
      'gel',
      'collyre',
      'suppositoire',
      'injectable',
      'ampoule',
      'flacon',
      'médicament',
      'médicaments',
      'médicamenteux',
      'medicament',
      'medicaments',
      'medicamenteux',
      'emplâtre',
      'emplâtres',
      'emplatre',
      'emplatres',
      'tablet',
      'tablets',
      'capsules',
      'syrup',
      'cream',
      'ointment',
      'powder',
      'suppository',
    ]) {
      expect(STOP_WORDS, word).toContain(word);
    }
  });

  it('do not include the age words, which are kept apart from the name', () => {
    for (const word of ['adulte', 'adultes', 'enfant', 'enfants', 'nourrisson', 'nourrissons']) {
      expect(STOP_WORDS, word).not.toContain(word);
    }
    expect(withoutStopWords(normalize('doliprane enfants'))).toBe('dolipran enfants');
  });

  it('are removed from a normalised text, accented or not, whatever the case', () => {
    expect(withoutStopWords(normalize('Comprimé blanc'))).toBe(normalize('blanc'));
    expect(withoutStopWords(normalize('COMPRIME BLANC'))).toBe(normalize('blanc'));
    expect(withoutStopWords(normalize('creme eclaircissante'))).toBe(normalize('eclaircissante'));
    expect(withoutStopWords(normalize('gelules sirop suppositoires'))).toBe('');
    expect(withoutStopWords(normalize('doliprane'))).toBe(normalize('doliprane'));
  });

  it('give no candidate for a query made only of stop-words', () => {
    for (const query of [
      'comprimé',
      'comprime',
      'comprimés',
      'sirop',
      'gélule',
      'gelule',
      'crème',
      'creme',
      'pommade',
      'tablet',
      'syrup',
      'sirop enfants',
      'comprimé pelliculé sécable',
      'médicament',
      'medicament',
      'médicaments',
      'médicamenteux',
      'emplâtre',
      'emplatre',
      'emplâtres',
    ]) {
      expect(ids(query, { minScore: 0 }), query).toEqual([]);
    }
  });

  it('are ignored in names: "comprimé blanc" no longer reaches every tablet', () => {
    expect(ids('comprimé blanc')).toEqual([]);
    expect(ids('comprime blanc')).toEqual([]);
  });

  it('are ignored in queries: a brand followed by its form is found as the brand', () => {
    expect(search(index, 'doliprane sirop')[0]).toMatchObject({ id: 'doliprane-500', score: 1 });
    expect(search(index, 'doliprane comprimé')[0]?.score).toBe(1);
    expect(search(index, 'amoxicilline gélule')[0]?.id).toBe('amoxicilline');
    expect(search(index, 'crème éclaircissante')[0]?.id).toBe('lightening-cream');
    // "ADVILMED ENFANTS ET NOURRISSONS" is matched as "advilmed et": a whole word.
    expect(search(index, 'advilmed enfants')[0]).toMatchObject({ id: 'advilmed', score: 0.95 });
  });

  it('do not hide a name that is only stop-words from other queries, nor match it', () => {
    expect(ids('sirop', { minScore: 0 })).not.toContain('only-forms');
    expect(ids('depakine')).toEqual(['depakine-sirop']);
  });
});

describe('relative cutoff and minimum score', () => {
  it('raises the default minimum score to 0.55 and cuts at 0.8 of the best score', () => {
    expect(DEFAULT_MIN_SCORE).toBe(0.55);
    expect(DEFAULT_RELATIVE_CUTOFF).toBe(0.8);
  });

  it('drops the candidates below 0.8 of the best candidate', () => {
    const all = search(index, 'dolipran', { minScore: 0, relativeCutoff: 0, limit: 20 });
    expect(all.length).toBeGreaterThan(1);
    const kept = search(index, 'dolipran', { minScore: 0, limit: 20 });
    const best = kept[0]?.score ?? 0;
    expect(kept.every((candidate) => candidate.score >= 0.8 * best)).toBe(true);
    expect(kept.length).toBeLessThan(all.length);
  });

  it('keeps candidates of equal or close scores', () => {
    expect(ids('doliprane', { limit: 5 })).toEqual(['doliprane-500', 'doliprane-syrup']);
  });
});
