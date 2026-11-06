// SPDX-License-Identifier: MIT
import type { CheckedItem } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import { contextFromProfile, OutdatedTermError } from './context.js';
import type { Profile } from './types.js';

const TODAY = '2026-11-04';
const NO_CHECK = { items: [], signs: [] };

function profile(patch: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    pseudonym: 'Awa',
    pregnant: false,
    breastfeeding: false,
    conditions: [],
    longTermItems: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...patch,
  };
}

const doliprane: CheckedItem = { ref: { kind: 'product', id: 'doliprane-500' } };
const kinkeliba: CheckedItem = { ref: { kind: 'plant', id: 'kinkeliba' } };
const unknownName: CheckedItem = { ref: { kind: 'unrecognised', text: 'tisane du marché' } };

describe('contextFromProfile: pregnancy', () => {
  it('has no pregnancy when the profile is not pregnant, whatever term is stored', () => {
    const context = contextFromProfile(
      profile({ pregnant: false, term: { kind: 'weeks', weeks: 26 } }),
      NO_CHECK,
      TODAY,
    );
    expect(context).not.toHaveProperty('pregnancy');
  });

  it('gives the exact term from the last menstrual period', () => {
    const context = contextFromProfile(
      profile({ pregnant: true, term: { kind: 'lmp', date: '2026-05-06' } }),
      NO_CHECK,
      TODAY,
    );
    expect(context.pregnancy).toEqual({ weeksMin: 26, weeksMax: 26, precision: 'exact' });
  });

  it('gives the exact term from weeks, moved on since the day they were given', () => {
    expect(
      contextFromProfile(
        profile({ pregnant: true, term: { kind: 'weeks', weeks: 26, givenOn: TODAY } }),
        NO_CHECK,
        TODAY,
      ).pregnancy,
    ).toEqual({ weeksMin: 26, weeksMax: 26, precision: 'exact' });
    expect(
      contextFromProfile(
        profile({ pregnant: true, term: { kind: 'weeks', weeks: 18, givenOn: '2026-08-09' } }),
        NO_CHECK,
        TODAY,
      ).pregnancy,
    ).toEqual({ weeksMin: 30, weeksMax: 31, precision: 'exact' });
  });

  it('gives the estimated range from months', () => {
    const context = contextFromProfile(
      profile({ pregnant: true, term: { kind: 'months', months: 5, givenOn: TODAY } }),
      NO_CHECK,
      TODAY,
    );
    expect(context.pregnancy).toEqual({ weeksMin: 19, weeksMax: 28, precision: 'estimated' });
  });

  it('gives the whole unknown range when the term is unknown or missing', () => {
    const unknown = { weeksMin: 0, weeksMax: 42, precision: 'unknown' };
    expect(
      contextFromProfile(profile({ pregnant: true, term: { kind: 'unknown' } }), NO_CHECK, TODAY)
        .pregnancy,
    ).toEqual(unknown);
    expect(contextFromProfile(profile({ pregnant: true }), NO_CHECK, TODAY).pregnancy).toEqual(
      unknown,
    );
  });

  it('refuses an outdated profile: no result is worked out on a term that no longer holds', () => {
    // A last period more than 42 weeks ago, weeks out of range, a corrupted month,
    // 42 weeks given 28 days ago, month 9 given 70 days ago.
    for (const term of [
      { kind: 'lmp', date: '2025-11-01' },
      { kind: 'weeks', weeks: 50 },
      { kind: 'weeks', weeks: Number.NaN },
      { kind: 'months', months: 12 },
      { kind: 'weeks', weeks: 42, givenOn: '2026-10-07' },
      { kind: 'months', months: 9, givenOn: '2026-08-26' },
    ] as const) {
      expect(
        () => contextFromProfile(profile({ pregnant: true, term }), NO_CHECK, TODAY),
        JSON.stringify(term),
      ).toThrow(OutdatedTermError);
    }
  });

  it('reads a possibly past term as the term held at 42 weeks, and breastfeeding as possible', () => {
    const at42 = contextFromProfile(
      profile({ pregnant: true, term: { kind: 'weeks', weeks: 42, givenOn: TODAY } }),
      NO_CHECK,
      TODAY,
    );
    expect(at42.pregnancy).toEqual({ weeksMin: 42, weeksMax: 42, precision: 'exact' });
    // No age, no prematurity: every breastfeeding rule applies.
    expect(at42.breastfeeding).toEqual({});
    // Month 9 given 8 days ago; a known older baby does not narrow it.
    const month9 = contextFromProfile(
      profile({
        pregnant: true,
        term: { kind: 'months', months: 9, givenOn: '2026-10-27' },
        breastfeeding: true,
        babyAgeWeeks: 60,
        babyAgeGivenOn: TODAY,
        premature: false,
      }),
      NO_CHECK,
      TODAY,
    );
    expect(month9.pregnancy).toEqual({ weeksMin: 37, weeksMax: 42, precision: 'estimated' });
    expect(month9.breastfeeding).toEqual({});
  });

  it('reads any term as unknown when today is before a day the app has already seen', () => {
    expect(
      contextFromProfile(
        profile({ pregnant: true, term: { kind: 'lmp', date: '2026-05-06' } }),
        NO_CHECK,
        TODAY,
        '2026-11-20',
      ).pregnancy,
    ).toEqual({ weeksMin: 0, weeksMax: 42, precision: 'unknown' });
  });

  it('reads a term given after today (a phone clock set back) as unknown: every window', () => {
    expect(
      contextFromProfile(
        profile({ pregnant: true, term: { kind: 'weeks', weeks: 30, givenOn: '2026-12-01' } }),
        NO_CHECK,
        TODAY,
      ).pregnancy,
    ).toEqual({ weeksMin: 0, weeksMax: 42, precision: 'unknown' });
  });

  it('reads breastfeeding as possible too when the phone clock is set back: the baby may be born', () => {
    // Before a day the app has already seen: the real date is later.
    const seen = contextFromProfile(
      profile({ pregnant: true, term: { kind: 'lmp', date: '2026-05-06' } }),
      NO_CHECK,
      TODAY,
      '2026-11-20',
    );
    expect(seen.breastfeeding).toEqual({});
    // Before the day the term was given; a known older baby does not narrow it.
    const given = contextFromProfile(
      profile({
        pregnant: true,
        term: { kind: 'weeks', weeks: 30, givenOn: '2026-12-01' },
        breastfeeding: true,
        babyAgeWeeks: 60,
        babyAgeGivenOn: '2026-11-01',
        premature: false,
      }),
      NO_CHECK,
      TODAY,
    );
    expect(given.breastfeeding).toEqual({});
  });

  it('reads "Je ne sais pas" to the pregnancy as a pregnancy of unknown term', () => {
    expect(
      contextFromProfile(
        profile({
          pregnant: true,
          pregnancyUnsure: true,
          term: { kind: 'weeks', weeks: 8, givenOn: TODAY },
        }),
        NO_CHECK,
        TODAY,
      ).pregnancy,
    ).toEqual({ weeksMin: 0, weeksMax: 42, precision: 'unknown' });
  });
});

