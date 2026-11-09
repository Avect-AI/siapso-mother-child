// SPDX-License-Identifier: MIT
import type { DangerSign } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import { groupsForProfile, shownGroups, signsByGroup, SIGN_GROUPS } from './signs.js';
import type { Profile, TermInput } from './types.js';

function sign(id: string, group: DangerSign['group']): DangerSign {
  return { id, group, label: { fr: id, en: id }, sources: [] };
}

const SIGNS = [
  sign('fever', 'pregnancy'),
  sign('baby-fever', 'baby'),
  sign('bleeding', 'pregnancy'),
  sign('heavy-bleeding', 'postpartum'),
];

describe('groupsForProfile', () => {
  const TODAY = '2026-11-04';
  const weeks30: TermInput = { kind: 'weeks', weeks: 30, givenOn: TODAY };

  function profile(patch: Partial<Profile>): Profile {
    return {
      id: 'p1',
      pseudonym: 'Awa',
      pregnant: false,
      breastfeeding: false,
      conditions: [],
      longTermItems: [],
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      ...patch,
    };
  }

  it('asks about the pregnancy for a pregnant woman, after the birth and the baby when she breastfeeds', () => {
    expect(groupsForProfile(profile({ pregnant: true, term: weeks30 }), TODAY)).toEqual([
      'pregnancy',
    ]);
    expect(groupsForProfile(profile({ breastfeeding: true }), TODAY)).toEqual([
      'postpartum',
      'baby',
    ]);
    expect(
      groupsForProfile(profile({ pregnant: true, term: weeks30, breastfeeding: true }), TODAY),
    ).toEqual(SIGN_GROUPS);
  });

  it('asks about every group when the profile is not known or says neither', () => {
    expect(groupsForProfile(null, TODAY)).toEqual(SIGN_GROUPS);
    expect(groupsForProfile(profile({}), TODAY)).toEqual(SIGN_GROUPS);
  });

  it('asks about every group when the baby may be born: a possibly past term', () => {
    // An unknown term given 40 days ago, 42 weeks given yesterday.
    for (const term of [
      { kind: 'unknown', givenOn: '2026-09-25' },
      { kind: 'weeks', weeks: 42, givenOn: '2026-11-03' },
    ] as const) {
      expect(groupsForProfile(profile({ pregnant: true, term }), TODAY), term.kind).toEqual(
        SIGN_GROUPS,
      );
    }
  });

  it('asks about every group when the phone clock is set back, as the check reads it', () => {
    // Before the day the term was given, before the last save, before a day the app has seen.
    expect(
      groupsForProfile(
        profile({ pregnant: true, term: { kind: 'weeks', weeks: 30, givenOn: '2026-12-01' } }),
        TODAY,
      ),
    ).toEqual(SIGN_GROUPS);
    expect(
      groupsForProfile(
        profile({ pregnant: true, term: weeks30, updatedAt: '2026-11-20T10:00:00.000Z' }),
        TODAY,
      ),
    ).toEqual(SIGN_GROUPS);
    expect(
      groupsForProfile(profile({ pregnant: true, term: weeks30 }), TODAY, '2026-11-20'),
    ).toEqual(SIGN_GROUPS);
    expect(groupsForProfile(profile({ pregnant: true, term: weeks30 }), TODAY, TODAY)).toEqual([
      'pregnancy',
    ]);
  });

  it('asks about every group on an outdated term (the result then asks to update it)', () => {
    expect(
      groupsForProfile(
        profile({ pregnant: true, term: { kind: 'lmp', date: '2025-11-01' } }),
        TODAY,
      ),
    ).toEqual(SIGN_GROUPS);
  });
});

describe('signsByGroup', () => {
  it('sets the signs in their groups, in the order of the groups then of the pack', () => {
    expect(signsByGroup(SIGNS, SIGN_GROUPS)).toEqual([
      { group: 'pregnancy', signs: [SIGNS[0], SIGNS[2]] },
      { group: 'postpartum', signs: [SIGNS[3]] },
      { group: 'baby', signs: [SIGNS[1]] },
    ]);
  });

  it('keeps only the groups asked for, and drops a group without a sign', () => {
    expect(signsByGroup(SIGNS, ['baby'])).toEqual([{ group: 'baby', signs: [SIGNS[1]] }]);
    expect(signsByGroup([sign('fever', 'pregnancy')], SIGN_GROUPS)).toEqual([
      { group: 'pregnancy', signs: [SIGNS[0]] },
    ]);
  });
});

describe('shownGroups', () => {
  it('shows the groups of the profile, and every group once asked', () => {
    expect(shownGroups(SIGNS, ['pregnancy'], [], false)).toEqual(['pregnancy']);
    expect(shownGroups(SIGNS, ['pregnancy'], [], true)).toEqual(SIGN_GROUPS);
  });

  it('never hides a sign that is chosen: its group stays shown', () => {
    expect(shownGroups(SIGNS, ['pregnancy'], ['baby-fever'], false)).toEqual(['pregnancy', 'baby']);
  });
});
