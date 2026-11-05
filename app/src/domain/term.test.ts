// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/translate.js';
import { addDays } from './dates.js';
import {
  babyMayBeBorn,
  latestDay,
  profileTermStatus,
  readTerm,
  termDisplay,
  type TermDisplay,
} from './term.js';
import type { Profile, TermInput } from './types.js';

const TODAY = '2026-11-04';

/** The words shown for a term, in French. */
function words(term: TermInput, today = TODAY): string {
  const { label } = termDisplay(term, today);
  return translate('fr', label.key, label.vars);
}

function range(term: TermInput, today = TODAY): [number, number] {
  const { weeksMin, weeksMax } = termDisplay(term, today);
  return [weeksMin, weeksMax];
}

/** The status of a term given `days` before TODAY. */
function statusAfter(term: TermInput & { givenOn?: string }, days: number): string {
  return readTerm({ ...term, givenOn: addDays(TODAY, -days) } as TermInput, TODAY).status;
}

const UNKNOWN: TermDisplay = {
  weeksMin: 0,
  weeksMax: 42,
  precision: 'unknown',
  label: { key: 'profile.term.unknown', vars: {} },
};

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

  it('holds up to 42 weeks and 0 days, and is outdated the day after', () => {
    expect(range({ kind: 'lmp', date: addDays(TODAY, -42 * 7) })).toEqual([42, 42]);
    expect(readTerm({ kind: 'lmp', date: addDays(TODAY, -(42 * 7 + 1)) }, TODAY)).toEqual({
      status: 'outdated',
    });
    expect(() => termDisplay({ kind: 'lmp', date: addDays(TODAY, -43 * 7) }, TODAY)).toThrow(
      RangeError,
    );
  });

  it('reads a date after today as a phone clock set back, and one that is not a date as outdated', () => {
    expect(readTerm({ kind: 'lmp', date: '2026-11-05' }, TODAY)).toEqual({ status: 'clock' });
    expect(readTerm({ kind: 'lmp', date: '2026-02-30' }, TODAY)).toEqual({ status: 'outdated' });
    expect(readTerm({ kind: 'lmp', date: '' }, TODAY)).toEqual({ status: 'outdated' });
    expect(() => termDisplay({ kind: 'lmp', date: '2026-11-05' }, TODAY)).toThrow(RangeError);
  });
});

