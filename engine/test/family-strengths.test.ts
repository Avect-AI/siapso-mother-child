// SPDX-License-Identifier: MIT
// A daily maximum with the strength on the box unknown (live test round 2,
// SCRUM-52): the strengths the item may have are those of the products of its
// family taken by the same route. The lowest gives the amount that is certain,
// the highest the amount that is possible. A certain excess is the rule's own
// finding; a possible one is held at before the next dose with the
// max-dose-may-exceed message, since it depends on the box.
import { describe, expect, it } from 'vitest';
import { BUILTIN_MESSAGES, evaluate, PackError, parsePack } from '../src/index.js';
import type {
  CheckedItem,
  Evaluation,
  EvaluationContext,
  Pack,
  Product,
  Rule,
} from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const MAX_RULE = 'fixture-max-dose-paracetamol';
const TOXIC_RULE = 'fixture-max-dose-paracetamol-toxic';
const MAY_EXCEED = 'max-dose-may-exceed';
const NOT_COMPUTABLE = 'max-dose-not-computable';

function product(id: string, strengthMg: number | undefined, route = 'oral'): Product {
  return {
    id,
    names: { fr: `${id} (fr)`, en: `${id} (en)` },
    brands: ['Fixture brand'],
    localNames: [],
    components: [
      strengthMg === undefined
        ? { substance: 'paracetamol' }
        : { substance: 'paracetamol', strengthMg },
    ],
    form: 'tablet',
    route,
    demo: true,
    family: 'brand:fixture',
  };
}

/**
 * The fixture pack (a 4000 mg daily maximum) with a family of 200, 500 and
 * 1000 mg tablets, a 2000 mg suppository of the same family, a member without
 * a strength, and a danger rule from 8000 mg a day.
 */
function familyPack(change: (pack: Pack) => void = () => undefined): Pack {
  const base = fixturePack();
  base.products.push(
    product('family-200', 200),
    product('family-500', 500),
    product('family-1000', 1000),
    product('family-unknown', undefined),
    product('family-suppository-2000', 2000, 'rectal'),
  );
  const max = base.rules.find((r) => r.id === MAX_RULE);
  if (max === undefined) throw new Error('No fixture rule');
  const toxic: Rule = {
    ...max,
    id: TOXIC_RULE,
    when: { subject: { substance: 'paracetamol' }, fromMgPerDay: 8000 },
    level: 'danger',
    dangerRationale: 'Fixture rationale: a toxic daily amount.',
    message: TOXIC_RULE,
  };
  base.rules.push(toxic);
  for (const lang of ['fr', 'en'] as const) {
    base.messages[lang][TOXIC_RULE] = { fact: 'Fixture.', risk: 'Fixture.' };
    base.messages[lang][MAY_EXCEED] = { fact: 'Fixture.', risk: 'Fixture.' };
  }
  change(base);
  return base;
}

function run(items: CheckedItem[], pack: Pack = familyPack()): Evaluation {
  const context: EvaluationContext = { conditions: [], items, signs: [] };
  return evaluate(deepFreeze(pack), deepFreeze(context));
}

function unknown(id: string, unitsPerDay: number): CheckedItem {
  return { ref: { kind: 'product', id }, unitsPerDay, strengthUnknown: true };
}

function doseFindings(result: Evaluation) {
  return result.findings
    .filter((f) => f.check === 'C7')
    .map((f) => ({ rule: f.ruleId, level: f.level, message: f.message, items: f.items }));
}

