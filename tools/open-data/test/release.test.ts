// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { earliestRelease, isDate, isIsoWeek, isoWeekEnd, weeksInYear } from '../src/index.js';

describe('ISO calendar', () => {
  it('knows which years have 53 weeks', () => {
    expect(weeksInYear(2026)).toBe(53);
    expect(weeksInYear(2025)).toBe(52);
    expect(weeksInYear(2020)).toBe(53);
    expect(weeksInYear(2032)).toBe(53);
    expect(weeksInYear(2027)).toBe(52);
  });

  it('accepts only real weeks', () => {
    expect(isIsoWeek('2026-W45')).toBe(true);
    expect(isIsoWeek('2026-W53')).toBe(true);
    expect(isIsoWeek('2025-W53')).toBe(false);
    expect(isIsoWeek('2026-W00')).toBe(false);
    expect(isIsoWeek('2026-45')).toBe(false);
  });

  it('gives the Sunday that ends a week', () => {
    expect(isoWeekEnd('2026-W45')).toBe('2026-11-08');
    expect(isoWeekEnd('2026-W01')).toBe('2026-01-04');
    expect(isoWeekEnd('2026-W53')).toBe('2027-01-03');
    expect(isoWeekEnd('2024-W01')).toBe('2024-01-07');
  });

  it('puts the earliest release 28 days after the week ends', () => {
    expect(earliestRelease('2026-W45')).toBe('2026-12-06');
    expect(earliestRelease('2026-W53')).toBe('2027-01-31');
  });

  it('checks calendar dates strictly', () => {
    expect(isDate('2026-12-06')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-12-6')).toBe(false);
  });
});
