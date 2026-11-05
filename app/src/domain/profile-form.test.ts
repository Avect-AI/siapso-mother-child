// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { contextFromProfile } from './context.js';
import { addDays } from './dates.js';
import {
  conditionsShown,
  emptyForm,
  formFromProfile,
  profileFromForm,
  termFromForm,
  validateForm,
  type ProfileForm,
} from './profile-form.js';
import type { Profile } from './types.js';

const TODAY = '2026-11-04';
const NOW = '2026-11-04T09:30:00.000Z';

/** The common case: 26 weeks, not breastfeeding, no situation. */
function common(patch: Partial<ProfileForm> = {}): ProfileForm {
  return {
    ...emptyForm('Moi'),
    pregnant: true,
    termKind: 'weeks',
    weeks: '26',
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
    const errors = validateForm(emptyForm(''), TODAY, 'woman');
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

  it('asks how the term is known once pregnant', () => {
    expect(validateForm(common({ termKind: null }), TODAY, 'woman')).toEqual({
      termKind: 'profile.error.choose',
    });
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

  it('accepts whole months from 1 to 9 only', () => {
    expect(validateForm(common({ termKind: 'months', months: '9' }), TODAY, 'woman')).toEqual({});
    for (const months of ['', '0', '10', '4.5']) {
      expect(validateForm(common({ termKind: 'months', months }), TODAY, 'woman'), months).toEqual({
        months: 'profile.error.months',
      });
    }
  });

  it('says a month given so long ago that the term is now past 45 weeks must be given again', () => {
    const form = common({
      termKind: 'months',
      months: '9',
      keptTerm: { kind: 'months', months: 9, givenOn: '2026-08-26' },
    });
    expect(validateForm(form, TODAY, 'woman')).toEqual({ months: 'profile.error.monthsOutdated' });
    const recent = { ...form, keptTerm: { kind: 'months', months: 9, givenOn: '2026-09-02' } };
    expect(validateForm(recent as ProfileForm, TODAY, 'woman')).toEqual({});
  });

  it('says weeks given earlier that have moved past 42 must be given again', () => {
    // 40 weeks given 21 days ago: 43 today.
    const form = common({
      weeks: '43',
      keptTerm: { kind: 'weeks', weeks: 40, givenOn: '2026-10-14' },
    });
    expect(validateForm(form, TODAY, 'woman')).toEqual({ weeks: 'profile.error.weeksMovedOn' });
    const within = common({
      weeks: '42',
      keptTerm: { kind: 'weeks', weeks: 39, givenOn: '2026-10-14' },
    });
    expect(validateForm(within, TODAY, 'woman')).toEqual({});
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

  it('accepts a last period from today back to 45 weeks, and names the problem otherwise', () => {
    const lmp = (lmpDate: string) =>
      validateForm(common({ termKind: 'lmp', lmpDate }), TODAY, 'woman');
    expect(lmp(TODAY)).toEqual({});
    expect(lmp('2025-12-18')).toEqual({});
    expect(lmp('')).toEqual({ lmpDate: 'profile.error.date' });
    expect(lmp('2026-02-30')).toEqual({ lmpDate: 'profile.error.date' });
    expect(lmp('2026-11-05')).toEqual({ lmpDate: 'profile.error.dateFuture' });
    expect(lmp('2025-12-17')).toEqual({ lmpDate: 'profile.error.lmpTooOld' });
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
        common({ pregnant: false, termKind: 'weeks', weeks: '99', ...breastfeeding }),
        TODAY,
        'woman',
      ),
    ).toEqual({});
  });

  it('refuses "no" to both pregnant and breastfeeding: one mis-tap would drop every pregnancy rule', () => {
    expect(
      validateForm(common({ pregnant: false, breastfeeding: false }), TODAY, 'accompanied'),
    ).toEqual({ breastfeeding: 'profile.error.neither' });
  });

  it('asks the baby age and prematurity once breastfeeding', () => {
    expect(validateForm(common({ breastfeeding: true }), TODAY, 'woman')).toEqual({
      babyAgeKind: 'profile.error.choose',
      premature: 'profile.error.choose',
    });
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

describe('termFromForm', () => {
  it('gives the term being entered, dated today for weeks and months', () => {
    expect(termFromForm(common(), TODAY)).toEqual({ kind: 'weeks', weeks: 26, givenOn: TODAY });
    expect(termFromForm(common({ termKind: 'months', months: '5' }), TODAY)).toEqual({
      kind: 'months',
      months: 5,
      givenOn: TODAY,
    });
    expect(termFromForm(common({ termKind: 'lmp', lmpDate: '2026-05-06' }), TODAY)).toEqual({
      kind: 'lmp',
      date: '2026-05-06',
    });
    expect(termFromForm(common({ termKind: 'unknown' }), TODAY)).toEqual({ kind: 'unknown' });
  });

  it('gives the stored term exactly while its field is not typed in, so a save never moves it', () => {
    const kept = { kind: 'months', months: 5, givenOn: '2026-10-07' } as const;
    // The field shows today's month (6); the term stays month 5 given on 7 October.
    expect(
      termFromForm(common({ termKind: 'months', months: '6', keptTerm: kept }), TODAY),
    ).toEqual(kept);
    const keptWeeks = { kind: 'weeks', weeks: 20, givenOn: '2026-10-01' } as const;
    expect(termFromForm(common({ weeks: '24', keptTerm: keptWeeks }), TODAY)).toEqual(keptWeeks);
    // A kept term of the other kind does not answer for this one.
    expect(termFromForm(common({ weeks: '24', keptTerm: kept }), TODAY)).toEqual({
      kind: 'weeks',
      weeks: 24,
      givenOn: TODAY,
    });
  });

  it('gives nothing while the field cannot be read', () => {
    expect(termFromForm(common({ weeks: '' }), TODAY)).toBeUndefined();
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
    const profile = profileFromForm(common({ pseudonym: '  Awa  ', pregnant: false }), {
      id: 'x',
      nowIso: NOW,
      todayIso: TODAY,
    });
    expect(profile.pseudonym).toBe('Awa');
    expect(profile).not.toHaveProperty('term');
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
    expect(emptyForm('Femme 3')).toEqual({
      pseudonym: 'Femme 3',
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
    });
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
    // The weeks come back with the stored term kept, so saving again leaves it as it is.
    expect(formFromProfile(profile, TODAY, 'woman')).toEqual({
      ...form,
      keptTerm: { kind: 'weeks', weeks: 26, givenOn: TODAY },
    });
  });

  it('shows the weeks reached today for weeks given earlier, and keeps the stored term', () => {
    const term = { kind: 'weeks', weeks: 18, givenOn: '2026-08-09' } as const;
    const form = formFromProfile(stored({ pregnant: true, term }), TODAY, 'woman');
    expect(form).toMatchObject({ termKind: 'weeks', weeks: '30', keptTerm: term });
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

  it('keeps nothing from a term whose day cannot be read, and shows it as given', () => {
    const term = { kind: 'weeks', weeks: 18, givenOn: 'not a date' } as const;
    const form = formFromProfile(stored({ pregnant: true, term }), TODAY, 'woman');
    expect(form).toMatchObject({ weeks: '18', keptTerm: null });
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

  it('takes a value typed again as given today, whatever was stored', () => {
    const term = { kind: 'weeks', weeks: 18, givenOn: '2026-08-09' } as const;
    const form = formFromProfile(stored({ pregnant: true, term }), TODAY, 'woman');
    // The screen clears the kept term when the field is typed in.
    const typed = { ...form, weeks: '31', keptTerm: null };
    expect(termFromForm(typed, TODAY)).toEqual({ kind: 'weeks', weeks: 31, givenOn: TODAY });
  });

  it('never loses a situation the mode does not show', () => {
    const base = stored({ conditions: ['sickle-cell', 'renal-failure'] });
    const form = formFromProfile(base, TODAY, 'woman');
    const saved = profileFromForm(
      { ...form, pregnant: true, termKind: 'unknown' },
      { base, id: 'x', nowIso: NOW, todayIso: TODAY },
    );
    expect(saved.conditions).toEqual(['renal-failure', 'sickle-cell']);
  });
});

describe('re-saving a profile', () => {
  const DAY_0 = '2026-09-01';

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
    const original = stored({ pregnant: true, term: { kind: 'weeks', weeks: 20, givenOn: DAY_0 } });
    const saved = resave(original, addDays(DAY_0, 13));

    expect(pregnancyOn(saved, addDays(DAY_0, 14))).toEqual(
      pregnancyOn(original, addDays(DAY_0, 14)),
    );
    expect(pregnancyOn(saved, addDays(DAY_0, 14))?.weeksMin).toBe(22);
  });

  it('never moves a term or an age, however often the profile is saved', () => {
    let weeks = stored({
      pregnant: true,
      term: { kind: 'weeks', weeks: 20, givenOn: DAY_0 },
      breastfeeding: true,
      babyAgeWeeks: 6,
      babyAgeGivenOn: DAY_0,
      premature: false,
    });
    let months = stored({
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
    // 60 days are 8 whole weeks: 20 weeks become 28, not 20.
    expect(pregnancyOn(weeks, day60)).toEqual({ weeksMin: 28, weeksMax: 28, precision: 'exact' });
    expect(babyAgeOn(weeks, day60)).toBe(14);
    expect(weeks.term).toEqual({ kind: 'weeks', weeks: 20, givenOn: DAY_0 });
    expect(months.term).toEqual({ kind: 'months', months: 4, givenOn: DAY_0 });
    expect(babyAgeOn(months, day60)).toBe(21);
    expect(months).toMatchObject({ babyAgeWeeks: 13, babyAgeMonths: 3, babyAgeGivenOn: DAY_0 });
  });
});
