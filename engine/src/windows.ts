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
