// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { describe, expect, it, vi } from 'vitest';
import { verifierOf } from '../test/verifier.js';
import {
  clearTabMarks,
  closeAppDb,
  eraseProfilesAndCode,
  getStoredLockout,
  getStoredPack,
  getStoredSettings,
  getStoredVerifier,
  openAppDb,
  readTabMarks,
  restorePreviousPack,
  storeLockout,
  storePack,
  storeSettings,
  storeVerifier,
  updateTabMarks,
} from './db.js';

const pack = (version: string) => ({ version }) as unknown as Pack;

/** Opens the database at a version with the raw API, creating the version 1 stores on upgrade. */
function openRaw(version: number, upgrade?: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('siapso', version);
    request.onupgradeneeded = () => {
      upgrade?.(request.result);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('open failed'));
    };
  });
}

describe('openAppDb', () => {
  it('creates the pack, settings, profiles, history and contacts stores', async () => {
    const db = await openAppDb();

    expect([...db.objectStoreNames].sort()).toEqual([
      'contacts',
      'history',
      'pack',
      'profiles',
      'settings',
    ]);
    expect(db.transaction('profiles').store.keyPath).toBe('id');
    expect(db.transaction('history').store.keyPath).toBe('id');
    expect(db.transaction('history').store.indexNames.contains('profileId')).toBe(true);
  });

  it('adds the contacts store to a version 1 database and keeps what it holds', async () => {
    const old = await openRaw(1, (db) => {
      db.createObjectStore('pack');
      db.createObjectStore('settings');
      db.createObjectStore('profiles', { keyPath: 'id' });
      db.createObjectStore('history', { keyPath: 'id' }).createIndex('profileId', 'profileId');
    });
    await new Promise<void>((resolve) => {
      const tx = old.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ lang: 'en', mode: 'woman', onboarded: true }, 'settings');
      tx.oncomplete = () => {
        resolve();
      };
    });
    old.close();

    const db = await openAppDb();
    expect(db.version).toBe(2);
    expect(db.objectStoreNames.contains('contacts')).toBe(true);
    expect(await getStoredSettings()).toEqual({ lang: 'en', mode: 'woman', onboarded: true });
  });

  it('opens once and shares the connection until it is closed', async () => {
    const first = await openAppDb();
    expect(await openAppDb()).toBe(first);

    closeAppDb();
    expect(await openAppDb()).not.toBe(first);
  });

  it('gives way when another tab opens a newer version, instead of blocking it', async () => {
    await openAppDb();

    const newer = await openRaw(3);

    expect(newer.version).toBe(3);
    newer.close();
  });
});

describe('storePack', () => {
  it('stores a pack once and does not rewrite it when version and hashes are the same', async () => {
    expect(await storePack(pack('0.1.0'), '0.1.0 aaa')).toBe('stored');
    expect(await storePack(pack('0.1.0'), '0.1.0 aaa')).toBe('unchanged');

    expect(await getStoredPack('current')).toEqual({
      pack: pack('0.1.0'),
      fingerprint: '0.1.0 aaa',
    });
    expect(await getStoredPack('previous')).toBeUndefined();
  });

  it('refuses, in its transaction, another content under the same version', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');

    await expect(storePack(pack('0.1.0'), '0.1.0 bbb')).rejects.toThrow(
      /not stored: version 0\.1\.0 is already on this device/,
    );
    expect((await getStoredPack('current'))?.fingerprint).toBe('0.1.0 aaa');
  });

  it('refuses, in its transaction, an older version than the one stored (another tab stored it first)', async () => {
    await storePack(pack('0.2.0'), '0.2.0 bbb');

    await expect(storePack(pack('0.1.0'), '0.1.0 aaa')).rejects.toThrow(/0\.2\.0 is already/);
    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
    expect(await getStoredPack('previous')).toBeUndefined();
  });

  it('refuses a version at or below the one rolled back on this device', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');
    await storePack(pack('0.2.0'), '0.2.0 bbb');
    await restorePreviousPack(() => undefined);

    await expect(storePack(pack('0.2.0'), '0.2.0 ccc')).rejects.toThrow(
      /version 0\.2\.0 was rolled back on this device/,
    );
    await expect(storePack(pack('0.1.5'), '0.1.5 ddd')).rejects.toThrow(/rolled back/);
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
  });

  it('replaces whatever the loader set aside (untrusted, invalid or below the floor), whatever its version', async () => {
    await storePack(pack('0.9.0'), 'set aside');

    expect(await storePack(pack('0.1.0'), '0.1.0 aaa', {}, { replaces: 'set aside' })).toBe(
      'stored',
    );
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
    expect((await getStoredPack('previous'))?.pack.version).toBe('0.9.0');
  });

  it('replaces a corrupted record that holds no pack, without throwing', async () => {
    await (await openAppDb()).put('pack', { fingerprint: 'broken' } as never, 'current');

    expect(await storePack(pack('0.1.0'), '0.1.0 aaa')).toBe('stored');
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
  });

  it('rolls back over a corrupted current record without a rollback mark', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');
    await storePack(pack('0.2.0'), '0.2.0 bbb');
    const db = await openAppDb();
    await db.put('pack', { fingerprint: 'broken' } as never, 'current');

    const restored = await restorePreviousPack(() => undefined);

    expect(restored).toEqual({ pack: pack('0.1.0'), fingerprint: '0.1.0 aaa' });
  });

  it('still checks the versions when the stored pack is not the one the loader set aside', async () => {
    await storePack(pack('0.9.0'), 'newer, from another tab');

    await expect(
      storePack(pack('0.1.0'), '0.1.0 aaa', {}, { replaces: 'set aside' }),
    ).rejects.toThrow(/0\.9\.0 is already/);
  });

  it('keeps the pack of the previous version', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');
    await storePack(pack('0.2.0'), '0.2.0 bbb');

    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
    expect((await getStoredPack('previous'))?.pack.version).toBe('0.1.0');
  });

  it('keeps the fragment hashes and the origin with the pack', async () => {
    const details = {
      hashes: { 'rules.json': 'aaa' },
      origin: { signed: true, keyId: 'team-1' } as const,
    };

    await storePack(pack('0.1.0'), '0.1.0 aaa', details);

    expect(await getStoredPack('current')).toEqual({
      pack: pack('0.1.0'),
      fingerprint: '0.1.0 aaa',
      ...details,
    });
  });

  it('rewrites the same pack when its origin changed (signed again), keeping its rollback mark', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa', { origin: { signed: false, reason: 'unsigned' } });
    await storePack(pack('0.2.0'), '0.2.0 bbb', { origin: { signed: false, reason: 'unsigned' } });
    await restorePreviousPack(() => undefined);

    expect(
      await storePack(pack('0.1.0'), '0.1.0 aaa', { origin: { signed: true, keyId: 'team-1' } }),
    ).toBe('stored');
    expect(
      await storePack(pack('0.1.0'), '0.1.0 aaa', { origin: { signed: true, keyId: 'team-1' } }),
    ).toBe('unchanged');
    expect(await getStoredPack('current')).toMatchObject({
      origin: { signed: true, keyId: 'team-1' },
      rolledBackFrom: '0.2.0',
    });
  });

  it('drops the rollback mark with a new version', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');
    await storePack(pack('0.2.0'), '0.2.0 bbb');
    await restorePreviousPack(() => undefined);

    await storePack(pack('0.3.0'), '0.3.0 ccc');

    expect((await getStoredPack('current'))?.rolledBackFrom).toBeUndefined();
    expect((await getStoredPack('previous'))?.rolledBackFrom).toBe('0.2.0');
  });
});

