// SPDX-License-Identifier: MIT
// The products named inside a sentence on the repository pack (SCRUM-61): the
// filler words name nothing of the base, and the sentences of the team's
// feedback (2026-11-05) find their products.
import type { Pack } from '@siapso/engine';
import {
  AMBIGUOUS_NAME_WORDS,
  buildIndex,
  CLAUSE_JOIN_WORDS,
  CLAUSE_RESET_WORDS,
  entriesFromPack,
  FILLER_WORDS,
  FOOD_NAME_WORDS,
  JOINING_WORDS,
  NEGATION_WORDS,
  PAST_WORDS,
  PERSON_WORDS,
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

  it('lists as foods only whole names of remedies of the base', () => {
    for (const word of FOOD_NAME_WORDS) {
      const exact = search(index, word).filter((candidate) => candidate.match === 'exact');
      expect(
        exact.map((candidate) => candidate.kind),
        word,
      ).toContain('plant');
    }
  });

  it('lists no word of a clause (negation, past, person) that is a whole name of the base', () => {
    for (const word of [
      ...NEGATION_WORDS,
      ...PAST_WORDS,
      ...PERSON_WORDS,
      ...CLAUSE_RESET_WORDS,
      ...CLAUSE_JOIN_WORDS,
    ]) {
      const exact = search(index, word).filter((candidate) => candidate.match === 'exact');
      expect(
        exact.map((candidate) => candidate.id),
        word,
      ).toEqual([]);
    }
  });
});

// Review of #68: the sentences of the review, on the repository pack.
describe('the products named but maybe not taken', () => {
  const read = (sentence: string) =>
    productsInSentence(index, sentence, { heard: true }).map((found) => [
      found.candidate.id.replace(/-\d.*$/, ''),
      found.checked,
      found.clause?.text,
    ]);

  it('unticks, never drops, a product said with a negation, by another person or before', () => {
    expect(read('je prends du doliprane mais pas de cytotec')).toEqual([
      ['doliprane', true, undefined],
      ['misoprostol-generic', false, 'pas de cytotec'],
    ]);
    expect(read('dama naan doliprane waaye duma naan cytotec')).toEqual([
      ['doliprane', true, undefined],
      ['misoprostol-generic', false, 'duma naan cytotec'],
    ]);
    const doctor = 'le médecin a dit de ne pas prendre de l advil ni de l ibuprofène';
    expect(read(doctor)).toEqual([
      ['advil', false, doctor],
      ['ibuprofen-generic', false, doctor],
    ]);
    expect(read('mon mari prend du coartem et moi du doliprane')).toEqual([
      ['artemether-lumefantrine-generic', false, 'mon mari prend du coartem'],
      ['doliprane', true, undefined],
    ]);
    expect(read('avant je prenais de la nivaquine maintenant du coartem')).toEqual([
      ['chloroquine-generic', false, 'avant je prenais de la nivaquine'],
      ['artemether-lumefantrine-generic', true, undefined],
    ]);
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

  // Transcripts of the French voice pack in the audio check of SCRUM-61.
  it('offers to confirm a name the French voice split into words', () => {
    const toConfirm = (heard: string): [string, boolean, string | undefined][] =>
      productsInSentence(index, heard, { heard: true }).map((found) => [
        found.candidate.family,
        found.checked,
        found.heardAs,
      ]);
    expect(toConfirm('Je prends de la tisanne de King Kyliba le matin')).toEqual([
      ['kinkeliba', false, 'King Kyliba'],
    ]);
    expect(toConfirm('Elle a pris de Libu Profaine pour le mal de dose')).toEqual([
      ['substances:ibuprofen', false, 'Libu Profaine'],
    ]);
    expect(toConfirm("J'ai pris du d'Oli-Pran ce matin")).toEqual([
      ['brand:dolipran', false, "d'Oli-Pran"],
    ]);
  });

  // With the names of the base given to the French decoder, "Je bois une
  // tisane de kinkéliba." was heard so.
  it('offers to confirm, never ticked, a medicine heard before another clause', () => {
    const found = productsInSentence(index, "Je bois une tisan de quinine qu'il y va.", {
      heard: true,
    });
    expect(
      found.map((product) => [
        product.candidate.id,
        product.checked,
        product.heardAs,
        product.alternative,
      ]),
    ).toEqual([
      // "tisane de" names no remedy of its own: read with the name it carries.
      ['quinine-generic', false, "tisan de quinine qu'il y va", undefined],
      // Review of #68: and the longer name the words may be, "Ou peut-être".
      ['kinkeliba', false, "tisan de quinine qu'il y va", true],
    ]);
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