describe('contextFromProfile: breastfeeding', () => {
  it('has no breastfeeding when the profile does not breastfeed, whatever baby is stored', () => {
    const context = contextFromProfile(
      profile({ breastfeeding: false, babyAgeWeeks: 3, premature: true }),
      NO_CHECK,
      TODAY,
    );
    expect(context).not.toHaveProperty('breastfeeding');
  });

  it('computes the baby age in whole weeks from the birth date', () => {
    const context = contextFromProfile(
      profile({ breastfeeding: true, babyBirthDate: '2026-10-01', premature: false }),
      NO_CHECK,
      TODAY,
    );
    // 34 days: 4 whole weeks.
    expect(context.breastfeeding).toEqual({ babyAgeWeeks: 4, premature: false });
  });

  it('prefers the birth date to a stored age', () => {
    const context = contextFromProfile(
      profile({ breastfeeding: true, babyBirthDate: '2026-10-01', babyAgeWeeks: 20 }),
      NO_CHECK,
      TODAY,
    );
    expect(context.breastfeeding?.babyAgeWeeks).toBe(4);
  });

  it('uses the stored age in weeks when there is no birth date', () => {
    const context = contextFromProfile(
      profile({ breastfeeding: true, babyAgeWeeks: 6, premature: true }),
      NO_CHECK,
      TODAY,
    );
    expect(context.breastfeeding).toEqual({ babyAgeWeeks: 6, premature: true });
  });

  it('moves a stored age on with the whole weeks since it was given', () => {
    const age = (babyAgeGivenOn: string) =>
      contextFromProfile(
        profile({ breastfeeding: true, babyAgeWeeks: 6, babyAgeGivenOn }),
        NO_CHECK,
        TODAY,
      ).breastfeeding?.babyAgeWeeks;
    // Four weeks ago: 10 weeks today.
    expect(age('2026-10-07')).toBe(10);
    // A day that cannot be read, or after today (clock moved back): the age as given,
    // the younger age, which keeps every age-bounded rule.
    expect(age('not a date')).toBe(6);
    expect(age('2026-12-01')).toBe(6);
  });

  it('omits prematurity when it is unknown (null) or was never answered', () => {
    expect(
      contextFromProfile(
        profile({ breastfeeding: true, babyAgeWeeks: 6, premature: null }),
        NO_CHECK,
        TODAY,
      ).breastfeeding,
    ).toEqual({ babyAgeWeeks: 6 });
    expect(
      contextFromProfile(profile({ breastfeeding: true, babyAgeWeeks: 6 }), NO_CHECK, TODAY)
        .breastfeeding,
    ).toEqual({ babyAgeWeeks: 6 });
  });

  it('omits an age it cannot trust (unknown age keeps every age-bounded rule) instead of passing it on', () => {
    for (const patch of [
      { babyBirthDate: '2026-11-20' },
      { babyBirthDate: 'not a date' },
      { babyAgeWeeks: -1 },
      { babyAgeWeeks: Number.NaN },
      { babyAgeWeeks: Number.POSITIVE_INFINITY },
      {},
    ]) {
      expect(
        contextFromProfile(profile({ breastfeeding: true, ...patch }), NO_CHECK, TODAY)
          .breastfeeding,
        JSON.stringify(patch),
      ).toEqual({});
    }
  });

  it('passes no age for "Je ne sais pas", whatever age is stored: every age-bounded rule applies', () => {
    expect(
      contextFromProfile(
        profile({ breastfeeding: true, babyAgeUnknown: true, babyAgeWeeks: 30, premature: false }),
        NO_CHECK,
        TODAY,
      ).breastfeeding,
    ).toEqual({ premature: false });
  });

  it('falls back to a valid stored age when the birth date cannot be read', () => {
    expect(
      contextFromProfile(
        profile({ breastfeeding: true, babyBirthDate: 'not a date', babyAgeWeeks: 8 }),
        NO_CHECK,
        TODAY,
      ).breastfeeding,
    ).toEqual({ babyAgeWeeks: 8 });
  });

  it('can be pregnant and breastfeeding at once', () => {
    const context = contextFromProfile(
      profile({
        pregnant: true,
        term: { kind: 'unknown' },
        breastfeeding: true,
        babyAgeWeeks: 40,
      }),
      NO_CHECK,
      TODAY,
    );
    expect(context.pregnancy?.precision).toBe('unknown');
    expect(context.breastfeeding).toEqual({ babyAgeWeeks: 40 });
  });
});

