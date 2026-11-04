// SPDX-License-Identifier: MIT
// The term of a pregnancy, in weeks of amenorrhoea, and the words that show
// it. Pure: today is a parameter, read from the phone's clock by the screen.
import { rangeFromMonths, UNKNOWN_TERM, weeksFromLmp, type TermPrecision } from '@siapso/engine';
import type { MessageKey } from '../i18n/translate.js';
import { weeksSince } from './dates.js';
import type { TermInput } from './types.js';

/** Weeks a woman may give (the screen refuses more). */
export const MAX_GIVEN_WEEKS = 42;

/**
 * The latest term still taken as a pregnancy: 45 whole weeks, the limit of
 * `weeksFromLmp` in engine/src/pregnancy.ts (not exported there), applied
 * here to weeks and months moved on since they were given.
 */
export const MAX_TERM_WEEKS = 45;

/** The last month of pregnancy; a month 9 estimate runs to the end of the unknown range. */
const LAST_MONTH = 9;

export interface TermDisplay {
  weeksMin: number;
  weeksMax: number;
  precision: TermPrecision;
  label: { key: MessageKey; vars: Record<string, number> };
}

/** Whole weeks in words: less than a week, about 1 week, about n weeks. */
export function weeksLabel(weeks: number): TermDisplay['label'] {
  if (weeks === 0) return { key: 'profile.term.underOne', vars: {} };
  if (weeks === 1) return { key: 'profile.term.one', vars: {} };
  return { key: 'profile.term.exact', vars: { weeks } };
}

function exact(weeks: number): TermDisplay {
  return { weeksMin: weeks, weeksMax: weeks, precision: 'exact', label: weeksLabel(weeks) };
}

function beyondTerm(weeks: number): never {
  throw new RangeError(`A term of ${String(weeks)} weeks is past ${String(MAX_TERM_WEEKS)} weeks`);
}

/** Weeks since `givenOn`, 0 when none was recorded. Throws as weeksSince does. */
function movedOn(givenOn: string | undefined, todayIso: string): number {
  return givenOn === undefined ? 0 : weeksSince(givenOn, todayIso);
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
 * The range of weeks of a term today, its precision and its words.
 * - lmp: exact, whole weeks since the last period (weeksFromLmp);
 * - weeks: exact, the weeks given (whole, 0 to 42) plus the whole weeks since;
 * - months: estimated, monthRange(months) moved on by the whole weeks since;
 * - unknown: 0 to 42, unknown.
 * Throws a RangeError for an input the screen refuses, for a day given after
 * today, or once the term (its start, for months) is past 45 weeks.
 */
export function termDisplay(term: TermInput, todayIso: string): TermDisplay {
  switch (term.kind) {
    case 'lmp':
      return exact(weeksFromLmp(term.date, todayIso));
    case 'weeks': {
      if (!Number.isInteger(term.weeks) || term.weeks < 0 || term.weeks > MAX_GIVEN_WEEKS) {
        throw new RangeError(
          `Weeks must be a whole number from 0 to ${String(MAX_GIVEN_WEEKS)}: ${String(term.weeks)}`,
        );
      }
      const weeks = term.weeks + movedOn(term.givenOn, todayIso);
      if (weeks > MAX_TERM_WEEKS) beyondTerm(weeks);
      return exact(weeks);
    }
    case 'months': {
      const range = monthRange(term.months);
      const since = movedOn(term.givenOn, todayIso);
      const weeksMin = range.weeksMin + since;
      const weeksMax = range.weeksMax + since;
      if (weeksMin > MAX_TERM_WEEKS) beyondTerm(weeksMin);
      return {
        weeksMin,
        weeksMax,
        precision: 'estimated',
        label: { key: 'profile.term.estimated', vars: { min: weeksMin, max: weeksMax } },
      };
    }
    case 'unknown':
      return {
        weeksMin: UNKNOWN_TERM.weeksMin,
        weeksMax: UNKNOWN_TERM.weeksMax,
        precision: 'unknown',
        label: { key: 'profile.term.unknown', vars: {} },
      };
  }
}
