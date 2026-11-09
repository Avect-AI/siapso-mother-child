// SPDX-License-Identifier: MIT
// The profile screen's answers as typed, their validation, and the profile
// they make. Pure: today and now are parameters, read from the phone's clock
// by the screen.
import { findForbiddenWording, rangeFromMonths, type ConditionId } from '@siapso/engine';
import type { MessageKey } from '../i18n/translate.js';
import { daysBetween, isIsoDate, weeksSince, wholeWeeksBetween } from './dates.js';
import { localDateOf, MAX_GIVEN_WEEKS, monthRange, pastTermToday, readTerm } from './term.js';
import type { Mode, Profile, TermInput } from './types.js';

export type BabyAgeKind = 'birthDate' | 'weeks' | 'months' | 'unknown';
export type PrematureAnswer = 'yes' | 'no' | 'unknown';
/** "Enceinte ?": yes, no, or "Je ne sais pas" (read as a pregnancy of unknown term). */
export type PregnantAnswer = 'yes' | 'no' | 'unknown';

/**
 * A stored term given back exactly as stored while it is not answered again:
 * a month (its field shows the month reached today), "Je ne sais pas" (with
 * the day it was said), or past 42 weeks and still pregnant (with its day).
 */
export type KeptTerm =
  | { kind: 'months'; months: number; givenOn: string }
  | { kind: 'unknown'; givenOn: string }
  | { kind: 'post-term'; givenOn: string };

/** The day weeks were known: today, or another day (an ultrasound, a booklet). */
export type WeeksDay = 'today' | 'other';

/** A stored baby age: weeks for the engine, the months when it was given in months. */
export interface KeptBabyAge {
  weeks: number;
  givenOn: string;
  months?: number;
}

