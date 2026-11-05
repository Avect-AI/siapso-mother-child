// SPDX-License-Identifier: MIT
import { evaluate, type CheckedItem, type Pack } from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { normalize, search, withoutStopWords } from '@siapso/resolver';
import { contextFromProfile } from './context.js';
import { cappedEvaluation, withPossibleMatches } from './possible-matches.js';
import { productFamilyOf, searchIndexOf } from './search-index.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

const typed = (text: string): CheckedItem => ({ ref: { kind: 'unrecognised', text } });

describe('withPossibleMatches after "Non, aucun de ces produits"', () => {
  const declined = () => true;

  it.each([
    'huile de coco',
    'huile de lin',
    'huile',
    'vitamines',
    'Moussa',
    'Anta',
    'clotrimazole',
  ])('keeps no weak resemblance: %s', (text) => {
    const net = withPossibleMatches(pack, [typed(text)], { declined });
    expect(net.items).toHaveLength(1);
    expect(net.possible.size).toBe(0);
  });

  // A laboratory or a word of a description that many products share names
  // none of them: after "none of these", nothing is kept (live test round 2).
  it.each([
    'biogaran',
    'teva',
    'sandoz',
    'zentiva',
    'accord',
    'dose',
    'gastro',
    'application',
    'cutanée',
    'chrono',
    'emulgel',
  ])('keeps no word shared by the names of several products: %s', (text) => {
    const net = withPossibleMatches(pack, [typed(text)], { declined });
    expect(net.items).toHaveLength(1);
    expect(net.possible.size).toBe(0);
  });

  // A brand after the substance it holds or a short prefix, and a name in
  // brackets, are names: "Non" never drops what the base knows for them.
  it.each([
    ['acnetrait', /^isotretinoine-acnetrait-/],
    ['codion', /^neo-codion/],
    ['profenid', /^bi-profenid-/],
    ['oseille', /^bissap$/],
    // ASPIRINE UPSA: after the substance name, the word reads as the brand.
    ['upsa', /^aspirine-upsa-/],
  ])('keeps a brand or a local name as a very strong resemblance: %s', (text, id) => {
    const net = withPossibleMatches(pack, [typed(text)], { declined });
    expect((net.items[1]?.ref as { id?: string } | undefined)?.id).toMatch(id);
    expect(net.possible.get(1)?.strength).toBe('very-strong');
  });

  it('reads the box abbreviations: "Efferalgan 1g cpr eff" is the effervescent EFFERALGAN 1000 mg', () => {
    const net = withPossibleMatches(pack, [typed('Efferalgan 1g cpr eff')], { declined });
    expect(net.items[1]).toEqual({ ref: { kind: 'product', id: 'efferalgan-1000-mg-67058605' } });
  });

  it.each([
    ['huile de ricin', 'castor-oil'],
    ['huile de ricin du marché', 'castor-oil'],
    ['Advil 400 mg comprimé pelliculé', 'advil-400-mg-63646874'],
    ['cytotec', 'misoprostol-generic'],
    ['Advil 400 mg boîte de 20', 'advil-400-mg-63646874'],
    ['Advil pour les douleurs', 'advil-200-mg-68634000'],
    ['cytotec de la pharmacie', 'misoprostol-generic'],
    ['aspirine du Rhône', 'aspirin-generic'],
    ['huile de ricin bio', 'castor-oil'],
    ['mon cytotec', 'misoprostol-generic'],
    ['le cytotec', 'misoprostol-generic'],
    ['ma depakine', 'depakine-200-mg-67623734'],
    ['un advil', 'advil-200-mg-68634000'],
    ['cytotec x 4', 'misoprostol-generic'],
  ])('keeps a strong resemblance or a name contained in the text: %s', (text, id) => {
    const net = withPossibleMatches(pack, [typed(text)], { declined });
    expect(net.items[1]?.ref).toMatchObject({ id });
    expect(net.possible.get(1)?.strength).toBe('very-strong');
  });
});

