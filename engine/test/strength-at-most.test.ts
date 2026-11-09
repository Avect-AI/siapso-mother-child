// SPDX-License-Identifier: MIT
// CheckedItem.strengthAtMostMg: the user answered the dose question of a box
// with no strength in the pack by a range ("100 mg ou moins" for generic
// aspirin). A component of unknown strength is then read as at most that
// value: a strengthAboveMg rule at or above it does not apply, one below it
// still does. A strength the pack knows is read as it is, and a daily maximum
// still reads the strength as not known.
import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/index.js';
import type {
  CheckedItem,
  Component,
  Evaluation,
  EvaluationContext,
  Pack,
  Product,
  Rule,
} from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const CODEINE_RULE = 'fixture-codeine-above-30';
const PARACETAMOL_RULE = 'fixture-paracetamol-above-500';
const CODEINE_HIGH_RULE = 'fixture-codeine-above-60';
const MAX_DOSE_RULE = 'fixture-max-dose-paracetamol';

function fixtureProduct(id: string, components: Component[]): Product {
  return {
    id,
    names: { fr: `${id} (fr)`, en: `${id} (en)` },
    brands: [],
    localNames: [],
    components,
    form: 'syrup',
    route: 'oral',
    demo: true,
  };
}

function thresholdRule(id: string, substance: string, strengthAboveMg: number): Rule {
  return {
    id,
    kind: 'pregnancy',
    when: { subject: { substance }, strengthAboveMg },
    level: 'next-contact',
    evidence: 'A',
    message: id,
    sources: [],
    review: { status: 'draft', reviewers: [] },
  };
}

/**
 * The fixture pack with two thresholds on codeine (whose syrup has no
 * strength) and one on paracetamol, and two combinations of codeine and
 * paracetamol: one with no strength at all, one with paracetamol at 500 mg.
 */
function thresholdPack(): Pack {
  const base = fixturePack();
  const extra = [
    thresholdRule(CODEINE_RULE, 'codeine', 30),
    thresholdRule(CODEINE_HIGH_RULE, 'codeine', 60),
    thresholdRule(PARACETAMOL_RULE, 'paracetamol', 500),
  ];
  const words = { fact: 'Fait.', risk: 'Risque.' };
  const messages = Object.fromEntries(extra.map((r) => [r.id, words]));
  return {
    ...base,
    products: [
      ...base.products,
      fixtureProduct('codeine-paracetamol-syrup', [
        { substance: 'codeine' },
        { substance: 'paracetamol' },
      ]),
      fixtureProduct('codeine-paracetamol-500', [
        { substance: 'codeine' },
        { substance: 'paracetamol', strengthMg: 500 },
      ]),
    ],
    rules: [...base.rules, ...extra],
    messages: {
      fr: { ...base.messages.fr, ...messages },
      en: { ...base.messages.en, ...messages },
    },
  };
}

function run(items: CheckedItem[]): Evaluation {
  const context: EvaluationContext = {
    pregnancy: { weeksMin: 30, weeksMax: 30, precision: 'exact' },
    conditions: [],
    items,
    signs: [],
  };
  return evaluate(deepFreeze(thresholdPack()), deepFreeze(context));
}

function product(id: string, extra: Omit<CheckedItem, 'ref'> = {}): CheckedItem {
  return { ref: { kind: 'product', id }, ...extra };
}

function ruleIds(result: Evaluation): (string | undefined)[] {
  return result.findings.map((f) => f.ruleId);
}

