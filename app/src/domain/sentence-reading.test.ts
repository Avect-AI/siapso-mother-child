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

  it('offers unticked a name read from words the voice split', () => {
    const found = sentenceReadingOf(index, 'je bois une tisanne de King Kyliba', 'plant', 'voice');
    expect(
      found?.map((product) => [product.candidate.id, product.checked, product.heardAs]),
    ).toEqual([['kinkeliba', false, 'King Kyliba']]);
    // Typed, the words are what she wrote: never read joined.
    expect(
      sentenceReadingOf(index, 'je bois une tisanne de King Kyliba', 'plant', 'typed'),
    ).toBeNull();
  });

  // "quinine qu'il y va" was heard for kinkéliba: the whole text has a
  // candidate, but the name must be confirmed, so it is offered unticked.
  it('offers unticked, in place of the candidates, a name heard before another clause', () => {
    const found = sentenceReadingOf(
      index,
      "je prends de la nivaquine qu'il y va le matin",
      'product',
      'voice',
    );
    expect(
      found?.map((product) => [product.candidate.id, product.checked, product.heardAs]),
    ).toEqual([['chloroquine-generic', false, "nivaquine qu'il y va"]]);
  });

  // The transcripts of the French voice given the names of the base, where
  // "kinkéliba" was said (docs/voice.md): never a product ticked.
  it('never ticks a product heard inside a garbled clause of a prompted transcript', () => {
    for (const heard of [
      "Je prends de la tisanne de quinine qu'il y va le matin.",
      "Je bois une tisan de quinine qu'il y va.",
      "Je bois une tisan de quinine qu'il y ba.",
    ]) {
      const found = sentenceReadingOf(index, heard, 'product', 'voice');
      expect(found?.length, heard).toBe(1);
      expect(
        found?.filter((product) => product.checked),
        heard,
      ).toEqual([]);
      expect(found?.[0]?.heardAs, heard).toMatch(/quinine qu'il y [vb]a$/);
    }
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

// Review of #68: one product named with a negation, by another person or as
// a past use is offered unticked, with its clause, in place of the candidates
// of the whole text, which would offer it as the answer.
describe('sentenceReadingOf: a product maybe not taken', () => {
  it('offers it unticked with its clause, typed or heard', () => {
    for (const source of ['typed', 'voice'] as const) {
      const found = sentenceReadingOf(index, "je n'ai pas pris de coartem", 'product', source);
      expect(
        found?.map((product) => [product.candidate.family, product.checked, product.clause]),
        source,
      ).toEqual([
        [
          'substances:artemether+lumefantrine',
          false,
          { reason: 'negation', text: "je n'ai pas pris de coartem" },
        ],
      ]);
    }
    expect(
      sentenceReadingOf(index, 'sama jëkkër dafay naan coartem', 'product', 'voice')?.[0]?.clause
        ?.reason,
    ).toBe('other-person');
  });
});
