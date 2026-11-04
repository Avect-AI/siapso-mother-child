// SPDX-License-Identifier: MIT
// Age words (adulte, enfant, nourrisson...): no weight on their own, but a
// query word that matches a product's age word prefers that product's variant.
// Short words match inside a multi-word name only as whole words or from 4
// characters.
import { describe, expect, it } from 'vitest';
import { AGE_WORDS, buildIndex, search, STOP_WORDS } from '../src/index.js';
import type { IndexEntry } from '../src/index.js';

function entry(partial: Partial<IndexEntry> & Pick<IndexEntry, 'id' | 'names'>): IndexEntry {
  return {
    kind: 'product',
    family: partial.id,
    display: { fr: partial.id, en: partial.id },
    priority: 3,
    detail: '',
    ...partial,
  };
}

const index = buildIndex([
  entry({
    id: 'doliprane-adultes-1000',
    family: 'brand:doliprane',
    names: [
      { text: 'DOLIPRANE ADULTES 1000 mg, comprimé', lang: 'fr' },
      { text: 'DOLIPRANE', lang: 'brand' },
    ],
    strengths: [1000],
  }),
  entry({
    id: 'doliprane-enfants-100',
    family: 'brand:doliprane',
    names: [
      { text: 'DOLIPRANE ENFANTS 100 mg, suppositoire', lang: 'fr' },
      { text: 'DOLIPRANE', lang: 'brand' },
    ],
    strengths: [100],
  }),
  entry({
    id: 'doliprane-nourrissons-80',
    family: 'brand:doliprane',
    names: [
      { text: 'DOLIPRANE NOURRISSONS 80 mg, suppositoire', lang: 'fr' },
      { text: 'DOLIPRANE', lang: 'brand' },
    ],
    strengths: [80],
  }),
  entry({
    id: 'advilmed',
    names: [{ text: 'ADVILMED ENFANTS ET NOURRISSONS', lang: 'fr' }],
  }),
  entry({
    id: 'sels-minerals',
    names: [{ text: 'Réhydratation orale et sels minéraux', lang: 'fr' }],
  }),
  entry({
    id: 'iron-salts',
    names: [{ text: 'Fer (sels ferreux)', lang: 'fr' }],
  }),
  entry({
    id: 'selenium',
    names: [{ text: 'Sélénium', lang: 'fr' }],
  }),
  entry({
    id: 'fer-selenium',
    names: [{ text: 'Fer et sélénium forte dose', lang: 'fr' }],
  }),
]);

const ids = (query: string, options = {}): string[] =>
  search(index, query, options).map((candidate) => candidate.id);

describe('age words', () => {
  it('are exported, normalised, and not stop-words', () => {
    for (const word of ['adulte', 'adultes', 'enfant', 'enfants', 'nourrisson', 'nourrissons']) {
      expect(AGE_WORDS, word).toContain(word);
      expect(STOP_WORDS, word).not.toContain(word);
    }
  });

  it('give no candidate when the query is made only of age words', () => {
    for (const query of ['enfant', 'enfants', 'adulte', 'adultes', 'nourrisson', 'enfant adulte']) {
      expect(ids(query, { minScore: 0 }), query).toEqual([]);
    }
  });

  it('give no weight on their own: "enfants" does not reach a name that contains it', () => {
    expect(ids('enfants', { minScore: 0 })).not.toContain('advilmed');
  });

  it('prefer the variant whose age word the query holds', () => {
    expect(search(index, 'doliprane enfant')[0]).toMatchObject({
      id: 'doliprane-enfants-100',
      family: 'brand:doliprane',
    });
    expect(search(index, 'doliprane enfants')[0]?.id).toBe('doliprane-enfants-100');
    expect(search(index, 'doliprane nourrisson')[0]?.id).toBe('doliprane-nourrissons-80');
    expect(search(index, 'doliprane adulte')[0]?.id).toBe('doliprane-adultes-1000');
    expect(search(index, 'doliprane enfant')[0]?.variants).toContain('doliprane-adultes-1000');
  });

  it('change nothing without an age word in the query, and accept English and forms', () => {
    const plain = search(index, 'doliprane');
    expect(plain).toHaveLength(1);
    expect(plain[0]?.id).toBe('doliprane-adultes-1000');
    expect(search(index, 'doliprane child')[0]?.id).toBe('doliprane-enfants-100');
    expect(search(index, 'doliprane sirop enfant')[0]?.id).toBe('doliprane-enfants-100');
  });

  it('leave the score of the name unchanged', () => {
    expect(search(index, 'doliprane enfant')[0]?.score).toBe(search(index, 'doliprane')[0]?.score);
    expect(search(index, 'advilmed enfants')[0]).toMatchObject({ id: 'advilmed', score: 0.95 });
  });

  it('are outranked by a typed strength', () => {
    expect(search(index, 'doliprane enfant 1000')[0]?.id).toBe('doliprane-adultes-1000');
  });
});

describe('prefix inside a multi-word name', () => {
  it('needs 4 characters inside the name: "sel" does not reach a longer word', () => {
    expect(ids('sel')).not.toContain('sels-minerals');
    expect(ids('sel')).not.toContain('fer-selenium');
    // Nor through a fuzzy match on one word ("sels").
    expect(ids('sel')).not.toContain('iron-salts');
    const whole = search(index, 'sels').find((c) => c.id === 'sels-minerals');
    expect(whole?.score).toBe(0.95);
    expect(ids('sele')).toContain('fer-selenium');
    expect(ids('mine')).toContain('sels-minerals');
  });

  it('keeps 3 characters for the prefix of the whole name', () => {
    expect(search(index, 'sel')[0]).toMatchObject({ id: 'selenium', score: 0.9 });
    expect(search(index, 'reh')[0]).toMatchObject({ id: 'sels-minerals', score: 0.9 });
  });
});
