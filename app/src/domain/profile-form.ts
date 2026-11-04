// SPDX-License-Identifier: MIT
// The profile screen's answers as typed, their validation, and the profile
// they make. Pure: today and now are parameters, read from the phone's clock
// by the screen.
import { rangeFromMonths, weeksFromLmp, type ConditionId } from '@siapso/engine';
import type { MessageKey } from '../i18n/translate.js';
import { daysBetween, isIsoDate, weeksSince, wholeWeeksBetween } from './dates.js';
import { MAX_GIVEN_WEEKS, monthRange, termDisplay } from './term.js';
import type { Mode, Profile, TermInput } from './types.js';

export type BabyAgeKind = 'birthDate' | 'weeks' | 'months';
export type PrematureAnswer = 'yes' | 'no' | 'unknown';

/** A stored term in weeks or months, given back exactly as stored. */
export type KeptTerm =
  | { kind: 'weeks'; weeks: number; givenOn: string }
  | { kind: 'months'; months: number; givenOn: string };

/** A stored baby age: weeks for the engine, the months when it was given in months. */
export interface KeptBabyAge {
  weeks: number;
  givenOn: string;
  months?: number;
}

/** The screen's answers, numbers and dates as typed; null is "not answered yet". */
export interface ProfileForm {
  pseudonym: string;
  pregnant: boolean | null;
  termKind: TermInput['kind'] | null;
  lmpDate: string;
  weeks: string;
  months: string;
  /**
   * The stored weeks or months term, saved back exactly while its field is not
   * typed in. The field shows the value reached today; saving that as given
   * today would drop the days past the last whole week at every save, and the
   * term would fall behind. The screen clears it when the field is typed in.
   */
  keptTerm: KeptTerm | null;
  breastfeeding: boolean | null;
  babyAgeKind: BabyAgeKind | null;
  babyBirthDate: string;
  babyWeeks: string;
  babyMonths: string;
  /** The stored age in weeks or months, kept the same way as `keptTerm`. */
  keptBabyAge: KeptBabyAge | null;
  premature: PrematureAnswer | null;
  /** Every situation ticked, those the mode does not show included (never lost on save). */
  conditions: ConditionId[];
  /** "None of these situations": an explicit answer, so a forgotten situation is never read as none. */
  noCondition: boolean;
}

/** Fields that can carry an error, in the order of the screen. */
export const FIELD_ORDER = [
  'pseudonym',
  'pregnant',
  'termKind',
  'lmpDate',
  'weeks',
  'months',
  'breastfeeding',
  'babyAgeKind',
  'babyBirthDate',
  'babyWeeks',
  'babyMonths',
  'premature',
  'conditions',
] as const;

export type FieldName = (typeof FIELD_ORDER)[number];

/** The error of each field that has one, in the order of the screen. */
export type FormErrors = Partial<Record<FieldName, MessageKey>>;

const WOMAN_CONDITIONS: readonly ConditionId[] = [
  'hiv-cotrimoxazole',
  'tuberculosis-treatment',
  'epilepsy-treatment',
  'uterine-scar',
];

/** Every situation, in the order of the screen; the last three in accompanied mode only. */
const ALL_CONDITIONS: readonly ConditionId[] = [
  ...WOMAN_CONDITIONS,
  'renal-failure',
  'hepatic-failure',
  'sickle-cell',
];

const MAX_BABY_WEEKS = 104;
const MAX_BABY_MONTHS = 24;
const LAST_MONTH = 9;
/** Weeks in a month for a baby's age given in months, rounded down after multiplying. */
const WEEKS_PER_MONTH = 4.345;
/** Six digits or more in a pseudonym look like a phone number. */
const PHONE_DIGITS = 6;

/** The situations the screen shows in this mode. */
export function conditionsShown(mode: Mode): readonly ConditionId[] {
  return mode === 'accompanied' ? ALL_CONDITIONS : WOMAN_CONDITIONS;
}

/** A whole number written with digits only (spaces around allowed), or undefined. */
function wholeNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return /^\d{1,3}$/.test(trimmed) ? Number(trimmed) : undefined;
}

function inRange(text: string, min: number, max: number): number | undefined {
  const value = wholeNumber(text);
  return value !== undefined && value >= min && value <= max ? value : undefined;
}

/** Weeks since `givenOn`, or undefined when it cannot be read or is after today. */
function sinceOrUndefined(givenOn: string, todayIso: string): number | undefined {
  try {
    return weeksSince(givenOn, todayIso);
  } catch {
    return undefined;
  }
}

/** The month in progress at a given week: the last month whose first week has come. */
function monthAt(weeks: number): number {
  let month = 1;
  while (month < LAST_MONTH && rangeFromMonths(month + 1).weeksMin <= weeks) month += 1;
  return month;
}

