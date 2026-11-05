// SPDX-License-Identifier: MIT
import { latestHistoryAt } from '../data/history.js';
import { getProfile } from '../data/profiles.js';
import type { Profile } from '../domain/types.js';

/** The profile a check is for, and when her last result was kept (none for a passer-by). */
export interface CheckProfile {
  profile: Profile | undefined;
  lastAt: string | undefined;
}

/**
 * The profile of the check `profileId`: the passer-by's answers kept in
 * memory (`quick`, a check without saving: no history), else the profile
 * stored on the phone with the day of her last result kept.
 */
export async function readCheckProfile(
  profileId: string,
  quick: Profile | null,
): Promise<CheckProfile> {
  if (quick !== null && quick.id === profileId) return { profile: quick, lastAt: undefined };
  const profile = await getProfile(profileId);
  return { profile, lastAt: profile ? await latestHistoryAt(profileId) : undefined };
}
