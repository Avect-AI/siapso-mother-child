// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';
import { createCodeKeys, openCode, type CodeKeys, type CodeVerifier } from '../domain/code.js';
import { seal } from '../domain/crypto.js';
import type { HistoryEntry, Profile, ReferralContact } from '../domain/types.js';
import { failWrites } from '../test/idb.js';
import { profileOf } from '../test/knowledge-pack.js';
import {
  codeKeysOf,
  legacyVerifier,
  openVaultOf,
  weakVerifier,
  withoutLength,
} from '../test/verifier.js';
import { CodeExistsError, codeFingerprint, NoCodeError } from './code-guard.js';
import { getStoredVerifier, openAppDb, storeVerifier } from './db.js';
import { listHistory, recordHistory } from './history.js';
import { SealTimeoutError, sealStoredData, storeNewCode } from './migration.js';
import { getProfile, listProfiles, saveProfile } from './profiles.js';
import { loadSavedContacts, saveContacts } from './referral.js';
import { openVault, profileScope } from './vault.js';

const CODE = '2468';

const aminata: Profile = {
  ...profileOf({ id: 'a', pseudonym: 'Aminata' }),
  conditions: ['hiv-cotrimoxazole'],
  term: { kind: 'lmp', date: '2026-08-01' },
};

const ndeye: Profile = {
  ...profileOf({ id: 'b', pseudonym: 'Ndeye' }),
  conditions: ['sickle-cell'],
};

const checked: HistoryEntry = {
  id: 'h1',
  profileId: 'a',
  at: '2026-11-04T10:00:00.000Z',
  packVersion: '0.1.0',
  level: 'danger',
  ruleIds: ['misoprostol-pregnancy'],
  items: [{ ref: { kind: 'unrecognised', text: 'pilule secrete zx' } }],
  signs: ['fever'],
};

const midwife: ReferralContact = {
  id: 'c1',
  role: 'midwife',
  name: 'Awa Diop',
  phone: '000 000 001',
};

/** What an older version left on the phone: everything in clear (and the code's verifier, when given). */
async function seedInClear(verifier?: CodeVerifier): Promise<void> {
  if (verifier) await storeVerifier(verifier);
  const db = await openAppDb();
  await db.put('profiles', aminata);
  await db.put('profiles', ndeye);
  await db.put('history', checked);
  await db.put('contacts', [midwife], 'saved');
}

/** Every record of the profile stores, as a forensic reader of the storage would see them. */
async function dump(): Promise<string> {
  const db = await openAppDb();
  return JSON.stringify([
    await db.getAll('profiles'),
    await db.getAll('history'),
    await db.getAll('contacts'),
  ]);
}

/** How many records the profile stores hold. */
async function counts(): Promise<number[]> {
  const db = await openAppDb();
  return [await db.count('profiles'), await db.count('history'), await db.count('contacts')];
}

const CLEAR = [
  'Aminata',
  'Ndeye',
  'hiv-cotrimoxazole',
  'sickle-cell',
  '2026-08-01',
  'pilule',
  'misoprostol',
  'Awa Diop',
  '000 000 001',
];

function expectNothingInClear(text: string): void {
  for (const clear of CLEAR) expect(text, clear).not.toContain(clear);
}

/** Everything read back through the app with the key of `keys`. */
async function readAll(keys: CodeKeys) {
  openVault(keys.wrappingKey);
  return {
    profiles: await listProfiles(),
    history: await listHistory('a'),
    contacts: await loadSavedContacts(),
  };
}

const original = { profiles: [aminata, ndeye], history: [checked], contacts: [midwife] };

/** The code of an older version opened: its fingerprint, and no key. */
async function legacyOpened(): Promise<{
  old: CodeVerifier;
  current: { fingerprint: string; wrappingKey: null };
}> {
  const old = await legacyVerifier(CODE);
  return { old, current: { fingerprint: codeFingerprint(old), wrappingKey: null } };
}

