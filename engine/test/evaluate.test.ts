// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { evaluate, rangeFromMonths, UNKNOWN_TERM } from '../src/index.js';
import type {
  CheckedItem,
  ConditionId,
  Evaluation,
  EvaluationContext,
  Finding,
  Pack,
  PregnancyContext,
  Rule,
  SourceRef,
} from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const pack = deepFreeze(fixturePack());

function run(context: Partial<EvaluationContext>, usePack: Pack = pack): Evaluation {
  return evaluate(usePack, deepFreeze({ conditions: [], items: [], signs: [], ...context }));
}

function product(id: string, extra: Omit<CheckedItem, 'ref'> = {}): CheckedItem {
  return { ref: { kind: 'product', id }, ...extra };
}

function plant(id: string): CheckedItem {
  return { ref: { kind: 'plant', id } };
}

function unrecognised(text: string): CheckedItem {
  return { ref: { kind: 'unrecognised', text } };
}

function exact(weeks: number): PregnancyContext {
  return { weeksMin: weeks, weeksMax: weeks, precision: 'exact' };
}

function ruleSources(ruleId: string): SourceRef[] {
  const rule = pack.rules.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`No fixture rule ${ruleId}`);
  return rule.sources.map((s) => ({ ...s }));
}

function plantSources(plantId: string): SourceRef[] {
  const found = pack.plants.find((p) => p.id === plantId);
  if (!found) throw new Error(`No fixture plant ${plantId}`);
  return found.sources.map((s) => ({ ...s }));
}

function withRule(evaluation: Evaluation, ruleId: string): Finding[] {
  return evaluation.findings.filter((f) => f.ruleId === ruleId);
}

function checks(evaluation: Evaluation): string[] {
  return evaluation.findings.map((f) => f.check);
}

const NSAID_RULE = 'fixture-pregnancy-nsaid-20-plus';
const CODEINE_RULE = 'fixture-breastfeeding-codeine';
const PREMATURE_RULE = 'fixture-breastfeeding-quinine-premature';
const INTERACTION_RULE = 'fixture-interaction-quinine-antimalarial';
const HERB_RULE = 'fixture-herb-drug-moringa-sp';
const CLAY_RULE = 'fixture-toxicity-clay';
const CASTOR_RULE = 'fixture-toxicity-castor-oil-term-scar';
const DUPLICATE_RULE = 'fixture-duplicate-paracetamol';
const MAX_DOSE_RULE = 'fixture-max-dose-paracetamol';
const CONDITION_RULE = 'fixture-condition-sp-cotrimoxazole';
const CONTRACEPTION_RULE = 'fixture-contraception-info-artesunate';
const REMINDER_RULE = 'fixture-reminder-iptp';

function nothingFound(index: number): Finding {
  return {
    level: 'unknown',
    check: 'no-finding',
    items: [index],
    message: 'nothing-found',
    capped: false,
    sources: [],
  };
}

describe('C1 pregnancy', () => {
  it('gives before-next-dose for an NSAID at 30 weeks', () => {
    const result = run({ pregnancy: exact(30), items: [product('ibuprofen-400')] });
    expect(result.level).toBe('before-next-dose');
    expect(result.findings).toStrictEqual([
      {
        level: 'before-next-dose',
        check: 'C1',
        ruleId: NSAID_RULE,
        evidence: 'A',
        items: [0],
        message: NSAID_RULE,
        capped: false,
        sources: ruleSources(NSAID_RULE),
      },
    ]);
  });

  it('does not trigger the 20-plus rule for an NSAID at 10 weeks', () => {
    const result = run({ pregnancy: exact(10), items: [product('ibuprofen-400')] });
    expect(withRule(result, NSAID_RULE)).toEqual([]);
    expect(result.findings).toStrictEqual([nothingFound(0)]);
    expect(result.level).toBe('unknown');
  });

  it('triggers the rule for an unknown term and flags the term as unknown', () => {
    const result = run({
      pregnancy: { ...UNKNOWN_TERM, precision: 'unknown' },
      items: [product('ibuprofen-400')],
    });
    expect(withRule(result, NSAID_RULE)).toMatchObject([
      { check: 'C1', level: 'before-next-dose', term: 'unknown', items: [0] },
    ]);
  });

  it('flags an estimated term when a month range reaches the window', () => {
    const result = run({
      pregnancy: { ...rangeFromMonths(5), precision: 'estimated' },
      items: [product('ibuprofen-400')],
    });
    expect(withRule(result, NSAID_RULE)).toMatchObject([{ check: 'C1', term: 'estimated' }]);
  });

  it('does not apply a pregnancy rule without a pregnancy', () => {
    const result = run({ items: [product('ibuprofen-400')] });
    expect(result.findings).toStrictEqual([nothingFound(0)]);
  });
});

