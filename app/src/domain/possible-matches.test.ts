// SPDX-License-Identifier: MIT
import { evaluate, type CheckedItem, type Pack } from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { contextFromProfile } from './context.js';
import { cappedEvaluation, withPossibleMatches } from './possible-matches.js';

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

describe('withPossibleMatches: a brand spelt within one edit', () => {
  it.each([
    ['cytotek', 'misoprostol-generic'],
    ['cytoteck', 'misoprostol-generic'],
    ['misopristol', 'misoprostol-generic'],
  ])('keeps %s after "none of these", strong but not very strong', (text, id) => {
    const net = withPossibleMatches(pack, [typed(text)], { declined: () => true });
    expect(net.items[1]?.ref).toMatchObject({ id });
    expect(net.possible.get(1)?.strength).toBe('strong');
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