/** The screen's answers, numbers and dates as typed; null is "not answered yet". */
export interface ProfileForm {
  pseudonym: string;
  pregnant: PregnantAnswer | null;
  /** The day a stored "Je ne sais pas" to "Enceinte ?" was said, kept while not answered again. */
  keptUnsureOn: string | null;
  termKind: TermInput['kind'] | null;
  lmpDate: string;
  weeks: string;
  /**
   * When the weeks were known: today, or another day (weeksGivenOn). Typing a
   * new number clears it, so the day is always answered for that number.
   */
  weeksDay: WeeksDay | null;
  /** The other day the weeks were known, as typed (YYYY-MM-DD). */
  weeksGivenOn: string;
  months: string;
  /**
   * The stored months term, saved back exactly while its field is not typed
   * in. The field shows the month reached today; saving that as given today
   * would drop the days past the last whole week at every save, and the term
   * would fall behind. The screen clears it when the field is typed in. An
   * unknown term keeps the day it was said the same way. Weeks need none:
   * their field and day show them as given.
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
  'weeksDay',
  'weeksGivenOn',
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

/** The longest pseudonym: a longer one is refused with this limit, never cut. */
export const PSEUDONYM_MAX = 40;

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
export const WEEKS_PER_MONTH = 4.345;
/** Six digits or more in a pseudonym look like a phone number. */
const PHONE_DIGITS = 6;

/** The situations the screen shows in this mode. */
export function conditionsShown(mode: Mode): readonly ConditionId[] {
  return mode === 'accompanied' ? ALL_CONDITIONS : WOMAN_CONDITIONS;
}

/** Situations that say HIV: a secret on a shared phone, hidden on screen until an explicit tap. */
const CONCEALED_CONDITIONS: readonly ConditionId[] = ['hiv-cotrimoxazole'];

/** Whether a situation is shown only after an explicit tap (the profile, the result). */
export function isConcealedCondition(condition: ConditionId): boolean {
  return CONCEALED_CONDITIONS.includes(condition);
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

/**
 * A pseudonym as compared with the others of the phone: without case,
 * accents, or spaces around and doubled ("Àwa  Diop " is "awa diop").
 */
export function pseudonymKey(pseudonym: string): string {
  return pseudonym
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
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

/** The kept term while its kind is chosen; it does not answer for another kind. */
function keptTermFor(form: ProfileForm): KeptTerm | null {
  return form.keptTerm !== null && form.keptTerm.kind === form.termKind ? form.keptTerm : null;
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

/**
 * A new profile: the pseudonym given, nothing answered. `weeksDay` is the
 * default day of weeks typed: "today" only for a new profile of her own in
 * woman mode; otherwise it is asked.
 */
export function emptyForm(
  pseudonym: string,
  _todayIso: string,
  weeksDay: WeeksDay | null = null,
): ProfileForm {
  return {
    pseudonym,
    pregnant: null,
    keptUnsureOn: null,
    termKind: null,
    lmpDate: '',
    weeks: '',
    weeksDay,
    weeksGivenOn: '',
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

/** The day the weeks typed were known, or undefined while it is not answered or cannot be read. */
function weeksGivenOn(form: ProfileForm, todayIso: string): string | undefined {
  if (form.weeksDay === 'today') return todayIso;
  if (form.weeksDay === 'other' && isIsoDate(form.weeksGivenOn)) return form.weeksGivenOn;
  return undefined;
}

/**
 * The term being entered, or undefined while its fields cannot be read: the
 * kept month (or unknown term) exactly while it is not answered again, else
 * what is typed; weeks with the day they were known, months and an unknown
 * term dated today.
 */
export function termFromForm(form: ProfileForm, todayIso: string): TermInput | undefined {
  const kept = keptTermFor(form);
  if (kept) return { ...kept };
  // Still pregnant past 42 weeks (a last period, or weeks given long ago): read
  // as 42 weeks and over from today, never as an unknown term.
  const pastTerm = (term: Extract<TermInput, { kind: 'lmp' | 'weeks' }>): TermInput =>
    pastTermToday(term, todayIso) === 'post-term' ? { kind: 'post-term', givenOn: todayIso } : term;
  switch (form.termKind) {
    case 'lmp':
      return isIsoDate(form.lmpDate) ? pastTerm({ kind: 'lmp', date: form.lmpDate }) : undefined;
    case 'weeks': {
      const weeks = wholeNumber(form.weeks);
      const givenOn = weeksGivenOn(form, todayIso);
      if (weeks === undefined || givenOn === undefined) return undefined;
      return pastTerm({ kind: 'weeks', weeks, givenOn });
    }
    case 'months': {
      const months = wholeNumber(form.months);
      return months === undefined ? undefined : { kind: 'months', months, givenOn: todayIso };
    }
    case 'unknown':
      return { kind: 'unknown', givenOn: todayIso };
    case 'post-term':
      return { kind: 'post-term', givenOn: todayIso };
    case null:
      return undefined;
  }
}

/**
 * A new weeks number typed. It no longer goes with the day answered for the
 * old one: the day is asked again (`asksDay`: accompanied mode, or her own
 * profile being edited); a new profile of her own keeps its default, today.
 */
export function typedWeeks(form: ProfileForm, weeks: string, asksDay: boolean): ProfileForm {
  return asksDay ? { ...form, weeks, weeksDay: null, weeksGivenOn: '' } : { ...form, weeks };
}

/**
 * The weeks as given and their day, when that day is not today, so the
 * screen can say both ("Environ 32 semaines aujourd'hui (26 semaines le
 * 24/09)"); undefined otherwise.
 */
export function weeksReadback(
  form: ProfileForm,
  todayIso: string,
): { weeks: number; givenOn: string } | undefined {
  if (form.termKind !== 'weeks') return undefined;
  const term = termFromForm(form, todayIso);
  if (term?.kind !== 'weeks' || term.givenOn === undefined || term.givenOn === todayIso) {
    return undefined;
  }
  return { weeks: term.weeks, givenOn: term.givenOn };
}

/**
 * Month 8 or 9 given: near term a month is a wide range (36 to 42 weeks for
 * month 9), so the screen suggests weeks or the date of the last period.
 */
export function monthsNearTerm(form: ProfileForm): boolean {
  if (form.termKind !== 'months') return false;
  const months = wholeNumber(form.months);
  return months === 8 || months === LAST_MONTH;
}

/**
 * The last month a woman past term may count (lunar months, or overdue): 10
 * to 12 typed as months is never read as weeks, it is asked about.
 */
const LAST_PAST_TERM_MONTH = 12;

/** The number typed as months when it looks like weeks (13 to 42); undefined otherwise. */
function monthsAsWeeksValue(form: ProfileForm): number | undefined {
  if (form.termKind !== 'months') return undefined;
  return inRange(form.months, LAST_PAST_TERM_MONTH + 1, MAX_GIVEN_WEEKS);
}

/** Whether the number typed as months looks like weeks: a whole number from 13 to 42. */
export function monthsLookLikeWeeks(form: ProfileForm): boolean {
  return monthsAsWeeksValue(form) !== undefined;
}

/**
 * Whether 10 to 12 is typed as months: past 9 months (she counts lunar months,
 * or she is overdue), or weeks typed in the wrong field. Never converted in one
 * tap: the screen asks "Elle a dépassé 9 mois ?".
 */
export function monthsPastNine(form: ProfileForm): boolean {
  if (form.termKind !== 'months' || keptTermFor(form) !== null) return false;
  return inRange(form.months, LAST_MONTH + 1, LAST_PAST_TERM_MONTH) !== undefined;
}

/**
 * The answer to "Elle a dépassé 9 mois ?": yes reads the term as past 42
 * weeks, from today; no opens the weeks field empty, to be typed by hand (its
 * day asked when `asksDay`).
 */
export function answerPastNine(form: ProfileForm, past: boolean, asksDay: boolean): ProfileForm {
  if (past) return postTermForm(form);
  return {
    ...form,
    ...noTermValues(),
    termKind: 'weeks',
    weeksDay: asksDay ? null : 'today',
  };
}

/** The term given in weeks instead, with the number typed as months, known today. */
export function monthsAsWeeks(form: ProfileForm): ProfileForm {
  const weeks = monthsAsWeeksValue(form);
  if (weeks === undefined) return form;
  return {
    ...form,
    termKind: 'weeks',
    weeks: String(weeks),
    // The month was said for today: so are the weeks it becomes.
    weeksDay: 'today',
    weeksGivenOn: '',
    months: '',
    keptTerm: null,
  };
}

/**
 * What is wrong with a date typed: not a date, after today (the phone's date,
 * which seems wrong when a day the app has seen, `seen`, is later still), or
 * too old for the question.
 */
function dateError(
  date: string,
  todayIso: string,
  tooOld: (date: string) => boolean,
  tooOldKey: MessageKey,
  seen?: string,
): MessageKey | undefined {
  if (!isIsoDate(date)) return 'profile.error.date';
  if (daysBetween(date, todayIso) < 0) {
    const clockBehind = seen !== undefined && isIsoDate(seen) && daysBetween(seen, todayIso) < 0;
    return clockBehind ? 'profile.error.phoneDate' : 'profile.error.dateFuture';
  }
  return tooOld(date) ? tooOldKey : undefined;
}

function termErrors(form: ProfileForm, todayIso: string, seen?: string): FormErrors {
  switch (form.termKind) {
    case null:
      return { termKind: 'profile.error.choose' };
    case 'lmp': {
      // Past 42 weeks is a pregnancy past term (accepted); 45 weeks or more, a date to look at.
      const tooOld = (date: string) =>
        pastTermToday({ kind: 'lmp', date }, todayIso) === 'too-long';
      const error = dateError(form.lmpDate, todayIso, tooOld, 'profile.error.lmpTooOld', seen);
      return error ? { lmpDate: error } : {};
    }
    case 'weeks': {
      const weeks = inRange(form.weeks, 0, MAX_GIVEN_WEEKS);
      if (weeks === undefined) return { weeks: 'profile.error.weeks' };
      if (form.weeksDay === null) return { weeksDay: 'profile.error.choose' };
      if (form.weeksDay === 'other') {
        const dateProblem = dateError(
          form.weeksGivenOn,
          todayIso,
          () => false,
          'profile.error.date',
          seen,
        );
        if (dateProblem) return { weeksGivenOn: dateProblem };
      }
      const givenOn = weeksGivenOn(form, todayIso);
      // Weeks known so long ago that they would be 45 weeks or more today.
      return givenOn !== undefined &&
        pastTermToday({ kind: 'weeks', weeks, givenOn }, todayIso) === 'too-long'
        ? { weeks: 'profile.error.weeksMovedOn' }
        : {};
    }
    case 'post-term': {
      const kept = keptTermFor(form);
      if (kept === null) return {};
      // Said more than a week ago: the term of today is asked again.
      const status = readTerm(kept, todayIso).status;
      if (status === 'clock') return { termKind: 'profile.error.phoneDate' };
      return status === 'outdated' ? { termKind: 'profile.error.postTermOutdated' } : {};
    }
    case 'months': {
      const kept = keptTermFor(form);
      if (kept) {
        // A month given so long ago that its start is past 42 weeks: ask for
        // today's month. One whose end only may be past term stays (the screens
        // say the baby may be born).
        const status = readTerm(kept, todayIso).status;
        if (status === 'clock') return { months: 'profile.error.clockBehind' };
        return status === 'outdated' ? { months: 'profile.error.monthsOutdated' } : {};
      }
      if (monthsPastNine(form)) return { months: 'profile.error.monthsPastNine' };
      if (monthsLookLikeWeeks(form)) return { months: 'profile.error.monthsLooksLikeWeeks' };
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
    case 'unknown':
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

/**
 * A dose in a pseudonym: a number with a unit ("500 mg", "2 comprimés", "3
 * fois"), or an amount per day. A pseudonym heads a result ("Résultat pour
 * ..."): it must never read as a dose.
 */
const DOSE_IN_NAME =
  /\p{Nd}+(?:[.,]\p{Nd}+)?\s*(?:mg|g|µg|mcg|ml|cl|ui|comprim[eé]s?|g[eé]lules?|gouttes?|cuill[eè]res?|cuiller[eé]es?|sachets?|fois|tablets?|capsules?|drops?|times)(?![\p{L}\p{N}])|\b(?:par|per)\s+(?:jour|day)\b/iu;

/** Whether a pseudonym says a forbidden word ("Sans danger", "safe") or a dose, in either language. */
function misleads(pseudonym: string): boolean {
  if (DOSE_IN_NAME.test(pseudonym)) return true;
  return (['fr', 'en'] as const).some((lang) => findForbiddenWording(pseudonym, lang).length > 0);
}

/** A pseudonym's letters and digits only, compared without case or accents ("Aw a." is "awa"). */
function compactKey(pseudonym: string): string {
  return pseudonymKey(pseudonym).replace(/[^\p{L}\p{N}]/gu, '');
}

/** Whether two texts are one edit apart at most (a letter added, taken off or changed). */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Two words or more that start with a capital, as a first name and a family name do. */
const FULL_NAME = /\p{Lu}\p{Ll}+(?:[\s-]+\p{Lu}\p{Ll}+)+/u;

/**
 * What to say of a pseudonym that can be saved but may mislead: one that is
 * one letter from another on the phone (punctuation and spaces aside), so
 * the list could mix them up; one that looks like a first and family name,
 * when it should never be the real name. Null when nothing is to be said. A
 * numbered series ("Femme 1", "Femme 2") is not a mix-up.
 */
export function pseudonymWarning(
  pseudonym: string,
  taken: readonly string[],
): { key: MessageKey; vars: Record<string, string> } | null {
  const key = compactKey(pseudonym);
  if (key !== '') {
    const numbered = /\p{N}/u.test(key);
    const near = taken.find((other) => {
      const otherKey = compactKey(other);
      if (
        otherKey === '' ||
        (otherKey === key && pseudonymKey(other) === pseudonymKey(pseudonym))
      ) {
        return false;
      }
      // "Femme 1" and "Femme 2": the numbers tell them apart.
      if (numbered && /\p{N}/u.test(otherKey)) return false;
      return oneEditApart(key, otherKey);
    });
    if (near !== undefined) return { key: 'profile.warning.near', vars: { name: near.trim() } };
  }
  return FULL_NAME.test(pseudonym.trim()) ? { key: 'profile.warning.realName', vars: {} } : null;
}

function pseudonymError(pseudonym: string, taken: readonly string[]): MessageKey | undefined {
  const trimmed = pseudonym.trim();
  if (trimmed === '') return 'profile.error.pseudonym';
  if ((trimmed.match(/\d/g) ?? []).length >= PHONE_DIGITS) return 'profile.error.pseudonymNumber';
  if (misleads(trimmed)) return 'profile.error.pseudonymWording';
  // Counted as the input's maxlength counted it before (UTF-16 code units).
  if (trimmed.length > PSEUDONYM_MAX) return 'profile.error.pseudonymLong';
  const key = pseudonymKey(trimmed);
  if (taken.some((other) => pseudonymKey(other) === key)) return 'profile.error.pseudonymTaken';
  return undefined;
}

/**
 * Each field's error, in the order of the screen; empty when the profile can
 * be saved. `taken` are the pseudonyms of the other profiles of the phone: a
 * pseudonym is never used twice, so a list never shows two women alike.
 * `seen` is the latest day the app has seen for this profile (its last save):
 * a date after today is then the phone's date set back, and said so.
 */
export function validateForm(
  form: ProfileForm,
  todayIso: string,
  mode: Mode,
  taken: readonly string[] = [],
  seen?: string,
): FormErrors {
  const errors: FormErrors = {};
  const pseudonym = pseudonymError(form.pseudonym, taken);
  if (pseudonym) errors.pseudonym = pseudonym;
  if (form.pregnant === null) errors.pregnant = 'profile.error.yesNo';
  else if (form.pregnant === 'yes') Object.assign(errors, termErrors(form, todayIso, seen));
  if (form.breastfeeding === null) errors.breastfeeding = 'profile.error.yesNo';
  else if (form.breastfeeding) Object.assign(errors, babyErrors(form, todayIso));
  // Neither: the engine would get no pregnancy and no breastfeeding at all, so
  // one mis-tap on the neighbouring "Non" would drop every pregnancy rule.
  else if (form.pregnant === 'no') errors.breastfeeding = 'profile.error.neither';
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
 * cannot be read, is past 104 weeks, or is not known.
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
    case 'unknown':
    case null:
      return undefined;
  }
}

type BabyFields = Pick<
  Profile,
  | 'babyBirthDate'
  | 'babyAgeWeeks'
  | 'babyAgeGivenOn'
  | 'babyAgeMonths'
  | 'babyAgeUnknown'
  | 'premature'
>;

function babyOf(form: ProfileForm, todayIso: string): BabyFields {
  const premature = form.premature === 'unknown' ? null : form.premature === 'yes';
  if (form.babyAgeKind === 'unknown') return { babyAgeUnknown: true, premature };
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
 * its id, creation date, long-term items and mark (`self`); `id` and `self`
 * (her own profile, made in woman mode) are for a new one. "Je ne sais pas"
 * to the pregnancy is stored pregnant and unsure, with the day it was said
 * and no term.
 */
export function profileFromForm(
  form: ProfileForm,
  {
    base,
    id,
    nowIso,
    todayIso,
    self,
  }: { base?: Profile; id: string; nowIso: string; todayIso: string; self?: boolean },
): Profile {
  const term = form.pregnant === 'yes' ? termFromForm(form, todayIso) : undefined;
  const mark = base === undefined ? self : base.self;
  return {
    id: base?.id ?? id,
    ...(mark === undefined ? {} : { self: mark }),
    pseudonym: form.pseudonym.trim(),
    pregnant: form.pregnant === 'yes' || form.pregnant === 'unknown',
    ...(form.pregnant === 'unknown'
      ? { pregnancyUnsure: true, pregnancyUnsureOn: form.keptUnsureOn ?? todayIso }
      : {}),
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
 * A stored term as the screen shows it today: weeks as given with their day
 * (today, or another day; empty when it cannot be read), the month in
 * progress today with the stored month kept, or an unknown term with the day
 * it was said kept. A term recorded without its day (an older record) is
 * dated by `saved`, the profile's last save. A month whose day cannot be read
 * shows as given, kept nothing: saving it dates it today.
 */
function termFields(
  term: TermInput | undefined,
  todayIso: string,
  saved: string | undefined,
): Partial<ProfileForm> {
  switch (term?.kind) {
    case undefined:
      return {};
    case 'lmp':
      return { termKind: 'lmp', lmpDate: term.date };
    case 'weeks': {
      const givenOn = term.givenOn ?? saved;
      if (givenOn === todayIso)
        return { termKind: 'weeks', weeks: String(term.weeks), weeksDay: 'today' };
      return {
        termKind: 'weeks',
        weeks: String(term.weeks),
        weeksDay: 'other',
        weeksGivenOn: givenOn !== undefined && isIsoDate(givenOn) ? givenOn : '',
      };
    }
    case 'months': {
      const givenOn = term.givenOn ?? saved;
      const since = givenOn === undefined ? undefined : sinceOrUndefined(givenOn, todayIso);
      if (since === undefined || givenOn === undefined) {
        return { termKind: 'months', months: String(term.months) };
      }
      // The month in progress today, where the term read back starts.
      const shown = monthAt(monthRange(term.months).weeksMin + since);
      return {
        termKind: 'months',
        months: String(shown),
        keptTerm: { kind: 'months', months: term.months, givenOn },
      };
    }
    case 'unknown': {
      const givenOn = term.givenOn ?? saved;
      return givenOn === undefined || !isIsoDate(givenOn)
        ? { termKind: 'unknown' }
        : { termKind: 'unknown', keptTerm: { kind: 'unknown', givenOn } };
    }
    case 'post-term': {
      // Kept with its day, so a save never makes it said today.
      const givenOn = term.givenOn ?? saved;
      return givenOn === undefined || !isIsoDate(givenOn)
        ? { termKind: null }
        : { termKind: 'post-term', keptTerm: { kind: 'post-term', givenOn } };
    }
  }
}

function babyFields(profile: Profile, todayIso: string): Partial<ProfileForm> {
  let premature: PrematureAnswer | null = null;
  if (profile.premature === null) premature = 'unknown';
  else if (profile.premature !== undefined) premature = profile.premature ? 'yes' : 'no';
  if (profile.babyAgeUnknown === true) return { babyAgeKind: 'unknown', premature };
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

function pregnantAnswer(profile: Profile): PregnantAnswer {
  if (!profile.pregnant) return 'no';
  return profile.pregnancyUnsure === true ? 'unknown' : 'yes';
}

/** The answers of a saved profile, as the screen shows them today. */
export function formFromProfile(profile: Profile, todayIso: string, mode: Mode): ProfileForm {
  const shown = conditionsShown(mode);
  const pregnant = pregnantAnswer(profile);
  const saved = localDateOf(profile.updatedAt);
  return {
    ...emptyForm(profile.pseudonym, todayIso),
    pregnant,
    keptUnsureOn: pregnant === 'unknown' ? (profile.pregnancyUnsureOn ?? saved ?? null) : null,
    ...(pregnant === 'yes' ? termFields(profile.term, todayIso, saved) : {}),
    breastfeeding: profile.breastfeeding,
    ...(profile.breastfeeding ? babyFields(profile, todayIso) : {}),
    conditions: [...profile.conditions],
    noCondition: !profile.conditions.some((c) => shown.includes(c)),
  };
}

/** The term answers cleared: no value typed, no term kept, the day of weeks to answer. */
function noTermValues(): Partial<ProfileForm> {
  return { lmpDate: '', weeks: '', weeksDay: null, weeksGivenOn: '', months: '', keptTerm: null };
}

/**
 * "Oui, le bébé est né" on an outdated profile: no longer pregnant, and the
 * breastfeeding and baby age questions to answer (nothing taken for granted).
 * The pseudonym and situations stay.
 */
export function afterBirth(form: ProfileForm): ProfileForm {
  return {
    ...form,
    ...noTermValues(),
    pregnant: 'no',
    keptUnsureOn: null,
    termKind: null,
    breastfeeding: null,
    babyAgeKind: null,
    babyBirthDate: '',
    babyWeeks: '',
    babyMonths: '',
    keptBabyAge: null,
    premature: null,
  };
}

/**
 * "Non, toujours enceinte" when the baby may be born: the term is given
 * again, the way it was given before (its value cleared); a term unknown or
 * past 42 weeks is chosen anew.
 */
export function reenterTerm(form: ProfileForm): ProfileForm {
  return {
    ...form,
    ...noTermValues(),
    pregnant: 'yes',
    keptUnsureOn: null,
    termKind: form.termKind === 'unknown' || form.termKind === 'post-term' ? null : form.termKind,
  };
}

/**
 * "Non, toujours enceinte" on a term past 42 weeks: still pregnant past term,
 * read as 42 weeks and over from today (the screen says to go to the health
 * post today); the term can still be given another way.
 */
export function postTermForm(form: ProfileForm): ProfileForm {
  return {
    ...form,
    ...noTermValues(),
    pregnant: 'yes',
    keptUnsureOn: null,
    termKind: 'post-term',
  };
}
