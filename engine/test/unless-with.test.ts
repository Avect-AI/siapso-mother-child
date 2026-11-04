// SPDX-License-Identifier: MIT
// when.unlessWith: a rule does not apply when an item matches one of its subjects.
import { describe, expect, it } from 'vitest';
import { evaluate, PackError, parsePack, RULE_WHEN_KEYS } from '../src/index.js';
import type { CheckedItem, Evaluation, EvaluationContext, Pack, Rule } from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const REMINDER_RULE = 'fixture-reminder-iptp';
const NSAID_RULE = 'fixture-pregnancy-nsaid-20-plus';
const PREGNANT = { weeksMin: 25, weeksMax: 25, precision: 'exact' as const };

function run(context: Partial<EvaluationContext>, pack: Pack = fixturePack()): Evaluation {
  return evaluate(
    deepFreeze(pack),
    deepFreeze({ pregnancy: PREGNANT, conditions: [], items: [], signs: [], ...context }),
  );
}

function product(id: string, extra: Omit<CheckedItem, 'ref'> = {}): CheckedItem {
  return { ref: { kind: 'product', id }, ...extra };
}

function rule(pack: Pack, id: string): Rule {
  const found = pack.rules.find((r) => r.id === id);
  if (!found) throw new Error(`No fixture rule ${id}`);
  return found;
}

function errorOf(json: unknown): PackError {
  try {
    parsePack(json);
  } catch (error) {
    if (error instanceof PackError) return error;
    throw error;
  }
  throw new Error('parsePack did not throw');
}

function set(target: object, key: string, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

describe('when.unlessWith in evaluate', () => {
  it('drops the IPTp reminder when an item holds sulfamethoxazole, without a condition', () => {
    expect(run({}).reminders.map((r) => r.ruleId)).toEqual([REMINDER_RULE]);
    const result = run({ items: [product('cotrimoxazole', { longTerm: true })] });
    expect(result.reminders).toEqual([]);
    expect(result.level).toBe('unknown');
  });

  it('keeps the reminder for items that do not match, unrecognised ones included', () => {
    const items: CheckedItem[] = [
      product('sp'),
      { ref: { kind: 'unrecognised', text: 'cotrimoxazole du marché' } },
      { ref: { kind: 'product', id: 'not-in-the-pack' } },
    ];
    expect(run({ items }).reminders.map((r) => r.ruleId)).toEqual([REMINDER_RULE]);
  });

  it('drops a finding when an item matches a class or a plant listed in unlessWith', () => {
    const byClass = fixturePack();
    rule(byClass, NSAID_RULE).when.unlessWith = [{ class: 'antimalarial' }];
    const items = [product('ibuprofen-400')];
    expect(run({ items }, byClass).findings.map((f) => f.ruleId)).toEqual([NSAID_RULE]);
    expect(
      run({ items: [...items, product('quinine-300')] }, byClass).findings.map((f) => f.ruleId),
    ).not.toContain(NSAID_RULE);

    const byPlant = fixturePack();
    rule(byPlant, NSAID_RULE).when.unlessWith = [{ substance: 'codeine' }, { plant: 'clay' }];
    const withClay = run({ items: [...items, { ref: { kind: 'plant', id: 'clay' } }] }, byPlant);
    expect(withClay.findings.map((f) => f.ruleId)).not.toContain(NSAID_RULE);
  });

  it('applies to the subject item itself: an item matching unlessWith cancels the rule', () => {
    const pack = fixturePack();
    rule(pack, NSAID_RULE).when.unlessWith = [{ substance: 'ibuprofen' }];
    expect(run({ items: [product('ibuprofen-400')] }, pack).findings).toMatchObject([
      { check: 'no-finding', items: [0] },
    ]);
  });
});

describe('when.unlessWith in parsePack', () => {
  it('is one of the rule condition keys', () => {
    expect(RULE_WHEN_KEYS).toContain('unlessWith');
  });

  it('accepts a list of subjects', () => {
    expect(() => parsePack(fixturePack())).not.toThrow();
    expect(rule(fixturePack(), REMINDER_RULE).when.unlessWith).toEqual([
      { substance: 'sulfamethoxazole' },
    ]);
  });

  it('refuses an empty list, a non-list, a malformed subject or an unknown reference', () => {
    const changes: [unknown, RegExp][] = [
      [[], /unlessWith.*must not be empty/],
      [{ substance: 'sulfamethoxazole' }, /unlessWith.*must be an array/],
      [[{ substance: 'sulfamethoxazole', class: 'nsaid' }], /unlessWith\[0\].*exactly one/],
      [[{ substances: 'sulfamethoxazole' }], /unlessWith\[0\].*unknown key "substances"/],
      [[{ substance: '' }], /unlessWith\[0\]\.substance/],
      [[{ substance: 'nope' }], /unknown substance "nope"/],
      [[{ class: 'nope' }], /unknown class "nope"/],
      [[{ plant: 'nope' }], /unknown plant "nope"/],
    ];
    for (const [value, pattern] of changes) {
      const pack = fixturePack();
      set(rule(pack, REMINDER_RULE).when, 'unlessWith', value);
      const message = errorOf(pack).message;
      expect(message, JSON.stringify(value)).toMatch(/fixture-reminder-iptp/);
      expect(message, JSON.stringify(value)).toMatch(pattern);
    }
  });
});
