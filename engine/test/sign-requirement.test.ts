// SPDX-License-Identifier: MIT
// A rule may require a danger sign present now (live test round 2, SCRUM-52):
// codeine while breastfeeding with the baby very sleepy is the very effect
// the codeine card warns about, so that card becomes a danger of its own.
import { describe, expect, it } from 'vitest';
import { evaluate, PackError, parsePack } from '../src/index.js';
import type { CheckedItem, Evaluation, Pack, Rule } from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const SIGN_RULE = 'fixture-breastfeeding-codeine-sign';

function signPack(change: (rule: Rule) => void = () => undefined): Pack {
  const base = fixturePack();
  const rule: Rule = {
    id: SIGN_RULE,
    kind: 'breastfeeding',
    when: {
      subject: { substance: 'codeine' },
      requires: [{ sign: 'bleeding' }, { sign: 'fever' }],
    },
    level: 'danger',
    evidence: 'C',
    dangerRationale: 'Fixture rationale: the sign is the effect of the product.',
    message: SIGN_RULE,
    sources: [],
    review: { status: 'draft', reviewers: [] },
  };
  change(rule);
  base.rules.push(rule);
  for (const lang of ['fr', 'en'] as const) {
    base.messages[lang][SIGN_RULE] = { fact: 'Fixture.', risk: 'Fixture.' };
  }
  return base;
}

const codeine: CheckedItem = { ref: { kind: 'product', id: 'codeine-syrup' } };

function run(signs: string[], pack: Pack = signPack()): Evaluation {
  return evaluate(
    deepFreeze(pack),
    deepFreeze({ breastfeeding: { babyAgeWeeks: 4 }, conditions: [], items: [codeine], signs }),
  );
}

describe('a sign requirement', () => {
  it('applies the rule only when one of the signs is present now', () => {
    expect(run([]).findings.map((f) => f.ruleId)).not.toContain(SIGN_RULE);
    const result = run(['fever']);
    expect(result.findings.filter((f) => f.ruleId === SIGN_RULE)).toMatchObject([
      { level: 'danger', check: 'C2', items: [0] },
    ]);
    expect(result.findings.filter((f) => f.ruleId === SIGN_RULE)[0]?.sign).toBeUndefined();
  });

  it('still needs the subject', () => {
    const result = evaluate(
      deepFreeze(signPack()),
      deepFreeze({ breastfeeding: {}, conditions: [], items: [], signs: ['fever'] }),
    );
    expect(result.findings.map((f) => f.ruleId)).not.toContain(SIGN_RULE);
  });

  it('is checked against the danger signs of the pack', () => {
    expect(() => parsePack(signPack())).not.toThrow();
    const unknown = signPack((rule) => {
      rule.when.requires = [{ sign: 'no-such-sign' }];
    });
    expect(() => parsePack(unknown)).toThrow(PackError);
    expect(() => parsePack(unknown)).toThrow(/unknown danger sign "no-such-sign"/);
    const empty = signPack((rule) => {
      rule.when.requires = [{ sign: '' }];
    });
    expect(() => parsePack(empty)).toThrow(PackError);
    const two = signPack((rule) => {
      rule.when.requires = [{ sign: 'fever', condition: 'renal-failure' } as never];
    });
    expect(() => parsePack(two)).toThrow(/exactly one of with, condition or sign/);
  });
});