describe('the update from a verifier of the format in clear', () => {
  it('seals every profile, history entry and contact, and stores the new verifier in one go', async () => {
    const { old, current } = await legacyOpened();
    await seedInClear(old);
    const next = await createCodeKeys(CODE);

    const outcome = await sealStoredData({ current, next });

    expect(outcome).toEqual({ sealed: 4, rewrapped: 0, deleted: 0, skipped: 0 });
    expect(await getStoredVerifier()).toEqual(next.verifier);
    expectNothingInClear(await dump());
    expect(await readAll(next)).toEqual(original);
  });

  it('a crash in the middle leaves everything as it was, in clear and readable: never half done', async () => {
    const { old, current } = await legacyOpened();
    await seedInClear(old);
    const before = await dump();
    const next = await createCodeKeys(CODE);
    // The third write of the transaction fails, as a tab closed in the middle
    // would: the first two went through.
    const crash = failWrites((_store, write) => write === 3);

    await expect(sealStoredData({ current, next })).rejects.toThrow();
    crash.restore();

    expect(crash.writes()).toBe(3);
    expect(await dump()).toBe(before);
    expect(await getStoredVerifier()).toEqual(old);
    // The next unlock seals it all.
    await sealStoredData({ current, next });
    expectNothingInClear(await dump());
    expect(await readAll(next)).toEqual(original);
  });

  it('starts again when another tab writes in the middle, so no record is left behind', async () => {
    const { old, current } = await legacyOpened();
    await seedInClear(old);
    const next = await createCodeKeys(CODE);
    const late: Profile = { ...profileOf({ id: 'z', pseudonym: 'Coumba' }) };
    // While the first pass encrypts, another tab (an older version) adds a profile in clear.
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let added = false;
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
      if (!added) {
        added = true;
        await (await openAppDb()).put('profiles', late);
      }
      return encrypt(...args);
    });

    await sealStoredData({ current, next });
    vi.restoreAllMocks();

    expect(await dump()).not.toContain('Coumba');
    openVault(next.wrappingKey);
    expect(await getProfile('z')).toEqual(late);
  });

  it('leaves out, and says so, a sealed record it has no key for, instead of failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { old, current } = await legacyOpened();
    await seedInClear(old);
    // A record sealed under some other key, next to the records in clear.
    const stray = await seal(ndeye, (await codeKeysOf('1357')).wrappingKey, profileScope('s'));
    await (await openAppDb()).put('profiles', { id: 's', sealed: stray });
    const next = await createCodeKeys(CODE);

    const outcome = await sealStoredData({ current, next });

    expect(outcome).toEqual({ sealed: 4, rewrapped: 0, deleted: 0, skipped: 1 });
    expect(await getStoredVerifier()).toEqual(next.verifier);
    expect(await readAll(next)).toEqual(original);
    expect(warn).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('needs the new verifier to seal with', async () => {
    const { old, current } = await legacyOpened();
    await seedInClear(old);
    const before = await dump();

    await expect(sealStoredData({ current })).rejects.toThrow();
    expect(await dump()).toBe(before);
  });
});