/** The kept term when it is of the kind chosen; one of the other kind does not answer for it. */
function keptTermFor(form: ProfileForm): KeptTerm | null {
  return form.keptTerm?.kind === form.termKind ? form.keptTerm : null;
}

/** The kept age when it was given the way chosen (weeks, or months). */
function keptBabyAgeFor(form: ProfileForm): KeptBabyAge | null {
  const kept = form.keptBabyAge;
  if (kept === null) return null;
  if (form.babyAgeKind === 'weeks' && kept.months === undefined) return kept;
  if (form.babyAgeKind === 'months' && kept.months !== undefined) return kept;
  return null;
}

/** A kept age's weeks today (as stored when its day cannot be read: the younger age). */
function keptAgeToday(kept: KeptBabyAge, todayIso: string): number {
  return kept.weeks + (sinceOrUndefined(kept.givenOn, todayIso) ?? 0);
}

export function emptyForm(pseudonym: string): ProfileForm {
  return {
    pseudonym,
    pregnant: null,
    termKind: null,
    lmpDate: '',
    weeks: '',
    months: '',
    keptTerm: null,
    breastfeeding: null,
    babyAgeKind: null,
    babyBirthDate: '',
    babyWeeks: '',
    babyMonths: '',
    keptBabyAge: null,
    premature: null,
    conditions: [],
    noCondition: false,
  };
}

/**
 * The term being entered, or undefined while its field cannot be read: the
 * kept term exactly while its field is not typed in, else what is typed,
 * weeks and months dated today.
 */
export function termFromForm(form: ProfileForm, todayIso: string): TermInput | undefined {
  const kept = keptTermFor(form);
  if (kept) return { ...kept };
  switch (form.termKind) {
    case 'lmp':
      return isIsoDate(form.lmpDate) ? { kind: 'lmp', date: form.lmpDate } : undefined;
    case 'weeks': {
      const weeks = wholeNumber(form.weeks);
      return weeks === undefined ? undefined : { kind: 'weeks', weeks, givenOn: todayIso };
    }
    case 'months': {
      const months = wholeNumber(form.months);
      return months === undefined ? undefined : { kind: 'months', months, givenOn: todayIso };
    }
    case 'unknown':
      return { kind: 'unknown' };
    case null:
      return undefined;
  }
}

function dateError(
  date: string,
  todayIso: string,
  tooOld: (date: string) => boolean,
  tooOldKey: MessageKey,
): MessageKey | undefined {
  if (!isIsoDate(date)) return 'profile.error.date';
  if (daysBetween(date, todayIso) < 0) return 'profile.error.dateFuture';
  return tooOld(date) ? tooOldKey : undefined;
}

function lmpTooOld(todayIso: string) {
  return (date: string) => {
    try {
      weeksFromLmp(date, todayIso);
      return false;
    } catch {
      return true;
    }
  };
}

function termErrors(form: ProfileForm, todayIso: string): FormErrors {
  const kept = keptTermFor(form);
  switch (form.termKind) {
    case null:
      return { termKind: 'profile.error.choose' };
    case 'lmp': {
      const error = dateError(
        form.lmpDate,
        todayIso,
        lmpTooOld(todayIso),
        'profile.error.lmpTooOld',
      );
      return error ? { lmpDate: error } : {};
    }
    case 'weeks': {
      if (kept?.kind === 'weeks') {
        // Weeks given earlier, now past 42: the term must be given again today.
        const since = sinceOrUndefined(kept.givenOn, todayIso);
        const today = since === undefined ? undefined : kept.weeks + since;
        return today === undefined || today > MAX_GIVEN_WEEKS
          ? { weeks: 'profile.error.weeksMovedOn' }
          : {};
      }
      return inRange(form.weeks, 0, MAX_GIVEN_WEEKS) === undefined
        ? { weeks: 'profile.error.weeks' }
        : {};
    }
    case 'months': {
      if (kept) {
        // A month given long ago may now be past any term: ask for today's month.
        try {
          termDisplay(kept, todayIso);
          return {};
        } catch {
          return { months: 'profile.error.monthsOutdated' };
        }
      }
      return inRange(form.months, 1, LAST_MONTH) === undefined
        ? { months: 'profile.error.months' }
        : {};
    }
    case 'unknown':
      return {};
  }
}

