// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatDate,
  isIsoDate,
  todayIso,
  weeksSince,
  wholeWeeksBetween,
} from './dates.js';

describe('formatDate', () => {
  it('writes a date as each language reads it, the same on every screen, whatever the time zone', () => {
    expect(formatDate('2026-11-05', 'fr')).toBe('05/11/2026');
    expect(formatDate('2026-11-05', 'en')).toBe('5 November 2026');
    expect(formatDate('not a date', 'en')).toBe('not a date');
    expect(formatDate('2026-02-30', 'fr')).toBe('2026-02-30');
  });
});

describe('todayIso', () => {
  it('gives the calendar date of the device clock, in local time', () => {
    expect(todayIso(new Date(2026, 10, 4, 23, 59))).toBe('2026-11-04');
    expect(todayIso(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('pads the month and the day', () => {
    expect(todayIso(new Date(2027, 1, 3))).toBe('2027-02-03');
  });
});

describe('isIsoDate', () => {
  it('accepts a real calendar date written YYYY-MM-DD', () => {
    expect(isIsoDate('2026-11-04')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  it('refuses anything else', () => {
    for (const value of ['', '2026-11-4', '04/11/2026', '2026-02-29', '2026-13-01', '2026-11-31']) {
      expect(isIsoDate(value), value).toBe(false);
    }
  });
});

describe('daysBetween', () => {
  it('counts calendar days, across months, years and leap days', () => {
    expect(daysBetween('2026-11-04', '2026-11-04')).toBe(0);
    expect(daysBetween('2026-05-06', '2026-11-04')).toBe(182);
    expect(daysBetween('2027-12-31', '2028-03-01')).toBe(61);
  });

  it('is negative when the first date is later', () => {
    expect(daysBetween('2026-11-05', '2026-11-04')).toBe(-1);
  });

  it('throws a RangeError for a date that is not a calendar date', () => {
    expect(() => daysBetween('2026-02-30', '2026-11-04')).toThrow(RangeError);
    expect(() => daysBetween('2026-11-04', 'today')).toThrow(RangeError);
  });
});

describe('wholeWeeksBetween', () => {
  it('rounds down to whole weeks', () => {
    expect(wholeWeeksBetween('2026-11-04', '2026-11-10')).toBe(0);
    expect(wholeWeeksBetween('2026-11-04', '2026-11-11')).toBe(1);
    expect(wholeWeeksBetween('2026-05-06', '2026-11-04')).toBe(26);
  });

  it('is negative when the first date is later (never rounded towards zero)', () => {
    expect(wholeWeeksBetween('2026-11-05', '2026-11-04')).toBe(-1);
  });
});

describe('weeksSince', () => {
  it('counts the whole weeks from a past day to today, rounded down', () => {
    expect(weeksSince('2026-11-04', '2026-11-04')).toBe(0);
    expect(weeksSince('2026-10-29', '2026-11-04')).toBe(0);
    expect(weeksSince('2026-10-28', '2026-11-04')).toBe(1);
  });

  it('throws a RangeError for a day after today (a clock moved back) or not a date', () => {
    expect(() => weeksSince('2026-11-05', '2026-11-04')).toThrow(RangeError);
    expect(() => weeksSince('yesterday', '2026-11-04')).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('moves a date by whole days, either way', () => {
    expect(addDays('2026-11-04', -182)).toBe('2026-05-06');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
