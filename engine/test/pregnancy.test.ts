// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { rangeFromMonths, UNKNOWN_TERM, weeksFromLmp } from '../src/index.js';

describe('weeksFromLmp', () => {
  it('counts whole weeks of amenorrhoea, rounded down', () => {
    expect(weeksFromLmp('2026-05-01', '2026-11-03')).toBe(26);
    expect(weeksFromLmp('2026-11-03', '2026-11-03')).toBe(0);
    expect(weeksFromLmp('2026-10-28', '2026-11-03')).toBe(0);
    expect(weeksFromLmp('2026-10-27', '2026-11-03')).toBe(1);
  });

  it('handles leap years and year boundaries', () => {
    expect(weeksFromLmp('2028-02-28', '2028-03-06')).toBe(1);
    expect(weeksFromLmp('2028-02-28', '2028-03-05')).toBe(0);
    expect(weeksFromLmp('2027-02-28', '2027-03-07')).toBe(1);
    expect(weeksFromLmp('2027-02-28', '2027-03-06')).toBe(0);
    expect(weeksFromLmp('2026-12-25', '2027-01-08')).toBe(2);
    expect(weeksFromLmp('2099-12-31', '2100-03-01')).toBe(8);
  });

  it('agrees with UTC calendar arithmetic over several years', () => {
    const today = '2026-11-03';
    const todayMs = Date.UTC(2026, 10, 3);
    for (let days = 0; days <= 315; days += 1) {
      const lmp = new Date(todayMs - days * 86_400_000).toISOString().slice(0, 10);
      expect(weeksFromLmp(lmp, today)).toBe(Math.floor(days / 7));
    }
  });

  it('accepts 45 weeks and refuses more', () => {
    expect(weeksFromLmp('2025-12-23', '2026-11-03')).toBe(45);
    expect(weeksFromLmp('2025-12-17', '2026-11-03')).toBe(45);
    expect(() => weeksFromLmp('2025-12-16', '2026-11-03')).toThrow(RangeError);
  });

  it('refuses a last period after today', () => {
    expect(() => weeksFromLmp('2026-11-04', '2026-11-03')).toThrow(RangeError);
  });

  it('refuses anything that is not an ISO calendar date', () => {
    for (const bad of [
      '2026-02-29',
      '2028-02-30',
      '2026-04-31',
      '2026-13-01',
      '2026-00-10',
      '2026-01-00',
      '2026-5-1',
      '2026-05-01T00:00:00Z',
      ' 2026-05-01',
      '01/05/2026',
      '',
    ]) {
      expect(() => weeksFromLmp(bad, '2026-11-03'), bad).toThrow(RangeError);
      expect(() => weeksFromLmp('2026-05-01', bad), bad).toThrow(RangeError);
    }
    expect(weeksFromLmp('2028-02-29', '2028-03-07')).toBe(1);
  });
});

describe('rangeFromMonths', () => {
  it('converts a month of pregnancy to a range of weeks', () => {
    expect(rangeFromMonths(5)).toEqual({ weeksMin: 19, weeksMax: 24 });
    expect(rangeFromMonths(1)).toEqual({ weeksMin: 2, weeksMax: 7 });
    expect(rangeFromMonths(9)).toEqual({ weeksMin: 36, weeksMax: 41 });
  });

  it('gives ranges that follow each other without a gap', () => {
    for (let month = 1; month < 9; month += 1) {
      expect(rangeFromMonths(month + 1).weeksMin).toBeLessThanOrEqual(
        rangeFromMonths(month).weeksMax,
      );
    }
  });

  it('refuses a month outside 1 to 9 or not an integer', () => {
    for (const bad of [0, 10, -1, 2.5, Number.NaN, Infinity]) {
      expect(() => rangeFromMonths(bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe('UNKNOWN_TERM', () => {
  it('covers weeks 0 to 42 and cannot be modified', () => {
    expect(UNKNOWN_TERM).toEqual({ weeksMin: 0, weeksMax: 42 });
    expect(Object.isFrozen(UNKNOWN_TERM)).toBe(true);
  });
});
