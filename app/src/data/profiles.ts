// SPDX-License-Identifier: MIT
// Pseudonymous profiles, kept in IndexedDB on the phone only.
import type { Profile } from '../domain/types.js';
import { openAppDb } from './db.js';

function byCreation(a: Profile, b: Profile): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Every profile, the oldest first (then by id, so the order never depends on storage). */
export async function listProfiles(): Promise<Profile[]> {
  return (await (await openAppDb()).getAll('profiles')).sort(byCreation);
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  return (await openAppDb()).get('profiles', id);
}

/** Stores `profile`, replacing the one with the same id. */
export async function saveProfile(profile: Profile): Promise<void> {
  await (await openAppDb()).put('profiles', profile);
}

/** Removes the profile with this id; nothing happens when there is none. */
export async function deleteProfile(id: string): Promise<void> {
  await (await openAppDb()).delete('profiles', id);
}
