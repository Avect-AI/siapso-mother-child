// SPDX-License-Identifier: MIT
// Pure term helpers: today is always a parameter, never read from a clock.

const MAX_WEEKS = 45;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Days since 1970-01-01 of a proleptic Gregorian calendar date, computed
 * with integer arithmetic only (algorithm "days_from_civil" by Howard Hinnant).
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const shiftedMonth = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Parses YYYY-MM-DD as a calendar date (no time, no time zone). */
function isoDayNumber(iso: string): number {
  const match = ISO_DATE.exec(iso);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  if (!match || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Not an ISO calendar date (YYYY-MM-DD): "${iso}"`);
  }
  return daysFromCivil(year, month, day);
}

/** Whether a text is a calendar date written YYYY-MM-DD (no time, no time zone). */
export function isIsoDate(text: string): boolean {
  try {
    isoDayNumber(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whole weeks of amenorrhoea between the last menstrual period and today,
 * rounded down. Accepts up to 45 whole weeks: 45 weeks and 6 days (321 days)
 * still gives 45, while 46 weeks (322 days) or more throws. Throws a
 * RangeError when a date is invalid, when the last period is after today, or
 * when the result is more than 45 whole weeks.
 */
export function weeksFromLmp(lmpIso: string, todayIso: string): number {
  const days = isoDayNumber(todayIso) - isoDayNumber(lmpIso);
  if (days < 0) {
    throw new RangeError(`Last menstrual period ${lmpIso} is after today ${todayIso}`);
  }
  const weeks = Math.floor(days / 7);
  if (weeks > MAX_WEEKS) {
    throw new RangeError(
      `Last menstrual period ${lmpIso} is more than ${String(MAX_WEEKS)} weeks before ${todayIso}`,
    );
  }
  return weeks;
}

/**
 * Range of weeks of amenorrhoea covered by a month of pregnancy (1 to 9):
 * from floor(4.33 x (m - 1) + 2) to ceil(4.33 x m + 2).
 */
export function rangeFromMonths(month: number): { weeksMin: number; weeksMax: number } {
  if (!Number.isInteger(month) || month < 1 || month > 9) {
    throw new RangeError(`Month of pregnancy must be an integer from 1 to 9: ${String(month)}`);
  }
  return {
    weeksMin: Math.floor(4.33 * (month - 1) + 2),
    weeksMax: Math.ceil(4.33 * month + 2),
  };
}

/** Range of weeks used when the term is unknown. */
export const UNKNOWN_TERM: { readonly weeksMin: 0; readonly weeksMax: 42 } = Object.freeze({
  weeksMin: 0,
  weeksMax: 42,
});