describe('C2 breastfeeding', () => {
  it('applies within the baby age bound', () => {
    for (const babyAgeWeeks of [0, 4, 26]) {
      const result = run({ breastfeeding: { babyAgeWeeks }, items: [product('codeine-syrup')] });
      expect(result.findings).toStrictEqual([
        {
          level: 'before-next-dose',
          check: 'C2',
          ruleId: CODEINE_RULE,
          evidence: 'B',
          items: [0],
          message: CODEINE_RULE,
          capped: false,
          sources: ruleSources(CODEINE_RULE),
        },
      ]);
    }
  });

  it('applies when the baby age is unknown', () => {
    const result = run({ breastfeeding: {}, items: [product('codeine-syrup')] });
    expect(checks(result)).toEqual(['C2']);
  });

  it('does not apply above the age bound or without breastfeeding', () => {
    expect(
      run({ breastfeeding: { babyAgeWeeks: 27 }, items: [product('codeine-syrup')] }).findings,
    ).toStrictEqual([nothingFound(0)]);
    expect(run({ items: [product('codeine-syrup')] }).findings).toStrictEqual([nothingFound(0)]);
  });

  it('applies a prematurity rule when the baby is premature or prematurity is unknown', () => {
    for (const breastfeeding of [{ premature: true }, {}]) {
      const result = run({ breastfeeding, items: [product('quinine-300')] });
      expect(withRule(result, PREMATURE_RULE)).toMatchObject([
        { check: 'C2', level: 'next-contact', items: [0] },
      ]);
    }
  });

  it('does not apply a prematurity rule to a baby born at term', () => {
    const result = run({ breastfeeding: { premature: false }, items: [product('quinine-300')] });
    expect(result.findings).toStrictEqual([nothingFound(0)]);
  });
});

describe('C3 interaction', () => {
  it('flags two distinct items that interact', () => {
    const result = run({ items: [product('quinine-300'), product('asaq')] });
    expect(result.findings).toStrictEqual([
      {
        level: 'before-next-dose',
        check: 'C3',
        ruleId: INTERACTION_RULE,
        evidence: 'B',
        items: [0, 1],
        message: INTERACTION_RULE,
        capped: false,
        sources: ruleSources(INTERACTION_RULE),
      },
    ]);
    expect(
      withRule(run({ items: [product('asaq'), product('quinine-300')] }), INTERACTION_RULE),
    ).toMatchObject([{ items: [0, 1] }]);
  });

  it('does not let one item interact with itself', () => {
    const result = run({ items: [product('quinine-300')] });
    expect(result.findings).toStrictEqual([nothingFound(0)]);
  });

  it('does not let the same product entered twice interact with itself', () => {
    const result = run({ items: [product('quinine-300'), product('quinine-300')] });
    expect(withRule(result, INTERACTION_RULE)).toEqual([]);
    expect(result.findings).toStrictEqual([nothingFound(0), nothingFound(1)]);
  });

  it('lists every item involved in the interaction', () => {
    const result = run({
      items: [
        product('quinine-300'),
        product('paracetamol-500'),
        product('asaq'),
        product('quinine-300'),
      ],
    });
    expect(withRule(result, INTERACTION_RULE)).toMatchObject([{ items: [0, 2, 3] }]);
  });
});

