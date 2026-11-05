// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, Profile } from '../domain/types.js';
import { verifierOf } from '../test/verifier.js';
import { codeOpened, NoCodeError } from './code-guard.js';
import { closeAppDb, storeVerifier } from './db.js';
import { listHistory, recordHistory } from './history.js';
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

  it('deletes the history of the profile with it, and only hers', async () => {
    await saveProfile(profile('a', '2026-11-01T08:00:00.000Z'));
    await saveProfile(profile('b', '2026-11-02T08:00:00.000Z'));
    const entry = (id: string, profileId: string): HistoryEntry => ({
      id,
      profileId,
      at: '2026-11-04T10:00:00.000Z',
      packVersion: '0.1.0',
      level: 'unknown',
      ruleIds: [],
      items: [{ ref: { kind: 'product', id: 'doliprane-500' } }],
      signs: [],
    });
    await recordHistory(entry('h1', 'a'));
    await recordHistory(entry('h2', 'a'));
    await recordHistory(entry('h3', 'b'));

    await deleteProfile('a');

    expect(await getProfile('a')).toBeUndefined();
    expect(await listHistory('a')).toEqual([]);
    expect((await listHistory('b')).map((h) => h.id)).toEqual(['h3']);
  });

  it('deletes nothing from a tab whose code is no longer the one on the phone', async () => {
    const hers = await verifierOf('2468');
    codeOpened(hers);
    await saveProfile(profile('a', '2026-11-01T08:00:00.000Z'));
    await recordHistory({
      id: 'h1',
      profileId: 'a',
      at: '2026-11-04T10:00:00.000Z',
      packVersion: '0.1.0',
      level: 'unknown',
      ruleIds: [],
      items: [{ ref: { kind: 'product', id: 'doliprane-500' } }],
      signs: [],
    });
    // Another code made since (after an erase, from another tab).
    await storeVerifier(await verifierOf('1111'));

    await expect(deleteProfile('a')).rejects.toBeInstanceOf(NoCodeError);
    expect(await getProfile('a')).toBeDefined();
    expect(await listHistory('a')).toHaveLength(1);
  });
});
