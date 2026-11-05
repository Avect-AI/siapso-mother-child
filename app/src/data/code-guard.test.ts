// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../domain/types.js';
import { profileOf } from '../test/knowledge-pack.js';
import { storeTestCode } from '../test/render-app.js';
import { verifierOf } from '../test/verifier.js';
import { CodeExistsError, codeFingerprint, codeOpened, NoCodeError } from './code-guard.js';
import {
  eraseProfilesAndCode,
  getStoredSettings,
  getStoredVerifier,
  openAppDb,
  storeNewVerifier,
  storeSettings,
  storeVerifier,
} from './db.js';
import { recordHistory } from './history.js';
import { listProfiles, saveProfile } from './profiles.js';
import { loadSavedContacts, saveContacts } from './referral.js';

const entry: HistoryEntry = {
  id: 'h1',
  profileId: 'a',
  at: '2026-11-04T10:00:00.000Z',
  packVersion: '0.1.0',
  level: 'unknown',
  ruleIds: [],
  items: [{ ref: { kind: 'plant', id: 'kinkeliba' } }],
  signs: [],
};

const contact = { id: 'c1', role: 'relay', name: 'Mariama', phone: '000 000 001' } as const;

afterEach(() => {
  codeOpened(null);
});

describe('the code made at the welcome', () => {
  it('is stored only when no code is on the phone: a second one is refused, the first kept', async () => {
    const hers = await verifierOf('2468');
    await storeNewVerifier(hers);

    await expect(storeNewVerifier(await verifierOf('1111'))).rejects.toBeInstanceOf(
      CodeExistsError,
    );
    expect(await getStoredVerifier()).toEqual(hers);
  });
});

describe('the code a tab opened', () => {
  it('is the only one its writes go through with: another code made since refuses them', async () => {
    const hers = await verifierOf('2468');
    await storeVerifier(hers);
    codeOpened(hers);
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Aminata' }));

    // Erased, then someone else made his code; this tab still holds hers.
    await eraseProfilesAndCode();
    await storeVerifier(await verifierOf('1111'));

    await expect(saveProfile(profileOf({ id: 'a', pseudonym: 'Aminata' }))).rejects.toBeInstanceOf(
      NoCodeError,
    );
    await expect(recordHistory(entry)).rejects.toBeInstanceOf(NoCodeError);
    await expect(saveContacts([contact])).rejects.toBeInstanceOf(NoCodeError);
    expect(await listProfiles()).toEqual([]);
  });

  it('is told apart by the salt and hash of its verifier only, never the code itself', async () => {
    const hers = await verifierOf('2468');
    expect(codeFingerprint(hers)).toBe(`${hers.salt}.${hers.hash}`);
    expect(codeFingerprint(hers)).not.toContain('2468');
  });
});

describe('settings written from a tab', () => {
  const woman = { lang: 'fr', mode: 'woman', onboarded: true } as const;

  it('never change the mode or the welcome from a tab whose code is not the one stored', async () => {
    // As the welcome leaves it: the answers, then her code.
    const hers = await verifierOf('2468');
    await storeSettings(woman);
    await storeVerifier(hers);

    // A tab that never opened this code (left on the welcome): the language only.
    await storeSettings({ ...woman, lang: 'en' });
    await expect(storeSettings({ ...woman, mode: 'accompanied' })).rejects.toBeInstanceOf(
      NoCodeError,
    );
    await expect(storeSettings({ ...woman, onboarded: false })).rejects.toBeInstanceOf(NoCodeError);
    expect(await getStoredSettings()).toEqual({ ...woman, lang: 'en' });

    // A tab that opened another code than the one stored now.
    codeOpened(await verifierOf('1111'));
    await expect(storeSettings({ ...woman, mode: 'accompanied' })).rejects.toBeInstanceOf(
      NoCodeError,
    );

    // The tab that opened her code changes the mode.
    codeOpened(hers);
    await storeSettings({ ...woman, mode: 'accompanied' });
    expect((await getStoredSettings())?.mode).toBe('accompanied');
  });

  it('are free on a phone with no code: the welcome stores its answers', async () => {
    await storeSettings({ lang: 'en', mode: null, onboarded: false });
    await storeSettings({ lang: 'en', mode: 'woman', onboarded: false });
    expect((await getStoredSettings())?.mode).toBe('woman');
  });
});

describe('writes about a profile', () => {
  it('are refused while no code is on the phone, and nothing is kept', async () => {
    await expect(saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }))).rejects.toBeInstanceOf(
      NoCodeError,
    );
    await expect(recordHistory(entry)).rejects.toBeInstanceOf(NoCodeError);
    await expect(saveContacts([contact])).rejects.toBeInstanceOf(NoCodeError);

    expect(await listProfiles()).toEqual([]);
    expect(await (await openAppDb()).getAll('history')).toEqual([]);
    expect(await loadSavedContacts()).toEqual([]);
  });

  it('go through once a code is on the phone', async () => {
    await storeTestCode();

    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    await recordHistory(entry);
    await saveContacts([contact]);

    expect((await listProfiles()).map((profile) => profile.pseudonym)).toEqual(['Awa']);
    expect(await (await openAppDb()).getAll('history')).toHaveLength(1);
    expect(await loadSavedContacts()).toHaveLength(1);
  });

  it('from a tab left open after the forgotten-code erase never come back', async () => {
    await storeTestCode();
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));

    await eraseProfilesAndCode();

    // The stale tab saves her profile again: refused, the phone stays empty.
    await expect(saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }))).rejects.toBeInstanceOf(
      NoCodeError,
    );
    expect(await listProfiles()).toEqual([]);
  });
});