describe('termDisplay: weeks', () => {
  it('is exact, from 0 to 41, on the day it is given', () => {
    expect(termDisplay({ kind: 'weeks', weeks: 26, givenOn: TODAY }, TODAY)).toEqual({
      weeksMin: 26,
      weeksMax: 26,
      precision: 'exact',
      label: { key: 'profile.term.exact', vars: { weeks: 26 } },
    });
    expect(range({ kind: 'weeks', weeks: 0, givenOn: TODAY })).toEqual([0, 0]);
    expect(range({ kind: 'weeks', weeks: 41, givenOn: TODAY })).toEqual([41, 41]);
  });

  it('reads N whole weeks as N weeks and 0 to 6 days: the upper end reaches N + 1 the next day', () => {
    const given = '2026-10-28';
    expect(range({ kind: 'weeks', weeks: 19, givenOn: given }, addDays(given, 1))).toEqual([
      19, 20,
    ]);
    expect(range({ kind: 'weeks', weeks: 19, givenOn: given }, addDays(given, 6))).toEqual([
      19, 20,
    ]);
    expect(range({ kind: 'weeks', weeks: 19, givenOn: given }, addDays(given, 7))).toEqual([
      20, 20,
    ]);
    expect(range({ kind: 'weeks', weeks: 19, givenOn: given }, addDays(given, 8))).toEqual([
      20, 21,
    ]);
    // The words say the lower end: "about".
    expect(words({ kind: 'weeks', weeks: 19, givenOn: given }, addDays(given, 1))).toBe(
      'Environ 19 semaines',
    );
  });

  it('moves on with the days since the weeks were given', () => {
    // Given as 18 weeks twelve weeks and three days ago: 30 weeks and 3 to 9 days today.
    const term: TermInput = { kind: 'weeks', weeks: 18, givenOn: '2026-08-09' };
    expect(range(term)).toEqual([30, 31]);
    expect(words(term)).toBe('Environ 30 semaines');
  });

  it('is possibly past term once its upper end is past 42+0, with the range held at 42', () => {
    // 42 weeks today: 42+0 to 42+6.
    expect(readTerm({ kind: 'weeks', weeks: 42, givenOn: TODAY }, TODAY)).toEqual({
      status: 'possibly-past',
      term: {
        weeksMin: 42,
        weeksMax: 42,
        precision: 'exact',
        label: { key: 'profile.term.exact', vars: { weeks: 42 } },
      },
    });
    // 41 weeks (41+0 to 41+6) given a day ago reaches 42+0; two days ago, 42+1.
    expect(statusAfter({ kind: 'weeks', weeks: 41 }, 1)).toBe('ok');
    expect(statusAfter({ kind: 'weeks', weeks: 41 }, 2)).toBe('possibly-past');
    expect(statusAfter({ kind: 'weeks', weeks: 41 }, 7)).toBe('possibly-past');
  });

  it('is outdated once its lower end is past 42+0', () => {
    expect(statusAfter({ kind: 'weeks', weeks: 42 }, 1)).toBe('outdated');
    expect(statusAfter({ kind: 'weeks', weeks: 41 }, 8)).toBe('outdated');
    expect(() => termDisplay({ kind: 'weeks', weeks: 40, givenOn: '2026-09-01' }, TODAY)).toThrow(
      RangeError,
    );
  });

  it('reads stored weeks outside 0 to 42, or not whole, as outdated', () => {
    for (const weeks of [-1, 43, 26.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readTerm({ kind: 'weeks', weeks, givenOn: TODAY }, TODAY), String(weeks)).toEqual({
        status: 'outdated',
      });
    }
  });

  it('reads a day given after today as a phone clock set back, one that is not a date as outdated', () => {
    expect(readTerm({ kind: 'weeks', weeks: 20, givenOn: '2026-11-12' }, TODAY)).toEqual({
      status: 'clock',
    });
    expect(readTerm({ kind: 'weeks', weeks: 20, givenOn: 'yesterday' }, TODAY)).toEqual({
      status: 'outdated',
    });
  });

  it('dates weeks stored without a day by the fallback given (the last save of the profile)', () => {
    expect(readTerm({ kind: 'weeks', weeks: 20 }, TODAY, '2026-10-07')).toMatchObject({
      status: 'ok',
      term: { weeksMin: 24, weeksMax: 24 },
    });
    // No fallback: read as given today.
    expect(range({ kind: 'weeks', weeks: 20 })).toEqual([20, 20]);
  });
});