describe('a phone that has a version 2 verifier', () => {
  it('deletes a record in clear, never seals it: no legitimate record is in clear any more', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const keys = await codeKeysOf(CODE);
    await storeVerifier(keys.verifier);
    await openVaultOf(CODE);
    await saveProfile(ndeye);
    // Someone writes records in clear into the storage.
    const db = await openAppDb();
    await db.put('profiles', aminata);
    await db.put('history', checked);
    await db.put('contacts', [{ ...midwife, phone: '000 000 999' }], 'saved');

    const outcome = await sealStoredData({
      current: { fingerprint: codeFingerprint(keys.verifier), wrappingKey: keys.wrappingKey },
    });

    expect(outcome).toEqual({ sealed: 0, rewrapped: 0, deleted: 3, skipped: 0 });
    expect(await counts()).toEqual([1, 0, 0]);
    expect(await listProfiles()).toEqual([ndeye]);
    expect(await dump()).not.toMatch(/Aminata|000 000 999|pilule/);
    warn.mockRestore();
  });

  it('writes nothing when everything is sealed already', async () => {
    const keys = await codeKeysOf(CODE);
    await storeVerifier(keys.verifier);
    await openVaultOf(CODE);
    await saveProfile(aminata);
    const before = await dump();

    const outcome = await sealStoredData({
      current: { fingerprint: codeFingerprint(keys.verifier), wrappingKey: keys.wrappingKey },
    });

    expect(outcome).toEqual({ sealed: 0, rewrapped: 0, deleted: 0, skipped: 0 });
    expect(await dump()).toBe(before);
  });

  it("adds the code's length to a verifier kept without it, in the same pass, the code unchanged", async () => {
    const keys = await codeKeysOf(CODE);
    const before = withoutLength(keys.verifier);
    await storeVerifier(before);
    await openVaultOf(CODE);
    await saveProfile(aminata);
    // Someone writes a record in clear: the same transaction sweeps it.
    await (await openAppDb()).put('history', checked);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const outcome = await sealStoredData({
      current: { fingerprint: codeFingerprint(before), wrappingKey: keys.wrappingKey },
      codeLength: CODE.length,
    });

    expect(outcome).toEqual({ sealed: 0, rewrapped: 0, deleted: 1, skipped: 0 });
    // The same salt and hash: the same code, the same key, every tab still opened on it.
    expect(await getStoredVerifier()).toEqual({ ...before, length: 4 });
    expect(await listProfiles()).toEqual([aminata]);
    vi.restoreAllMocks();
  });

  it('leaves a length already kept as it is, and keeps none it was not given', async () => {
    const keys = await codeKeysOf(CODE);
    await storeVerifier(keys.verifier);
    const without = withoutLength(keys.verifier);
    const current = { fingerprint: codeFingerprint(keys.verifier), wrappingKey: keys.wrappingKey };

    await sealStoredData({ current, codeLength: 6 });
    expect(await getStoredVerifier()).toEqual(keys.verifier);

    await storeVerifier(without);
    await sealStoredData({ current });
    expect(await getStoredVerifier()).toEqual(without);
    // A length that is not one of a code is never written.
    await sealStoredData({ current, codeLength: 9 });
    expect(await getStoredVerifier()).toEqual(without);
  });

  it('with a verifier made again: wraps every data key for the new key, skipping one that does not open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const weak = await weakVerifier(CODE, 1000, { split: true });
    await storeVerifier(weak);
    const before = await openCode(CODE, weak);
    if (!before?.wrappingKey) throw new Error('no key');
    openVault(before.wrappingKey);
    await saveProfile(aminata);
    await recordHistory(checked);
    await saveContacts([midwife]);
    // A record sealed under another key, that this code does not open.
    const stray = await seal(ndeye, (await codeKeysOf('1357')).wrappingKey, profileScope('s'));
    await (await openAppDb()).put('profiles', { id: 's', sealed: stray });
    const next = await createCodeKeys(CODE);

    const outcome = await sealStoredData({
      current: { fingerprint: codeFingerprint(weak), wrappingKey: before.wrappingKey },
      next,
    });

    expect(outcome).toEqual({ sealed: 0, rewrapped: 3, deleted: 0, skipped: 1 });
    expect(await getStoredVerifier()).toEqual(next.verifier);
    openVault(next.wrappingKey);
    expect(await listProfiles()).toEqual([aminata]);
    expect(await listHistory('a')).toEqual([checked]);
    expect(await loadSavedContacts()).toEqual([midwife]);
    // The old key opens nothing any more.
    openVault(before.wrappingKey);
    expect(await listProfiles()).toEqual([]);
    warn.mockRestore();
  });

  it('changes nothing when the code on the phone is not the one opened', async () => {
    const keys = await codeKeysOf(CODE);
    await seedInClear(keys.verifier);
    const before = await dump();
    const other = await codeKeysOf('1357');

    await expect(
      sealStoredData({
        current: { fingerprint: codeFingerprint(other.verifier), wrappingKey: other.wrappingKey },
      }),
    ).rejects.toBeInstanceOf(NoCodeError);
    expect(await dump()).toBe(before);
  });

  it('says another code is on the phone before anything else, even where it could not seal', async () => {
    // Another tab already made the verifier again and sealed everything with its key.
    const { current } = await legacyOpened();
    const made = await codeKeysOf(CODE);
    await storeVerifier(made.verifier);
    openVault(made.wrappingKey);
    await saveProfile(aminata);
    const before = await dump();

    await expect(
      sealStoredData({ current, next: await createCodeKeys(CODE) }),
    ).rejects.toBeInstanceOf(NoCodeError);
    expect(await dump()).toBe(before);
    expect(await getStoredVerifier()).toEqual(made.verifier);
  });
});

