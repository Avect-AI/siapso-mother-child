// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { STALE_AFTER_DAYS, isStale } from './staleness.js';

describe('isStale', () => {
  it('is not stale on the day of the pack, nor before it (a phone clock set back)', () => {
    expect(isStale('2026-11-04', '2026-11-04')).toBe(false);
    expect(isStale('2026-11-04', '2026-10-01')).toBe(false);
  });

  it('is not stale at exactly 90 days and stale at 91', () => {
    expect(STALE_AFTER_DAYS).toBe(90);
    expect(isStale('2026-11-04', '2027-02-02')).toBe(false);
    expect(isStale('2026-11-04', '2027-02-03')).toBe(true);
  });

  it('counts calendar days across a leap day', () => {
    expect(isStale('2028-01-01', '2028-03-31')).toBe(false);
    expect(isStale('2028-01-01', '2028-04-01')).toBe(true);
  });

  it('is not stale when a date is not a calendar date (nothing certain to say)', () => {
    expect(isStale('not a date', '2027-06-01')).toBe(false);
    expect(isStale('2026-11-04', '2027-02-30')).toBe(false);
  });
});
