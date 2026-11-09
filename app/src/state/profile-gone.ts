// SPDX-License-Identifier: MIT
// A profile deleted in another tab leaves every screen that shows it here:
// its form, its check, its result. The session hears of the deletion
// (session.tsx, tab-sync.ts) and forgets its list and its answers not saved;
// each screen then reads its own profile again, and goes to the start once it
// is no longer on the phone. A message alone never makes a screen leave: a
// forged one, or one about another profile, changes nothing.
import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { getProfile } from '../data/profiles.js';
import { useCheck } from './check-state.js';
import { useSession } from './session.js';

/**
 * Leaves the screen (for the start, in place of this entry) when a profile was
 * deleted in another tab and the profile `profileId` it shows is no longer on
 * the phone. Nothing for a screen with no saved profile (null).
 */
export function useLeaveWhenDeleted(profileId: string | null | undefined): void {
  const { deletedProfile } = useSession();
  const { forget } = useCheck();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (deletedProfile === null || profileId === null || profileId === undefined) return;
    // Another profile, named: this one stays.
    if (deletedProfile.id !== null && deletedProfile.id !== profileId) return;
    let live = true;
    getProfile(profileId).then(
      (found) => {
        if (!live || found !== undefined) return;
        forget(profileId);
        navigate('/', { replace: true });
      },
      () => {
        // Locked or unreadable: nothing of hers is on screen to leave.
      },
    );
    return () => {
      live = false;
    };
  }, [deletedProfile, profileId, forget, navigate]);
}
