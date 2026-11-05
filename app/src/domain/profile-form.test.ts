// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { contextFromProfile } from './context.js';
import { addDays } from './dates.js';
import {
  afterBirth,
  conditionsShown,
  isConcealedCondition,
  emptyForm,
  formFromProfile,
  monthsAsWeeks,
  monthsLookLikeWeeks,
  monthsNearTerm,
  profileFromForm,
  PSEUDONYM_MAX,
  pseudonymKey,
  reenterTerm,
  termFromForm,
  typedWeeks,
  validateForm,
  weeksReadback,
  type ProfileForm,
} from './profile-form.js';
import type { Profile } from './types.js';

const TODAY = '2026-11-04';
const NOW = '2026-11-04T09:30:00.000Z';

/** The common case: 26 weeks given today, not breastfeeding, no situation. */
function common(patch: Partial<ProfileForm> = {}): ProfileForm {
  return {
    ...emptyForm('Moi', TODAY),
    pregnant: 'yes',
    termKind: 'weeks',
    weeks: '26',
    weeksDay: 'today',
    breastfeeding: false,
    noCondition: true,
    ...patch,
  };
}

function stored(patch: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    pseudonym: 'Awa',
    pregnant: false,
    breastfeeding: false,
    conditions: [],
    longTermItems: [],
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...patch,
  };
}

describe('isConcealedCondition', () => {
  it('hides on screen the situations that say HIV, and only those', () => {
    expect(conditionsShown('accompanied').filter(isConcealedCondition)).toEqual([
      'hiv-cotrimoxazole',
    ]);
  });
});

describe('conditionsShown', () => {
  it('shows four situations to a woman and seven in accompanied mode', () => {
    expect(conditionsShown('woman')).toEqual([
      'hiv-cotrimoxazole',
      'tuberculosis-treatment',
      'epilepsy-treatment',
      'uterine-scar',
    ]);
    expect(conditionsShown('accompanied')).toEqual([
      'hiv-cotrimoxazole',
      'tuberculosis-treatment',
      'epilepsy-treatment',
      'uterine-scar',
      'renal-failure',
      'hepatic-failure',
      'sickle-cell',
    ]);
  });
});