describe('termDisplay: months', () => {
  it('covers both readings of "month m": the month in progress and m months completed', () => {
    // From the start of month 5 to the end of month 6.
    expect(termDisplay({ kind: 'months', months: 5, givenOn: TODAY }, TODAY)).toEqual({
      weeksMin: 19,
      weeksMax: 28,
      precision: 'estimated',
      label: { key: 'profile.term.estimated', vars: { min: 19, max: 28 } },
    });
    expect(words({ kind: 'months', months: 5 })).toBe('Entre 19 et 28 semaines (estimé)');
  });

  it('runs from the start of month m to the end of month m + 1, and to 42 weeks for month 9', () => {
    expect(range({ kind: 'months', months: 1 })).toEqual([2, 11]);
    expect(range({ kind: 'months', months: 5 })).toEqual([19, 28]);
    expect(range({ kind: 'months', months: 6 })).toEqual([23, 33]);
    expect(range({ kind: 'months', months: 9 })).toEqual([36, 42]);
  });

  it('reads a stored month outside 1 to 9, or not whole, as outdated', () => {
    for (const months of [0, 10, 4.5, Number.NaN]) {
      expect(readTerm({ kind: 'months', months }, TODAY), String(months)).toEqual({
        status: 'outdated',
      });
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

  it('never blocks a month answer on its upper end: months 7, 8 and 9 after 1, 8 and 36 days', () => {
    const at = (months: number, days: number) => statusAfter({ kind: 'months', months }, days);
    // Month 7 is 27 to 37 weeks: possibly past only once 37 weeks and 36 days are past 42+0.
    expect([at(7, 1), at(7, 8), at(7, 36)]).toEqual(['ok', 'ok', 'possibly-past']);
    // Month 8 is 32 to 41 weeks.
    expect([at(8, 1), at(8, 8), at(8, 36)]).toEqual(['ok', 'possibly-past', 'possibly-past']);
    // Month 9 is 36 to 42 weeks: possibly past the next day, never blocked while 36 + days <= 42.
    expect([at(9, 0), at(9, 1), at(9, 8), at(9, 36)]).toEqual([
      'ok',
      'possibly-past',
      'possibly-past',
      'possibly-past',
    ]);
    // The range is held at 42 weeks while possibly past.
    expect(
      readTerm({ kind: 'months', months: 9, givenOn: addDays(TODAY, -8) }, TODAY),
    ).toMatchObject({ term: { weeksMin: 37, weeksMax: 42 } });
  });

  it('is outdated once its lower end is past 42+0', () => {
    // Month 9 starts at 36 weeks: 42+1 after 43 days.
    expect(statusAfter({ kind: 'months', months: 9 }, 42)).toBe('possibly-past');
    expect(statusAfter({ kind: 'months', months: 9 }, 43)).toBe('outdated');
  });

  it('reads a day given after today as a phone clock set back', () => {
    expect(readTerm({ kind: 'months', months: 5, givenOn: '2026-12-01' }, TODAY)).toEqual({
      status: 'clock',
    });
  });
});

describe('termDisplay: unknown', () => {
  it('covers 0 to 42 weeks, flagged unknown', () => {
    expect(termDisplay({ kind: 'unknown', givenOn: TODAY }, TODAY)).toEqual(UNKNOWN);
    expect(words({ kind: 'unknown' })).toBe('Terme inconnu');
  });

  it('is possibly past term after 28 days, and outdated after 42 weeks', () => {
    expect(statusAfter({ kind: 'unknown' }, 28)).toBe('ok');
    expect(statusAfter({ kind: 'unknown' }, 29)).toBe('possibly-past');
    expect(readTerm({ kind: 'unknown', givenOn: addDays(TODAY, -40) }, TODAY)).toEqual({
      status: 'possibly-past',
      term: UNKNOWN,
    });
    expect(statusAfter({ kind: 'unknown' }, 42 * 7)).toBe('possibly-past');
    expect(statusAfter({ kind: 'unknown' }, 42 * 7 + 1)).toBe('outdated');
  });

  it('reads a day after today as a phone clock set back', () => {
    expect(readTerm({ kind: 'unknown', givenOn: '2026-12-01' }, TODAY)).toEqual({
      status: 'clock',
    });
  });
});

describe('latestDay', () => {
  it('gives the latest calendar day of dates and instants, leaving out what cannot be read', () => {
    expect(latestDay('2026-11-04', '2026-11-10T09:00:00.000Z', undefined, 'not a date')).toBe(
      '2026-11-10',
    );
    expect(latestDay(undefined)).toBeUndefined();
  });
});

describe('profileTermStatus', () => {
  function profile(patch: Partial<Profile>): Profile {
    return {
      id: 'p1',
      pseudonym: 'Awa',
      pregnant: true,
      breastfeeding: false,
      conditions: [],
      longTermItems: [],
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
      ...patch,
    };
  }

  it('says when the profile is not pregnant', () => {
    expect(profileTermStatus(profile({ pregnant: false }), TODAY)).toEqual({
      status: 'not-pregnant',
    });
  });

  it('gives the term of today when it holds', () => {
    expect(
      profileTermStatus(profile({ term: { kind: 'weeks', weeks: 30, givenOn: TODAY } }), TODAY),
    ).toEqual({
      status: 'ok',
      unsure: false,
      term: {
        weeksMin: 30,
        weeksMax: 30,
        precision: 'exact',
        label: { key: 'profile.term.exact', vars: { weeks: 30 } },
      },
    });
  });

  it('reads a pregnancy with no term as an unknown term dated by the last save', () => {
    expect(profileTermStatus(profile({ updatedAt: '2026-10-20T08:00:00.000Z' }), TODAY)).toEqual({
      status: 'ok',
      unsure: false,
      term: UNKNOWN,
    });
    // Saved more than 28 days ago: possibly past term.
    expect(profileTermStatus(profile({}), TODAY).status).toBe('possibly-past');
  });

  it('reads "Je ne sais pas" to the pregnancy as a pregnancy of unknown term, dated', () => {
    expect(
      profileTermStatus(profile({ pregnancyUnsure: true, pregnancyUnsureOn: TODAY }), TODAY),
    ).toEqual({ status: 'ok', unsure: true, term: UNKNOWN });
    expect(
      profileTermStatus(
        profile({ pregnancyUnsure: true, pregnancyUnsureOn: addDays(TODAY, -40) }),
        TODAY,
      ),
    ).toEqual({ status: 'possibly-past', unsure: true, term: UNKNOWN });
    expect(
      profileTermStatus(
        profile({ pregnancyUnsure: true, pregnancyUnsureOn: addDays(TODAY, -300) }),
        TODAY,
      ),
    ).toEqual({ status: 'outdated' });
    // An older record without the day: the last save dates it (1 October, 34 days ago).
    expect(profileTermStatus(profile({ pregnancyUnsure: true }), TODAY)).toEqual({
      status: 'possibly-past',
      unsure: true,
      term: UNKNOWN,
    });
  });

  it('says a term whose lower end is past 42 weeks, or a date that cannot be read, is outdated', () => {
    for (const term of [
      { kind: 'weeks', weeks: 30, givenOn: '2026-08-01' },
      { kind: 'months', months: 7, givenOn: '2026-07-01' },
      { kind: 'lmp', date: '2025-12-01' },
      { kind: 'lmp', date: 'not a date' },
    ] as const) {
      expect(profileTermStatus(profile({ term }), TODAY), term.kind).toEqual({
        status: 'outdated',
      });
    }
  });

  it('reads a term given after today as unknown, because of the phone clock', () => {
    expect(
      profileTermStatus(
        profile({ term: { kind: 'weeks', weeks: 30, givenOn: '2026-12-01' } }),
        TODAY,
      ),
    ).toEqual({ status: 'clock', term: UNKNOWN });
  });

  it('reads any term as unknown when today is before the profile was last saved, a last period too', () => {
    const lmp = profile({
      term: { kind: 'lmp', date: '2026-05-06' },
      updatedAt: '2026-11-20T08:00:00.000Z',
    });
    expect(profileTermStatus(lmp, TODAY)).toEqual({ status: 'clock', term: UNKNOWN });
  });

  it('reads any term as unknown when today is before a later date the app has seen', () => {
    const lmp = profile({ term: { kind: 'lmp', date: '2026-05-06' } });
    // The knowledge pack, or the last result kept on the phone, is dated after today.
    expect(profileTermStatus(lmp, TODAY, '2026-11-10')).toEqual({ status: 'clock', term: UNKNOWN });
    expect(profileTermStatus(lmp, TODAY, TODAY).status).toBe('ok');
  });
});

describe('babyMayBeBorn', () => {
  it('says the baby may be born on a possibly past term, an outdated one and a phone clock set back', () => {
    expect(babyMayBeBorn({ status: 'possibly-past', term: UNKNOWN, unsure: false })).toBe(true);
    expect(babyMayBeBorn({ status: 'outdated' })).toBe(true);
    // The real date is later than the phone says: the term may be past.
    expect(babyMayBeBorn({ status: 'clock', term: UNKNOWN })).toBe(true);
  });

  it('says it is not when the term holds or she is not pregnant', () => {
    expect(babyMayBeBorn({ status: 'ok', term: UNKNOWN, unsure: false })).toBe(false);
    expect(babyMayBeBorn({ status: 'not-pregnant' })).toBe(false);
  });
});
