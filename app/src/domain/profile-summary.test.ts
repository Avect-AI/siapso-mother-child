// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/translate.js';
import { profileSummary } from './profile-summary.js';
import type { Profile } from './types.js';

const TODAY = '2026-11-04';

function profile(patch: Partial<Profile>): Profile {
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

/** The summary in French, one string per line. */
function words(patch: Partial<Profile>, lang: 'fr' | 'en' = 'fr'): string[] {
  // A no-break space before ":" reads as a space here.
  return profileSummary(profile(patch), TODAY).map((line) =>
    translate(lang, line.key, line.vars).replace(/\s/g, ' '),
  );
}

describe('profileSummary', () => {
  it('says the term used, in plain words', () => {
    expect(words({ pregnant: true, term: { kind: 'weeks', weeks: 32, givenOn: TODAY } })).toEqual([
      'Environ 32 semaines',
    ]);
    expect(words({ pregnant: true, term: { kind: 'months', months: 2, givenOn: TODAY } })).toEqual([
      'Entre 6 et 15 semaines (estimé)',
    ]);
    expect(words({ pregnant: true, term: { kind: 'unknown', givenOn: TODAY } })).toEqual([
      'Terme inconnu',
    ]);
  });

  it('says an outdated term is to be updated', () => {
    expect(
      words({ pregnant: true, term: { kind: 'months', months: 7, givenOn: '2026-07-01' } }),
    ).toEqual(['À mettre à jour']);
  });

  it('says a term that may be past the birth is to be confirmed, after the term held at 42', () => {
    expect(
      words({ pregnant: true, term: { kind: 'months', months: 9, givenOn: '2026-10-28' } }),
    ).toEqual(['Entre 37 et 42 semaines (estimé)', 'À confirmer : le bébé est peut-être né']);
    expect(words({ pregnant: true, term: { kind: 'unknown', givenOn: '2026-09-01' } })).toEqual([
      'Terme inconnu',
      'À confirmer : le bébé est peut-être né',
    ]);
  });

  it('says when she does not know whether she is pregnant', () => {
    expect(words({ pregnant: true, pregnancyUnsure: true, pregnancyUnsureOn: TODAY })).toEqual([
      'Grossesse possible, terme inconnu',
    ]);
  });

  it('says why the term is unknown when the phone clock is behind the day it was given', () => {
    expect(
      words({ pregnant: true, term: { kind: 'weeks', weeks: 30, givenOn: '2026-12-01' } }),
    ).toEqual(['Terme inconnu (date du téléphone)']);
  });

  it("says the baby's age as it was given: months stay months, moved on to today", () => {
    expect(
      words({ breastfeeding: true, babyAgeWeeks: 13, babyAgeMonths: 3, babyAgeGivenOn: TODAY }),
    ).toEqual(['Allaite, bébé de 3 mois']);
    expect(
      words({
        breastfeeding: true,
        babyAgeWeeks: 13,
        babyAgeMonths: 3,
        babyAgeGivenOn: '2026-09-30',
      }),
    ).toEqual(['Allaite, bébé de 4 mois']);
    expect(
      words({ breastfeeding: true, babyAgeWeeks: 4, babyAgeMonths: 1, babyAgeGivenOn: TODAY }),
    ).toEqual(['Allaite, bébé de 1 mois']);
    expect(words({ breastfeeding: true, babyAgeWeeks: 5, babyAgeGivenOn: TODAY })).toEqual([
      'Allaite, bébé de 5 semaines',
    ]);
    expect(words({ breastfeeding: true, babyBirthDate: '2026-10-28' })).toEqual([
      'Allaite, bébé de 1 semaine',
    ]);
    expect(words({ breastfeeding: true, babyBirthDate: TODAY })).toEqual([
      "Allaite, bébé de moins d'une semaine",
    ]);
    expect(words({ breastfeeding: true, babyAgeUnknown: true })).toEqual([
      'Allaite, âge du bébé inconnu',
    ]);
    expect(words({ breastfeeding: true })).toEqual(['Allaite, âge du bébé inconnu']);
  });

  it('says both when she is pregnant and breastfeeding, the pregnancy first', () => {
    expect(
      words(
        {
          pregnant: true,
          term: { kind: 'weeks', weeks: 12, givenOn: TODAY },
          breastfeeding: true,
          babyAgeWeeks: 40,
          babyAgeGivenOn: TODAY,
        },
        'en',
      ),
    ).toEqual(['About 12 weeks', 'Breastfeeding, baby 40 weeks old']);
  });
});
