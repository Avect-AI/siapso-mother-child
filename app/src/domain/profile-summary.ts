// SPDX-License-Identifier: MIT
// Where a profile stands today, in plain words: the term used, or that it is
// to be updated, and the baby's age. Shown under the pseudonym on the list of
// profiles, on the check and on the result, so the person in the room can see
// she has the right woman and an up-to-date term. Pure: today is a parameter.
import type { MessageKey, Vars } from '../i18n/translate.js';
import { babyAgeWeeksOf } from './context.js';
import { weeksSince } from './dates.js';
import { WEEKS_PER_MONTH } from './profile-form.js';
import { profileTermStatus } from './term.js';
import type { Profile } from './types.js';

export interface SummaryLine {
  key: MessageKey;
  vars: Vars;
}

function line(key: MessageKey, vars: Vars = {}): SummaryLine {
  return { key, vars };
}

function pregnancyLines(profile: Profile, todayIso: string, notBefore?: string): SummaryLine[] {
  const status = profileTermStatus(profile, todayIso, notBefore);
  switch (status.status) {
    case 'not-pregnant':
      return [];
    case 'outdated':
      return [line('profileStatus.outdated')];
    case 'clock':
      return [line('profileStatus.clock')];
    case 'ok':
    case 'possibly-past': {
      const term = status.unsure
        ? line('profileStatus.maybePregnant')
        : line(status.term.label.key, status.term.label.vars);
      return status.status === 'ok' ? [term] : [term, line('profileStatus.mayBeBorn')];
    }
  }
}

/** Months as given, moved on by the whole months since (as the profile screen shows them). */
function monthsToday(profile: Profile, todayIso: string): number | undefined {
  const { babyAgeMonths: months, babyAgeGivenOn: givenOn } = profile;
  if (months === undefined || profile.babyBirthDate !== undefined) return undefined;
  let since = 0;
  if (givenOn !== undefined) {
    try {
      since = weeksSince(givenOn, todayIso);
    } catch {
      since = 0;
    }
  }
  return months + Math.floor(since / WEEKS_PER_MONTH);
}

/** The baby's age in words: months as given, else weeks, or not known. */
export function babyLine(profile: Profile, todayIso: string): SummaryLine {
  const months = profile.babyAgeUnknown === true ? undefined : monthsToday(profile, todayIso);
  if (months !== undefined) {
    return months === 1
      ? line('profileStatus.babyOneMonth')
      : line('profileStatus.babyMonths', { months });
  }
  const weeks = babyAgeWeeksOf(profile, todayIso);
  if (weeks === undefined) return line('profileStatus.babyUnknown');
  if (weeks === 0) return line('profileStatus.babyUnderOne');
  if (weeks === 1) return line('profileStatus.babyOneWeek');
  return line('profileStatus.babyWeeks', { weeks });
}

/**
 * The lines that say where a profile stands today: the pregnancy first (and
 * "to be confirmed" when the baby may be born), then the baby. `notBefore` is
 * a day the app has already seen (profileTermStatus).
 */
export function profileSummary(
  profile: Profile,
  todayIso: string,
  notBefore?: string,
): SummaryLine[] {
  const lines = pregnancyLines(profile, todayIso, notBefore);
  if (profile.breastfeeding) lines.push(babyLine(profile, todayIso));
  return lines;
}

/** Whether a profile's line says to update it (outdated) or to confirm the birth (possibly past term). */
export function needsUpdate(profile: Profile, todayIso: string, notBefore?: string): boolean {
  const { status } = profileTermStatus(profile, todayIso, notBefore);
  return status === 'outdated' || status === 'possibly-past';
}
