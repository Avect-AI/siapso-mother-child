// SPDX-License-Identifier: MIT
// Calendar dates written YYYY-MM-DD, with no time and no time zone. Pure:
// today is always a parameter; only todayIso reads a Date, given by the caller.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Milliseconds at midnight UTC of a calendar date, or undefined when it is not one. */
function utcMidnight(iso: string): number | undefined {
  const match = ISO_DATE.exec(iso);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // 2026-02-30 rolls over to March: not a calendar date.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return undefined;
  if (date.getUTCDate() !== day) return undefined;
  return date.getTime();
}

function dayNumber(iso: string): number {
  const ms = utcMidnight(iso);
  if (ms === undefined) throw new RangeError(`Not an ISO calendar date (YYYY-MM-DD): "${iso}"`);
  return ms / DAY_MS;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Whether `value` is a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  return utcMidnight(value) !== undefined;
}

/** The calendar date of `now` on the phone's clock, in its local time zone. */
export function todayIso(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/** Days from `fromIso` to `toIso`, negative when `fromIso` is later. Throws a RangeError for an invalid date. */
export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

/** Whole weeks from `fromIso` to `toIso`, rounded down (so -1 for one day back). */
export function wholeWeeksBetween(fromIso: string, toIso: string): number {
  return Math.floor(daysBetween(fromIso, toIso) / 7);
}

/**
 * The whole weeks a term or an age given on `givenOn` has moved on by today,
 * rounded down. Throws a RangeError when `givenOn` is not a date or is after
 * today (a phone clock moved back), so each caller chooses its safe reading.
 * The one helper every "weeks since" goes through.
 */
export function weeksSince(givenOn: string, todayIso: string): number {
  const weeks = wholeWeeksBetween(givenOn, todayIso);
  if (weeks < 0) throw new RangeError(`Given on ${givenOn}, after today ${todayIso}`);
  return weeks;
}

/**
 * A calendar date as the language writes it, the same on every screen:
 * "05/11/2026" in French (day, month, year), "5 November 2026" in English (a
 * month name, so a day and a month are never mixed up). Read as a calendar
 * date, whatever the phone's time zone; a value that is not one is returned
 * as it is.
 */
export function formatDate(iso: string, lang: 'fr' | 'en'): string {
  const ms = utcMidnight(iso);
  if (ms === undefined) return iso;
  const options: Intl.DateTimeFormatOptions =
    lang === 'fr'
      ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', options).format(ms);
}

/** The calendar date `days` after `iso` (before it when negative). */
export function addDays(iso: string, days: number): string {
  const date = new Date((dayNumber(iso) + days) * DAY_MS);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}
