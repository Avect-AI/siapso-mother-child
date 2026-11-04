// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/translate.js';
import { termDisplay } from './term.js';
import type { TermInput } from './types.js';

const TODAY = '2026-11-04';

/** The words shown for a term, in French. */
function words(term: TermInput, today = TODAY): string {
  const { label } = termDisplay(term, today);
  return translate('fr', label.key, label.vars);
}

describe('termDisplay: last menstrual period', () => {
  it('gives the exact whole weeks since the date', () => {
    expect(termDisplay({ kind: 'lmp', date: '2026-05-06' }, TODAY)).toEqual({
      weeksMin: 26,
      weeksMax: 26,
      precision: 'exact',
      label: { key: 'profile.term.exact', vars: { weeks: 26 } },
    });
    expect(words({ kind: 'lmp', date: '2026-05-06' })).toBe('Environ 26 semaines');
    // One day short of 26 weeks is still 25.
    expect(termDisplay({ kind: 'lmp', date: '2026-05-07' }, TODAY).weeksMin).toBe(25);
  });

  it('says less than a week, then one week, in the singular', () => {
    expect(words({ kind: 'lmp', date: TODAY })).toBe("Moins d'une semaine");
    expect(words({ kind: 'lmp', date: '2026-10-28' })).toBe('Environ 1 semaine');
    expect(translate('en', 'profile.term.one')).toBe('About 1 week');
  });

  it('accepts up to 45 whole weeks (45 weeks and 6 days)', () => {
    expect(termDisplay({ kind: 'lmp', date: '2025-12-18' }, TODAY).weeksMin).toBe(45);
  });

  it('throws a RangeError beyond 45 whole weeks, in the future or for an invalid date', () => {
    expect(() => termDisplay({ kind: 'lmp', date: '2025-12-17' }, TODAY)).toThrow(RangeError);
    expect(() => termDisplay({ kind: 'lmp', date: '2026-11-05' }, TODAY)).toThrow(RangeError);
    expect(() => termDisplay({ kind: 'lmp', date: '2026-02-30' }, TODAY)).toThrow(RangeError);
    expect(() => termDisplay({ kind: 'lmp', date: '' }, TODAY)).toThrow(RangeError);
  });
});

describe('termDisplay: weeks', () => {
  it('is exact, from 0 to 42', () => {
    expect(termDisplay({ kind: 'weeks', weeks: 26 }, TODAY)).toEqual({
      weeksMin: 26,
      weeksMax: 26,
      precision: 'exact',
      label: { key: 'profile.term.exact', vars: { weeks: 26 } },
    });
    expect(termDisplay({ kind: 'weeks', weeks: 0 }, TODAY).weeksMax).toBe(0);
    expect(termDisplay({ kind: 'weeks', weeks: 42 }, TODAY).weeksMax).toBe(42);
  });

  it('throws a RangeError outside 0 to 42 or for a number that is not whole', () => {
    for (const weeks of [-1, 43, 26.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => termDisplay({ kind: 'weeks', weeks }, TODAY), String(weeks)).toThrow(RangeError);
    }
  });

  it('moves on with the whole weeks since the day the weeks were given', () => {
    // Given as 18 weeks twelve weeks and three days ago: 30 weeks today.
    const term: TermInput = { kind: 'weeks', weeks: 18, givenOn: '2026-08-09' };
    expect(termDisplay(term, TODAY)).toMatchObject({ weeksMin: 30, weeksMax: 30 });
    expect(words(term)).toBe('Environ 30 semaines');
    expect(termDisplay({ kind: 'weeks', weeks: 18, givenOn: TODAY }, TODAY).weeksMin).toBe(18);
  });

  it('throws once the weeks given then add up to more than 45 today', () => {
    expect(() => termDisplay({ kind: 'weeks', weeks: 40, givenOn: '2026-09-01' }, TODAY)).toThrow(
      RangeError,
    );
  });

  it('accepts 42 weeks given 21 days ago (45 today), not 28 days ago (46)', () => {
    expect(termDisplay({ kind: 'weeks', weeks: 42, givenOn: '2026-10-14' }, TODAY).weeksMin).toBe(
      45,
    );
    expect(() => termDisplay({ kind: 'weeks', weeks: 42, givenOn: '2026-10-07' }, TODAY)).toThrow(
      RangeError,
    );
  });

  it('throws when the day the weeks were given is after today or not a date', () => {
    expect(() => termDisplay({ kind: 'weeks', weeks: 20, givenOn: '2026-11-12' }, TODAY)).toThrow(
      RangeError,
    );
    expect(() => termDisplay({ kind: 'weeks', weeks: 20, givenOn: 'yesterday' }, TODAY)).toThrow(
      RangeError,
    );
  });
});

describe('termDisplay: months', () => {
  it('covers both readings of "month m": the month in progress and m months completed', () => {
    // From the start of month 5 to the end of month 6.
    expect(termDisplay({ kind: 'months', months: 5 }, TODAY)).toEqual({
      weeksMin: 19,
      weeksMax: 28,
      precision: 'estimated',
      label: { key: 'profile.term.estimated', vars: { min: 19, max: 28 } },
    });
    expect(words({ kind: 'months', months: 5 })).toBe('Entre 19 et 28 semaines (estimé)');
  });

  it('runs from the start of month m to the end of month m + 1, and to 42 weeks for month 9', () => {
    const range = (months: number) => {
      const { weeksMin, weeksMax } = termDisplay({ kind: 'months', months }, TODAY);
      return [weeksMin, weeksMax];
    };
    expect(range(1)).toEqual([2, 11]);
    expect(range(5)).toEqual([19, 28]);
    expect(range(6)).toEqual([23, 33]);
    expect(range(9)).toEqual([36, 42]);
  });

  it('throws a RangeError outside 1 to 9 or for a month that is not whole', () => {
    for (const months of [0, 10, 4.5, Number.NaN]) {
      expect(() => termDisplay({ kind: 'months', months }, TODAY), String(months)).toThrow(
        RangeError,
      );
    }
  });

  it('moves the range on with the whole weeks since the month was given', () => {
    // Month 5 given four weeks ago.
    const term: TermInput = { kind: 'months', months: 5, givenOn: '2026-10-07' };
    expect(termDisplay(term, TODAY)).toMatchObject({
      weeksMin: 23,
      weeksMax: 32,
      precision: 'estimated',
    });
  });

  it('accepts month 9 given 63 days ago (from 45 weeks today), not 70 days ago (46)', () => {
    expect(termDisplay({ kind: 'months', months: 9, givenOn: '2026-09-02' }, TODAY)).toMatchObject({
      weeksMin: 45,
      weeksMax: 51,
    });
    expect(() => termDisplay({ kind: 'months', months: 9, givenOn: '2026-08-26' }, TODAY)).toThrow(
      RangeError,
    );
  });
});

describe('termDisplay: unknown', () => {
  it('covers 0 to 42 weeks, flagged unknown', () => {
    expect(termDisplay({ kind: 'unknown' }, TODAY)).toEqual({
      weeksMin: 0,
      weeksMax: 42,
      precision: 'unknown',
      label: { key: 'profile.term.unknown', vars: {} },
    });
    expect(words({ kind: 'unknown' })).toBe('Terme inconnu');
  });
});
