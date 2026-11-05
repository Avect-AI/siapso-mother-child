// SPDX-License-Identifier: MIT
// The danger signs as the screens list them: in groups (during pregnancy,
// after the birth, the baby), and for a check the groups of the profile
// first. Pure. A sign is never hidden for good: every group is one tap away,
// and a chosen sign keeps its group shown.
import type { DangerSign } from '@siapso/engine';
import type { Profile } from './types.js';

export type SignGroup = DangerSign['group'];

/** Every group, in the order the screens list them. */
export const SIGN_GROUPS: readonly SignGroup[] = ['pregnancy', 'postpartum', 'baby'];

/**
 * The groups a check asks about first: the pregnancy for a pregnant woman,
 * after the birth and the baby for one who breastfeeds, every group when she
 * is both, or when the profile is not known or says neither.
 */
export function groupsForProfile(
  profile: Pick<Profile, 'pregnant' | 'breastfeeding'> | null,
): SignGroup[] {
  if (profile === null) return [...SIGN_GROUPS];
  const groups: SignGroup[] = [];
  if (profile.pregnant) groups.push('pregnancy');
  if (profile.breastfeeding) groups.push('postpartum', 'baby');
  return groups.length === 0 ? [...SIGN_GROUPS] : groups;
}

/**
 * The groups shown: those of the profile, every group once she asked to see
 * all, and always the group of a sign that is chosen.
 */
export function shownGroups(
  signs: readonly DangerSign[],
  relevant: readonly SignGroup[],
  chosen: readonly string[],
  all: boolean,
): SignGroup[] {
  if (all) return [...SIGN_GROUPS];
  return SIGN_GROUPS.filter(
    (group) =>
      relevant.includes(group) ||
      signs.some((sign) => sign.group === group && chosen.includes(sign.id)),
  );
}

/** The signs of each group asked for, groups in their order and signs in the pack's; empty groups left out. */
export function signsByGroup(
  signs: readonly DangerSign[],
  groups: readonly SignGroup[],
): { group: SignGroup; signs: DangerSign[] }[] {
  return SIGN_GROUPS.filter((group) => groups.includes(group)).flatMap((group) => {
    const inGroup = signs.filter((sign) => sign.group === group);
    return inGroup.length === 0 ? [] : [{ group, signs: inGroup }];
  });
}