describe('validateForm', () => {
  it('accepts the common case', () => {
    expect(validateForm(common(), TODAY, 'woman')).toEqual({});
  });

  it('asks every question of an empty form, in the order of the screen', () => {
    const errors = validateForm(emptyForm('', TODAY), TODAY, 'woman');
    expect(errors).toEqual({
      pseudonym: 'profile.error.pseudonym',
      pregnant: 'profile.error.yesNo',
      breastfeeding: 'profile.error.yesNo',
      conditions: 'profile.error.situations',
    });
    expect(Object.keys(errors)).toEqual(['pseudonym', 'pregnant', 'breastfeeding', 'conditions']);
  });

  it('refuses a blank pseudonym and one that looks like a phone number', () => {
    expect(validateForm(common({ pseudonym: '   ' }), TODAY, 'woman').pseudonym).toBe(
      'profile.error.pseudonym',
    );
    expect(validateForm(common({ pseudonym: '00 000 00 00' }), TODAY, 'woman').pseudonym).toBe(
      'profile.error.pseudonymNumber',
    );
    expect(validateForm(common({ pseudonym: 'Femme 12' }), TODAY, 'woman')).toEqual({});
  });

  it('refuses a pseudonym longer than 40 characters instead of cutting it', () => {
    expect(PSEUDONYM_MAX).toBe(40);
    expect(validateForm(common({ pseudonym: 'a'.repeat(40) }), TODAY, 'woman')).toEqual({});
    expect(
      validateForm(
        common({ pseudonym: 'Awa Diop Ndiaye fille de Moussa du quartier HLM' }),
        TODAY,
        'woman',
      ),
    ).toEqual({ pseudonym: 'profile.error.pseudonymLong' });
    // Spaces around do not count.
    expect(validateForm(common({ pseudonym: `  ${'a'.repeat(40)}  ` }), TODAY, 'woman')).toEqual(
      {},
    );
  });

  it('refuses a pseudonym already used on the phone, whatever its case, accents and spaces', () => {
    const taken = ['Awa', 'Fatou Diop'];
    for (const pseudonym of ['Awa', ' awa ', 'AWA', 'Àwa', 'fatou  diop']) {
      expect(validateForm(common({ pseudonym }), TODAY, 'accompanied', taken), pseudonym).toEqual({
        pseudonym: 'profile.error.pseudonymTaken',
      });
    }
    expect(validateForm(common({ pseudonym: 'Awa 2' }), TODAY, 'accompanied', taken)).toEqual({});
  });

  it('asks how the term is known once pregnant', () => {
    expect(validateForm(common({ termKind: null }), TODAY, 'woman')).toEqual({
      termKind: 'profile.error.choose',
    });
  });

  it('needs no term when she does not know whether she is pregnant', () => {
    expect(
      validateForm(common({ pregnant: 'unknown', termKind: null, weeks: '' }), TODAY, 'woman'),
    ).toEqual({});
  });

  it('accepts whole weeks from 0 to 42 only', () => {
    for (const weeks of ['0', '42', ' 7 ']) {
      expect(validateForm(common({ weeks }), TODAY, 'woman'), weeks).toEqual({});
    }
    for (const weeks of ['', '43', '-1', '26.5', '26,5', 'abc', '1e1']) {
      expect(validateForm(common({ weeks }), TODAY, 'woman'), weeks).toEqual({
        weeks: 'profile.error.weeks',
      });
    }
  });

  it('takes weeks known at a past date, and names a date that cannot be used', () => {
    const other = (patch: Partial<ProfileForm>) => common({ weeksDay: 'other', ...patch });
    // 16 weeks at an ultrasound on 1 September: about 25 weeks today.
    expect(
      validateForm(other({ weeks: '16', weeksGivenOn: '2026-09-01' }), TODAY, 'woman'),
    ).toEqual({});
    expect(validateForm(other({ weeksGivenOn: '' }), TODAY, 'woman')).toEqual({
      weeksGivenOn: 'profile.error.date',
    });
    expect(validateForm(other({ weeksGivenOn: '2026-11-05' }), TODAY, 'woman')).toEqual({
      weeksGivenOn: 'profile.error.dateFuture',
    });
    // 30 weeks on 1 August: past 42 weeks today.
    expect(
      validateForm(other({ weeks: '30', weeksGivenOn: '2026-08-01' }), TODAY, 'woman'),
    ).toEqual({ weeks: 'profile.error.weeksMovedOn' });
  });

  it('asks the day the weeks were known until it is answered, today or another day', () => {
    expect(validateForm(common({ weeksDay: null }), TODAY, 'accompanied')).toEqual({
      weeksDay: 'profile.error.choose',
    });
    expect(validateForm(common({ weeksDay: 'today', weeksGivenOn: '' }), TODAY, 'woman')).toEqual(
      {},
    );
  });

  it('accepts whole months from 1 to 9 only', () => {
    expect(validateForm(common({ termKind: 'months', months: '9' }), TODAY, 'woman')).toEqual({});
    for (const months of ['', '0', '4.5', 'de', '99']) {
      expect(validateForm(common({ termKind: 'months', months }), TODAY, 'woman'), months).toEqual({
        months: 'profile.error.months',
      });
    }
  });

  it('says a month of 10 to 42 looks like weeks', () => {
    for (const months of ['10', '24', '34', '42']) {
      expect(validateForm(common({ termKind: 'months', months }), TODAY, 'woman'), months).toEqual({
        months: 'profile.error.monthsLooksLikeWeeks',
      });
    }
  });

  it('says a month given so long ago that its start is past 42 weeks must be given again', () => {
    const form = common({
      termKind: 'months',
      months: '9',
      keptTerm: { kind: 'months', months: 9, givenOn: '2026-08-26' },
    });
    expect(validateForm(form, TODAY, 'woman')).toEqual({ months: 'profile.error.monthsOutdated' });
    // Month 9 a week ago may be past term, but is not refused: the screens say so.
    const recent = { ...form, keptTerm: { kind: 'months', months: 9, givenOn: '2026-10-28' } };
    expect(validateForm(recent as ProfileForm, TODAY, 'woman')).toEqual({});
  });

  it('suggests weeks or the last period when month 8 or 9 is given', () => {
    expect(monthsNearTerm(common({ termKind: 'months', months: '8' }))).toBe(true);
    expect(monthsNearTerm(common({ termKind: 'months', months: ' 9 ' }))).toBe(true);
    for (const months of ['7', '', '10', '1']) {
      expect(monthsNearTerm(common({ termKind: 'months', months })), months).toBe(false);
    }
    expect(monthsNearTerm(common({ termKind: 'weeks', months: '9' }))).toBe(false);
  });

  it('says a stored month dated after today is a phone clock set back', () => {
    const form = common({
      termKind: 'months',
      months: '5',
      keptTerm: { kind: 'months', months: 5, givenOn: '2026-12-01' },
    });
    expect(validateForm(form, TODAY, 'woman')).toEqual({ months: 'profile.error.clockBehind' });
  });

  it('says a baby age given earlier that has moved past 104 weeks must be given again', () => {
    const baby = common({
      breastfeeding: true,
      premature: 'no',
      babyAgeKind: 'weeks',
      babyWeeks: '106',
      keptBabyAge: { weeks: 100, givenOn: '2026-09-23' },
    });
    expect(validateForm(baby, TODAY, 'woman')).toEqual({
      babyWeeks: 'profile.error.babyAgeMovedOn',
    });
  });

  it('accepts a last period from today back to 42 weeks, and names the problem otherwise', () => {
    const lmp = (lmpDate: string) =>
      validateForm(common({ termKind: 'lmp', lmpDate }), TODAY, 'woman');
    expect(lmp(TODAY)).toEqual({});
    expect(lmp(addDays(TODAY, -42 * 7))).toEqual({});
    expect(lmp('')).toEqual({ lmpDate: 'profile.error.date' });
    expect(lmp('2026-02-30')).toEqual({ lmpDate: 'profile.error.date' });
    expect(lmp('2026-11-05')).toEqual({ lmpDate: 'profile.error.dateFuture' });
    expect(lmp(addDays(TODAY, -(42 * 7 + 1)))).toEqual({ lmpDate: 'profile.error.lmpTooOld' });
  });

  it('needs no term field for an unknown term, and none at all when not pregnant', () => {
    expect(validateForm(common({ termKind: 'unknown', weeks: '' }), TODAY, 'woman')).toEqual({});
    const breastfeeding = {
      breastfeeding: true,
      babyAgeKind: 'weeks',
      babyWeeks: '6',
      premature: 'no',
    } as const;
    expect(
      validateForm(
        common({ pregnant: 'no', termKind: 'weeks', weeks: '99', ...breastfeeding }),
        TODAY,
        'woman',
      ),
    ).toEqual({});
  });

  it('refuses "no" to both pregnant and breastfeeding: one mis-tap would drop every pregnancy rule', () => {
    expect(
      validateForm(common({ pregnant: 'no', breastfeeding: false }), TODAY, 'accompanied'),
    ).toEqual({ breastfeeding: 'profile.error.neither' });
    // "Je ne sais pas" keeps the pregnancy rules.
    expect(
      validateForm(common({ pregnant: 'unknown', breastfeeding: false }), TODAY, 'accompanied'),
    ).toEqual({});
  });

  it('asks the baby age and prematurity once breastfeeding', () => {
    expect(validateForm(common({ breastfeeding: true }), TODAY, 'woman')).toEqual({
      babyAgeKind: 'profile.error.choose',
      premature: 'profile.error.choose',
    });
  });

  it('accepts "Je ne sais pas" for the baby age', () => {
    expect(
      validateForm(
        common({ breastfeeding: true, babyAgeKind: 'unknown', premature: 'no' }),
        TODAY,
        'woman',
      ),
    ).toEqual({});
  });

  it('accepts a baby age from 0 to 104 weeks, in weeks, months or as a birth date', () => {
    const baby = (patch: Partial<ProfileForm>) =>
      validateForm(common({ breastfeeding: true, premature: 'unknown', ...patch }), TODAY, 'woman');
    expect(baby({ babyAgeKind: 'weeks', babyWeeks: '0' })).toEqual({});
    expect(baby({ babyAgeKind: 'weeks', babyWeeks: '104' })).toEqual({});
    expect(baby({ babyAgeKind: 'weeks', babyWeeks: '105' })).toEqual({
      babyWeeks: 'profile.error.babyWeeks',
    });
    expect(baby({ babyAgeKind: 'months', babyMonths: '24' })).toEqual({});
    expect(baby({ babyAgeKind: 'months', babyMonths: '25' })).toEqual({
      babyMonths: 'profile.error.babyMonths',
    });
    expect(baby({ babyAgeKind: 'birthDate', babyBirthDate: TODAY })).toEqual({});
    // 104 weeks and 6 days ago is still 104 whole weeks.
    expect(baby({ babyAgeKind: 'birthDate', babyBirthDate: '2024-10-31' })).toEqual({});
    expect(baby({ babyAgeKind: 'birthDate', babyBirthDate: '2024-10-30' })).toEqual({
      babyBirthDate: 'profile.error.birthTooOld',
    });
    expect(baby({ babyAgeKind: 'birthDate', babyBirthDate: '2026-11-05' })).toEqual({
      babyBirthDate: 'profile.error.dateFuture',
    });
    expect(baby({ babyAgeKind: 'birthDate', babyBirthDate: '' })).toEqual({
      babyBirthDate: 'profile.error.date',
    });
  });

  it('needs a situation ticked, or "none of these", counting only the situations shown', () => {
    expect(validateForm(common({ noCondition: false }), TODAY, 'woman')).toEqual({
      conditions: 'profile.error.situations',
    });
    expect(
      validateForm(common({ noCondition: false, conditions: ['uterine-scar'] }), TODAY, 'woman'),
    ).toEqual({});
    // A situation only accompanied mode shows does not answer the question in woman mode.
    expect(
      validateForm(common({ noCondition: false, conditions: ['sickle-cell'] }), TODAY, 'woman'),
    ).toEqual({ conditions: 'profile.error.situations' });
    expect(
      validateForm(
        common({ noCondition: false, conditions: ['sickle-cell'] }),
        TODAY,
        'accompanied',
      ),
    ).toEqual({});
  });
});

