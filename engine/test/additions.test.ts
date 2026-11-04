// SPDX-License-Identifier: MIT
// strengthAboveMg and DangerSign.message: evaluation and pack validation.
import { describe, expect, it } from 'vitest';
import { evaluate, PackError, parsePack } from '../src/index.js';
import type { CheckedItem, Evaluation, Pack, Product, Rule } from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

function run(pack: Pack, items: CheckedItem[], signs: string[] = []): Evaluation {
  return evaluate(
    deepFreeze(pack),
    deepFreeze({
      pregnancy: { weeksMin: 30, weeksMax: 30, precision: 'exact' as const },
      conditions: [],
      items,
      signs,
    }),
  );
}

function product(id: string): CheckedItem {
  return { ref: { kind: 'product', id } };
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

const STRENGTH_RULE = 'fixture-extra-strength';

/** A fixture pack with a pregnancy rule on paracetamol above `strengthAboveMg`. */
function strengthPack(strengthAboveMg: number): Pack {
  const base = fixturePack();
  const extra: Rule = {
    id: STRENGTH_RULE,
    kind: 'pregnancy',
    when: { subject: { substance: 'paracetamol' }, strengthAboveMg },
    level: 'next-contact',
    evidence: 'A',
    message: STRENGTH_RULE,
    sources: [],
    review: { status: 'draft', reviewers: [] },
  };
  const unknownStrength: Product = {
    id: 'paracetamol-unknown',
    names: { fr: 'x', en: 'x' },
    brands: [],
    localNames: [],
    components: [{ substance: 'paracetamol' }],
    form: 'tablet',
    route: 'oral',
    demo: true,
  };
  return {
    ...base,
    rules: [...base.rules, extra],
    products: [...base.products, unknownStrength],
    messages: {
      fr: { ...base.messages.fr, [STRENGTH_RULE]: { fact: 'Fait.', risk: 'Risque.' } },
      en: { ...base.messages.en, [STRENGTH_RULE]: { fact: 'Fact.', risk: 'Risk.' } },
    },
  };
}

function strengthFindings(pack: Pack, items: CheckedItem[]): Evaluation['findings'] {
  return run(pack, items).findings.filter((f) => f.ruleId === STRENGTH_RULE);
}

describe('strengthAboveMg evaluation', () => {
  it('applies only to a component stronger than the value', () => {
    const items = [product('paracetamol-1000'), product('paracetamol-500')];
    expect(strengthFindings(strengthPack(500), items)).toMatchObject([{ check: 'C1', items: [0] }]);
  });

  it('does not apply at exactly the value', () => {
    expect(strengthFindings(strengthPack(500), [product('paracetamol-500')])).toEqual([]);
  });

  it('applies when the strength is unknown, to stay cautious', () => {
    expect(strengthFindings(strengthPack(500), [product('paracetamol-unknown')])).toMatchObject([
      { items: [0] },
    ]);
  });

  it('ignores the strength of components of other substances', () => {
    // sp holds sulfadoxine 500 and pyrimethamine 25, no paracetamol.
    expect(strengthFindings(strengthPack(1), [product('sp')])).toEqual([]);
  });
});

function signPack(message: string | undefined): Pack {
  const base = fixturePack();
  const fever = base.dangerSigns[0];
  if (!fever) throw new Error('No fixture sign');
  return {
    ...base,
    dangerSigns: [
      message === undefined ? fever : { ...fever, message },
      ...base.dangerSigns.slice(1),
    ],
    messages: {
      fr: { ...base.messages.fr, 'fever-message': { fact: 'Fait.', risk: 'Risque.' } },
      en: { ...base.messages.en, 'fever-message': { fact: 'Fact.', risk: 'Risk.' } },
    },
  };
}

describe('danger sign message evaluation', () => {
  it('uses the message of the sign when it has one', () => {
    const result = run(signPack('fever-message'), [], ['fever', 'bleeding']);
    expect(result.findings.map((f) => [f.sign, f.message])).toEqual([
      ['bleeding', 'danger-sign'],
      ['fever', 'fever-message'],
    ]);
  });

  it('uses the standard message for a sign without one or an unknown sign', () => {
    const result = run(signPack(undefined), [], ['fever', 'unknown-sign']);
    expect(result.findings.map((f) => f.message)).toEqual(['danger-sign', 'danger-sign']);
  });
});

function nsaidRule(pack: Pack): Rule {
  const found = pack.rules.find((r) => r.id === 'fixture-pregnancy-nsaid-20-plus');
  if (!found) throw new Error('No fixture rule');
  return found;
}

describe('parsePack: strengthAboveMg and danger sign message', () => {
  it('accepts a strength threshold on a substance subject', () => {
    const pack = fixturePack();
    nsaidRule(pack).when.subject = { substance: 'ibuprofen' };
    nsaidRule(pack).when.strengthAboveMg = 200;
    expect(() => parsePack(pack)).not.toThrow();
  });

  it('refuses a strength threshold that is not a positive finite number', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5']) {
      const pack = fixturePack();
      nsaidRule(pack).when.subject = { substance: 'ibuprofen' };
      set(nsaidRule(pack).when, 'strengthAboveMg', value);
      expect(errorOf(pack).message, String(value)).toMatch(/strengthAboveMg/);
    }
  });

  it('refuses a strength threshold without a substance subject', () => {
    for (const subject of [{ class: 'nsaid' }, { plant: 'moringa' }]) {
      const pack = fixturePack();
      nsaidRule(pack).when.subject = subject;
      nsaidRule(pack).when.strengthAboveMg = 100;
      const message = errorOf(pack).message;
      expect(message).toMatch(/fixture-pregnancy-nsaid-20-plus/);
      expect(message).toMatch(/strengthAboveMg/);
    }
    const reminder = fixturePack();
    const rule = reminder.rules.find((r) => r.id === 'fixture-reminder-iptp');
    if (!rule) throw new Error('No fixture rule');
    rule.when.strengthAboveMg = 100;
    expect(errorOf(reminder).message).toMatch(/strengthAboveMg/);
  });

  it('refuses a strength threshold on max-dose and duplicate rules, naming the rule', () => {
    for (const id of ['fixture-max-dose-paracetamol', 'fixture-duplicate-paracetamol']) {
      const pack = fixturePack();
      const rule = pack.rules.find((r) => r.id === id);
      if (!rule) throw new Error('No fixture rule');
      rule.when.strengthAboveMg = 100;
      const message = errorOf(pack).message;
      expect(message, id).toMatch(new RegExp(id));
      expect(message, id).toMatch(/strengthAboveMg/);
    }
  });

  it('accepts a danger sign message that exists in both languages', () => {
    expect(() => parsePack(signPack('fever-message'))).not.toThrow();
  });

  it('refuses a danger sign message missing in a language, or not a string', () => {
    const missing = errorOf(signPack('nope'));
    expect(missing.message).toMatch(/dangerSigns "fever"/);
    expect(missing.message).toMatch(/nope/);

    const onlyFr = signPack('fever-message');
    Reflect.deleteProperty(onlyFr.messages.en, 'fever-message');
    expect(errorOf(onlyFr).message).toMatch(/messages\.en/);

    const wrongType = fixturePack();
    const sign = wrongType.dangerSigns[0];
    if (!sign) throw new Error('No fixture sign');
    set(sign, 'message', 3);
    expect(errorOf(wrongType).message).toMatch(/dangerSigns "fever".*message/);
  });
});