describe('restorePreviousPack', () => {
  it('makes the previous pack current, drops the newer one and marks its version', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');
    await storePack(pack('0.2.0'), '0.2.0 bbb');

    const restored = await restorePreviousPack(() => undefined);

    expect(restored).toEqual({
      pack: pack('0.1.0'),
      fingerprint: '0.1.0 aaa',
      rolledBackFrom: '0.2.0',
    });
    expect(await getStoredPack('current')).toEqual(restored);
    expect(await getStoredPack('previous')).toBeUndefined();
  });

  it('changes nothing when the check refuses the previous pack', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');
    await storePack(pack('0.2.0'), '0.2.0 bbb');

    await expect(
      restorePreviousPack(() => {
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');

    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
    expect((await getStoredPack('previous'))?.pack.version).toBe('0.1.0');
  });

  it('resolves undefined when there is no previous pack, and changes nothing', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');
    const check = vi.fn();

    expect(await restorePreviousPack(check)).toBeUndefined();

    expect(check).not.toHaveBeenCalled();
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
  });
});

describe('settings', () => {
  it('reads back what was stored, and nothing before', async () => {
    expect(await getStoredSettings()).toBeUndefined();

    await storeSettings({ lang: 'en', mode: 'woman', onboarded: true });

    expect(await getStoredSettings()).toEqual({ lang: 'en', mode: 'woman', onboarded: true });
  });
});

describe('code and lockout', () => {
  it('keep the verifier and the lockout beside the settings, never the code', async () => {
    expect(await getStoredVerifier()).toBeUndefined();
    expect(await getStoredLockout()).toBeUndefined();
    const verifier = await verifierOf('2468');

    await storeSettings({ lang: 'fr', mode: 'woman', onboarded: true });
    await storeVerifier({ ...verifier, code: '2468' } as never);
    await storeLockout({ failures: 5, lockedUntil: 30_000 });

    expect(await getStoredVerifier()).toEqual(verifier);
    expect(JSON.stringify(await (await openAppDb()).getAll('settings'))).not.toContain('2468');
    expect(await getStoredLockout()).toEqual({ failures: 5, lockedUntil: 30_000 });
    expect(await getStoredSettings()).toEqual({ lang: 'fr', mode: 'woman', onboarded: true });
  });

  it('read a stored value that is not a verifier or a lockout as none', async () => {
    const db = await openAppDb();
    await db.put('settings', { lang: 'fr' } as never, 'code');
    await db.put('settings', { failures: 'many' } as never, 'lockout');

    expect(await getStoredVerifier()).toBeUndefined();
    expect(await getStoredLockout()).toBeUndefined();
  });
});

describe('the copy of the tabs epoch', () => {
  it('changes in one transaction, and goes at the erase with the code', async () => {
    await updateTabMarks(() => ['a'.repeat(32)]);
    await updateTabMarks((stored) => [...(stored as string[]), 'b'.repeat(32)]);
    expect(await readTabMarks()).toEqual(['a'.repeat(32), 'b'.repeat(32)]);

    await storeVerifier(await verifierOf('2468'));
    await eraseProfilesAndCode();

    expect(await readTabMarks()).toBeUndefined();
  });

  it('is cleared on demand (a new code)', async () => {
    await updateTabMarks(() => ['c'.repeat(32)]);
    await clearTabMarks();
    expect(await readTabMarks()).toBeUndefined();
  });
});