describe('C4 herb-drug', () => {
  it('caps a D-evidence herb-drug rule at next-contact', () => {
    const result = run({ items: [plant('moringa'), product('sp')] });
    expect(result.findings).toStrictEqual([
      {
        level: 'next-contact',
        check: 'C4',
        ruleId: HERB_RULE,
        evidence: 'D',
        items: [0, 1],
        message: HERB_RULE,
        capped: true,
        sources: ruleSources(HERB_RULE),
      },
    ]);
    expect(result.level).toBe('next-contact');
  });

  it('needs the drug as a distinct item', () => {
    const result = run({ items: [plant('moringa')] });
    expect(withRule(result, HERB_RULE)).toEqual([]);
  });
});

describe('C5 toxicity', () => {
  it('does not cap a D-evidence toxicity rule', () => {
    const result = run({ items: [plant('clay')] });
    expect(result.findings).toStrictEqual([
      {
        level: 'before-next-dose',
        check: 'C5',
        ruleId: CLAY_RULE,
        evidence: 'D',
        items: [0],
        message: CLAY_RULE,
        capped: false,
        sources: ruleSources(CLAY_RULE),
      },
    ]);
  });

  it('gives danger for castor oil at term with a uterine scar', () => {
    const result = run({
      pregnancy: exact(38),
      conditions: ['uterine-scar'],
      items: [plant('castor-oil')],
    });
    expect(result.level).toBe('danger');
    expect(withRule(result, CASTOR_RULE)).toMatchObject([
      { check: 'C5', level: 'danger', evidence: 'C', capped: false, items: [0] },
    ]);
  });

  it('needs both the condition and the window', () => {
    expect(
      withRule(run({ pregnancy: exact(38), items: [plant('castor-oil')] }), CASTOR_RULE),
    ).toEqual([]);
    expect(
      withRule(
        run({ pregnancy: exact(25), conditions: ['uterine-scar'], items: [plant('castor-oil')] }),
        CASTOR_RULE,
      ),
    ).toEqual([]);
  });
});

describe('C6 duplicate', () => {
  it('lists both paracetamol products', () => {
    const result = run({ items: [product('paracetamol-1000'), product('paracetamol-500')] });
    expect(result.findings).toStrictEqual([
      {
        level: 'before-next-dose',
        check: 'C6',
        ruleId: DUPLICATE_RULE,
        evidence: 'A',
        items: [0, 1],
        message: DUPLICATE_RULE,
        capped: false,
        sources: ruleSources(DUPLICATE_RULE),
      },
    ]);
  });

  it('counts the same product entered twice as a duplicate', () => {
    const result = run({ items: [product('paracetamol-500'), product('paracetamol-500')] });
    expect(withRule(result, DUPLICATE_RULE)).toMatchObject([{ items: [0, 1] }]);
  });

  it('lists only the matching items', () => {
    const result = run({
      items: [product('paracetamol-500'), plant('kinkeliba'), product('paracetamol-1000')],
    });
    expect(withRule(result, DUPLICATE_RULE)).toMatchObject([{ items: [0, 2] }]);
  });

  it('needs at least two items', () => {
    expect(run({ items: [product('paracetamol-500')] }).findings).toStrictEqual([nothingFound(0)]);
  });
});

