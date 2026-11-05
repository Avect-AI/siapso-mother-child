// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { describe, expect, it } from 'vitest';
import {
  closeAppDb,
  getStoredPack,
  getStoredSettings,
  openAppDb,
  storePack,
  storeSettings,
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

  it('rewrites a pack whose content changed under the same version, without a previous one', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');

    expect(await storePack(pack('0.1.0'), '0.1.0 bbb')).toBe('stored');
    expect((await getStoredPack('current'))?.fingerprint).toBe('0.1.0 bbb');
    expect(await getStoredPack('previous')).toBeUndefined();
  });

  it('keeps the pack of the previous version', async () => {
    await storePack(pack('0.1.0'), '0.1.0 aaa');
    await storePack(pack('0.2.0'), '0.2.0 bbb');

    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
    expect((await getStoredPack('previous'))?.pack.version).toBe('0.1.0');
  });
});

describe('settings', () => {
  it('reads back what was stored, and nothing before', async () => {
    expect(await getStoredSettings()).toBeUndefined();

    await storeSettings({ lang: 'en', mode: 'woman', onboarded: true });

    expect(await getStoredSettings()).toEqual({ lang: 'en', mode: 'woman', onboarded: true });
  });
});