describe('contextFromProfile: conditions, items and signs', () => {
  it('passes the conditions on, each once', () => {
    const context = contextFromProfile(
      profile({ conditions: ['hiv-cotrimoxazole', 'uterine-scar', 'hiv-cotrimoxazole'] }),
      NO_CHECK,
      TODAY,
    );
    expect(context.conditions).toEqual(['hiv-cotrimoxazole', 'uterine-scar']);
  });

  it('passes the danger signs of the check through, and copies them', () => {
    const signs = ['fever', 'bleeding'];
    const context = contextFromProfile(profile(), { items: [], signs }, TODAY);
    expect(context.signs).toEqual(['fever', 'bleeding']);
    expect(context.signs).not.toBe(signs);
  });

  it('puts the checked items first, in order, then the long-term items flagged longTerm', () => {
    const checked: CheckedItem[] = [{ ...doliprane, unitsPerDay: 2 }, unknownName];
    const context = contextFromProfile(
      profile({ longTermItems: [kinkeliba] }),
      { items: checked, signs: [] },
      TODAY,
    );
    expect(context.items).toEqual([
      { ref: { kind: 'product', id: 'doliprane-500' }, unitsPerDay: 2 },
      unknownName,
      { ref: { kind: 'plant', id: 'kinkeliba' }, longTerm: true },
    ]);
  });

  it('adds a long-term item only once, and not when the check already holds it', () => {
    const context = contextFromProfile(
      profile({ longTermItems: [kinkeliba, doliprane, kinkeliba] }),
      { items: [doliprane], signs: [] },
      TODAY,
    );
    expect(context.items).toEqual([
      { ref: { kind: 'product', id: 'doliprane-500' }, longTerm: true },
      { ref: { kind: 'plant', id: 'kinkeliba' }, longTerm: true },
    ]);
  });

  it('keeps the dose range of a product both checked and long-term only when both give one, the larger', () => {
    const aspirin: CheckedItem = { ref: { kind: 'product', id: 'aspirin-generic' } };
    const both = contextFromProfile(
      profile({ longTermItems: [{ ...aspirin, strengthAtMostMg: 100 }] }),
      { items: [{ ...aspirin, strengthAtMostMg: 75 }], signs: [] },
      TODAY,
    );
    expect(both.items).toEqual([{ ...aspirin, strengthAtMostMg: 100, longTerm: true }]);

    // One of them says no range ("Plus de 100 mg", or none asked): the safer reading, none.
    const one = contextFromProfile(
      profile({ longTermItems: [aspirin] }),
      { items: [{ ...aspirin, strengthAtMostMg: 100 }], signs: [] },
      TODAY,
    );
    expect(one.items).toEqual([{ ...aspirin, longTerm: true }]);
  });

  it('keeps the larger units per day of a product both checked and long-term (safer for a maximum dose)', () => {
    const largerLongTerm = contextFromProfile(
      profile({ longTermItems: [{ ...doliprane, unitsPerDay: 3 }] }),
      { items: [{ ...doliprane, unitsPerDay: 2 }], signs: [] },
      TODAY,
    );
    expect(largerLongTerm.items).toEqual([
      { ref: { kind: 'product', id: 'doliprane-500' }, unitsPerDay: 3, longTerm: true },
    ]);

    const largerChecked = contextFromProfile(
      profile({ longTermItems: [{ ...doliprane, unitsPerDay: 1 }] }),
      { items: [{ ...doliprane, unitsPerDay: 4 }], signs: [] },
      TODAY,
    );
    expect(largerChecked.items).toEqual([
      { ref: { kind: 'product', id: 'doliprane-500' }, unitsPerDay: 4, longTerm: true },
    ]);

    const withoutUnits = contextFromProfile(
      profile({ longTermItems: [{ ...doliprane, unitsPerDay: 3 }] }),
      { items: [doliprane], signs: [] },
      TODAY,
    );
    expect(withoutUnits.items).toEqual([
      { ref: { kind: 'product', id: 'doliprane-500' }, unitsPerDay: 3, longTerm: true },
    ]);
  });

  it('never matches a product with a plant of the same id, and keeps every unrecognised name', () => {
    const context = contextFromProfile(
      profile({
        longTermItems: [{ ref: { kind: 'plant', id: 'doliprane-500' } }, unknownName],
      }),
      { items: [doliprane, unknownName], signs: [] },
      TODAY,
    );
    expect(context.items).toHaveLength(4);
  });

  it('does not change the profile or the check it reads', () => {
    const stored = profile({ longTermItems: [kinkeliba], conditions: ['sickle-cell'] });
    const check = { items: [doliprane], signs: ['fever'] };
    const before = JSON.stringify({ stored, check });

    contextFromProfile(stored, check, TODAY);

    expect(JSON.stringify({ stored, check })).toBe(before);
  });

  it('throws a RangeError for a unit count the engine would refuse, naming the item', () => {
    for (const unitsPerDay of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        contextFromProfile(profile(), { items: [{ ...doliprane, unitsPerDay }], signs: [] }, TODAY),
      ).toThrow(/doliprane-500/);
    }
    expect(() =>
      contextFromProfile(
        profile({ longTermItems: [{ ...kinkeliba, unitsPerDay: 0 }] }),
        NO_CHECK,
        TODAY,
      ),
    ).toThrow(RangeError);
  });
});