describe('pseudonymKey', () => {
  it('compares pseudonyms without case, accents or extra spaces', () => {
    expect(pseudonymKey('  Àwa   Diop ')).toBe(pseudonymKey('awa diop'));
    expect(pseudonymKey('Awa')).not.toBe(pseudonymKey('Awa 2'));
  });
});

describe('a month that looks like weeks', () => {
  it('is a whole number from 10 to 42 typed as months', () => {
    expect(monthsLookLikeWeeks(common({ termKind: 'months', months: '24' }))).toBe(true);
    expect(monthsLookLikeWeeks(common({ termKind: 'months', months: ' 34 ' }))).toBe(true);
    for (const months of ['9', '1', '', '43', 'ab']) {
      expect(monthsLookLikeWeeks(common({ termKind: 'months', months })), months).toBe(false);
    }
    expect(monthsLookLikeWeeks(common({ termKind: 'weeks', months: '24' }))).toBe(false);
  });

  it('moves to "En semaines" with the number typed, given today', () => {
    const form = monthsAsWeeks(
      common({
        termKind: 'months',
        months: '24',
        weeks: '',
        weeksDay: null,
        weeksGivenOn: '2026-01-01',
      }),
    );
    expect(form).toMatchObject({
      termKind: 'weeks',
      weeks: '24',
      weeksDay: 'today',
      weeksGivenOn: '',
      months: '',
    });
    expect(validateForm(form, TODAY, 'accompanied')).toEqual({});
  });
});

