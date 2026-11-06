// SPDX-License-Identifier: MIT
import { evaluate, type CheckedItem, type Pack } from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { normalize, search, withoutStopWords } from '@siapso/resolver';
import { contextFromProfile } from './context.js';
import {
  cappedEvaluation,
  evaluateWithPossibleMatches,
  strengthOf,
  withPossibleMatches,
} from './possible-matches.js';
import { productFamilyOf, searchIndexOf } from './search-index.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

const typed = (text: string): CheckedItem => ({ ref: { kind: 'unrecognised', text } });

// Review of SCRUM-51 (prescription reading, SCRUM-57): a posology line, or one
// of its words read by a camera or said ("price" for "prise"), names no product.
describe('a word of how a medicine is taken', () => {
  it.each([
    'prise',
    'price',
    'une prise par jour',
    '1 cp en prise unique',
    '1 ap en price unique',
    'quotidienne',
    'sans sucre',
  ])('is never a strong or very strong resemblance: %s', (text) => {
    for (const candidate of search(searchIndexOf(pack), text, { limit: 10 })) {
      expect(strengthOf(candidate), `${text}: ${candidate.id}`).toBe('weak');
    }
    const net = withPossibleMatches(pack, [typed(text)]);
    expect([...net.possible.values()].filter((p) => p.strength !== 'weak')).toEqual([]);
  });
});

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
    // The second word of a substance name, said alone (live test round 2).
    ['méfénamique', /^mefenamic-acid-generic$/],
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

  // Live test round 2 (depot-keeper#0, safety-auditor#10): every name typed
  // gets its own resemblance, even when what it looks like is already listed.
  it('gives a name typed that looks like a product already in the check that item, as listed', () => {
    const advil: CheckedItem = { ref: { kind: 'product', id: 'advil-400-mg-63646874' } };
    const net = withPossibleMatches(pack, [advil, typed('advil')]);
    expect(net.items).toEqual([advil, typed('advil'), advil]);
    expect([...net.possible]).toEqual([
      [2, { forItem: 1, typed: 'advil', strength: 'very-strong', sameAs: 0, listed: true }],
    ]);
  });

  it('gives each name typed that looks like the same product its own possible match', () => {
    const net = withPossibleMatches(pack, [typed('advil 400'), typed('Advil 400 mg')]);
    expect(net.items).toHaveLength(4);
    expect([...net.possible]).toEqual([
      [2, { forItem: 0, typed: 'advil 400', strength: 'very-strong' }],
      [3, { forItem: 1, typed: 'Advil 400 mg', strength: 'very-strong', sameAs: 2 }],
    ]);
    expect(net.items[3]).toEqual(net.items[2]);
  });

  it('puts the resemblances of items already there after every possible match of its own', () => {
    const miso: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
    const net = withPossibleMatches(pack, [miso, typed('cytotec 200'), typed('huile de ricin')]);
    expect(net.items.map((item) => item.ref)).toEqual([
      miso.ref,
      { kind: 'unrecognised', text: 'cytotec 200' },
      { kind: 'unrecognised', text: 'huile de ricin' },
      { kind: 'plant', id: 'castor-oil' },
      miso.ref,
    ]);
    expect(net.possible.get(4)).toMatchObject({ forItem: 1, sameAs: 0, listed: true });
  });

  it('keeps a weak resemblance of an item already there out after "none of these", as any', () => {
    const advil: CheckedItem = { ref: { kind: 'product', id: 'advil-400-mg-63646874' } };
    const net = withPossibleMatches(pack, [advil, typed('advi')], { declined: () => true });
    expect(net.items).toHaveLength(2);
  });

  // Live test round 2 (depot-keeper#1): a name that names two brands or a
  // brand and a substance no single product holds keeps a possible match for each.
  it('keeps a possible match for each brand or substance the first one lacks', () => {
    const net = withPossibleMatches(pack, [typed('advil cytotec')], { declined: () => true });
    const ids = net.items.slice(1).map((item) => (item.ref as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('misoprostol-generic');
    expect(ids.some((id) => id.startsWith('advil-'))).toBe(true);
    for (const match of net.possible.values()) {
      expect(match).toMatchObject({ forItem: 0, typed: 'advil cytotec', strength: 'very-strong' });
    }
  });

  it('keeps one possible match when one product holds every substance named', () => {
    const net = withPossibleMatches(pack, [typed('Advil codéine')]);
    expect(net.items.slice(1)).toEqual([
      {
        ref: { kind: 'product', id: 'antarene-codeine-200-mg-30-mg-63755329' },
        strengthUnknown: true,
      },
    ]);
  });
});