describe('CheckedItem.strengthAtMostMg', () => {
  it('keeps a threshold rule off a box of unknown strength said to be at most the threshold', () => {
    // No strength in the pack: read above any threshold, as before.
    expect(ruleIds(run([product('codeine-syrup')]))).toContain(CODEINE_RULE);
    // "30 mg ou moins": at most the threshold, so never above it.
    expect(ruleIds(run([product('codeine-syrup', { strengthAtMostMg: 30 })]))).not.toContain(
      CODEINE_RULE,
    );
    expect(ruleIds(run([product('codeine-syrup', { strengthAtMostMg: 10 })]))).not.toContain(
      CODEINE_RULE,
    );
  });

  it('still applies a threshold rule below the value said: the strength may be above it', () => {
    expect(ruleIds(run([product('codeine-syrup', { strengthAtMostMg: 31 })]))).toContain(
      CODEINE_RULE,
    );
  });

  it('reads a strength the pack knows as it is, whatever the value said', () => {
    expect(ruleIds(run([product('paracetamol-1000', { strengthAtMostMg: 100 })]))).toContain(
      PARACETAMOL_RULE,
    );
    expect(ruleIds(run([product('paracetamol-500', { strengthAtMostMg: 1000 })]))).not.toContain(
      PARACETAMOL_RULE,
    );
  });

  it('bounds a strength unknown by strengthUnknown too', () => {
    const unknown = product('paracetamol-1000', { strengthUnknown: true });
    expect(ruleIds(run([unknown]))).toContain(PARACETAMOL_RULE);
    expect(ruleIds(run([{ ...unknown, strengthAtMostMg: 500 }]))).not.toContain(PARACETAMOL_RULE);
  });

  it('leaves a daily maximum reading the strength as not known', () => {
    const unknown = product('paracetamol-1000', { unitsPerDay: 5, strengthUnknown: true });
    const bounded = run([{ ...unknown, strengthAtMostMg: 500 }]);
    expect(bounded.findings.filter((f) => f.check === 'C7')).toEqual(
      run([unknown]).findings.filter((f) => f.check === 'C7'),
    );
    expect(bounded.notes).toMatchObject([{ ruleId: MAX_DOSE_RULE }]);
  });

  it('reads each threshold of a substance against the value said: the lower one only may apply', () => {
    const at = (mg: number) => ruleIds(run([product('codeine-syrup', { strengthAtMostMg: mg })]));
    expect(at(30)).not.toContain(CODEINE_RULE);
    expect(at(30)).not.toContain(CODEINE_HIGH_RULE);
    // "50 mg or less" may be above 30 mg, never above 60 mg.
    expect(at(50)).toContain(CODEINE_RULE);
    expect(at(50)).not.toContain(CODEINE_HIGH_RULE);
    expect(at(80)).toEqual(expect.arrayContaining([CODEINE_RULE, CODEINE_HIGH_RULE]));
  });

  it('bounds the one component of unknown strength of a combination, the others read as the pack says', () => {
    const item = product('codeine-paracetamol-500', { strengthAtMostMg: 30 });
    expect(ruleIds(run([item]))).not.toContain(CODEINE_RULE);
    expect(ruleIds(run([product('codeine-paracetamol-500')]))).toContain(CODEINE_RULE);
  });

  it('ignores the value when two components or more have no strength: which one it bounds is not said', () => {
    const bounded = run([product('codeine-paracetamol-syrup', { strengthAtMostMg: 30 })]);
    expect(ruleIds(bounded)).toEqual(
      expect.arrayContaining([CODEINE_RULE, CODEINE_HIGH_RULE, PARACETAMOL_RULE]),
    );
    expect(bounded).toEqual(run([product('codeine-paracetamol-syrup')]));
    // strengthUnknown makes every component unknown: the value is ignored too.
    const unknown = product('codeine-paracetamol-500', { strengthUnknown: true });
    expect(run([{ ...unknown, strengthAtMostMg: 30 }])).toEqual(run([unknown]));
  });

  it('changes nothing when absent', () => {
    expect(run([product('codeine-syrup', {})])).toEqual(run([product('codeine-syrup')]));
  });

  it('refuses a value that is not a finite number greater than 0, naming the item', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      const items = [
        product('codeine-syrup'),
        { ...product('codeine-syrup'), strengthAtMostMg: bad } as unknown as CheckedItem,
      ];
      expect(() => run(items)).toThrow(/items\[1\]\.strengthAtMostMg/);
    }
  });
});
