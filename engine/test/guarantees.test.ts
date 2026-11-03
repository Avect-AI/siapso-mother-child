// SPDX-License-Identifier: MIT
// Engine guarantees (design spec section 5.3), each checked over every
// generated context. Generation is exhaustive and deterministic: every
// combination of 0 to 3 items taken from the fixture products, the fixture
// plants and one unrecognised item, every pregnancy window (exact, estimated,
// unknown, none), with and without breastfeeding, with and without
// conditions and a danger sign. No randomness.
import { describe, expect, it } from 'vitest';
import { evaluate, LEVELS, rangeFromMonths, UNKNOWN_TERM } from '../src/index.js';
import type {
  BreastfeedingContext,
  CheckedItem,
  ConditionId,
  Evaluation,
  EvaluationContext,
  PregnancyContext,
} from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const pack = deepFreeze(fixturePack());

const POOL: CheckedItem[] = [
  ...pack.products.map((p): CheckedItem => ({
    ref: { kind: 'product', id: p.id },
    unitsPerDay: 4,
  })),
  ...pack.plants.map((p): CheckedItem => ({ ref: { kind: 'plant', id: p.id } })),
  { ref: { kind: 'unrecognised', text: 'Xyzol' } },
];

const UNKNOWN_PREGNANCY: PregnancyContext = { ...UNKNOWN_TERM, precision: 'unknown' };
const EXACT_PREGNANCIES: PregnancyContext[] = [8, 15, 25, 34].map((weeks) => ({
  weeksMin: weeks,
  weeksMax: weeks,
  precision: 'exact',
}));
const PREGNANCIES: (PregnancyContext | undefined)[] = [
  undefined,
  ...EXACT_PREGNANCIES,
  { ...rangeFromMonths(5), precision: 'estimated' },
  UNKNOWN_PREGNANCY,
];
const BREASTFEEDING: (BreastfeedingContext | undefined)[] = [
  undefined,
  { babyAgeWeeks: 4, premature: true },
];
const SITUATIONS: { conditions: ConditionId[]; signs: string[] }[] = [
  { conditions: [], signs: [] },
  { conditions: ['hiv-cotrimoxazole', 'uterine-scar'], signs: ['fever'] },
];

/** Every combination of 0 to maxSize elements, in pool order. */
function combinations<T>(pool: readonly T[], maxSize: number): T[][] {
  const result: T[][] = [[]];
  const extend = (start: number, current: T[]): void => {
    for (let i = start; i < pool.length; i += 1) {
      const next = [...current, pool[i] as T];
      result.push(next);
      if (next.length < maxSize) extend(i + 1, next);
    }
  };
  extend(0, []);
  return result;
}

interface Case {
  context: EvaluationContext;
  result: Evaluation;
  /** Same index for the cases that differ only by pregnancy. */
  base: number;
  pregnancy: PregnancyContext | undefined;
}

function buildCases(): Case[] {
  const cases: Case[] = [];
  let base = 0;
  for (const items of combinations(POOL, 3)) {
    for (const breastfeeding of BREASTFEEDING) {
      for (const situation of SITUATIONS) {
        for (const pregnancy of PREGNANCIES) {
          const context: EvaluationContext = deepFreeze({
            ...situation,
            items,
            ...(pregnancy ? { pregnancy } : {}),
            ...(breastfeeding ? { breastfeeding } : {}),
          });
          cases.push({ context, result: evaluate(pack, context), base, pregnancy });
        }
        base += 1;
      }
    }
  }
  return cases;
}

const CASES = buildCases();

function describeCase(c: Case): string {
  return JSON.stringify(c.context);
}

