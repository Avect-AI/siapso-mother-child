// SPDX-License-Identifier: MIT
import {
  CONDITION_IDS,
  evaluate,
  itemMatches,
  levelRank,
  maxLevel,
  type CheckedItem,
  type ConditionId,
  type EvaluationContext,
  type Pack,
  type Product,
  type Subject,
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

/** Every window of a pregnancy (with the look-ahead across each limit), an unknown term, none. */
const TERMS: Pick<EvaluationContext, 'pregnancy'>[] = [
  {},
  ...[6, 10, 14, 18, 22, 26, 31, 38].map((weeks) => ({
    pregnancy: { weeksMin: weeks, weeksMax: weeks, precision: 'exact' as const },
  })),
  { pregnancy: { weeksMin: 0, weeksMax: 42, precision: 'unknown' } },
];

/** Not breastfeeding, a newborn, an older baby. */
const NURSING: Pick<EvaluationContext, 'breastfeeding'>[] = [
  {},
  { breastfeeding: { babyAgeWeeks: 4 } },
  { breastfeeding: { babyAgeWeeks: 40 } },
];

/** Fewer terms for a situation, a sign or a partner: none, each window, unknown, breastfeeding. */
const FEW: Omit<EvaluationContext, 'items' | 'conditions' | 'signs'>[] = [
  {},
  { pregnancy: { weeksMin: 10, weeksMax: 10, precision: 'exact' } },
  { pregnancy: { weeksMin: 24, weeksMax: 24, precision: 'exact' } },
  { pregnancy: { weeksMin: 34, weeksMax: 34, precision: 'exact' } },
  { pregnancy: { weeksMin: 0, weeksMax: 42, precision: 'unknown' } },
  { breastfeeding: { babyAgeWeeks: 4 } },
];

/** A product or remedy of the pack that `subject` reads, to stand beside the box. */
function itemFor(subject: Subject): CheckedItem | undefined {
  if ('plant' in subject) return { ref: { kind: 'plant', id: subject.plant } };
  const found = pack.products.find((p) => itemMatches(pack, productItem(p.id), subject));
  return found === undefined ? undefined : productItem(found.id);
}

function productItem(id: string, strengthUnknown = false): CheckedItem {
  return { ref: { kind: 'product', id }, ...(strengthUnknown ? { strengthUnknown: true } : {}) };
}

/**
 * What may stand beside a box of `members` and change a level: the other side
 * of every rule that reads it, as its subject, its partner (`with`) or an
 * exception (`unlessWith`).
 */
function partnersOf(members: readonly Product[]): CheckedItem[] {
  const reads = (subject: Subject) =>
    members.some((p) => itemMatches(pack, productItem(p.id), subject));
  const partners = new Map<string, CheckedItem>();
  for (const rule of pack.rules) {
    const { subject, requires = [], unlessWith = [] } = rule.when;
    const sides = [
      ...(subject === undefined ? [] : [subject]),
      ...requires.flatMap((r) => ('with' in r ? [r.with] : [])),
      ...unlessWith,
    ];
    if (!sides.some(reads)) continue;
    for (const side of sides) {
      if (reads(side)) continue;
      const item = itemFor(side);
      if (item !== undefined) partners.set(JSON.stringify(item.ref), item);
    }
  }
  return [...partners.values()];
}

/** The danger signs that a rule requires, each a situation of its own. */
function requiredSigns(): string[] {
  return [
    ...new Set(
      pack.rules.flatMap((rule) =>
        (rule.when.requires ?? []).flatMap((r) => ('sign' in r ? [r.sign] : [])),
      ),
    ),
  ];
}

/** The highest level of the findings about the box, the first item. */
function boxLevel(context: Omit<EvaluationContext, 'items'>, items: CheckedItem[]) {
  const { findings } = evaluate(pack, { ...context, items });
  return maxLevel(findings.filter((f) => f.items.includes(0)).map((f) => f.level));
}

describe('a box without its strength never reads lower than a box of its family (SCRUM-56, S10)', () => {
  it('in every situation, beside every partner of a rule, breastfeeding or not, at every term', () => {
    let pairs = 0;
    const lower: string[] = [];
    for (const [family, members] of families()) {
      const extras: {
        name: string;
        context: Pick<EvaluationContext, 'conditions' | 'signs'>;
        partner?: CheckedItem;
      }[] = [
        ...CONDITION_IDS.map((condition) => ({
          name: condition,
          context: { conditions: [condition as ConditionId], signs: [] },
        })),
        ...requiredSigns().map((sign) => ({
          name: sign,
          context: { conditions: [], signs: [sign] },
        })),
        ...partnersOf(members).map((partner) => ({
          name: JSON.stringify(partner.ref),
          context: { conditions: [], signs: [] },
          partner,
        })),
      ];
      const contexts = [
        ...TERMS.flatMap((term) =>
          NURSING.map((nursing) => ({
            name: JSON.stringify({ ...term, ...nursing }),
            context: { ...term, ...nursing, conditions: [], signs: [] },
            partner: undefined as CheckedItem | undefined,
          })),
        ),
        ...extras.flatMap((extra) =>
          FEW.map((few) => ({
            name: `${extra.name} ${JSON.stringify(few)}`,
            context: { ...few, ...extra.context },
            partner: extra.partner,
          })),
        ),
      ];
      for (const { name, context, partner } of contexts) {
        const beside = partner === undefined ? [] : [partner];
        const unknown = boxLevel(context, [productItem(members[0]?.id ?? '', true), ...beside]);
        for (const member of members) {
          pairs += 1;
          const known = boxLevel(context, [productItem(member.id), ...beside]);
          if (levelRank(unknown) < levelRank(known)) {
            lower.push(`${family} ${member.id} ${name}: ${unknown} < ${known}`);
          }
        }
      }
    }
    expect(lower).toEqual([]);
    // Thousands of pairs: a future threshold rule that would lower one is caught.
    expect(pairs).toBeGreaterThan(5000);
  });
});