function babyErrors(form: ProfileForm, todayIso: string): FormErrors {
  const errors: FormErrors = {};
  const kept = keptBabyAgeFor(form);
  const movedPast = kept !== null && keptAgeToday(kept, todayIso) > MAX_BABY_WEEKS;
  switch (form.babyAgeKind) {
    case null:
      errors.babyAgeKind = 'profile.error.choose';
      break;
    case 'birthDate': {
      const tooOld = (date: string) => wholeWeeksBetween(date, todayIso) > MAX_BABY_WEEKS;
      const error = dateError(form.babyBirthDate, todayIso, tooOld, 'profile.error.birthTooOld');
      if (error) errors.babyBirthDate = error;
      break;
    }
    case 'weeks':
      if (movedPast) errors.babyWeeks = 'profile.error.babyAgeMovedOn';
      else if (!kept && inRange(form.babyWeeks, 0, MAX_BABY_WEEKS) === undefined) {
        errors.babyWeeks = 'profile.error.babyWeeks';
      }
      break;
    case 'months':
      if (movedPast) errors.babyMonths = 'profile.error.babyAgeMovedOn';
      else if (!kept && inRange(form.babyMonths, 0, MAX_BABY_MONTHS) === undefined) {
        errors.babyMonths = 'profile.error.babyMonths';
      }
      break;
  }
  if (form.premature === null) errors.premature = 'profile.error.choose';
  return errors;
}

/** Each field's error, in the order of the screen; empty when the profile can be saved. */
export function validateForm(form: ProfileForm, todayIso: string, mode: Mode): FormErrors {
  const errors: FormErrors = {};
  const pseudonym = form.pseudonym.trim();
  if (pseudonym === '') errors.pseudonym = 'profile.error.pseudonym';
  else if ((pseudonym.match(/\d/g) ?? []).length >= PHONE_DIGITS) {
    errors.pseudonym = 'profile.error.pseudonymNumber';
  }
  if (form.pregnant === null) errors.pregnant = 'profile.error.yesNo';
  else if (form.pregnant) Object.assign(errors, termErrors(form, todayIso));
  if (form.breastfeeding === null) errors.breastfeeding = 'profile.error.yesNo';
  else if (form.breastfeeding) Object.assign(errors, babyErrors(form, todayIso));
  // Neither: the engine would get no pregnancy and no breastfeeding at all, so
  // one mis-tap on the neighbouring "Non" would drop every pregnancy rule.
  else if (form.pregnant === false) errors.breastfeeding = 'profile.error.neither';
  const shown = conditionsShown(mode);
  if (!form.noCondition && !form.conditions.some((c) => shown.includes(c))) {
    errors.conditions = 'profile.error.situations';
  }
  const ordered: FormErrors = {};
  for (const field of FIELD_ORDER) {
    const error = errors[field];
    if (error) ordered[field] = error;
  }
  return ordered;
}

/**
 * The baby's age in whole weeks today (a birth date, the kept age moved on,
 * typed weeks, or typed months x 4.345 rounded down), or undefined while it
 * cannot be read or is past 104 weeks.
 */
export function babyAgeFromForm(form: ProfileForm, todayIso: string): number | undefined {
  const kept = keptBabyAgeFor(form);
  if (kept) {
    const weeks = keptAgeToday(kept, todayIso);
    return weeks <= MAX_BABY_WEEKS ? weeks : undefined;
  }
  switch (form.babyAgeKind) {
    case 'birthDate': {
      if (!isIsoDate(form.babyBirthDate)) return undefined;
      const weeks = wholeWeeksBetween(form.babyBirthDate, todayIso);
      return weeks >= 0 && weeks <= MAX_BABY_WEEKS ? weeks : undefined;
    }
    case 'weeks':
      return inRange(form.babyWeeks, 0, MAX_BABY_WEEKS);
    case 'months': {
      const months = inRange(form.babyMonths, 0, MAX_BABY_MONTHS);
      return months === undefined ? undefined : Math.floor(months * WEEKS_PER_MONTH);
    }
    case null:
      return undefined;
  }
}

type BabyFields = Pick<
  Profile,
  'babyBirthDate' | 'babyAgeWeeks' | 'babyAgeGivenOn' | 'babyAgeMonths' | 'premature'
>;

function babyOf(form: ProfileForm, todayIso: string): BabyFields {
  const premature = form.premature === 'unknown' ? null : form.premature === 'yes';
  if (form.babyAgeKind === 'birthDate') return { babyBirthDate: form.babyBirthDate, premature };
  const kept = keptBabyAgeFor(form);
  if (kept) {
    // Saved back as stored, so the age keeps moving on from the day it was given.
    return {
      babyAgeWeeks: kept.weeks,
      babyAgeGivenOn: kept.givenOn,
      ...(kept.months === undefined ? {} : { babyAgeMonths: kept.months }),
      premature,
    };
  }
  if (form.babyAgeKind === 'months') {
    const months = inRange(form.babyMonths, 0, MAX_BABY_MONTHS);
    if (months === undefined) return { premature };
    return {
      babyAgeWeeks: Math.floor(months * WEEKS_PER_MONTH),
      babyAgeMonths: months,
      babyAgeGivenOn: todayIso,
      premature,
    };
  }
  const weeks = inRange(form.babyWeeks, 0, MAX_BABY_WEEKS);
  // Dated, so the age moves on (a frozen age would keep rules for younger babies).
  return weeks === undefined
    ? { premature }
    : { babyAgeWeeks: weeks, babyAgeGivenOn: todayIso, premature };
}

