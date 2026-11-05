// SPDX-License-Identifier: MIT
// The term look-ahead: a course of treatment goes on over the coming days, so
// the windows a finding is looked up in reach TERM_LOOKAHEAD_DAYS past the
// upper end of the term. Reminders and notes keep the term as it is today.
import { describe, expect, it } from 'vitest';
import { evaluate, TERM_LOOKAHEAD_DAYS, WINDOWS, windowsCovered } from '../src/index.js';
import type {
  CheckedItem,
  ConditionId,
  Evaluation,
  EvaluationContext,
  PregnancyContext,
} from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const pack = deepFreeze(fixturePack());

const NSAID_RULE = 'fixture-pregnancy-nsaid-20-plus';
const CASTOR_RULE = 'fixture-toxicity-castor-oil-term-scar';
const REMINDER_RULE = 'fixture-reminder-iptp';

function run(context: Partial<EvaluationContext>): Evaluation {
  return evaluate(pack, deepFreeze({ conditions: [], items: [], signs: [], ...context }));
}

function exact(weeks: number): PregnancyContext {
  return { weeksMin: weeks, weeksMax: weeks, precision: 'exact' };
}

const ibuprofen: CheckedItem = { ref: { kind: 'product', id: 'ibuprofen-400' } };
const castorOil: CheckedItem = { ref: { kind: 'plant', id: 'castor-oil' } };
const scar: ConditionId[] = ['uterine-scar'];

function ruleIds(result: Evaluation): string[] {
  return result.findings.flatMap((f) => (f.ruleId === undefined ? [] : [f.ruleId]));
}

describe('TERM_LOOKAHEAD_DAYS', () => {
  it('is 14 days: two whole weeks, so whole-week terms stay whole weeks', () => {
    expect(TERM_LOOKAHEAD_DAYS).toBe(14);
    expect(TERM_LOOKAHEAD_DAYS % 7).toBe(0);
  });
});

describe('the look-ahead on findings', () => {
  it('flags an NSAID at 18 weeks with the rule from 20 weeks (20 is reached within 14 days)', () => {
    const result = run({ pregnancy: exact(18), items: [ibuprofen] });
    expect(ruleIds(result)).toEqual([NSAID_RULE]);
    expect(result.level).toBe('before-next-dose');
  });

  it('does not reach a window more than 14 days away', () => {
    const result = run({ pregnancy: exact(17), items: [ibuprofen] });
    expect(ruleIds(result)).toEqual([]);
    expect(result.level).toBe('unknown');
  });

  it('gives danger for castor oil with a uterine scar at 28 and 29 weeks, not at 27', () => {
    for (const weeks of [28, 29]) {
      const result = run({ pregnancy: exact(weeks), conditions: scar, items: [castorOil] });
      expect(result.level, `${String(weeks)} weeks`).toBe('danger');
      expect(ruleIds(result), `${String(weeks)} weeks`).toEqual([CASTOR_RULE]);
    }
    const before = run({ pregnancy: exact(27), conditions: scar, items: [castorOil] });
    expect(ruleIds(before)).not.toContain(CASTOR_RULE);
  });

  it('extends a range at its upper end only, keeping its precision flag', () => {
    const result = run({
      pregnancy: { weeksMin: 14, weeksMax: 18, precision: 'estimated' },
      items: [ibuprofen],
    });
    expect(result.findings).toMatchObject([
      { ruleId: NSAID_RULE, level: 'before-next-dose', term: 'estimated' },
    ]);
  });

  it('never removes a window that applies today, for any whole-week term', () => {
    for (let min = 0; min <= 42; min += 1) {
      for (let max = min; max <= 42; max += 1) {
        const today = windowsCovered(min, max);
        const ahead = windowsCovered(min, max + TERM_LOOKAHEAD_DAYS / 7);
        for (const window of today)
          expect(ahead, `${String(min)}-${String(max)}`).toContain(window);
      }
    }
    // Every window can be reached: none is skipped by the look-ahead.
    expect(windowsCovered(0, 42 + TERM_LOOKAHEAD_DAYS / 7)).toEqual(WINDOWS.map((w) => w.id));
  });

  it('never lowers a level: every rule triggered at a term is triggered with the look-ahead', () => {
    const items = [ibuprofen, castorOil];
    for (let weeks = 0; weeks <= 42; weeks += 1) {
      const result = run({ pregnancy: exact(weeks), conditions: scar, items });
      const today = windowsCovered(weeks, weeks);
      for (const rule of pack.rules) {
        const windows = rule.when.pregnancyWindows;
        if (rule.kind === 'reminder' || windows === undefined) continue;
        if (!windows.some((w) => today.includes(w))) continue;
        if (rule.id !== NSAID_RULE && rule.id !== CASTOR_RULE) continue;
        expect(ruleIds(result), `${rule.id} at ${String(weeks)} weeks`).toContain(rule.id);
      }
    }
  });
});

describe('reminders keep the term as it is today', () => {
  it('gives no IPTp reminder at 11 weeks, though the look-ahead reaches 12', () => {
    expect(run({ pregnancy: exact(11) }).reminders).toEqual([]);
    expect(run({ pregnancy: exact(10) }).reminders).toEqual([]);
  });

  it('gives it from 12 weeks', () => {
    expect(run({ pregnancy: exact(12) }).reminders.map((r) => r.ruleId)).toEqual([REMINDER_RULE]);
  });
});