describe('evaluateWithPossibleMatches', () => {
  const at = (weeks: number, items: CheckedItem[]) =>
    contextFromProfile(
      profileOf({ term: { kind: 'weeks', weeks, givenOn: '2026-11-05' } }),
      { items, signs: [] },
      '2026-11-05',
    );

  it('gives a name typed that looks like a listed product the cards of that product', () => {
    const miso: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
    const context = at(10, [miso, typed('cytotec 200')]);
    const net = withPossibleMatches(pack, context.items, { declined: () => true });
    const evaluation = evaluateWithPossibleMatches(pack, context, net);
    const own = evaluation.findings.filter((f) => f.items.includes(0) && f.ruleId !== undefined);
    const copies = evaluation.findings.filter((f) => f.items.includes(2));
    expect(own.length).toBeGreaterThan(0);
    expect(copies.map((f) => [f.ruleId, f.level])).toEqual(own.map((f) => [f.ruleId, f.level]));
    // Never twice for the engine: no finding holds both.
    expect(evaluation.findings.some((f) => f.items.includes(0) && f.items.includes(2))).toBe(false);
    expect(evaluation.level).toBe(evaluate(pack, context).level);
  });

  it('gives each name typed that looks like castor oil its card at 37 weeks with a scar', () => {
    const context = contextFromProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 37, givenOn: '2026-11-05' },
        conditions: ['uterine-scar'],
      }),
      { items: [typed('ricin'), typed('huile ricin'), typed('huile de castor')], signs: [] },
      '2026-11-05',
    );
    const net = withPossibleMatches(pack, context.items);
    const evaluation = evaluateWithPossibleMatches(pack, context, net);
    expect(evaluation.level).toBe('danger');
    for (const index of [3, 4, 5]) {
      expect(
        evaluation.findings.some((f) => f.items.includes(index) && f.level === 'danger'),
        String(index),
      ).toBe(true);
    }
  });

  it('gives "Ibuprofène 400" typed after "Advil 400 mg boîte de 20" its card at 28 weeks', () => {
    const context = at(28, [typed('Advil 400 mg boîte de 20'), typed('Ibuprofène 400')]);
    const net = withPossibleMatches(pack, context.items, { declined: () => true });
    const evaluation = evaluateWithPossibleMatches(pack, context, net);
    for (const forItem of [0, 1]) {
      const added = [...net.possible].filter(([, match]) => match.forItem === forItem);
      expect(added, String(forItem)).toHaveLength(1);
      const [index] = added[0] ?? [];
      expect(
        evaluation.findings.some(
          (f) => index !== undefined && f.items.includes(index) && f.level === 'before-next-dose',
        ),
        String(forItem),
      ).toBe(true);
    }
  });

  // Review of SCRUM-51 (I1): another strength or form of a listed brand is
  // another box, read by the engine, never a copy of the listed box's cards.
  it('reads "Kardegic 300" typed beside KARDEGIC 75 mg as its own box at 26 weeks', () => {
    const kardegic75: CheckedItem = { ref: { kind: 'product', id: 'kardegic-75-mg-64755969' } };
    const context = at(26, [kardegic75, typed('Kardegic 300')]);
    expect(evaluate(pack, context).level).not.toBe('before-next-dose');
    const net = withPossibleMatches(pack, context.items, { declined: () => true });
    expect(net.items[2]).toEqual({ ref: { kind: 'product', id: 'kardegic-300-mg-68815221' } });
    expect(net.possible.get(2)).not.toHaveProperty('sameAs');
    const evaluation = evaluateWithPossibleMatches(pack, context, net);
    expect(evaluation.level).toBe('before-next-dose');
    expect(
      evaluation.findings.find((f) => f.ruleId === 'aspirin-analgesic-dose-pregnancy')?.items,
    ).toEqual([2]);
  });

  it('reads "doliprane 1000" typed beside DOLIPRANE 500 mg as a second paracetamol box', () => {
    const doliprane500: CheckedItem = {
      ref: { kind: 'product', id: 'doliprane-500-mg-63368332' },
    };
    const context = at(26, [doliprane500, typed('doliprane 1000')]);
    const net = withPossibleMatches(pack, context.items, { declined: () => true });
    expect(net.possible.get(2)).not.toHaveProperty('sameAs');
    const evaluation = evaluateWithPossibleMatches(pack, context, net);
    const duplicate = evaluation.findings.find(
      (f) => f.ruleId === 'paracetamol-duplicate-products',
    );
    expect(duplicate?.items).toEqual([0, 2]);
  });

  it('copies the cards of a listed box for its own name typed, or the brand alone', () => {
    const kardegic75: CheckedItem = { ref: { kind: 'product', id: 'kardegic-75-mg-64755969' } };
    for (const text of ['Kardegic 75', 'kardegic']) {
      const net = withPossibleMatches(pack, [kardegic75, typed(text)], { declined: () => true });
      expect(net.possible.get(2), text).toMatchObject({ sameAs: 0, listed: true });
    }
  });

  it('holds the copy of a danger below a danger when its resemblance is only strong', () => {
    const miso: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
    const context = at(36, [miso, typed('misopristol')]);
    const net = withPossibleMatches(pack, context.items);
    expect(net.possible.get(2)?.strength).toBe('strong');
    const evaluation = evaluateWithPossibleMatches(pack, context, net);
    expect(evaluation.level).toBe('danger');
    const copy = evaluation.findings.find((f) => f.items.includes(2) && f.ruleId !== undefined);
    expect(copy?.level).toBe('before-next-dose');
  });

  it('is the engine and the hold as before when nothing is listed twice', () => {
    const context = at(26, [typed('Advil 400 mg comprimé pelliculé')]);
    const net = withPossibleMatches(pack, context.items);
    expect(evaluateWithPossibleMatches(pack, context, net)).toEqual(
      cappedEvaluation(evaluate(pack, { ...context, items: net.items }), net.possible),
    );
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