describe('a daily maximum with the strength unknown', () => {
  it('has a builtin message for an excess that depends on the box', () => {
    expect(BUILTIN_MESSAGES.maxDoseMayExceed).toBe(MAY_EXCEED);
  });

  it('gives the rule finding when even the lowest oral strength of the family exceeds it', () => {
    // 21 x 200 mg = 4200 mg is certain whatever the box; 21 x 1000 mg is only
    // possible: the danger rule is said as possible, held at before the next dose.
    const result = run([unknown('family-1000', 21)]);
    expect(doseFindings(result)).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAX_RULE, items: [0] },
      { rule: TOXIC_RULE, level: 'before-next-dose', message: MAY_EXCEED, items: [0] },
    ]);
    expect(result.notes).toEqual([]);
  });

  it('gives the may-exceed finding, held at before the next dose, when only the highest exceeds it', () => {
    // 5 x 200 mg = 1000 mg certain, 5 x 1000 mg = 5000 mg possible.
    const result = run([unknown('family-200', 5)]);
    expect(doseFindings(result)).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAY_EXCEED, items: [0] },
    ]);
    expect(result.level).toBe('before-next-dose');
    expect(result.notes).toEqual([]);
  });

  it('holds a danger rule reached only by the possible amount at before the next dose', () => {
    // 10 x 200 = 2000 certain, 10 x 1000 = 10000 possible: above both rules.
    const result = run([unknown('family-500', 10)]);
    expect(result.level).toBe('before-next-dose');
    expect(doseFindings(result)).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAY_EXCEED, items: [0] },
      { rule: TOXIC_RULE, level: 'before-next-dose', message: MAY_EXCEED, items: [0] },
    ]);
  });

  it('gives the danger when the certain amount reaches the danger rule', () => {
    // 40 x 200 mg = 8000 mg, from 8000 included.
    const result = run([unknown('family-1000', 40)]);
    expect(result.level).toBe('danger');
    expect(doseFindings(result)).toEqual([
      { rule: TOXIC_RULE, level: 'danger', message: TOXIC_RULE, items: [0] },
      { rule: MAX_RULE, level: 'before-next-dose', message: MAX_RULE, items: [0] },
    ]);
  });

  it('leaves out a possible excess that a certain finding already says, never a held danger', () => {
    // 25 x 200 = 5000 certain (above 4000), 25 x 1000 = 25000 possible (from 8000).
    // The danger rule held at before the next dose stays: a possible overdose.
    expect(doseFindings(run([unknown('family-500', 25)]))).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAX_RULE, items: [0] },
      { rule: TOXIC_RULE, level: 'before-next-dose', message: MAY_EXCEED, items: [0] },
    ]);
    // A second rule at the same level is said by the certain card.
    const lower = familyPack((pack) => {
      const toxic = pack.rules.find((r) => r.id === TOXIC_RULE);
      if (toxic === undefined) throw new Error('No fixture rule');
      toxic.level = 'before-next-dose';
      delete toxic.dangerRationale;
    });
    expect(doseFindings(run([unknown('family-500', 25)], lower))).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAX_RULE, items: [0] },
    ]);
  });

  it('reads only the products of the same route, and leaves out those without a strength', () => {
    // The 2000 mg suppository is not an oral strength: 3 x 1000 = 3000 possible.
    expect(doseFindings(run([unknown('family-500', 3)]))).toEqual([]);
    expect(run([unknown('family-500', 3)]).notes).toEqual([]);
    // For a suppository of the family, only the suppository's strength counts: 3 x 2000 certain.
    const rectal = run([unknown('family-suppository-2000', 3)]);
    expect(doseFindings(rectal)).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAX_RULE, items: [0] },
    ]);
  });

  it('counts a known strength and a range together', () => {
    const result = run([
      { ref: { kind: 'product', id: 'paracetamol-1000' }, unitsPerDay: 3 },
      unknown('family-500', 2),
    ]);
    // 3000 + 2 x 200 = 3400 certain, 3000 + 2 x 1000 = 5000 possible.
    expect(doseFindings(result)).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAY_EXCEED, items: [0, 1] },
    ]);
  });

  it('keeps the not-computable note for a product with no family, or a family with no strength', () => {
    const lone = familyPack((pack) => {
      const generic = pack.products.find((p) => p.id === 'family-unknown');
      if (generic === undefined) throw new Error('No fixture product');
      delete generic.family;
    });
    const result = run([unknown('family-unknown', 30)], lone);
    expect(doseFindings(result)).toEqual([]);
    expect(result.notes.map((n) => [n.ruleId, n.message])).toEqual([
      [MAX_RULE, NOT_COMPUTABLE],
      [TOXIC_RULE, NOT_COMPUTABLE],
    ]);
    // A product whose own strength is missing, the strength not said unknown: no range.
    const plain = run([{ ref: { kind: 'product', id: 'family-unknown' }, unitsPerDay: 30 }]);
    expect(doseFindings(plain)).toEqual([]);
    expect(plain.notes.map((n) => n.message)).toEqual([NOT_COMPUTABLE, NOT_COMPUTABLE]);
  });

  it('gives no not-computable note for items a dose finding already lists', () => {
    const result = run([
      { ref: { kind: 'product', id: 'paracetamol-1000' }, unitsPerDay: 5 },
      { ref: { kind: 'product', id: 'family-unknown' }, unitsPerDay: 2 },
    ]);
    // 5000 mg is above 4000, not 8000: the danger rule did not trigger, but its
    // note would say the maximum may not be exceeded, beside a card that says it is.
    expect(doseFindings(result)).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAX_RULE, items: [0, 1] },
    ]);
    expect(result.notes).toEqual([]);
  });
});