describe('C7 max-dose', () => {
  it('triggers when the daily sum exceeds the threshold', () => {
    const result = run({
      items: [
        product('paracetamol-1000', { unitsPerDay: 4 }),
        product('paracetamol-500', { unitsPerDay: 3 }),
      ],
    });
    expect(withRule(result, MAX_DOSE_RULE)).toStrictEqual([
      {
        level: 'before-next-dose',
        check: 'C7',
        ruleId: MAX_DOSE_RULE,
        evidence: 'A',
        items: [0, 1],
        message: MAX_DOSE_RULE,
        capped: false,
        sources: ruleSources(MAX_DOSE_RULE),
      },
    ]);
  });

  it('triggers on the known sum when another item lacks a unit count, listing every item', () => {
    // 6 x 1000 mg = 6000 mg known, plus a 500 mg item without a unit count.
    const result = run({
      items: [product('paracetamol-1000', { unitsPerDay: 6 }), product('paracetamol-500')],
    });
    expect(withRule(result, MAX_DOSE_RULE)).toStrictEqual([
      {
        level: 'before-next-dose',
        check: 'C7',
        ruleId: MAX_DOSE_RULE,
        evidence: 'A',
        items: [0, 1],
        message: MAX_DOSE_RULE,
        capped: false,
        sources: ruleSources(MAX_DOSE_RULE),
      },
    ]);
  });

  it('is skipped when the known sum stays at or below the threshold', () => {
    for (const unitsPerDay of [3, 4]) {
      const result = run({
        items: [product('paracetamol-1000', { unitsPerDay }), product('paracetamol-500')],
      });
      expect(withRule(result, MAX_DOSE_RULE), String(unitsPerDay)).toEqual([]);
    }
  });

  it('counts the known strengths when a strength is missing', () => {
    const base = fixturePack();
    const noStrength: Pack = deepFreeze({
      ...base,
      products: base.products.map((p) =>
        p.id === 'paracetamol-500' ? { ...p, components: [{ substance: 'paracetamol' }] } : p,
      ),
    });
    const items = (units: number): CheckedItem[] => [
      product('paracetamol-500', { unitsPerDay: 3 }),
      product('paracetamol-1000', { unitsPerDay: units }),
    ];
    expect(withRule(run({ items: items(4) }, noStrength), MAX_DOSE_RULE)).toEqual([]);
    expect(withRule(run({ items: items(5) }, noStrength), MAX_DOSE_RULE)).toMatchObject([
      { check: 'C7', items: [0, 1] },
    ]);
  });

  it('does not trigger at the threshold itself, and does for a single item above it', () => {
    expect(
      withRule(run({ items: [product('paracetamol-1000', { unitsPerDay: 4 })] }), MAX_DOSE_RULE),
    ).toEqual([]);
    expect(
      withRule(run({ items: [product('paracetamol-500', { unitsPerDay: 9 })] }), MAX_DOSE_RULE),
    ).toMatchObject([{ check: 'C7', items: [0] }]);
  });

  it('ignores the unit count of items without the substance', () => {
    const result = run({
      items: [product('paracetamol-500', { unitsPerDay: 9 }), product('ibuprofen-400')],
    });
    expect(withRule(result, MAX_DOSE_RULE)).toMatchObject([{ items: [0] }]);
  });
});

describe('C8 condition', () => {
  it('triggers for SP with HIV on cotrimoxazole', () => {
    const result = run({ conditions: ['hiv-cotrimoxazole'], items: [product('sp')] });
    expect(result.findings).toStrictEqual([
      {
        level: 'before-next-dose',
        check: 'C8',
        ruleId: CONDITION_RULE,
        evidence: 'B',
        items: [0],
        message: CONDITION_RULE,
        capped: false,
        sources: ruleSources(CONDITION_RULE),
      },
    ]);
  });

  it('triggers the same rule once for SP with a long-term cotrimoxazole item', () => {
    const result = run({ items: [product('sp'), product('cotrimoxazole', { longTerm: true })] });
    expect(withRule(result, CONDITION_RULE)).toMatchObject([{ check: 'C8', items: [0, 1] }]);
    expect(result.findings).toHaveLength(1);
  });

  it('triggers once when both the condition and the item are present', () => {
    const result = run({
      conditions: ['hiv-cotrimoxazole'],
      items: [product('cotrimoxazole', { longTerm: true }), product('sp')],
    });
    expect(withRule(result, CONDITION_RULE)).toMatchObject([{ items: [0, 1] }]);
  });

  it('needs the subject and one of the requirements', () => {
    expect(run({ items: [product('sp')] }).findings).toStrictEqual([nothingFound(0)]);
    expect(
      run({ conditions: ['hiv-cotrimoxazole'], items: [product('cotrimoxazole')] }).findings,
    ).toStrictEqual([nothingFound(0)]);
  });
});

describe('C9 contraception-info', () => {
  it('produces a note, never a finding', () => {
    const result = run({ items: [product('asaq')] });
    expect(result.notes).toStrictEqual([
      {
        ruleId: CONTRACEPTION_RULE,
        message: CONTRACEPTION_RULE,
        sources: ruleSources(CONTRACEPTION_RULE),
      },
    ]);
    expect(checks(result)).not.toContain('C9');
    expect(result.findings).toStrictEqual([nothingFound(0)]);
    expect(result.reminders).toEqual([]);
  });
});

