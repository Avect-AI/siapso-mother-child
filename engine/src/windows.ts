// SPDX-License-Identifier: MIT
import type { WindowId } from './types.js';

/** Pregnancy windows in weeks of amenorrhoea; `from` inclusive, `to` exclusive. */
export const WINDOWS: readonly { id: WindowId; from: number; to: number }[] = Object.freeze([
  Object.freeze({ id: 'lt12', from: 0, to: 12 }),
  Object.freeze({ id: '12-19', from: 12, to: 20 }),
  Object.freeze({ id: '20-29', from: 20, to: 30 }),
  Object.freeze({ id: '30-plus', from: 30, to: Infinity }),
]);

/**
 * Days past the upper end of the term that a finding looks ahead to: a course
 * of treatment goes on over the coming days, and the next visit may be about
 * four weeks away, so a window the woman reaches within this time is looked up
 * as well (a finding reached only this way says where its window starts:
 * Finding.windowStart). A whole number of weeks, so a term in whole weeks stays
 * in whole weeks. A conservative engineering default (14 days until the live
 * test round 2, SCRUM-52), to be confirmed by the clinical committee (open
 * question 1 in section 13 of
 * docs/superpowers/specs/2026-11-03-implementation-design.md).
 */
export const TERM_LOOKAHEAD_DAYS = 28;

/**
 * Every window intersecting the closed range [weeksMin, weeksMax], in window
 * order. Throws a RangeError for a range that is not finite, negative or empty,
 * so that a bad term can never silently match no window.
 */
export function windowsCovered(weeksMin: number, weeksMax: number): WindowId[] {
  if (
    !Number.isFinite(weeksMin) ||
    !Number.isFinite(weeksMax) ||
    weeksMin < 0 ||
    weeksMin > weeksMax
  ) {
    throw new RangeError(
      `Invalid pregnancy range: ${String(weeksMin)} to ${String(weeksMax)} weeks`,
    );
  }
  return WINDOWS.filter((w) => weeksMin < w.to && weeksMax >= w.from).map((w) => w.id);
}