describe('fromMgPerDay', () => {
  it('triggers at the amount itself, unlike maxMgPerDay', () => {
    const at = run([{ ref: { kind: 'product', id: 'paracetamol-1000' }, unitsPerDay: 8 }]);
    expect(doseFindings(at).map((f) => f.rule)).toContain(TOXIC_RULE);
    const below = run([{ ref: { kind: 'product', id: 'paracetamol-1000' }, unitsPerDay: 7 }]);
    expect(doseFindings(below).map((f) => f.rule)).not.toContain(TOXIC_RULE);
    // maxMgPerDay stays strict: 4000 mg exactly is not above 4000.
    const max = run([{ ref: { kind: 'product', id: 'paracetamol-1000' }, unitsPerDay: 4 }]);
    expect(doseFindings(max)).toEqual([]);
  });

  it('is refused outside a max-dose rule, with maxMgPerDay, or below or at 0', () => {
    const variants: [string, (rule: Rule) => void][] = [
      [
        'another kind',
        (rule) => {
          rule.kind = 'pregnancy';
        },
      ],
      [
        'both thresholds',
        (rule) => {
          rule.when.maxMgPerDay = 4000;
        },
      ],
      [
        'zero',
        (rule) => {
          rule.when.fromMgPerDay = 0;
        },
      ],
    ];
    for (const [name, change] of variants) {
      const pack = familyPack((p) => {
        const rule = p.rules.find((r) => r.id === TOXIC_RULE);
        if (rule === undefined) throw new Error('No fixture rule');
        change(rule);
        if (rule.kind !== 'max-dose') {
          delete rule.dangerRationale;
          rule.level = 'next-contact';
        }
      });
      expect(() => parsePack(pack), name).toThrow(PackError);
    }
    // A max-dose rule needs one of the two.
    const neither = familyPack((p) => {
      const rule = p.rules.find((r) => r.id === TOXIC_RULE);
      if (rule === undefined) throw new Error('No fixture rule');
      delete rule.when.fromMgPerDay;
    });
    expect(() => parsePack(neither)).toThrow(/maxMgPerDay or fromMgPerDay/);
  });
});

describe('Product.family', () => {
  it('is optional, and a string when given', () => {
    expect(() => parsePack(familyPack())).not.toThrow();
    const bad = familyPack((p) => {
      (p.products[0] as unknown as Record<string, unknown>).family = 3;
    });
    expect(() => parsePack(bad)).toThrow(/family/);
  });

  it('needs the may-exceed builtin message in both languages', () => {
    for (const lang of ['fr', 'en'] as const) {
      const pack = familyPack();
      Reflect.deleteProperty(pack.messages[lang], MAY_EXCEED);
      expect(() => parsePack(pack), lang).toThrow(/max-dose-may-exceed/);
    }
  });
});

