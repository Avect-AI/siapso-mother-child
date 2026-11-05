// SPDX-License-Identifier: MIT
// Salt words: the salt or hydrate a box names next to the substance
// ("valproate de sodium", "chlorhydrate de tramadol") says nothing about which
// substance it is, so it is ignored with the "de" that links it.
import { describe, expect, it } from 'vitest';
import { buildIndex, normalize, SALT_WORDS, search, withoutStopWords } from '../src/index.js';
import type { IndexEntry } from '../src/index.js';

function product(id: string, names: IndexEntry['names']): IndexEntry {
  return {
    id,
    kind: 'product',
    family: id,
    display: { fr: id, en: id },
    names,
    priority: 2,
    detail: '',
  };
}

const index = buildIndex([
  product('valproate', [
    { text: 'Valproate (générique)', lang: 'fr' },
    { text: 'Acide valproïque (valproate)', lang: 'inn' },
  ]),
  product('tramadol', [{ text: 'Tramadol', lang: 'inn' }]),
  product('iron', [{ text: 'Fer (sels ferreux)', lang: 'inn' }]),
  product('enalapril', [{ text: 'Énalapril', lang: 'inn' }]),
  product('castor-oil', [{ text: 'Huile de ricin', lang: 'fr' }]),
]);

const cleaned = (text: string): string => withoutStopWords(normalize(text));
const ids = (query: string): string[] => search(index, query).map((candidate) => candidate.id);

describe('salt words', () => {
  it('are exported and cover the salts and hydrates of the registry substances', () => {
    for (const word of [
      'sodium',
      'sodique',
      'potassique',
      'chlorhydrate',
      'hyclate',
      'phosphate',
      'sulfate',
      'fumarate',
      'maléate',
      'hémihydraté',
      'disoproxil',
    ]) {
      expect(SALT_WORDS, word).toContain(word);
    }
  });

  it('are removed with the "de" that links them to the substance', () => {
    expect(cleaned('valproate de sodium')).toBe(normalize('valproate'));
    expect(cleaned('Valproate sodium')).toBe(normalize('valproate'));
    expect(cleaned('sodium valproate')).toBe(normalize('valproate'));
    expect(cleaned('chlorhydrate de tramadol')).toBe(normalize('tramadol'));
    expect(cleaned("maléate d'énalapril")).toBe(normalize('enalapril'));
    expect(cleaned('Phosphate de codéine hémihydraté')).toBe(normalize('codeine'));
  });

  it('leave a "de" that links two other words', () => {
    expect(cleaned('noix de cola')).toBe(normalize('noix de cola'));
  });

  it('let the salt form of a substance find it', () => {
    expect(ids('valproate de sodium')).toEqual(['valproate']);
    expect(ids('valproate sodium')).toEqual(['valproate']);
    expect(ids('chlorhydrate de tramadol')).toEqual(['tramadol']);
    expect(ids('fumarate ferreux')).toEqual(['iron']);
    expect(ids('huile de ricin')).toEqual(['castor-oil']);
  });

  it('give no candidate on their own', () => {
    expect(ids('sodium')).toEqual([]);
    expect(ids('chlorhydrate de')).toEqual([]);
  });
});