describe('typing weeks', () => {
  it('clears the day they were known: it is asked again', () => {
    const before = common({ weeksDay: 'other', weeksGivenOn: '2026-09-24' });
    expect(typedWeeks(before, '32', true)).toMatchObject({
      weeks: '32',
      weeksDay: null,
      weeksGivenOn: '',
    });
    // A new profile in woman mode keeps today, as said by default.
    expect(typedWeeks(common({ weeksDay: 'today' }), '32', false)).toMatchObject({
      weeks: '32',
      weeksDay: 'today',
    });
  });
});

describe('weeksReadback', () => {
  it('says the term today and the weeks on the day given when it is not today', () => {
    const form = common({ weeks: '26', weeksDay: 'other', weeksGivenOn: '2026-09-24' });
    expect(weeksReadback(form, TODAY)).toEqual({ weeks: 26, givenOn: '2026-09-24' });
    expect(weeksReadback(common(), TODAY)).toBeUndefined();
    expect(weeksReadback(common({ termKind: 'months', months: '5' }), TODAY)).toBeUndefined();
  });
});

describe('termFromForm', () => {
  it('gives the term being entered: weeks with their day, months and unknown dated today', () => {
    expect(termFromForm(common(), TODAY)).toEqual({ kind: 'weeks', weeks: 26, givenOn: TODAY });
    expect(
      termFromForm(common({ weeks: '16', weeksDay: 'other', weeksGivenOn: '2026-09-01' }), TODAY),
    ).toEqual({ kind: 'weeks', weeks: 16, givenOn: '2026-09-01' });
    expect(termFromForm(common({ termKind: 'months', months: '5' }), TODAY)).toEqual({
      kind: 'months',
      months: 5,
      givenOn: TODAY,
    });
    expect(termFromForm(common({ termKind: 'lmp', lmpDate: '2026-05-06' }), TODAY)).toEqual({
      kind: 'lmp',
      date: '2026-05-06',
    });
    expect(termFromForm(common({ termKind: 'unknown' }), TODAY)).toEqual({
      kind: 'unknown',
      givenOn: TODAY,
    });
  });

  it('keeps the day an unknown term was given while it is not answered again', () => {
    const kept = { kind: 'unknown', givenOn: '2026-10-07' } as const;
    expect(termFromForm(common({ termKind: 'unknown', keptTerm: kept }), TODAY)).toEqual(kept);
  });

  it('gives the stored month exactly while its field is not typed in, so a save never moves it', () => {
    const kept = { kind: 'months', months: 5, givenOn: '2026-10-07' } as const;
    // The field shows today's month (6); the term stays month 5 given on 7 October.
    expect(
      termFromForm(common({ termKind: 'months', months: '6', keptTerm: kept }), TODAY),
    ).toEqual(kept);
    // A kept month does not answer for weeks.
    expect(termFromForm(common({ weeks: '24', keptTerm: kept }), TODAY)).toEqual({
      kind: 'weeks',
      weeks: 24,
      givenOn: TODAY,
    });
  });

  it('gives nothing while the field cannot be read', () => {
    expect(termFromForm(common({ weeks: '' }), TODAY)).toBeUndefined();
    expect(termFromForm(common({ weeksDay: null }), TODAY)).toBeUndefined();
    expect(termFromForm(common({ weeksDay: 'other', weeksGivenOn: '' }), TODAY)).toBeUndefined();
    expect(termFromForm(common({ termKind: 'lmp', lmpDate: '' }), TODAY)).toBeUndefined();
    expect(termFromForm(common({ termKind: null }), TODAY)).toBeUndefined();
  });
});

