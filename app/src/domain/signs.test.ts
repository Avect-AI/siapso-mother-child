// SPDX-License-Identifier: MIT
import type { DangerSign } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import { groupsForProfile, shownGroups, signsByGroup, SIGN_GROUPS } from './signs.js';

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
  it('asks about the pregnancy for a pregnant woman, after the birth and the baby when she breastfeeds', () => {
    expect(groupsForProfile({ pregnant: true, breastfeeding: false })).toEqual(['pregnancy']);
    expect(groupsForProfile({ pregnant: false, breastfeeding: true })).toEqual([
      'postpartum',
      'baby',
    ]);
    expect(groupsForProfile({ pregnant: true, breastfeeding: true })).toEqual(SIGN_GROUPS);
  });

  it('asks about every group when the profile is not known or says neither', () => {
    expect(groupsForProfile(null)).toEqual(SIGN_GROUPS);
    expect(groupsForProfile({ pregnant: false, breastfeeding: false })).toEqual(SIGN_GROUPS);
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
