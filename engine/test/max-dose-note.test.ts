// SPDX-License-Identifier: MIT
// The max-dose-not-computable note: a unit count is given for an item holding
// a substance with a max-dose rule, but the item's strength is unknown, so the
// daily total cannot be computed. C7 is a level check: this is a note, never a
// level.
import { describe, expect, it } from 'vitest';
import { BUILTIN_MESSAGES, evaluate, PackError, parsePack } from '../src/index.js';
import type {
  CheckedItem,
  Evaluation,
  EvaluationContext,
  Pack,
  Rule,
  SourceRef,
} from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const MAX_DOSE_RULE = 'fixture-max-dose-paracetamol';
const CONTRACEPTION_RULE = 'fixture-contraception-info-artesunate';
const NOTE_MESSAGE = 'max-dose-not-computable';

/** The fixture pack with a paracetamol product of unknown strength. */
function packWithGeneric(change: (pack: Pack) => void = () => undefined): Pack {
  const base = fixturePack();
  const generic = base.products.find((p) => p.id === 'paracetamol-500');
  if (!generic) throw new Error('No fixture product');
  base.products.push({
    ...generic,
    id: 'paracetamol-generic',
    components: [{ substance: 'paracetamol' }],
  });
  change(base);
  return base;
}

function run(context: Partial<EvaluationContext>, pack: Pack = packWithGeneric()): Evaluation {
  return evaluate(
    deepFreeze(pack),
    deepFreeze({ conditions: [], items: [], signs: [], ...context }),
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

function sourcesOf(id: string): SourceRef[] {
  return rule(fixturePack(), id).sources.map((s) => ({ ...s }));
}

const note = {
  kind: 'dose',
  ruleId: MAX_DOSE_RULE,
  message: NOTE_MESSAGE,
  sources: sourcesOf(MAX_DOSE_RULE),
};

describe('the max-dose-not-computable note', () => {
  it('is a builtin message', () => {
    expect(BUILTIN_MESSAGES.maxDoseNotComputable).toBe(NOTE_MESSAGE);
  });

  it('is given for a unit count on an item of unknown strength, without changing the level', () => {
    const result = run({ items: [product('paracetamol-generic', { unitsPerDay: 8 })] });
    expect(result.notes).toStrictEqual([note]);
    expect(result.findings.map((f) => f.check)).toEqual(['no-finding']);
    expect(result.level).toBe('unknown');
  });

  it('is not given without a unit count, or when every strength is known', () => {
    expect(run({ items: [product('paracetamol-generic')] }).notes).toEqual([]);
    expect(
      run({
        items: [product('paracetamol-500', { unitsPerDay: 2 }), product('paracetamol-generic')],
      }).notes,
    ).toEqual([]);
    expect(run({ items: [product('paracetamol-1000', { unitsPerDay: 2 })] }).notes).toEqual([]);
  });

  it('is not given for a substance without a max-dose rule', () => {
    // codeine-syrup has no strength, but no max-dose rule covers codeine.
    expect(run({ items: [product('codeine-syrup', { unitsPerDay: 3 })] }).notes).toEqual([]);
  });

  it('has a kind: dose for the max-dose note, contraception for the C9 note', () => {
    const result = run({
      items: [product('paracetamol-generic', { unitsPerDay: 2 }), product('asaq')],
    });
    expect(result.notes.map((n) => [n.ruleId, n.kind])).toEqual([
      [CONTRACEPTION_RULE, 'contraception'],
      [MAX_DOSE_RULE, 'dose'],
    ]);
  });

  it('is not given when the same rule already triggered C7 (the finding is enough)', () => {
    const result = run({
      items: [
        product('paracetamol-1000', { unitsPerDay: 5 }),
        product('paracetamol-generic', { unitsPerDay: 2 }),
      ],
    });
    expect(result.findings.filter((f) => f.check === 'C7')).toMatchObject([
      { ruleId: MAX_DOSE_RULE, items: [0, 1] },
    ]);
    expect(result.notes).toEqual([]);
  });

  it('is still given for another substance whose rule did not trigger C7', () => {
    const pack = packWithGeneric((p) => {
      p.rules.push({
        ...rule(p, MAX_DOSE_RULE),
        id: 'fixture-extra-max-dose-quinine',
        when: { subject: { substance: 'quinine' }, maxMgPerDay: 1000 },
      });
      const quinine = p.products.find((x) => x.id === 'quinine-300');
      if (!quinine) throw new Error('No fixture product');
      p.products.push({
        ...quinine,
        id: 'quinine-generic',
        components: [{ substance: 'quinine' }],
      });
    });
    const result = run(
      {
        items: [
          product('paracetamol-1000', { unitsPerDay: 5 }),
          product('quinine-generic', { unitsPerDay: 3 }),
        ],
      },
      pack,
    );
    expect(result.findings.filter((f) => f.check === 'C7').map((f) => f.ruleId)).toEqual([
      MAX_DOSE_RULE,
    ]);
    expect(result.notes.map((n) => n.ruleId)).toEqual(['fixture-extra-max-dose-quinine']);
  });

  it('follows the conditions of the rule: not given when the rule cannot apply', () => {
    const items = [product('paracetamol-generic', { unitsPerDay: 8 })];
    const unless = packWithGeneric((p) => {
      rule(p, MAX_DOSE_RULE).when.unlessConditions = ['renal-failure'];
    });
    expect(run({ items }, unless).notes).toStrictEqual([note]);
    expect(run({ items, conditions: ['renal-failure'] }, unless).notes).toEqual([]);

    const windows = packWithGeneric((p) => {
      rule(p, MAX_DOSE_RULE).when.pregnancyWindows = ['30-plus'];
    });
    expect(run({ items }, windows).notes).toEqual([]);
    const pregnancy = { weeksMin: 32, weeksMax: 32, precision: 'exact' as const };
    expect(run({ items, pregnancy }, windows).notes).toMatchObject([{ ruleId: MAX_DOSE_RULE }]);

    const requires = packWithGeneric((p) => {
      rule(p, MAX_DOSE_RULE).when.requires = [{ condition: 'hepatic-failure' }];
    });
    expect(run({ items }, requires).notes).toEqual([]);
    expect(run({ items, conditions: ['hepatic-failure'] }, requires).notes).toHaveLength(1);
  });

  it('is given once per rule, sorted with the other notes by rule id', () => {
    const result = run({
      items: [
        product('paracetamol-generic', { unitsPerDay: 2 }),
        product('paracetamol-generic', { unitsPerDay: 3 }),
        product('asaq'),
      ],
    });
    expect(result.notes.map((n) => [n.ruleId, n.message])).toEqual([
      [CONTRACEPTION_RULE, CONTRACEPTION_RULE],
      [MAX_DOSE_RULE, NOTE_MESSAGE],
    ]);
  });

  it('covers a class max-dose rule and a component of unknown strength in a combination', () => {
    const pack = packWithGeneric((p) => {
      p.rules.push({
        ...rule(p, MAX_DOSE_RULE),
        id: 'fixture-extra-max-dose-antimalarial',
        when: { subject: { class: 'antimalarial' }, maxMgPerDay: 700 },
      });
      const asaq = p.products.find((x) => x.id === 'asaq');
      if (!asaq) throw new Error('No fixture product');
      asaq.components = [
        { substance: 'artesunate', strengthMg: 100 },
        { substance: 'amodiaquine' },
      ];
    });
    const result = run({ items: [product('asaq', { unitsPerDay: 2 })] }, pack);
    expect(result.notes.map((n) => [n.ruleId, n.message])).toEqual([
      [CONTRACEPTION_RULE, CONTRACEPTION_RULE],
      ['fixture-extra-max-dose-antimalarial', NOTE_MESSAGE],
    ]);
  });

  it('needs the builtin message in both languages', () => {
    for (const lang of ['fr', 'en'] as const) {
      const pack = fixturePack();
      Reflect.deleteProperty(pack.messages[lang], NOTE_MESSAGE);
      expect(() => parsePack(pack), lang).toThrow(PackError);
      expect(() => parsePack(pack), lang).toThrow(/max-dose-not-computable/);
    }
  });
});
