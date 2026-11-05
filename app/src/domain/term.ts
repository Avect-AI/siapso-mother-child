// SPDX-License-Identifier: MIT
// The term of a pregnancy, in weeks of amenorrhoea, and the words that show
// it. Pure: today is a parameter, read from the phone's clock by the screen.
import { rangeFromMonths, UNKNOWN_TERM, type TermPrecision } from '@siapso/engine';
import type { MessageKey } from '../i18n/translate.js';
import { daysBetween, isIsoDate, todayIso } from './dates.js';
import type { Profile, TermInput } from './types.js';

/** Weeks a woman may give (the screen refuses more). */
export const MAX_GIVEN_WEEKS = 42;

/** The latest term in whole weeks: 42+0. */
export const MAX_TERM_WEEKS = 42;

const DAYS_PER_WEEK = 7;
/** 42+0 in days: a term past it may be past the birth. */
const MAX_TERM_DAYS = MAX_TERM_WEEKS * DAYS_PER_WEEK;

/**
 * Days a "Je ne sais pas" answer (to "Enceinte ?" or to the term) is read as
 * it was given; past them the baby may be born, and breastfeeding is read as
 * possible too. A conservative engineering default for the clinical committee
 * to confirm (spec section 13).
 */
export const UNKNOWN_HOLDS_DAYS = 28;

/** The last month of pregnancy; a month 9 estimate runs to the end of the unknown range. */
const LAST_MONTH = 9;

export interface TermDisplay {
  weeksMin: number;
  weeksMax: number;
  precision: TermPrecision;
  label: { key: MessageKey; vars: Record<string, number> };
}

/**
 * A stored term read today:
 * - ok: its range and words;
 * - possibly-past: the upper end of the term is past 42+0 weeks (or a "Je ne
 *   sais pas" is older than 28 days) but the lower end is not: the baby may be
 *   born. The range is held at 42 weeks and breastfeeding is read as possible;
 * - outdated: the lower end is past 42+0 (or a "Je ne sais pas" older than 42
 *   weeks), or a value cannot be read: it must be given again;
 * - clock: a day after today, which only a phone clock set back can give.
 */
export type TermReading =
  | { status: 'ok'; term: TermDisplay }
  | { status: 'possibly-past'; term: TermDisplay }
  | { status: 'outdated' }
  | { status: 'clock' };

/** Whole weeks in words: less than a week, about 1 week, about n weeks. */
export function weeksLabel(weeks: number): TermDisplay['label'] {
  if (weeks === 0) return { key: 'profile.term.underOne', vars: {} };
  if (weeks === 1) return { key: 'profile.term.one', vars: {} };
  return { key: 'profile.term.exact', vars: { weeks } };
}

/** The unknown term: every week of a pregnancy. */
export function unknownTerm(): TermDisplay {
  return {
    weeksMin: UNKNOWN_TERM.weeksMin,
    weeksMax: UNKNOWN_TERM.weeksMax,
    precision: 'unknown',
    label: { key: 'profile.term.unknown', vars: {} },
  };
}

/**
 * The weeks a month of pregnancy may mean. "5 months" is read either as the
 * month in progress (the fifth) or as five months completed (into the sixth):
 * the range covers both, from the start of month m to the end of month m + 1
 * (to 42 weeks for month 9), so no reading falls outside it.
 */
export function monthRange(months: number): { weeksMin: number; weeksMax: number } {
  const { weeksMin } = rangeFromMonths(months);
  const weeksMax =
    months < LAST_MONTH ? rangeFromMonths(months + 1).weeksMax : UNKNOWN_TERM.weeksMax;
  return { weeksMin, weeksMax };
}

/**
 * The calendar date on the phone of an instant (an ISO date and time, such as
 * a profile's updatedAt), or the date itself when it is already one;
 * undefined when it cannot be read.
 */
export function localDateOf(instant: string): string | undefined {
  if (isIsoDate(instant)) return instant;
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? undefined : todayIso(date);
}