describe('guarantees', () => {
  it('covers a large number of generated contexts', () => {
    // 378 item combinations x 7 pregnancies x 2 breastfeeding x 2 situations.
    expect(combinations(POOL, 3)).toHaveLength(378);
    expect(CASES).toHaveLength(378 * 7 * 2 * 2);
  });

  it('gives every unrecognised item an unknown C12 finding, whatever else is present', () => {
    const violations: string[] = [];
    for (const c of CASES) {
      c.context.items.forEach((item, index) => {
        if (item.ref.kind !== 'unrecognised') return;
        const found = c.result.findings.some(
          (f) => f.check === 'C12' && f.level === 'unknown' && f.items.includes(index),
        );
        if (!found) violations.push(describeCase(c));
      });
    }
    expect(violations).toEqual([]);
  });

  it('never yields a level outside the four levels', () => {
    const levels: readonly string[] = LEVELS;
    const violations = CASES.filter(
      (c) =>
        !levels.includes(c.result.level) ||
        c.result.findings.some((f) => !levels.includes(f.level)),
    ).map(describeCase);
    expect(violations).toEqual([]);
  });

  it('gives deep-equal outputs for deep-equal inputs and never modifies them', () => {
    const packCopy = deepFreeze(structuredClone(fixturePack()));
    const violations: string[] = [];
    for (const c of CASES) {
      const pristine: EvaluationContext = structuredClone(c.context);
      const again = evaluate(packCopy, deepFreeze(structuredClone(c.context)));
      const repeated = evaluate(pack, c.context);
      try {
        expect(again).toStrictEqual(c.result);
        expect(repeated).toStrictEqual(c.result);
        expect(c.context).toStrictEqual(pristine);
      } catch {
        violations.push(describeCase(c));
      }
    }
    expect(violations).toEqual([]);
    expect(pack).toStrictEqual(fixturePack());
  });

  it('never lets evidence D, E or 0 exceed next-contact, except for toxicity', () => {
    const kindOf = new Map(pack.rules.map((r) => [r.id, r.kind]));
    const weak: readonly string[] = ['D', 'E', '0'];
    const above = new Set(['before-next-dose', 'danger']);
    const violations: string[] = [];
    for (const c of CASES) {
      for (const f of c.result.findings) {
        const kind = f.ruleId === undefined ? undefined : kindOf.get(f.ruleId);
        if (f.evidence !== undefined && weak.includes(f.evidence) && kind !== 'toxicity') {
          if (above.has(f.level)) violations.push(`${f.ruleId ?? f.message} in ${describeCase(c)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('only uses message ids that exist in French and English', () => {
    const violations: string[] = [];
    for (const c of CASES) {
      const ids = [
        ...c.result.findings.map((f) => f.message),
        ...c.result.reminders.map((n) => n.message),
        ...c.result.notes.map((n) => n.message),
      ];
      for (const id of ids) {
        if (!Object.hasOwn(pack.messages.fr, id) || !Object.hasOwn(pack.messages.en, id)) {
          violations.push(id);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('triggers with an unknown term every rule that some exact term triggers', () => {
    const triggered = (result: Evaluation): string[] => [
      ...result.findings.flatMap((f) => (f.ruleId === undefined ? [] : [f.ruleId])),
      ...result.reminders.map((n) => n.ruleId),
      ...result.notes.map((n) => n.ruleId),
    ];
    const byBase = new Map<number, Case[]>();
    for (const c of CASES) byBase.set(c.base, [...(byBase.get(c.base) ?? []), c]);
    const violations: string[] = [];
    let compared = 0;
    for (const group of byBase.values()) {
      const unknown = group.find((c) => c.pregnancy === UNKNOWN_PREGNANCY);
      if (!unknown) throw new Error('Every group has an unknown-term case');
      const unknownRules = new Set(triggered(unknown.result));
      for (const c of group) {
        if (!c.pregnancy || !EXACT_PREGNANCIES.includes(c.pregnancy)) continue;
        for (const ruleId of triggered(c.result)) {
          compared += 1;
          if (!unknownRules.has(ruleId)) violations.push(`${ruleId} in ${describeCase(c)}`);
        }
      }
      const windowRules = new Set(
        pack.rules.filter((r) => r.when.pregnancyWindows !== undefined).map((r) => r.id),
      );
      for (const f of unknown.result.findings) {
        if (f.ruleId !== undefined && windowRules.has(f.ruleId) && f.term !== 'unknown') {
          violations.push(`${f.ruleId} without term unknown in ${describeCase(unknown)}`);
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