describe('profileFromForm', () => {
  it('makes a new profile from the common case', () => {
    expect(profileFromForm(common(), { id: 'new-id', nowIso: NOW, todayIso: TODAY })).toEqual({
      id: 'new-id',
      pseudonym: 'Moi',
      pregnant: true,
      term: { kind: 'weeks', weeks: 26, givenOn: TODAY },
      breastfeeding: false,
      conditions: [],
      longTermItems: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('trims the pseudonym and keeps no term when not pregnant', () => {
    const profile = profileFromForm(common({ pseudonym: '  Awa  ', pregnant: 'no' }), {
      id: 'x',
      nowIso: NOW,
      todayIso: TODAY,
    });
    expect(profile.pseudonym).toBe('Awa');
    expect(profile.pregnant).toBe(false);
    expect(profile).not.toHaveProperty('term');
    expect(profile).not.toHaveProperty('pregnancyUnsure');
  });

  it('stores "Je ne sais pas" to the pregnancy as pregnant, unsure, dated, with no term', () => {
    const profile = profileFromForm(common({ pregnant: 'unknown' }), {
      id: 'x',
      nowIso: NOW,
      todayIso: TODAY,
    });
    expect(profile).toMatchObject({
      pregnant: true,
      pregnancyUnsure: true,
      pregnancyUnsureOn: TODAY,
    });
    expect(profile).not.toHaveProperty('term');
    // Saved again unchanged, it keeps the day it was said.
    const again = profileFromForm(
      formFromProfile({ ...profile, pregnancyUnsureOn: '2026-10-20' }, TODAY, 'woman'),
      {
        base: profile,
        id: 'x',
        nowIso: NOW,
        todayIso: TODAY,
      },
    );
    expect(again.pregnancyUnsureOn).toBe('2026-10-20');
  });

  it('marks her own profile in woman mode, and keeps the mark of a profile it edits', () => {
    const mine = profileFromForm(common(), { id: 'x', nowIso: NOW, todayIso: TODAY, self: true });
    expect(mine.self).toBe(true);
    const theirs = profileFromForm(common(), {
      id: 'y',
      nowIso: NOW,
      todayIso: TODAY,
      self: false,
    });
    expect(theirs.self).toBe(false);
    expect(
      profileFromForm(common(), { base: mine, id: 'z', nowIso: NOW, todayIso: TODAY, self: false })
        .self,
    ).toBe(true);
  });

  it('stores a birth date, or an age in weeks; months become whole weeks (x 4.345, rounded down)', () => {
    const baby = (patch: Partial<ProfileForm>) =>
      profileFromForm(common({ breastfeeding: true, premature: 'no', ...patch }), {
        id: 'x',
        nowIso: NOW,
        todayIso: TODAY,
      });
    const byDate = baby({ babyAgeKind: 'birthDate', babyBirthDate: '2026-10-01' });
    expect(byDate.babyBirthDate).toBe('2026-10-01');
    expect(byDate).not.toHaveProperty('babyAgeWeeks');
    expect(baby({ babyAgeKind: 'weeks', babyWeeks: '6' }).babyAgeWeeks).toBe(6);
    expect(baby({ babyAgeKind: 'months', babyMonths: '3' }).babyAgeWeeks).toBe(13);
    expect(baby({ babyAgeKind: 'months', babyMonths: '24' }).babyAgeWeeks).toBe(104);
    expect(baby({ babyAgeKind: 'months', babyMonths: '0' }).babyAgeWeeks).toBe(0);
    expect(baby({ babyAgeKind: 'weeks', babyWeeks: '6' })).not.toHaveProperty('babyBirthDate');
  });

  it('stores "Je ne sais pas" to the baby age with no age at all', () => {
    const profile = profileFromForm(
      common({ breastfeeding: true, babyAgeKind: 'unknown', babyWeeks: '6', premature: 'no' }),
      { id: 'x', nowIso: NOW, todayIso: TODAY },
    );
    expect(profile).toMatchObject({ breastfeeding: true, babyAgeUnknown: true, premature: false });
    expect(profile).not.toHaveProperty('babyAgeWeeks');
    expect(profile).not.toHaveProperty('babyBirthDate');
  });

  it('dates an age given in weeks or months, so it moves on (a birth date needs no date)', () => {
    const baby = (patch: Partial<ProfileForm>) =>
      profileFromForm(common({ breastfeeding: true, premature: 'no', ...patch }), {
        id: 'x',
        nowIso: NOW,
        todayIso: TODAY,
      });
    expect(baby({ babyAgeKind: 'weeks', babyWeeks: '6' }).babyAgeGivenOn).toBe(TODAY);
    expect(baby({ babyAgeKind: 'weeks', babyWeeks: '6' })).not.toHaveProperty('babyAgeMonths');
    // Months are kept as given too, so the profile reopens in months.
    expect(baby({ babyAgeKind: 'months', babyMonths: '3' })).toMatchObject({
      babyAgeWeeks: 13,
      babyAgeMonths: 3,
      babyAgeGivenOn: TODAY,
    });
    expect(baby({ babyAgeKind: 'birthDate', babyBirthDate: '2026-10-01' })).not.toHaveProperty(
      'babyAgeGivenOn',
    );
  });

  it('stores prematurity as true, false, or null for "je ne sais pas"', () => {
    const premature = (answer: ProfileForm['premature']) =>
      profileFromForm(
        common({ breastfeeding: true, babyAgeKind: 'weeks', babyWeeks: '2', premature: answer }),
        { id: 'x', nowIso: NOW, todayIso: TODAY },
      ).premature;
    expect(premature('yes')).toBe(true);
    expect(premature('no')).toBe(false);
    expect(premature('unknown')).toBeNull();
  });

  it('keeps no baby when not breastfeeding', () => {
    const profile = profileFromForm(
      common({ breastfeeding: false, babyAgeKind: 'weeks', babyWeeks: '6', premature: 'yes' }),
      { id: 'x', nowIso: NOW, todayIso: TODAY },
    );
    expect(profile).not.toHaveProperty('babyAgeWeeks');
    expect(profile).not.toHaveProperty('premature');
    expect(profile).not.toHaveProperty('babyAgeUnknown');
  });

  it('keeps the id, creation date and long-term items of the profile it edits', () => {
    const base = stored({
      longTermItems: [{ ref: { kind: 'product', id: 'bactrim' } }],
    });
    const profile = profileFromForm(common(), {
      base,
      id: 'ignored',
      nowIso: NOW,
      todayIso: TODAY,
    });
    expect(profile.id).toBe('p1');
    expect(profile.createdAt).toBe('2026-10-01T08:00:00.000Z');
    expect(profile.updatedAt).toBe(NOW);
    expect(profile.longTermItems).toEqual([{ ref: { kind: 'product', id: 'bactrim' } }]);
  });

  it('stores the situations in a fixed order, each once', () => {
    const profile = profileFromForm(
      common({
        noCondition: false,
        conditions: ['sickle-cell', 'hiv-cotrimoxazole', 'sickle-cell'],
      }),
      { id: 'x', nowIso: NOW, todayIso: TODAY },
    );
    expect(profile.conditions).toEqual(['hiv-cotrimoxazole', 'sickle-cell']);
  });
});

describe('formFromProfile', () => {
  it('starts a new profile with the given pseudonym and nothing answered', () => {
    expect(emptyForm('Femme 3', TODAY)).toEqual({
      pseudonym: 'Femme 3',
      pregnant: null,
      keptUnsureOn: null,
      termKind: null,
      lmpDate: '',
      weeks: '',
      weeksDay: null,
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
    });
    // A new profile of her own may take today as the day the weeks are known.
    expect(emptyForm('Moi', TODAY, 'today').weeksDay).toBe('today');
  });

  it('round-trips a saved profile', () => {
    const form = common({
      pseudonym: 'Awa',
      breastfeeding: true,
      babyAgeKind: 'birthDate',
      babyBirthDate: '2026-10-01',
      premature: 'unknown',
      noCondition: false,
      conditions: ['epilepsy-treatment'],
    });
    const profile = profileFromForm(form, { id: 'x', nowIso: NOW, todayIso: TODAY });
    expect(formFromProfile(profile, TODAY, 'woman')).toEqual(form);
  });

  it('round-trips "Je ne sais pas" to the pregnancy and to the baby age', () => {
    const form = common({
      pregnant: 'unknown',
      termKind: null,
      weeks: '',
      weeksDay: null,
      breastfeeding: true,
      babyAgeKind: 'unknown',
      premature: 'no',
    });
    const profile = profileFromForm(form, { id: 'x', nowIso: NOW, todayIso: TODAY });
    // The day "Je ne sais pas" was said is kept, so saving again does not move it.
    expect(formFromProfile(profile, TODAY, 'woman')).toEqual({ ...form, keptUnsureOn: TODAY });
  });

  it('shows weeks as given, with the day they were given', () => {
    const term = { kind: 'weeks', weeks: 18, givenOn: '2026-08-09' } as const;
    const form = formFromProfile(stored({ pregnant: true, term }), TODAY, 'woman');
    expect(form).toMatchObject({
      termKind: 'weeks',
      weeks: '18',
      weeksDay: 'other',
      weeksGivenOn: '2026-08-09',
    });
    expect(termFromForm(form, TODAY)).toEqual(term);
    const today = formFromProfile(
      stored({ pregnant: true, term: { ...term, givenOn: TODAY } }),
      TODAY,
      'woman',
    );
    expect(today).toMatchObject({ weeksDay: 'today', weeksGivenOn: '' });
  });

  it('dates stored weeks without a day by the last save, and leaves a day that cannot be read empty', () => {
    expect(
      formFromProfile(
        stored({ pregnant: true, term: { kind: 'weeks', weeks: 18 } }),
        TODAY,
        'woman',
      ),
    ).toMatchObject({ weeks: '18', weeksDay: 'other', weeksGivenOn: '2026-10-01' });
    expect(
      formFromProfile(
        stored({ pregnant: true, term: { kind: 'weeks', weeks: 18, givenOn: 'not a date' } }),
        TODAY,
        'woman',
      ),
    ).toMatchObject({ weeks: '18', weeksDay: 'other', weeksGivenOn: '' });
  });

  it('keeps the day of an unknown term, the last save for an older record', () => {
    expect(
      formFromProfile(stored({ pregnant: true, term: { kind: 'unknown' } }), TODAY, 'woman'),
    ).toMatchObject({ termKind: 'unknown', keptTerm: { kind: 'unknown', givenOn: '2026-10-01' } });
    expect(
      formFromProfile(stored({ pregnant: true, pregnancyUnsure: true }), TODAY, 'woman'),
    ).toMatchObject({ pregnant: 'unknown', keptUnsureOn: '2026-10-01' });
  });

  it("shows today's month for a month given earlier, agreeing with the term read back", () => {
    // Month 5 given four weeks ago: from 23 weeks today, the start of month 6.
    const term = { kind: 'months', months: 5, givenOn: '2026-10-07' } as const;
    const form = formFromProfile(stored({ pregnant: true, term }), TODAY, 'woman');
    expect(form).toMatchObject({ termKind: 'months', months: '6', keptTerm: term });
    expect(
      formFromProfile(stored({ pregnant: true, term: { ...term, givenOn: TODAY } }), TODAY, 'woman')
        .months,
    ).toBe('5');
  });

  it('shows month 9 for a month given so long ago that it no longer holds', () => {
    const term = { kind: 'months', months: 9, givenOn: '2026-08-26' } as const;
    expect(formFromProfile(stored({ pregnant: true, term }), TODAY, 'woman').months).toBe('9');
  });

  it('shows the age a baby has reached today, from an age given weeks ago', () => {
    const form = formFromProfile(
      stored({ breastfeeding: true, babyAgeWeeks: 13, babyAgeGivenOn: '2026-10-07' }),
      TODAY,
      'woman',
    );
    expect(form).toMatchObject({
      babyAgeKind: 'weeks',
      babyWeeks: '17',
      keptBabyAge: { weeks: 13, givenOn: '2026-10-07' },
    });
  });

  it('reopens an age given in months as months, moved on to today', () => {
    // 3 months (13 weeks) given five weeks ago: 4 months today.
    const form = formFromProfile(
      stored({
        breastfeeding: true,
        babyAgeWeeks: 13,
        babyAgeMonths: 3,
        babyAgeGivenOn: '2026-09-30',
      }),
      TODAY,
      'woman',
    );
    expect(form).toMatchObject({
      babyAgeKind: 'months',
      babyMonths: '4',
      keptBabyAge: { weeks: 13, months: 3, givenOn: '2026-09-30' },
    });
  });

  it('shows a stored age in weeks as weeks', () => {
    const form = formFromProfile(
      stored({ breastfeeding: true, babyAgeWeeks: 13, premature: true }),
      TODAY,
      'woman',
    );
    expect(form).toMatchObject({ babyAgeKind: 'weeks', babyWeeks: '13', premature: 'yes' });
  });

  it('answers "none of these" for a saved profile with no situation shown in this mode', () => {
    expect(formFromProfile(stored(), TODAY, 'woman').noCondition).toBe(true);
    const hidden = formFromProfile(stored({ conditions: ['sickle-cell'] }), TODAY, 'woman');
    expect(hidden.noCondition).toBe(true);
    expect(hidden.conditions).toEqual(['sickle-cell']);
    expect(
      formFromProfile(stored({ conditions: ['sickle-cell'] }), TODAY, 'accompanied').noCondition,
    ).toBe(false);
  });

  it('never loses a situation the mode does not show', () => {
    const base = stored({ conditions: ['sickle-cell', 'renal-failure'] });
    const form = formFromProfile(base, TODAY, 'woman');
    const saved = profileFromForm(
      { ...form, pregnant: 'yes', termKind: 'unknown' },
      { base, id: 'x', nowIso: NOW, todayIso: TODAY },
    );
    expect(saved.conditions).toEqual(['renal-failure', 'sickle-cell']);
  });
});

describe('updating an outdated profile', () => {
  const outdated = stored({
    pregnant: true,
    term: { kind: 'months', months: 7, givenOn: '2026-07-01' },
    conditions: ['uterine-scar'],
  });

  it('"the baby is born": not pregnant, the breastfeeding and baby age questions to answer', () => {
    const form = afterBirth(formFromProfile(outdated, TODAY, 'woman'));
    expect(form).toMatchObject({
      pseudonym: 'Awa',
      pregnant: 'no',
      termKind: null,
      months: '',
      keptTerm: null,
      breastfeeding: null,
      babyAgeKind: null,
      premature: null,
      conditions: ['uterine-scar'],
    });
    expect(validateForm(form, TODAY, 'woman')).toEqual({ breastfeeding: 'profile.error.yesNo' });
  });

  it('"still pregnant": the term is to be given again, the way it was given', () => {
    const form = reenterTerm(formFromProfile(outdated, TODAY, 'woman'));
    expect(form).toMatchObject({
      pregnant: 'yes',
      termKind: 'months',
      months: '',
      keptTerm: null,
      weeks: '',
      weeksDay: null,
      weeksGivenOn: '',
      lmpDate: '',
    });
    expect(validateForm(form, TODAY, 'woman')).toEqual({ months: 'profile.error.months' });
  });
});

describe('re-saving a profile', () => {
  const DAY_0 = '2026-09-01';
  const SAVED_ON_DAY_0 = {
    createdAt: `${DAY_0}T08:00:00.000Z`,
    updatedAt: `${DAY_0}T08:00:00.000Z`,
  };

  /** Opens the profile on `today` and saves it without touching anything, as the screen does. */
  function resave(profile: Profile, today: string): Profile {
    const form = formFromProfile(profile, today, 'woman');
    expect(validateForm(form, today, 'woman'), `valid on ${today}`).toEqual({});
    return profileFromForm(form, {
      base: profile,
      id: 'unused',
      nowIso: `${today}T10:00:00.000Z`,
      todayIso: today,
    });
  }

  const pregnancyOn = (profile: Profile, today: string) =>
    contextFromProfile(profile, { items: [], signs: [] }, today).pregnancy;
  const babyAgeOn = (profile: Profile, today: string) =>
    contextFromProfile(profile, { items: [], signs: [] }, today).breastfeeding?.babyAgeWeeks;

  it('leaves a weeks term as it was: saved on day 13, the same term on day 14 as without the save', () => {
    const original = stored({
      ...SAVED_ON_DAY_0,
      pregnant: true,
      term: { kind: 'weeks', weeks: 20, givenOn: DAY_0 },
    });
    const saved = resave(original, addDays(DAY_0, 13));

    expect(pregnancyOn(saved, addDays(DAY_0, 14))).toEqual(
      pregnancyOn(original, addDays(DAY_0, 14)),
    );
    expect(pregnancyOn(saved, addDays(DAY_0, 14))?.weeksMin).toBe(22);
  });

  it('never moves a term or an age, however often the profile is saved', () => {
    let weeks = stored({
      ...SAVED_ON_DAY_0,
      pregnant: true,
      term: { kind: 'weeks', weeks: 20, givenOn: DAY_0 },
      breastfeeding: true,
      babyAgeWeeks: 6,
      babyAgeGivenOn: DAY_0,
      premature: false,
    });
    let months = stored({
      ...SAVED_ON_DAY_0,
      pregnant: true,
      term: { kind: 'months', months: 4, givenOn: DAY_0 },
      breastfeeding: true,
      babyAgeWeeks: 13,
      babyAgeMonths: 3,
      babyAgeGivenOn: DAY_0,
      premature: null,
    });
    for (let day = 6; day <= 60; day += 6) {
      weeks = resave(weeks, addDays(DAY_0, day));
      months = resave(months, addDays(DAY_0, day));
    }

    const day60 = addDays(DAY_0, 60);
    // 60 days are 8 weeks and 4 days: 20 weeks become 28 to 29, not 20.
    expect(pregnancyOn(weeks, day60)).toEqual({ weeksMin: 28, weeksMax: 29, precision: 'exact' });
    expect(babyAgeOn(weeks, day60)).toBe(14);
    expect(weeks.term).toEqual({ kind: 'weeks', weeks: 20, givenOn: DAY_0 });
    expect(months.term).toEqual({ kind: 'months', months: 4, givenOn: DAY_0 });
    expect(babyAgeOn(months, day60)).toBe(21);
    expect(months).toMatchObject({ babyAgeWeeks: 13, babyAgeMonths: 3, babyAgeGivenOn: DAY_0 });
  });
});
