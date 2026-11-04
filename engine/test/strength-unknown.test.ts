// SPDX-License-Identifier: MIT
// CheckedItem.strengthUnknown: the user confirmed the product but does not
// know which strength is written on the box. Its component strengths are then
// read as unknown: a strengthAboveMg rule applies (cautious), the max-dose sum
// skips the item and the max-dose-not-computable note can apply.
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index.js';
import type { CheckedItem, Evaluation, EvaluationContext, Pack, Rule } from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const MAX_DOSE_RULE = 'fixture-max-dose-paracetamol';
const STRENGTH_RULE = 'fixture-extra-strength';

/** The fixture pack with a pregnancy rule on paracetamol above 500 mg. */
function strengthPack(): Pack {
  const base = fixturePack();
  const extra: Rule = {
    id: STRENGTH_RULE,
    kind: 'pregnancy',
    when: { subject: { substance: 'paracetamol' }, strengthAboveMg: 500 },
    level: 'next-contact',
    evidence: 'A',
    message: STRENGTH_RULE,
    sources: [],
    review: { status: 'draft', reviewers: [] },
  };
  return {
    ...base,
    rules: [...base.rules, extra],
    messages: {
      fr: { ...base.messages.fr, [STRENGTH_RULE]: { fact: 'Fait.', risk: 'Risque.' } },
      en: { ...base.messages.en, [STRENGTH_RULE]: { fact: 'Fact.', risk: 'Risk.' } },
    },
  };
}

function run(items: CheckedItem[], pack: Pack = strengthPack()): Evaluation {
  const context: EvaluationContext = {
    pregnancy: { weeksMin: 30, weeksMax: 30, precision: 'exact' },
    conditions: [],
    items,
    signs: [],
  };
  return evaluate(deepFreeze(pack), deepFreeze(context));
}

function product(id: string, extra: Omit<CheckedItem, 'ref'> = {}): CheckedItem {
  return { ref: { kind: 'product', id }, ...extra };
}

describe('CheckedItem.strengthUnknown', () => {
  it('makes a strengthAboveMg rule apply to a product whose strength is below the value', () => {
    const known = run([product('paracetamol-500')]);
    expect(known.findings.filter((f) => f.ruleId === STRENGTH_RULE)).toEqual([]);

    const unknown = run([product('paracetamol-500', { strengthUnknown: true })]);
    expect(unknown.findings.filter((f) => f.ruleId === STRENGTH_RULE)).toMatchObject([
      { check: 'C1', items: [0] },
    ]);
  });

  it('keeps the item out of the max-dose sum, and gives the not-computable note instead', () => {
    // 1000 mg x 5 = 5000 mg is above the fixture threshold of 4000 mg.
    const known = run([product('paracetamol-1000', { unitsPerDay: 5 })]);
    expect(known.findings.filter((f) => f.check === 'C7')).toMatchObject([
      { ruleId: MAX_DOSE_RULE },
    ]);
    expect(known.notes).toEqual([]);

    const unknown = run([product('paracetamol-1000', { unitsPerDay: 5, strengthUnknown: true })]);
    expect(unknown.findings.filter((f) => f.check === 'C7')).toEqual([]);
    expect(unknown.notes).toMatchObject([
      { ruleId: MAX_DOSE_RULE, message: 'max-dose-not-computable', kind: 'dose' },
    ]);
  });

  it('still counts the known part of the other items in the max-dose sum', () => {
    const result = run([
      product('paracetamol-1000', { unitsPerDay: 5 }),
      product('paracetamol-500', { unitsPerDay: 2, strengthUnknown: true }),
    ]);
    expect(result.findings.filter((f) => f.check === 'C7')).toMatchObject([
      { ruleId: MAX_DOSE_RULE, items: [0, 1] },
    ]);
  });

  it('changes nothing when false or absent', () => {
    const absent = run([product('paracetamol-1000', { unitsPerDay: 5 })]);
    const unset = run([product('paracetamol-1000', { unitsPerDay: 5, strengthUnknown: false })]);
    expect(unset).toEqual(absent);
  });

  it('refuses a value that is not a boolean, naming the item', () => {
    const items = [
      product('paracetamol-500'),
      { ...product('paracetamol-500'), strengthUnknown: 'yes' } as unknown as CheckedItem,
    ];
    expect(() => run(items)).toThrow(TypeError);
    expect(() => run(items)).toThrow(/items\[1\]\.strengthUnknown/);
  });
});
