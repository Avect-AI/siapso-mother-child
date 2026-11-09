// SPDX-License-Identifier: MIT
// Pseudonymous profiles, kept in IndexedDB on the phone only, sealed with
// their own data key under the code's wrapping key (domain/crypto.ts): what is
// stored is the profile's random id and the sealed record, nothing readable.
// They are read and written only while the code is open in this page
// (vault.ts), and written only with the code this tab opened (code-guard.ts).
import { isSealed, UnsealError } from '../domain/crypto.js';
import type { Profile } from '../domain/types.js';
import { requireCode } from './code-guard.js';
import { openAppDb, type SealedProfile } from './db.js';
import { openRecord, profileScope, sealRecord, vaultFingerprint, vaultKey } from './vault.js';

function byCreation(a: Profile, b: Profile): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function isSealedProfile(record: SealedProfile | Profile): record is SealedProfile {
  return 'sealed' in record && isSealed(record.sealed);
}

/**
 * The profile a stored record holds, opened with the session's key. A record
 * the code does not open (sealed under another code, changed, moved) is left
 * out: undefined, with a warning. So is a record in clear: once the code is
 * open its verifier is of version 2, and no legitimate record is in clear
 * (migration.ts); one was written into the storage from outside.
 */
async function profileOf(record: SealedProfile | Profile): Promise<Profile | undefined> {
  if (!isSealedProfile(record)) {
    console.warn('A profile in clear on this phone is not read: it is left out');
    return undefined;
  }
  try {
    const value = await openRecord(record.sealed, profileScope(record.id));
    if (typeof value === 'object' && value !== null && (value as Profile).id === record.id) {
      return value as Profile;
    }
  } catch (failure) {
    if (!(failure instanceof UnsealError)) throw failure;
  }
  console.warn('A profile on this phone does not open with this code: it is left out');
  return undefined;
}

/** Every profile, the oldest first (then by id, so the order never depends on storage). */
export async function listProfiles(): Promise<Profile[]> {
  vaultKey();
  const records = await (await openAppDb()).getAll('profiles');
  const profiles = await Promise.all(records.map(profileOf));
  return profiles.filter((profile) => profile !== undefined).sort(byCreation);
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  vaultKey();
  const record = await (await openAppDb()).get('profiles', id);
  return record === undefined ? undefined : profileOf(record);
}

/**
 * A profile saved again after it was deleted (in another tab, or from a form
 * left open): it is not written back.
 */
export class ProfileGoneError extends Error {
  constructor() {
    super('This profile was deleted from this phone: it is not written back');
    this.name = 'ProfileGoneError';
  }
}

/**
 * Stores `profile` sealed, replacing the one with the same id; NoCodeError
 * while no code is on the phone, LockedError while the code is not open here.
 * `existing`: the profile was read from storage (an edit), so it is written
 * only while its record is still there, checked in the same transaction
 * (ProfileGoneError otherwise, nothing written): a profile deleted meanwhile
 * never comes back. A new profile has no record until its first save.
 */
export async function saveProfile(
  profile: Profile,
  { existing = false }: { existing?: boolean } = {},
): Promise<void> {
  // Sealed before the transaction: a transaction cannot wait for WebCrypto.
  // Written only while the code it was sealed under is the one stored.
  const { sealed, fingerprint } = await sealRecord(profile, profileScope(profile.id));
  const tx = (await openAppDb()).transaction(['profiles', 'settings'], 'readwrite');
  await requireCode(tx, fingerprint);
  const profiles = tx.objectStore('profiles');
  if (existing && (await profiles.getKey(profile.id)) === undefined) {
    // Abandoned on purpose: its end is not an error to report.
    tx.done.catch(() => undefined);
    tx.abort();
    throw new ProfileGoneError();
  }
  await profiles.put({ id: profile.id, sealed });
  await tx.done;
}

/**
 * Removes the profile with this id and every history entry of it, in one
 * transaction (nothing of hers is left on the phone, or nothing is removed);
 * nothing happens when there is none. NoCodeError, and nothing removed, while
 * the code this tab opened is not on the phone (code-guard.ts) or is not open
 * here (LockedError).
 */
export async function deleteProfile(id: string): Promise<void> {
  // Only with the code whose key is open here.
  const fingerprint = vaultFingerprint();
  const tx = (await openAppDb()).transaction(['profiles', 'history', 'settings'], 'readwrite');
  await requireCode(tx, fingerprint);
  const history = tx.objectStore('history');
  const entries = await history.index('profileId').getAllKeys(id);
  await Promise.all([
    tx.objectStore('profiles').delete(id),
    ...entries.map((key) => history.delete(key)),
  ]);
  await tx.done;
}