describe('the brand words and local names of the pack', () => {
  /** The words of a text as the resolver reads them (lower case, no accents, no form words). */
  const wordsOf = (text: string) =>
    withoutStopWords(normalize(text))
      .split(' ')
      .filter((word) => word !== '');
  /** Every word of a substance name of the pack: a brand may follow one ("ISOTRETINOINE ACNETRAIT"). */
  const substanceWords = () =>
    new Set(pack.substances.flatMap((s) => [s.names.fr, s.names.en].flatMap(wordsOf)));
  /** The first word of each part of a name (around its brackets) that is not a substance or a short prefix. */
  const leadWords = (text: string, skip: ReadonlySet<string>) =>
    text.split(/[()]/).flatMap((part) => {
      const word = wordsOf(part).find((w) => w.length > 3 && !skip.has(w));
      return word === undefined ? [] : [word];
    });

  it('never weighs the brand word of a product as a word inside a name', () => {
    const index = searchIndexOf(pack);
    const skip = substanceWords();
    let checked = 0;
    for (const product of pack.products) {
      const family = productFamilyOf(pack, product.id);
      for (const word of product.brands.flatMap((brand) => leadWords(brand, skip))) {
        const found = search(index, word, { limit: 50 }).find((c) => c.family === family);
        if (found?.match !== 'word') continue;
        checked += 1;
        expect(found.weakWord, `${product.id}: ${word}`).not.toBe('inner');
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('never weighs the first word of a local name as a word inside a name', () => {
    const index = searchIndexOf(pack);
    const names = [
      ...pack.plants.flatMap((plant) =>
        [plant.names.fr, plant.names.en, ...plant.localNames.map((l) => l.text)].map(
          (text) => [plant.id, text] as const,
        ),
      ),
      ...pack.products.flatMap((product) =>
        product.localNames.map(
          (l) => [productFamilyOf(pack, product.id) ?? product.id, l.text] as const,
        ),
      ),
    ];
    let checked = 0;
    for (const [family, text] of names) {
      for (const word of leadWords(text, new Set())) {
        const found = search(index, word, { limit: 50 }).find((c) => c.family === family);
        if (found?.match !== 'word') continue;
        checked += 1;
        expect(found.weakWord, `${family}: ${word}`).not.toBe('inner');
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('withPossibleMatches: a brand spelt within one edit', () => {
  it.each([['misopristol', 'misoprostol-generic']])(
    'keeps %s after "none of these", strong but not very strong',
    (text, id) => {
      const net = withPossibleMatches(pack, [typed(text)], { declined: () => true });
      expect(net.items[1]?.ref).toMatchObject({ id });
      expect(net.possible.get(1)?.strength).toBe('strong');
    },
  );
});

// Live test round 2 (SCRUM-51): a name written as it sounds is the name itself,
// so its danger is never held below the danger of the name written right.
describe('withPossibleMatches: a name written as it sounds', () => {
  it.each([
    ['cytotek', 'misoprostol-generic'],
    ['cytoteck', 'misoprostol-generic'],
    ['sitotek', 'misoprostol-generic'],
    ['sitotec', 'misoprostol-generic'],
    ['kodeyin', 'codeine-generic'],
    ['huile de rissin', 'castor-oil'],
    ['huille de rissin', 'castor-oil'],
    ['uile de risin', 'castor-oil'],
  ])('keeps %s after "none of these", very strong', (text, id) => {
    const net = withPossibleMatches(pack, [typed(text)], { declined: () => true });
    expect(net.items[1]?.ref).toMatchObject({ id });
    expect(net.possible.get(1)?.strength).toBe('very-strong');
  });

  it('gives "sitotek" at 37 weeks the danger of Cytotec, and "huile de rissin" with a scar the danger of castor oil', () => {
    const profile = profileOf({
      term: { kind: 'weeks', weeks: 37, givenOn: '2026-11-05' },
      conditions: ['uterine-scar'],
    });
    for (const text of ['sitotek', 'cytotek', 'huile de rissin', 'uile de risin']) {
      const context = contextFromProfile(
        profile,
        { items: [typed(text)], signs: [] },
        '2026-11-05',
      );
      const net = withPossibleMatches(pack, context.items, { declined: () => true });
      const evaluation = cappedEvaluation(
        evaluate(pack, { ...context, items: net.items }),
        net.possible,
      );
      expect(evaluation.level, text).toBe('danger');
    }
  });
});

describe('cappedEvaluation', () => {
  it('holds a danger of a resemblance that is not very strong at "before the next dose"', () => {
    const profile = profileOf({
      term: { kind: 'weeks', weeks: 37, givenOn: '2026-11-05' },
      conditions: ['uterine-scar'],
    });
    const context = contextFromProfile(
      profile,
      { items: [typed('huile de ricin')], signs: [] },
      '2026-11-05',
    );
    const net = withPossibleMatches(pack, context.items);
    const evaluation = evaluate(pack, { ...context, items: net.items });
    expect(evaluation.level).toBe('danger');
    expect(cappedEvaluation(evaluation, net.possible)).toBe(evaluation);

    const strong = new Map(
      [...net.possible].map(([at, match]) => [at, { ...match, strength: 'strong' as const }]),
    );
    const capped = cappedEvaluation(evaluation, strong);
    expect(capped.level).toBe('before-next-dose');
    expect(capped.findings.every((f) => f.level !== 'danger')).toBe(true);
    // The findings stay sorted, highest first.
    expect(capped.findings[0]?.level).toBe('before-next-dose');
  });

  it('never holds a danger sign down', () => {
    const context = contextFromProfile(
      profileOf(),
      { items: [typed('huile de ricin')], signs: ['fever'] },
      '2026-11-04',
    );
    const net = withPossibleMatches(pack, context.items);
    const strong = new Map(
      [...net.possible].map(([at, match]) => [at, { ...match, strength: 'strong' as const }]),
    );
    expect(cappedEvaluation(evaluate(pack, { ...context, items: net.items }), strong).level).toBe(
      'danger',
    );
  });
});

describe('withPossibleMatches', () => {
  it('reads the strength as unknown when the strength typed is not the one of the product', () => {
    // ASCOFER has one strength, 33 mg: "ascofer 50" is not that box.
    const net = withPossibleMatches(pack, [typed('ascofer 50')]);
    expect(net.items[1]).toEqual({
      ref: { kind: 'product', id: 'ascofer-33-mg-61521103' },
      strengthUnknown: true,
    });
    expect(withPossibleMatches(pack, [typed('ascofer 33')]).items[1]).toEqual({
      ref: { kind: 'product', id: 'ascofer-33-mg-61521103' },
    });
  });

  it('adds the product a name typed as unrecognised looks like, after the items', () => {
    const items = [typed('Advil 400 mg comprimé pelliculé')];
    const net = withPossibleMatches(pack, items);
    expect(net.items).toEqual([
      typed('Advil 400 mg comprimé pelliculé'),
      { ref: { kind: 'product', id: 'advil-400-mg-63646874' } },
    ]);
    expect([...net.possible]).toEqual([
      [1, { forItem: 0, typed: 'Advil 400 mg comprimé pelliculé', strength: 'very-strong' }],
    ]);
    // The items given are not changed.
    expect(items).toHaveLength(1);
  });

  it('looks in both lists: a remedy typed among the medicines', () => {
    const net = withPossibleMatches(pack, [typed('huile de ricin')]);
    expect(net.items[1]).toEqual({ ref: { kind: 'plant', id: 'castor-oil' } });
  });

  it('reads the strength as unknown when the name typed does not give it', () => {
    const net = withPossibleMatches(pack, [typed('doliprane')]);
    expect(net.items[1]).toMatchObject({ strengthUnknown: true, ref: { kind: 'product' } });
  });

  it('adds nothing for a name that looks like nothing in either list', () => {
    const net = withPossibleMatches(pack, [typed('comprimés du marché')]);
    expect(net.items).toHaveLength(1);
    expect(net.possible.size).toBe(0);
  });

  it('adds nothing for a product or remedy already in the check, nor twice', () => {
    const advil: CheckedItem = { ref: { kind: 'product', id: 'advil-400-mg-63646874' } };
    expect(withPossibleMatches(pack, [advil, typed('advil')]).items).toHaveLength(2);
    const twice = withPossibleMatches(pack, [typed('advil 400'), typed('Advil 400 mg')]);
    expect(twice.items).toHaveLength(3);
    expect([...twice.possible.values()].map((p) => p.forItem)).toEqual([0]);
  });

  it('never lowers the level: the base knows castor oil at term with a scar is a danger', () => {
    const profile = profileOf({
      term: { kind: 'weeks', weeks: 37, givenOn: '2026-11-05' },
      conditions: ['uterine-scar'],
    });
    const context = contextFromProfile(
      profile,
      { items: [typed('huile de ricin')], signs: [] },
      '2026-11-05',
    );
    expect(evaluate(pack, context).level).toBe('unknown');
    const net = withPossibleMatches(pack, context.items);
    const evaluation = evaluate(pack, { ...context, items: net.items });
    expect(evaluation.level).toBe('danger');
    // The text typed stays unrecognised: its own finding is still there.
    expect(evaluation.findings.some((f) => f.check === 'C12' && f.items.includes(0))).toBe(true);
  });

  it('gives an NSAID typed as unrecognised its level from 20 weeks', () => {
    const context = contextFromProfile(
      profileOf(),
      { items: [typed('Advil 400 mg comprimé pelliculé')], signs: [] },
      '2026-11-04',
    );
    const net = withPossibleMatches(pack, context.items);
    expect(evaluate(pack, { ...context, items: net.items }).level).toBe('before-next-dose');
  });
});
