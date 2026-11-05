// SPDX-License-Identifier: MIT
import { daysBetween, isIsoDate } from './dates.js';

/** A knowledge base older than this many days (strictly) is called out of date. */
export const STALE_AFTER_DAYS = 90;

/**
 * Whether the knowledge base dated `packDateIso` is out of date on the phone's
 * date `todayIso` (both YYYY-MM-DD): strictly more than 90 days later. A
 * clock set before the pack date is not stale. A date that is not a calendar
 * date gives false: nothing certain to say.
 */
export function isStale(packDateIso: string, todayIso: string): boolean {
  if (!isIsoDate(packDateIso) || !isIsoDate(todayIso)) return false;
  return daysBetween(packDateIso, todayIso) > STALE_AFTER_DAYS;
}
