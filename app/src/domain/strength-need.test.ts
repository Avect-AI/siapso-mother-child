// SPDX-License-Identifier: MIT
import {
  evaluate,
  levelRank,
  maxLevel,
  type CheckedItem,
  type EvaluationContext,
  type Pack,
  type Product,
} from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack } from '../test/knowledge-pack.js';
import { productFamilyOf } from './search-index.js';
import { strengthNeed, type StrengthNeed } from './strength-need.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

/** The families of the pack with more than one product: those the confirm screen asks about. */
function families(): Map<string, Product[]> {
  const byFamily = new Map<string, Product[]>();
  for (const product of pack.products) {
    const family = productFamilyOf(pack, product.id);
    if (family === undefined) continue;
    byFamily.set(family, [...(byFamily.get(family) ?? []), product]);
  }
  return new Map([...byFamily].filter(([, members]) => members.length > 1));
}

function needs(): Map<string, StrengthNeed> {
  return new Map([...families()].map(([family, members]) => [family, strengthNeed(pack, members)]));
}

/** The need of the family whose boxes are named `brand` ("DOLIPRANE 1000 mg"), undefined when none is. */
function needOf(brand: string): StrengthNeed | undefined {
  const found = [...families().values()].find((members) =>
    members.some((p) => p.names.fr.toUpperCase().startsWith(`${brand} `)),
  );
  return found === undefined ? undefined : strengthNeed(pack, found);
}

/** The situations a level depends on: every window of a pregnancy, an unknown term, breastfeeding. */
const CONTEXTS: Omit<EvaluationContext, 'items'>[] = [
  { pregnancy: { weeksMin: 6, weeksMax: 6, precision: 'exact' }, conditions: [], signs: [] },
  { pregnancy: { weeksMin: 16, weeksMax: 16, precision: 'exact' }, conditions: [], signs: [] },
  { pregnancy: { weeksMin: 24, weeksMax: 24, precision: 'exact' }, conditions: [], signs: [] },
  { pregnancy: { weeksMin: 34, weeksMax: 34, precision: 'exact' }, conditions: [], signs: [] },
  { pregnancy: { weeksMin: 0, weeksMax: 42, precision: 'unknown' }, conditions: [], signs: [] },
  { breastfeeding: { babyAgeWeeks: 4 }, conditions: [], signs: [] },
];

function levelOf(context: Omit<EvaluationContext, 'items'>, item: CheckedItem) {
  const { findings } = evaluate(pack, { ...context, items: [item] });
  return maxLevel(findings.map((finding) => finding.level));
}

describe('the strength is asked only when a rule reads it (SCRUM-56, S10)', () => {
  it('always for aspirin, whose boxes sit on both sides of a rule threshold (ASPEGIC, KARDEGIC)', () => {
    const always = [...needs()].filter(([, need]) => need === 'always').map(([family]) => family);
    expect(needOf('ASPEGIC')).toBe('always');
    expect(needOf('KARDEGIC')).toBe('always');
    // Every aspirin family, and nothing else, in the pack of today.
    expect(always.length).toBeLessThanOrEqual(3);
    for (const family of always) {
      const members = families().get(family) ?? [];
      const held = new Set(members.flatMap((p) => p.components.map((c) => c.substance)));
      // Either a threshold on one of its substances, or boxes that hold different substances.
      const threshold = pack.rules.some(
        (rule) =>
          rule.when.strengthAboveMg !== undefined &&
          rule.when.subject !== undefined &&
          'substance' in rule.when.subject &&
          held.has(rule.when.subject.substance),
      );
      const keys = new Set(
        members.map((p) => [...new Set(p.components.map((c) => c.substance))].sort().join('+')),
      );
      expect(threshold || keys.size > 1, family).toBe(true);
    }
  });

  it('only once a daily count is given for paracetamol, under a daily maximum (DOLIPRANE)', () => {
    const all = needs();
    expect(needOf('DOLIPRANE')).toBe('with-count');
    // The 7 paracetamol families of the study (spec section 4.3, F5).
    expect([...all.values()].filter((need) => need === 'with-count')).toHaveLength(7);
    for (const [family, need] of all) {
      if (need !== 'with-count') continue;
      const members = families().get(family) ?? [];
      expect(
        members.some((p) => p.components.some((c) => c.substance === 'paracetamol')),
        family,
      ).toBe(true);
    }
  });

  it('never otherwise: an amoxicillin box is added with its strength not given (CLAMOXYL)', () => {
    expect(needOf('CLAMOXYL')).toBe('never');
  });

  it('never lowers a level: a box added without its strength reads at least as high as any box of its family', () => {
    for (const [family, members] of families()) {
      const need = strengthNeed(pack, members);
      if (need === 'always') continue;
      for (const context of CONTEXTS) {
        const unknown = levelOf(context, {
          ref: { kind: 'product', id: members[0]?.id ?? '' },
          strengthUnknown: true,
        });
        for (const member of members) {
          const known = levelOf(context, { ref: { kind: 'product', id: member.id } });
          // Never lower; and no other answer either, since no rule reads the strength without a count.
          expect(levelRank(unknown), `${family} ${member.id}`).toBeGreaterThanOrEqual(
            levelRank(known),
          );
          expect(unknown, `${family} ${member.id}`).toBe(known);
        }
      }
    }
  });
});
