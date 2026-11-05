// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it } from 'vitest';
import type { Profile } from '../domain/types.js';
import { verifierOf } from '../test/verifier.js';
import { closeAppDb, storeVerifier } from './db.js';
import { deleteProfile, getProfile, listProfiles, saveProfile } from './profiles.js';

// Profile data is written only while a code is on the phone (code-guard.ts).
beforeEach(async () => {
  await storeVerifier(await verifierOf('2468'));
});

function profile(id: string, createdAt: string, patch: Partial<Profile> = {}): Profile {
  return {
    id,
    pseudonym: `Profil ${id}`,
    pregnant: true,
    term: { kind: 'weeks', weeks: 26, givenOn: '2026-11-04' },
    breastfeeding: false,
    conditions: [],
    longTermItems: [],
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

describe('profiles', () => {
  it('lists nothing before the first profile', async () => {
    expect(await listProfiles()).toEqual([]);
    expect(await getProfile('none')).toBeUndefined();
  });

  it('reads back a saved profile exactly, also after the database is reopened', async () => {
    const saved = profile('a', '2026-11-04T08:00:00.000Z', {
      breastfeeding: true,
      babyBirthDate: '2026-10-01',
      premature: null,
      conditions: ['hiv-cotrimoxazole', 'sickle-cell'],
      longTermItems: [{ ref: { kind: 'product', id: 'bactrim' }, unitsPerDay: 2 }],
    });
    await saveProfile(saved);
    closeAppDb();

    expect(await getProfile('a')).toEqual(saved);
  });

  it('lists the profiles from the oldest, then by id', async () => {
    await saveProfile(profile('c', '2026-11-03T08:00:00.000Z'));
    await saveProfile(profile('b', '2026-11-01T08:00:00.000Z'));
    await saveProfile(profile('a', '2026-11-03T08:00:00.000Z'));

    expect((await listProfiles()).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  it('replaces a profile saved again under the same id', async () => {
    await saveProfile(profile('a', '2026-11-01T08:00:00.000Z'));
    await saveProfile(
      profile('a', '2026-11-01T08:00:00.000Z', {
        pseudonym: 'Awa',
        updatedAt: '2026-11-04T09:00:00.000Z',
      }),
    );

    const all = await listProfiles();
    expect(all).toHaveLength(1);
    expect(all[0]?.pseudonym).toBe('Awa');
  });

  it('deletes a profile, and deleting one that is not there is not an error', async () => {
    await saveProfile(profile('a', '2026-11-01T08:00:00.000Z'));
    await saveProfile(profile('b', '2026-11-02T08:00:00.000Z'));

    await deleteProfile('a');
    await deleteProfile('missing');

    expect((await listProfiles()).map((p) => p.id)).toEqual(['b']);
  });
});
