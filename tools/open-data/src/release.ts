// SPDX-License-Identifier: MIT

/**
 * Release policy: an ISO week is published once, after this many days following
 * the end of the week (the Sunday), as an immutable file.
 */
export const RELEASE_LAG_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_PATTERN = /^(20[0-9]{2})-W(0[1-9]|[1-4][0-9]|5[0-3])$/;
const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of ISO weeks in a year: 53 when 1 January is a Thursday, or a Wednesday in a leap year. */
export function weeksInYear(year: number): 52 | 53 {
  const day = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  return day === 4 || (day === 3 && isLeap(year)) ? 53 : 52;
}

/** True when the text is a week of the ISO calendar, for example 2026-W45 (2025-W53 does not exist). */
export function isIsoWeek(week: string): boolean {
  const match = WEEK_PATTERN.exec(week);
  if (match === null) return false;
  return Number(match[2]) <= weeksInYear(Number(match[1]));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The Sunday that ends the ISO week, as YYYY-MM-DD. */
export function isoWeekEnd(week: string): string {
  const match = WEEK_PATTERN.exec(week);
  if (match === null || !isIsoWeek(week)) throw new Error(`Not an ISO week: ${week}`);
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const mondayOfWeek1 = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY_MS;
  return formatDate(new Date(mondayOfWeek1 + (Number(match[2]) - 1) * 7 * DAY_MS + 6 * DAY_MS));
}

/** First date on which the week may be published: week end plus the fixed lag. */
export function earliestRelease(week: string): string {
  const end = Date.parse(`${isoWeekEnd(week)}T00:00:00Z`);
  return formatDate(new Date(end + RELEASE_LAG_DAYS * DAY_MS));
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return formatDate(date) === text;
}