describe('C10 reminder', () => {
  it('produces a reminder during pregnancy, never a finding', () => {
    const result = run({ pregnancy: exact(25) });
    expect(result.reminders).toStrictEqual([
      { ruleId: REMINDER_RULE, message: REMINDER_RULE, sources: ruleSources(REMINDER_RULE) },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.level).toBe('unknown');
  });

  it('is absent for a woman living with HIV on cotrimoxazole', () => {
    const conditions: ConditionId[] = ['hiv-cotrimoxazole'];
    expect(run({ pregnancy: exact(25), conditions }).reminders).toEqual([]);
  });

  it('is absent outside its windows and without a pregnancy', () => {
    expect(run({ pregnancy: exact(8) }).reminders).toEqual([]);
    expect(run({ breastfeeding: {} }).reminders).toEqual([]);
  });
});

describe('C11 danger signs', () => {
  it('puts a fever danger finding first', () => {
    const result = run({ signs: ['fever'], items: [product('paracetamol-500'), plant('clay')] });
    expect(result.level).toBe('danger');
    expect(result.findings[0]).toStrictEqual({
      level: 'danger',
      check: 'C11',
      items: [],
      message: 'danger-sign',
      sign: 'fever',
      capped: false,
      sources: [],
    });
    expect(checks(result)).toEqual(['C11', 'C5', 'no-finding']);
  });

  it('gives one finding per sign, ordered by sign id', () => {
    const result = run({ signs: ['fever', 'bleeding', 'fever'] });
    expect(result.findings.map((f) => f.sign)).toEqual(['bleeding', 'fever']);
    expect(result.findings.every((f) => f.check === 'C11' && f.level === 'danger')).toBe(true);
  });
});

describe('C12 unrecognised items', () => {
  it('gives an unknown finding for each unrecognised item', () => {
    const result = run({ items: [unrecognised('Xyzol'), unrecognised('Abcine')] });
    expect(result.findings).toStrictEqual([
      {
        level: 'unknown',
        check: 'C12',
        items: [0],
        message: 'not-recognised',
        capped: false,
        sources: [],
      },
      {
        level: 'unknown',
        check: 'C12',
        items: [1],
        message: 'not-recognised',
        capped: false,
        sources: [],
      },
    ]);
    expect(result.level).toBe('unknown');
  });

  it('treats a product or plant id missing from the pack as unrecognised', () => {
    const result = run({ items: [product('missing-product'), plant('missing-plant')] });
    expect(result.findings).toMatchObject([
      { check: 'C12', items: [0], message: 'not-recognised' },
      { check: 'C12', items: [1], message: 'not-recognised' },
    ]);
  });

  it('keeps the unrecognised finding next to other findings', () => {
    const result = run({
      pregnancy: exact(30),
      items: [product('ibuprofen-400'), unrecognised('Xyzol')],
    });
    expect(checks(result)).toEqual(['C1', 'C12']);
    expect(result.findings[1]).toMatchObject({ level: 'unknown', items: [1] });
  });
});

describe('no-finding', () => {
  it('gives nothing-found for a known product without any finding', () => {
    expect(run({ items: [product('paracetamol-500')] }).findings).toStrictEqual([nothingFound(0)]);
  });

  it('gives the plant message and evidence for a known plant without any finding', () => {
    const result = run({ items: [plant('kinkeliba')] });
    expect(result.findings).toStrictEqual([
      {
        level: 'unknown',
        check: 'no-finding',
        evidence: '0',
        items: [0],
        message: 'fixture-plant-kinkeliba',
        capped: false,
        sources: plantSources('kinkeliba'),
      },
    ]);
  });
});

describe('evaluation', () => {
  it('returns unknown with no finding for an empty context, with the pack identity', () => {
    expect(run({})).toStrictEqual({
      level: 'unknown',
      findings: [],
      reminders: [],
      notes: [],
      pack: { version: '0.0.0-fixture', date: '2026-11-03', clinicallyValidated: false },
    });
  });

  it('sorts by level, then check, then rule or message, then first item', () => {
    const result = run({
      pregnancy: exact(30),
      signs: ['fever'],
      items: [
        product('paracetamol-1000', { unitsPerDay: 4 }),
        plant('kinkeliba'),
        product('paracetamol-500', { unitsPerDay: 3 }),
        unrecognised('Xyzol'),
        plant('clay'),
        plant('moringa'),
        product('sp'),
        product('codeine-syrup'),
      ],
    });
    expect(result.findings.map((f) => [f.level, f.check, f.ruleId ?? f.message, f.items])).toEqual([
      ['danger', 'C11', 'danger-sign', []],
      ['before-next-dose', 'C5', CLAY_RULE, [4]],
      ['before-next-dose', 'C6', DUPLICATE_RULE, [0, 2]],
      ['before-next-dose', 'C7', MAX_DOSE_RULE, [0, 2]],
      ['next-contact', 'C4', HERB_RULE, [5, 6]],
      ['unknown', 'C12', 'not-recognised', [3]],
      ['unknown', 'no-finding', 'fixture-plant-kinkeliba', [1]],
      ['unknown', 'no-finding', 'nothing-found', [7]],
    ]);
    expect(result.reminders.map((r) => r.ruleId)).toEqual([REMINDER_RULE]);
    expect(result.level).toBe('danger');
  });

  it('orders findings of the same message by first item', () => {
    const result = run({
      items: [product('sp'), product('paracetamol-500'), product('codeine-syrup')],
    });
    expect(result.findings).toStrictEqual([nothingFound(0), nothingFound(1), nothingFound(2)]);
  });

  it('returns sources that are copies, not the pack objects', () => {
    const result = run({ items: [plant('clay')] });
    const source = result.findings[0]?.sources[0];
    expect(source).toBeDefined();
    expect(Object.isFrozen(source)).toBe(false);
    expect(source).not.toBe(pack.rules.find((r) => r.id === CLAY_RULE)?.sources[0]);
  });

  it('refuses an invalid pregnancy range rather than matching no window', () => {
    expect(() =>
      run({ pregnancy: { weeksMin: 30, weeksMax: 20, precision: 'estimated' } }),
    ).toThrow(RangeError);
  });

  it('refuses a unit count that is not a finite number greater than 0, naming the item', () => {
    for (const unitsPerDay of [NaN, Infinity, -Infinity, -1, 0]) {
      const items = [product('paracetamol-500'), product('paracetamol-1000', { unitsPerDay })];
      expect(() => run({ items }), String(unitsPerDay)).toThrow(RangeError);
      expect(() => run({ items }), String(unitsPerDay)).toThrow(/items\[1\]\.unitsPerDay/);
    }
    const text = { unitsPerDay: '4' } as unknown as Omit<CheckedItem, 'ref'>;
    expect(() => run({ items: [product('paracetamol-500', text)] })).toThrow(
      /items\[0\]\.unitsPerDay/,
    );
    expect(
      withRule(run({ items: [product('paracetamol-500', { unitsPerDay: 0.5 })] }), MAX_DOSE_RULE),
    ).toEqual([]);
  });

  it('refuses a baby age that is not a finite number of at least 0', () => {
    for (const babyAgeWeeks of [NaN, -1, -0.5, Infinity]) {
      const context = { breastfeeding: { babyAgeWeeks }, items: [product('codeine-syrup')] };
      expect(() => run(context), String(babyAgeWeeks)).toThrow(RangeError);
      expect(() => run(context), String(babyAgeWeeks)).toThrow(/breastfeeding\.babyAgeWeeks/);
    }
  });
});

describe('rule matching edge cases', () => {
  function packWithRule(extra: Rule): Pack {
    const base = fixturePack();
    return deepFreeze({
      ...base,
      rules: [...base.rules, extra],
      messages: {
        fr: { ...base.messages.fr, [extra.message]: { fact: 'Fait.', risk: 'Risque.' } },
        en: { ...base.messages.en, [extra.message]: { fact: 'Fact.', risk: 'Risk.' } },
      },
    });
  }

  function extraRule(id: string, kind: Rule['kind'], when: Rule['when']): Rule {
    return {
      id,
      kind,
      when,
      level: 'next-contact',
      evidence: 'A',
      message: id,
      sources: [],
      review: { status: 'draft', reviewers: [] },
    };
  }

  it('gives a reminder without subject when its with item is present', () => {
    const custom = packWithRule(
      extraRule('fixture-extra-reminder-with', 'reminder', {
        requires: [{ with: { substance: 'codeine' } }],
      }),
    );
    expect(run({ items: [product('codeine-syrup')] }, custom).reminders).toMatchObject([
      { ruleId: 'fixture-extra-reminder-with' },
    ]);
    expect(run({ items: [product('sp')] }, custom).reminders).toEqual([]);
    // Reminders are ordered by rule id, whatever the pack order.
    expect(
      run({ pregnancy: exact(25), items: [product('codeine-syrup')] }, custom).reminders.map(
        (r) => r.ruleId,
      ),
    ).toEqual(['fixture-extra-reminder-with', REMINDER_RULE]);
  });

  it('treats an empty requirement list as no requirement', () => {
    const custom = packWithRule(
      extraRule('fixture-extra-empty-requires', 'condition', {
        subject: { substance: 'codeine' },
        requires: [],
      }),
    );
    expect(
      withRule(run({ items: [product('codeine-syrup')] }, custom), 'fixture-extra-empty-requires'),
    ).toMatchObject([{ check: 'C8', items: [0] }]);
  });

  it('does not apply a breastfeeding rule to a woman who is not breastfeeding', () => {
    const id = 'fixture-extra-breastfeeding-any-age';
    const custom = packWithRule(
      extraRule(id, 'breastfeeding', { subject: { substance: 'sulfadoxine' } }),
    );
    const items = [product('sp')];
    expect(withRule(run({ pregnancy: exact(25), items }, custom), id)).toEqual([]);
    expect(withRule(run({ items }, custom), id)).toEqual([]);
    // Without age bounds, the rule applies at any baby age, known or not.
    for (const breastfeeding of [{}, { babyAgeWeeks: 0 }, { babyAgeWeeks: 104 }]) {
      expect(withRule(run({ breastfeeding, items }, custom), id)).toMatchObject([
        { check: 'C2', items: [0] },
      ]);
    }
  });

  it('applies a pregnancy rule without windows to every pregnancy and nothing else', () => {
    const id = 'fixture-extra-pregnancy-any-window';
    const custom = packWithRule(
      extraRule(id, 'pregnancy', { subject: { substance: 'sulfadoxine' } }),
    );
    const items = [product('sp')];
    expect(withRule(run({ breastfeeding: {}, items }, custom), id)).toEqual([]);
    expect(withRule(run({ breastfeeding: { babyAgeWeeks: 4 }, items }, custom), id)).toEqual([]);
    expect(withRule(run({ items }, custom), id)).toEqual([]);
    const pregnancies: PregnancyContext[] = [
      exact(8),
      exact(15),
      exact(25),
      exact(34),
      { ...UNKNOWN_TERM, precision: 'unknown' },
    ];
    for (const pregnancy of pregnancies) {
      expect(withRule(run({ pregnancy, items }, custom), id)).toStrictEqual([
        {
          level: 'next-contact',
          check: 'C1',
          ruleId: id,
          evidence: 'A',
          items: [0],
          message: id,
          capped: false,
          sources: [],
        },
      ]);
    }
  });

  it('never applies a rule that needs a subject but has none', () => {
    const custom = packWithRule(extraRule('fixture-extra-no-subject', 'pregnancy', {}));
    expect(run({ pregnancy: exact(30), items: [product('sp')] }, custom).findings).toStrictEqual([
      nothingFound(0),
    ]);
  });

  it('applies a class max-dose rule over every matching component', () => {
    const custom = packWithRule(
      extraRule('fixture-extra-max-dose-antimalarial', 'max-dose', {
        subject: { class: 'antimalarial' },
        maxMgPerDay: 700,
      }),
    );
    const id = 'fixture-extra-max-dose-antimalarial';
    // asaq: (100 + 270) x 2 = 740 mg of antimalarials per day.
    expect(
      withRule(run({ items: [product('asaq', { unitsPerDay: 2 })] }, custom), id),
    ).toMatchObject([{ check: 'C7', items: [0] }]);
    expect(withRule(run({ items: [product('asaq', { unitsPerDay: 1 })] }, custom), id)).toEqual([]);
  });
});
