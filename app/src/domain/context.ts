// SPDX-License-Identifier: MIT
// The evaluation context the engine reads, built from a profile and the
// current check. Pure: today is a parameter. The engine refuses invalid
// numbers with a RangeError; this mapping never hands it one. A stored value
// that no longer holds (a last period now too far back, an age that cannot be
// read) becomes "unknown", which the engine treats as the riskier case: every
// pregnancy window, every age-bounded rule. It never lowers a level.
import {
  UNKNOWN_TERM,
  type BreastfeedingContext,
  type CheckedItem,
  type EvaluationContext,
  type PregnancyContext,
} from '@siapso/engine';
import { weeksSince, wholeWeeksBetween } from './dates.js';
import { termDisplay } from './term.js';
import type { Profile, TermInput } from './types.js';

const UNKNOWN_PREGNANCY: PregnancyContext = {
  weeksMin: UNKNOWN_TERM.weeksMin,
  weeksMax: UNKNOWN_TERM.weeksMax,
  precision: 'unknown',
};

function pregnancyOf(term: TermInput | undefined, todayIso: string): PregnancyContext {
  if (term === undefined) return { ...UNKNOWN_PREGNANCY };
  try {
    const { weeksMin, weeksMax, precision } = termDisplay(term, todayIso);
    return { weeksMin, weeksMax, precision };
  } catch {
    return { ...UNKNOWN_PREGNANCY };
  }
}

function isAge(weeks: number | undefined): weeks is number {
  return weeks !== undefined && Number.isFinite(weeks) && weeks >= 0;
}

/**
 * Weeks an age given on `givenOn` has moved on by; 0 when none was recorded,
 * when it cannot be read or when it is after today: the younger age is the
 * safer reading, it keeps every age-bounded rule.
 */
function ageMovedOn(givenOn: string | undefined, todayIso: string): number {
  if (givenOn === undefined) return 0;
  try {
    return weeksSince(givenOn, todayIso);
  } catch {
    return 0;
  }
}

/**
 * Whole weeks from the birth date when it can be read, else the stored age
 * moved on since the day it was given; undefined when neither holds.
 */
function babyAgeWeeksOf(profile: Profile, todayIso: string): number | undefined {
  if (profile.babyBirthDate !== undefined) {
    try {
      const weeks = wholeWeeksBetween(profile.babyBirthDate, todayIso);
      if (weeks >= 0) return weeks;
    } catch {
      // Not a date: try the stored age.
    }
  }
  if (!isAge(profile.babyAgeWeeks)) return undefined;
  return profile.babyAgeWeeks + ageMovedOn(profile.babyAgeGivenOn, todayIso);
}

function breastfeedingOf(profile: Profile, todayIso: string): BreastfeedingContext {
  const breastfeeding: BreastfeedingContext = {};
  const babyAgeWeeks = babyAgeWeeksOf(profile, todayIso);
  if (babyAgeWeeks !== undefined) breastfeeding.babyAgeWeeks = babyAgeWeeks;
  // null is "je ne sais pas": left out, so a rule on prematurity still applies.
  if (typeof profile.premature === 'boolean') breastfeeding.premature = profile.premature;
  return breastfeeding;
}

function keyOf(item: CheckedItem): string | undefined {
  const { ref } = item;
  return ref.kind === 'unrecognised' ? undefined : `${ref.kind}:${ref.id}`;
}

function refName(item: CheckedItem): string {
  return item.ref.kind === 'unrecognised' ? item.ref.text : item.ref.id;
}

function checkUnits(item: CheckedItem): void {
  const units = item.unitsPerDay;
  if (units !== undefined && !(Number.isFinite(units) && units > 0)) {
    throw new RangeError(
      `Units per day of ${refName(item)} must be a finite number greater than 0: ${String(units)}`,
    );
  }
}

/**
 * The checked items in their order (so a finding's item index below their
 * count is the index in the check), then each long-term item flagged
 * longTerm. A long-term product or plant already listed is not added twice
 * (the engine would read two items of one substance as a duplicate): the item
 * already there is flagged longTerm and keeps the larger of the two units per
 * day (the safer count for a maximum dose).
 */
function itemsOf(checked: readonly CheckedItem[], longTerm: readonly CheckedItem[]): CheckedItem[] {
  // Every count is checked before any is compared or kept.
  checked.forEach(checkUnits);
  longTerm.forEach(checkUnits);
  const items = checked.map((item) => ({ ...item, ref: { ...item.ref } }));
  const byKey = new Map<string, CheckedItem>();
  for (const item of items) {
    const key = keyOf(item);
    if (key !== undefined && !byKey.has(key)) byKey.set(key, item);
  }
  for (const item of longTerm) {
    const key = keyOf(item);
    const present = key === undefined ? undefined : byKey.get(key);
    if (present) {
      present.longTerm = true;
      if (item.unitsPerDay !== undefined) {
        present.unitsPerDay = Math.max(present.unitsPerDay ?? 0, item.unitsPerDay);
      }
      continue;
    }
    const added: CheckedItem = { ...item, ref: { ...item.ref }, longTerm: true };
    items.push(added);
    if (key !== undefined) byKey.set(key, added);
  }
  return items;
}

/**
 * The engine context for a check: a pregnancy only when the profile is
 * pregnant, breastfeeding only when it breastfeeds, the profile's conditions,
 * the checked items then the long-term ones, and the danger signs of the check.
 * Throws a RangeError for a unit count the engine would refuse (the check
 * screen validates them; dropping one could hide a maximum-dose excess).
 */
export function contextFromProfile(
  profile: Profile,
  check: { items: CheckedItem[]; signs: string[] },
  todayIso: string,
): EvaluationContext {
  const context: EvaluationContext = {
    conditions: [...new Set(profile.conditions)],
    items: itemsOf(check.items, profile.longTermItems),
    signs: [...check.signs],
  };
  if (profile.pregnant) context.pregnancy = pregnancyOf(profile.term, todayIso);
  if (profile.breastfeeding) context.breastfeeding = breastfeedingOf(profile, todayIso);
  return context;
}