describe('storage that does not answer in time', () => {
  /** Holds a readwrite transaction on every profile store, as another tab in the middle of a write. */
  async function holdStores(): Promise<() => Promise<void>> {
    await openAppDb();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('siapso');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('cannot open the database'));
      };
    });
    const tx = db.transaction(['settings', 'profiles', 'history', 'contacts'], 'readwrite');
    const store = tx.objectStore('settings');
    let held = true;
    const spin = () => {
      if (held) store.get('code').onsuccess = spin;
    };
    spin();
    const done = new Promise<void>((resolve) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    });
    return () => {
      held = false;
      return done;
    };
  }

  it('times the storage steps only: a slow encryption still seals', async () => {
    const { old, current } = await legacyOpened();
    await seedInClear(old);
    const next = await createCodeKeys(CODE);
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return encrypt(...args);
    });

    // Eight encryptions of 60 ms, far more than the 100 ms of a storage step.
    const outcome = await sealStoredData({ current, next, storageTimeoutMs: 100 });
    vi.restoreAllMocks();

    expect(outcome.sealed).toBe(4);
    expect(await getStoredVerifier()).toEqual(next.verifier);
  });

  it('writes nothing when its write does not start in time, and says so', async () => {
    const { old, current } = await legacyOpened();
    await seedInClear(old);
    const before = await dump();
    const next = await createCodeKeys(CODE);
    // Another tab holds the stores once the records are read.
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    let release: (() => Promise<void>) | null = null;
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => {
      release ??= await holdStores();
      return encrypt(...args);
    });

    await expect(sealStoredData({ current, next, storageTimeoutMs: 150 })).rejects.toBeInstanceOf(
      SealTimeoutError,
    );
    vi.restoreAllMocks();
    await (release as (() => Promise<void>) | null)?.();

    expect(await dump()).toBe(before);
    expect(await getStoredVerifier()).toEqual(old);
  });
});

describe('a code made on a phone that kept profiles in clear (before codes existed)', () => {
  it('stores the verifier and the sealed records in one transaction', async () => {
    await seedInClear();
    const keys = await createCodeKeys(CODE);

    await storeNewCode(keys);

    expect(await getStoredVerifier()).toEqual(keys.verifier);
    expectNothingInClear(await dump());
    expect(await readAll(keys)).toEqual(original);
  });

  it('refuses, and changes nothing, when a code is already on the phone', async () => {
    const hers = await codeKeysOf(CODE);
    await storeVerifier(hers.verifier);
    await seedInClear();
    const before = await dump();

    await expect(storeNewCode(await createCodeKeys('1357'))).rejects.toBeInstanceOf(
      CodeExistsError,
    );
    expect(await dump()).toBe(before);
    expect(await getStoredVerifier()).toEqual(hers.verifier);
  });
});
