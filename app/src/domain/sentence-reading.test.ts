// SPDX-License-Identifier: MIT
// When the search screen reads the products of a sentence instead of
// proposing the candidates of the whole text (SCRUM-61).
import type { Pack } from '@siapso/engine';
import type { ResolverIndex } from '@siapso/resolver';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack } from '../test/knowledge-pack.js';
import { searchIndexOf } from './search-index.js';
import { sentenceReadingOf, SENTENCE_TYPED_WORDS } from './sentence-reading.js';

let pack: Pack;
let index: ResolverIndex;

beforeAll(async () => {
  pack = await knowledgePack();
  index = searchIndexOf(pack);
});

const families = (found: ReturnType<typeof sentenceReadingOf>): string[] | null =>
  found === null ? null : found.map((product) => product.candidate.family);

describe('sentenceReadingOf: what the voice heard', () => {
  it('reads the sentence when the whole text has no candidate', () => {
    expect(
      families(sentenceReadingOf(index, 'dama naan ibiporofen bi', 'product', 'voice')),
    ).toEqual(['substances:ibuprofen']);
  });

  it('reads the sentence when it names several products, even with candidates', () => {
    expect(
      families(sentenceReadingOf(index, 'dama naan doliprane ak nivaquine', 'product', 'voice')),
    ).toEqual(['brand:dolipran', 'substances:chloroquine']);
  });

  it('leaves the candidates of the whole text when it names one product they have', () => {
    expect(sentenceReadingOf(index, 'dama naan doliprane', 'product', 'voice')).toBeNull();
    expect(sentenceReadingOf(index, 'doliprane', 'product', 'voice')).toBeNull();
  });

  it('finds a remedy said while the medicines are searched', () => {
    expect(families(sentenceReadingOf(index, 'dama naan kinkéliba', 'product', 'voice'))).toEqual([
      'kinkeliba',
    ]);
  });

  it('is null when the sentence names no product', () => {
    expect(sentenceReadingOf(index, 'dama feebar', 'product', 'voice')).toBeNull();
    expect(sentenceReadingOf(index, '', 'product', 'voice')).toBeNull();
  });
});

describe('sentenceReadingOf: what is typed', () => {
  it(`reads a text of ${String(SENTENCE_TYPED_WORDS)} words or more that has no candidate`, () => {
    expect(
      families(sentenceReadingOf(index, "j'ai pris doliparan hier", 'product', 'typed')),
    ).toEqual(['brand:dolipran']);
  });

  it('leaves a shorter text, or one with candidates, to the search', () => {
    expect(sentenceReadingOf(index, 'dama doliparan', 'product', 'typed')).toBeNull();
    expect(sentenceReadingOf(index, "j'ai pris du doliprane", 'product', 'typed')).toBeNull();
  });

  it('reads several products typed, even with candidates', () => {
    expect(
      families(sentenceReadingOf(index, "j'ai pris de l'advil et du coartem", 'product', 'typed')),
    ).toEqual(['brand:advil', 'substances:artemether+lumefantrine']);
  });
});
