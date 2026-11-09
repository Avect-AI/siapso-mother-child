// SPDX-License-Identifier: MIT
// The evaluation context the engine reads, built from a profile and the
// current check. Pure: today is a parameter. The engine refuses invalid
// numbers with a RangeError; this mapping never hands it one. A value that
// cannot be read (an age, a term given after today on a clock set back)
// becomes "unknown", which the engine treats as the riskier case: every
// pregnancy window, every age-bounded rule. It never lowers a level. An
// outdated pregnancy (past 42 weeks: the baby may be born) is refused: the
// profile is updated first.
import type {
  BreastfeedingContext,
  CheckedItem,
  EvaluationContext,
  PregnancyContext,
} from '@siapso/engine';
import { weeksSince, wholeWeeksBetween } from './dates.js';
import { babyMayBeBorn, profileTermStatus } from './term.js';
import type { Profile } from './types.js';

/** The profile's term is outdated: it is updated before any result (screens show the step). */
export class OutdatedTermError extends RangeError {
  constructor() {
    super('The pregnancy term of this profile is outdated: update the profile first');
    this.name = 'OutdatedTermError';
  }
}

/**
 * The pregnancy of the profile today (undefined when not pregnant), and
 * whether the baby may be born (babyMayBeBorn: a possibly past term, a phone
 * clock set back; breastfeeding is then read as possible too).
 */
function pregnancyOf(
  profile: Profile,
  todayIso: string,
  notBefore: string | undefined,
): { pregnancy: PregnancyContext | undefined; mayBeBorn: boolean } {
  const status = profileTermStatus(profile, todayIso, notBefore);
  if (status.status === 'not-pregnant') return { pregnancy: undefined, mayBeBorn: false };
  if (status.status === 'outdated') throw new OutdatedTermError();
  const { weeksMin, weeksMax, precision } = status.term;
  return {
    pregnancy: { weeksMin, weeksMax, precision },
    mayBeBorn: babyMayBeBorn(status),
  };
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
 * moved on since the day it was given; undefined when neither holds, and for
 * an age answered "Je ne sais pas".
 */
export function babyAgeWeeksOf(profile: Profile, todayIso: string): number | undefined {
  if (profile.babyAgeUnknown === true) return undefined;
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

/** A product or plant, with the dose range said: two boxes read two ways are two items. */
function keyOf(item: CheckedItem): string | undefined {
  const { ref } = item;
  if (ref.kind === 'unrecognised') return undefined;
  const range = item.strengthAtMostMg === undefined ? '' : `@${String(item.strengthAtMostMg)}`;
  return `${ref.kind}:${ref.id}${range}`;
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
 * day (the safer count for a maximum dose). A box read in another dose range
 * (CheckedItem.strengthAtMostMg), or in none, is another item: each is read
 * as it was said.
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
 * When the baby may be born (possibly past term), the term is held at 42
 * weeks and breastfeeding is added with no age and no prematurity, so every
 * breastfeeding rule applies. `notBefore` is a day the app has already seen
 * (the knowledge pack's date, the last result kept): a phone date before it
 * reads the term as unknown and, the real date being later, breastfeeding
 * as possible too. Throws a RangeError for a unit count the engine
 * would refuse (the check screen validates them; dropping one could hide a
 * maximum-dose excess), and an OutdatedTermError for an outdated pregnancy
 * (profileTermStatus): no result is ever worked out on it.
 */
export function contextFromProfile(
  profile: Profile,
  check: { items: CheckedItem[]; signs: string[] },
  todayIso: string,
  notBefore?: string,
): EvaluationContext {
  const context: EvaluationContext = {
    conditions: [...new Set(profile.conditions)],
    items: itemsOf(check.items, profile.longTermItems),
    signs: [...check.signs],
  };
  const { pregnancy, mayBeBorn } = pregnancyOf(profile, todayIso, notBefore);
  if (pregnancy) context.pregnancy = pregnancy;
  // A baby that may be born is of unknown age: the youngest, riskiest reading.
  if (mayBeBorn) context.breastfeeding = {};
  else if (profile.breastfeeding) context.breastfeeding = breastfeedingOf(profile, todayIso);
  return context;
}