describe('a possible toxic amount (fix round 1 of SCRUM-52)', () => {
  const POSSIBLE = 'fixture-toxic-possible';
  const withPossible = () =>
    familyPack((pack) => {
      const toxic = pack.rules.find((r) => r.id === TOXIC_RULE);
      if (toxic === undefined) throw new Error('No fixture rule');
      toxic.possibleMessage = POSSIBLE;
      for (const lang of ['fr', 'en'] as const) {
        pack.messages[lang][POSSIBLE] = { fact: 'Fixture.', risk: 'Fixture.' };
      }
    });

  it('says the message of its rule, held at before the next dose', () => {
    // 10 x 200 = 2000 certain, 10 x 1000 = 10000 possible.
    expect(doseFindings(run([unknown('family-500', 10)], withPossible()))).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAY_EXCEED, items: [0] },
      { rule: TOXIC_RULE, level: 'before-next-dose', message: POSSIBLE, items: [0] },
    ]);
  });

  it('is never left out behind a certain daily maximum', () => {
    // 25 x 200 = 5000 certain (above 4000), 25 x 1000 = 25000 possible (from 8000).
    expect(doseFindings(run([unknown('family-500', 25)], withPossible()))).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAX_RULE, items: [0] },
      { rule: TOXIC_RULE, level: 'before-next-dose', message: POSSIBLE, items: [0] },
    ]);
  });

  it('is refused on a rule that is not max-dose, and must exist in both languages', () => {
    const notMax = withPossible();
    const nsaid = notMax.rules.find((r) => r.id === 'fixture-pregnancy-nsaid-20-plus');
    if (nsaid === undefined) throw new Error('No fixture rule');
    nsaid.possibleMessage = POSSIBLE;
    expect(() => parsePack(notMax)).toThrow(/possibleMessage: is only allowed for a max-dose rule/);
    const missing = withPossible();
    Reflect.deleteProperty(missing.messages.en, POSSIBLE);
    expect(() => parsePack(missing)).toThrow(/message "fixture-toxic-possible" is missing/);
    expect(() => parsePack(withPossible())).not.toThrow();
  });
});

describe('the adult strengths of a substance (fix round 1 of SCRUM-52)', () => {
  const adult = (min: number) =>
    familyPack((pack) => {
      const paracetamol = pack.substances.find((s) => s.id === 'paracetamol');
      if (paracetamol === undefined) throw new Error('No fixture substance');
      paracetamol.adultMinStrengthMg = min;
    });

  it('leaves the children strengths of a family out of the certain amount', () => {
    // Without it: 10 x 200 = 2000 certain. With 400: 10 x 500 = 5000 certain, above 4000.
    expect(doseFindings(run([unknown('family-1000', 10)]))[0]?.message).toBe(MAY_EXCEED);
    expect(doseFindings(run([unknown('family-1000', 10)], adult(400)))).toEqual([
      { rule: MAX_RULE, level: 'before-next-dose', message: MAX_RULE, items: [0] },
      { rule: TOXIC_RULE, level: 'before-next-dose', message: MAY_EXCEED, items: [0] },
    ]);
  });

  it('keeps every strength when the family has no adult one', () => {
    // Every oral strength of the family below 2500: the family is read as it is.
    const result = run([unknown('family-1000', 10)], adult(2500));
    expect(doseFindings(result)[0]?.message).toBe(MAY_EXCEED);
  });

  it('is refused when it is not a number above 0', () => {
    const bad = adult(0);
    expect(() => parsePack(bad)).toThrow(/adultMinStrengthMg/);
  });
});