/**
 * The latest calendar day among dates and instants (the knowledge pack's
 * date, the last result kept), those that cannot be read left out: a phone
 * date before it is a clock set back.
 */
export function latestDay(...instants: (string | undefined)[]): string | undefined {
  let latest: string | undefined;
  for (const instant of instants) {
    const day = instant === undefined ? undefined : localDateOf(instant);
    if (day !== undefined && (latest === undefined || day > latest)) latest = day;
  }
  return latest;
}

/**
 * Days since `givenOn`, or since `fallback` when no day was recorded (0 when
 * neither): null when the day cannot be read, negative when after today.
 */
function daysSince(
  givenOn: string | undefined,
  todayIso: string,
  fallback?: string,
): number | null {
  const day = givenOn ?? fallback;
  if (day === undefined) return 0;
  return isIsoDate(day) && isIsoDate(todayIso) ? daysBetween(day, todayIso) : null;
}

function isWhole(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** A term today in days of amenorrhoea: the earliest and latest it may be. */
interface DayRange {
  minDays: number;
  maxDays: number;
}

/**
 * The range of a term in days today. A whole-week answer stands for that week
 * and its 6 days (N weeks is N+0 to N+6); a month range runs from the first
 * day of its first week to the first day of its last (its bounds are already
 * rounded out); a last period is one day.
 */
function dayRangeOf(
  term: Exclude<TermInput, { kind: 'unknown' }>,
  todayIso: string,
  fallback?: string,
): DayRange | 'outdated' | 'clock' {
  switch (term.kind) {
    case 'lmp': {
      if (!isIsoDate(term.date) || !isIsoDate(todayIso)) return 'outdated';
      const days = daysBetween(term.date, todayIso);
      return days < 0 ? 'clock' : { minDays: days, maxDays: days };
    }
    case 'weeks': {
      if (!isWhole(term.weeks, 0, MAX_GIVEN_WEEKS)) return 'outdated';
      const days = daysSince(term.givenOn, todayIso, fallback);
      if (days === null) return 'outdated';
      if (days < 0) return 'clock';
      const start = term.weeks * DAYS_PER_WEEK + days;
      return { minDays: start, maxDays: start + DAYS_PER_WEEK - 1 };
    }
    case 'months': {
      if (!isWhole(term.months, 1, LAST_MONTH)) return 'outdated';
      const days = daysSince(term.givenOn, todayIso, fallback);
      if (days === null) return 'outdated';
      if (days < 0) return 'clock';
      const { weeksMin, weeksMax } = monthRange(term.months);
      return {
        minDays: weeksMin * DAYS_PER_WEEK + days,
        maxDays: weeksMax * DAYS_PER_WEEK + days,
      };
    }
  }
}

/** An unknown term (or a "Je ne sais pas" to the pregnancy), read by how long ago it was said. */
function readUnknown(
  givenOn: string | undefined,
  todayIso: string,
  fallback?: string,
): TermReading {
  const days = daysSince(givenOn, todayIso, fallback);
  if (days === null) return { status: 'outdated' };
  if (days < 0) return { status: 'clock' };
  if (days > MAX_TERM_DAYS) return { status: 'outdated' };
  if (days > UNKNOWN_HOLDS_DAYS) return { status: 'possibly-past', term: unknownTerm() };
  return { status: 'ok', term: unknownTerm() };
}

/**
 * A stored term read today (TermReading). `fallback` dates a weeks, months or
 * unknown answer stored without its day: the profile's last save.
 */
export function readTerm(term: TermInput, todayIso: string, fallback?: string): TermReading {
  if (term.kind === 'unknown') return readUnknown(term.givenOn, todayIso, fallback);
  const range = dayRangeOf(term, todayIso, fallback);
  if (range === 'outdated' || range === 'clock') return { status: range };
  if (range.minDays > MAX_TERM_DAYS) return { status: 'outdated' };
  const weeksMin = Math.floor(range.minDays / DAYS_PER_WEEK);
  const weeksMax = Math.min(Math.floor(range.maxDays / DAYS_PER_WEEK), MAX_TERM_WEEKS);
  const status = range.maxDays > MAX_TERM_DAYS ? 'possibly-past' : 'ok';
  const term_: TermDisplay =
    term.kind === 'months'
      ? {
          weeksMin,
          weeksMax,
          precision: 'estimated',
          label: { key: 'profile.term.estimated', vars: { min: weeksMin, max: weeksMax } },
        }
      : { weeksMin, weeksMax, precision: 'exact', label: weeksLabel(weeksMin) };
  return { status, term: term_ };
}

/**
 * The range of weeks of a term today, its precision and its words (readTerm),
 * possibly past term included. Throws a RangeError when the term is outdated
 * or its day is after today.
 */
export function termDisplay(term: TermInput, todayIso: string, fallback?: string): TermDisplay {
  const reading = readTerm(term, todayIso, fallback);
  if (reading.status === 'ok' || reading.status === 'possibly-past') return reading.term;
  throw new RangeError(
    reading.status === 'clock'
      ? `The term was given after today (${todayIso})`
      : `The term is past ${String(MAX_TERM_WEEKS)} weeks or cannot be read`,
  );
}

/**
 * Where a profile stands on its pregnancy today, the one place that says it:
 * - not-pregnant;
 * - ok: the term of today; `unsure` when she does not know whether she is
 *   pregnant (an unknown term, every week of a pregnancy);
 * - possibly-past: the baby may be born (TermReading): the check goes on with
 *   the term held at 42 weeks and breastfeeding read as possible, and the
 *   screens say so;
 * - outdated: the baby is surely born or the term cannot be read: the profile
 *   is updated before any check and no result is worked out on it;
 * - clock: the phone's date is before a day the app has already seen (the
 *   profile's last save, `notBefore`: the knowledge pack's date or the last
 *   result kept), or before the day a term was given: the term is read as
 *   unknown, the riskier case, and the screens say why.
 */
export type ProfileTermStatus =
  | { status: 'not-pregnant' }
  | { status: 'ok'; term: TermDisplay; unsure: boolean }
  | { status: 'possibly-past'; term: TermDisplay; unsure: boolean }
  | { status: 'outdated' }
  | { status: 'clock'; term: TermDisplay };

export function profileTermStatus(
  profile: Pick<
    Profile,
    'pregnant' | 'pregnancyUnsure' | 'pregnancyUnsureOn' | 'term' | 'updatedAt'
  >,
  todayIso: string,
  notBefore?: string,
): ProfileTermStatus {
  if (!profile.pregnant) return { status: 'not-pregnant' };
  const saved = localDateOf(profile.updatedAt);
  for (const floor of [saved, notBefore]) {
    if (floor !== undefined && isIsoDate(floor) && daysBetween(floor, todayIso) < 0) {
      return { status: 'clock', term: unknownTerm() };
    }
  }
  const unsure = profile.pregnancyUnsure === true;
  let reading: TermReading;
  if (unsure) reading = readUnknown(profile.pregnancyUnsureOn, todayIso, saved);
  else if (profile.term === undefined) reading = readUnknown(undefined, todayIso, saved);
  else reading = readTerm(profile.term, todayIso, saved);
  switch (reading.status) {
    case 'ok':
    case 'possibly-past':
      return { status: reading.status, term: reading.term, unsure };
    case 'clock':
      return { status: 'clock', term: unknownTerm() };
    case 'outdated':
      return { status: 'outdated' };
  }
}

/**
 * Whether the baby may already be born: on a possibly past term, on an
 * outdated one, and on a phone clock set back (the real date is later, the
 * term may be past). The check then reads breastfeeding as possible (no baby
 * age) and asks about the signs after the birth and of the baby up front.
 */
export function babyMayBeBorn(status: ProfileTermStatus): boolean {
  return (
    status.status === 'possibly-past' || status.status === 'outdated' || status.status === 'clock'
  );
}