/**
 * The profile a valid form makes (validate it first). An edited profile keeps
 * its id, creation date and long-term items; `id` names a new one.
 */
export function profileFromForm(
  form: ProfileForm,
  { base, id, nowIso, todayIso }: { base?: Profile; id: string; nowIso: string; todayIso: string },
): Profile {
  const term = form.pregnant ? termFromForm(form, todayIso) : undefined;
  return {
    id: base?.id ?? id,
    pseudonym: form.pseudonym.trim(),
    pregnant: form.pregnant === true,
    ...(term ? { term } : {}),
    breastfeeding: form.breastfeeding === true,
    ...(form.breastfeeding ? babyOf(form, todayIso) : {}),
    conditions: ALL_CONDITIONS.filter((c) => form.conditions.includes(c)),
    longTermItems: base ? [...base.longTermItems] : [],
    createdAt: base?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

/**
 * A stored term as the screen shows it today: weeks reached today, or the
 * month in progress today, with the stored term kept. A term whose day cannot
 * be read (or none was recorded) shows as given, kept nothing: saving it
 * dates it today.
 */
function termFields(term: TermInput | undefined, todayIso: string): Partial<ProfileForm> {
  switch (term?.kind) {
    case undefined:
      return {};
    case 'lmp':
      return { termKind: 'lmp', lmpDate: term.date };
    case 'weeks': {
      const since =
        term.givenOn === undefined ? undefined : sinceOrUndefined(term.givenOn, todayIso);
      if (since === undefined || term.givenOn === undefined) {
        return { termKind: 'weeks', weeks: String(term.weeks) };
      }
      return {
        termKind: 'weeks',
        weeks: String(term.weeks + since),
        keptTerm: { kind: 'weeks', weeks: term.weeks, givenOn: term.givenOn },
      };
    }
    case 'months': {
      const since =
        term.givenOn === undefined ? undefined : sinceOrUndefined(term.givenOn, todayIso);
      if (since === undefined || term.givenOn === undefined) {
        return { termKind: 'months', months: String(term.months) };
      }
      // The month in progress today, where the term read back starts.
      const shown = monthAt(monthRange(term.months).weeksMin + since);
      return {
        termKind: 'months',
        months: String(shown),
        keptTerm: { kind: 'months', months: term.months, givenOn: term.givenOn },
      };
    }
    case 'unknown':
      return { termKind: 'unknown' };
  }
}

function babyFields(profile: Profile, todayIso: string): Partial<ProfileForm> {
  let premature: PrematureAnswer | null = null;
  if (profile.premature === null) premature = 'unknown';
  else if (profile.premature !== undefined) premature = profile.premature ? 'yes' : 'no';
  if (profile.babyBirthDate !== undefined) {
    return { babyAgeKind: 'birthDate', babyBirthDate: profile.babyBirthDate, premature };
  }
  const { babyAgeWeeks: weeks, babyAgeMonths: months, babyAgeGivenOn: givenOn } = profile;
  if (weeks === undefined) return { premature };
  const since = givenOn === undefined ? undefined : sinceOrUndefined(givenOn, todayIso);
  const kept: KeptBabyAge | null =
    since === undefined || givenOn === undefined
      ? null
      : { weeks, givenOn, ...(months === undefined ? {} : { months }) };
  if (months !== undefined) {
    const shown = months + Math.floor((since ?? 0) / WEEKS_PER_MONTH);
    return { babyAgeKind: 'months', babyMonths: String(shown), keptBabyAge: kept, premature };
  }
  return {
    babyAgeKind: 'weeks',
    babyWeeks: String(weeks + (since ?? 0)),
    keptBabyAge: kept,
    premature,
  };
}

/** The answers of a saved profile, as the screen shows them today. */
export function formFromProfile(profile: Profile, todayIso: string, mode: Mode): ProfileForm {
  const shown = conditionsShown(mode);
  return {
    ...emptyForm(profile.pseudonym),
    pregnant: profile.pregnant,
    ...(profile.pregnant ? termFields(profile.term, todayIso) : {}),
    breastfeeding: profile.breastfeeding,
    ...(profile.breastfeeding ? babyFields(profile, todayIso) : {}),
    conditions: [...profile.conditions],
    noCondition: !profile.conditions.some((c) => shown.includes(c)),
  };
}
