// SPDX-License-Identifier: MIT
// The danger signs as the screens list them: in groups (during pregnancy,
// after the birth, the baby), and for a check the groups of the profile
// first. Pure. A sign is never hidden for good: every group is one tap away,
// and a chosen sign keeps its group shown.
import type { DangerSign } from '@siapso/engine';
import { babyMayBeBorn, profileTermStatus } from './term.js';
import type { Profile } from './types.js';

export type SignGroup = DangerSign['group'];

/** Every group, in the order the screens list them. */
export const SIGN_GROUPS: readonly SignGroup[] = ['pregnancy', 'postpartum', 'baby'];

/**
 * The groups a check asks about first: the pregnancy for a pregnant woman,
 * after the birth and the baby for one who breastfeeds, every group when she
 * is both, or when the profile is not known or says neither. When the baby
 * may be born (babyMayBeBorn: a possibly past term, an outdated one, a phone
 * clock set back), the check reads breastfeeding as possible: every group.
 * `todayIso` and `notBefore` are those of the check (profileTermStatus).
 */
export function groupsForProfile(
  profile: Pick<
    Profile,
    'pregnant' | 'pregnancyUnsure' | 'pregnancyUnsureOn' | 'term' | 'updatedAt' | 'breastfeeding'
  > | null,
  todayIso: string,
  notBefore?: string,
): SignGroup[] {
  if (profile === null) return [...SIGN_GROUPS];
  if (babyMayBeBorn(profileTermStatus(profile, todayIso, notBefore))) return [...SIGN_GROUPS];
  const groups: SignGroup[] = [];
  if (profile.pregnant) groups.push('pregnancy');
  if (profile.breastfeeding) groups.push('postpartum', 'baby');
  return groups.length === 0 ? [...SIGN_GROUPS] : groups;
}

/**
 * What an answer to the danger signs question was given for (SCRUM-56, S14
 * and 8.5): her answers as saved (profile id and last save), the day, and the
 * groups of signs asked first. The answer holds only while this key is the
 * same: a new day, her answers saved again, or other signs to ask (her term
 * read as possibly past at midnight) ask the question again, and no result is
 * shown on the old answer meanwhile. No profile (not read): every group.
 */
export function signsAnswerKey(
  profile: Pick<
    Profile,
    | 'id'
    | 'pregnant'
    | 'pregnancyUnsure'
    | 'pregnancyUnsureOn'
    | 'term'
    | 'updatedAt'
    | 'breastfeeding'
  > | null,
  todayIso: string,
  notBefore?: string,
): string {
  const groups = groupsForProfile(profile, todayIso, notBefore).join('+');
  return [profile?.id ?? '', profile?.updatedAt ?? '', todayIso, groups].join('|');
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
