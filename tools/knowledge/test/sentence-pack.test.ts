// SPDX-License-Identifier: MIT
// The products named inside a sentence on the repository pack (SCRUM-61): the
// filler words name nothing of the base, and the sentences of the team's
// feedback (2026-11-05) find their products.
import type { Pack } from '@siapso/engine';
import {
  AMBIGUOUS_NAME_WORDS,
  buildIndex,
  entriesFromPack,
  FILLER_WORDS,
  JOINING_WORDS,
  productsInSentence,
  search,
  WEAK_ALONE_WORDS,
} from '@siapso/resolver';
import type { ResolverIndex } from '@siapso/resolver';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPack, loadContent } from '../src/index.js';
import { REPO_ROOT } from './helpers.js';

let pack: Pack;
let index: ResolverIndex;

beforeAll(async () => {
  pack = buildPack(await loadContent(REPO_ROOT));
  index = buildIndex(entriesFromPack(pack));
});

const ids = (sentence: string): string[] =>
  productsInSentence(index, sentence).map((found) => found.candidate.id);

describe('the word lists of a sentence on the repository pack', () => {
  it('lists no filler or joining word that is a whole name of the base', () => {
    for (const word of [...FILLER_WORDS, ...JOINING_WORDS]) {
      const exact = search(index, word).filter((candidate) => candidate.match === 'exact');
      expect(
        exact.map((candidate) => candidate.id),
        word,
      ).toEqual([]);
    }
  });

  it('lists only words of names among the words never read alone and the ambiguous names', () => {
    for (const word of [...WEAK_ALONE_WORDS, ...AMBIGUOUS_NAME_WORDS]) {
      expect(search(index, word).length, word).toBeGreaterThan(0);
    }
  });
});

describe('the sentences of the team feedback', () => {
  it('finds a medicine hidden in a spoken sentence', () => {
    expect(ids('dama naan doliprane ndax sama bopp dafa metti')[0]).toMatch(/^doliprane-/);
    expect(ids("j'ai pris de l'advil et du coartem")).toEqual([
      expect.stringMatching(/^advil-/),
      'artemether-lumefantrine-generic',
    ]);
    expect(ids('doliprane ak nivaquine')).toEqual([
      expect.stringMatching(/^doliprane-/),
      'chloroquine-generic',
    ]);
  });

  it('finds a name misspelt as the Wolof voice writes it', () => {
    expect(ids('dama naan parasetamol')).toEqual(['paracetamol-generic']);
    expect(ids('dama naan ibiporofen')).toEqual(['ibuprofen-generic']);
    expect(ids('dafa jël amoksisilin')[0]).toMatch(/^amoxicilline-/);
    expect(ids('dama naan doliparan')[0]).toMatch(/^doliprane-/);
  });

  it('finds nothing in a sentence that names no product', () => {
    for (const sentence of [
      'dama feebar, sama bopp dafa metti',
      "j'ai mangé du riz avec du poisson et du pain",
      'Fatou ak Awa dañu dem marse',
    ]) {
      expect(ids(sentence), sentence).toEqual([]);
    }
  });
});
