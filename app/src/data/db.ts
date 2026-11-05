// SPDX-License-Identifier: MIT
// The app's IndexedDB database. Everything stays on the phone: nothing in it
// is ever sent anywhere.
import type { Pack } from '@siapso/engine';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { HistoryEntry, Profile, ReferralContact, Settings } from '../domain/types.js';

export type PackSlot = 'current' | 'previous';

/**
 * A validated pack and its fingerprint: the version and the sha256 of every
 * fragment, so an identical download is recognised without rewriting it.
 */
export interface StoredPack {
  pack: Pack;
  fingerprint: string;
}

/** 'unchanged': the same version with the same fragments was already stored. */
export type StoreOutcome = 'stored' | 'unchanged';

interface SiapsoDb extends DBSchema {
  /** The active knowledge pack and the one before it. */
  pack: { key: PackSlot; value: StoredPack };
  settings: { key: 'settings'; value: Settings };
  profiles: { key: string; value: Profile };
  history: { key: string; value: HistoryEntry; indexes: { profileId: string } };
  /** The referral contacts saved on this phone, in their order, under one key (version 2). */
  contacts: { key: 'saved'; value: ReferralContact[] };
}

const NAME = 'siapso';
const VERSION = 2;

let opening: Promise<IDBPDatabase<SiapsoDb>> | undefined;
let connection: IDBPDatabase<SiapsoDb> | undefined;

/** The database, opened once and shared (created on first use, upgraded from an older version). */
export function openAppDb(): Promise<IDBPDatabase<SiapsoDb>> {
  if (opening) return opening;
  const attempt: Promise<IDBPDatabase<SiapsoDb>> = openDB<SiapsoDb>(NAME, VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('pack');
        db.createObjectStore('settings');
        db.createObjectStore('profiles', { keyPath: 'id' });
        db.createObjectStore('history', { keyPath: 'id' }).createIndex('profileId', 'profileId');
      }
      if (oldVersion < 2) db.createObjectStore('contacts');
    },
    // An older version of the app keeps the database open in another tab:
    // this open waits until that tab closes or reloads.
    blocked() {
      console.warn('siapso database: waiting for another tab of the app to close');
    },
    // A newer version of the app wants to upgrade the database in another
    // tab: let it, the next use here opens again.
    blocking() {
      closeAppDb();
    },
    terminated() {
      opening = undefined;
      connection = undefined;
    },
  }).then(
    (db) => {
      // Closed while it was opening: hand it over closed, the next call reopens.
      if (opening === attempt) connection = db;
      else db.close();
      return db;
    },
    (error: unknown) => {
      if (opening === attempt) opening = undefined;
      throw error;
    },
  );
  opening = attempt;
  return attempt;
}

/** Closes the shared connection now (or as soon as it opens); the next openAppDb opens a new one. */
export function closeAppDb(): void {
  opening = undefined;
  connection?.close();
  connection = undefined;
}

export async function getStoredPack(slot: PackSlot): Promise<StoredPack | undefined> {
  return (await openAppDb()).get('pack', slot);
}

/**
 * Stores `pack` as current, unless the current one has the same fingerprint.
 * A current pack of another version becomes the previous one.
 */
export async function storePack(pack: Pack, fingerprint: string): Promise<StoreOutcome> {
  const tx = (await openAppDb()).transaction('pack', 'readwrite');
  const current = await tx.store.get('current');
  if (current?.fingerprint === fingerprint) {
    await tx.done;
    return 'unchanged';
  }
  if (current && current.pack.version !== pack.version) await tx.store.put(current, 'previous');
  await tx.store.put({ pack, fingerprint }, 'current');
  await tx.done;
  return 'stored';
}

export async function getStoredSettings(): Promise<Settings | undefined> {
  return (await openAppDb()).get('settings', 'settings');
}

export async function storeSettings(settings: Settings): Promise<void> {
  await (await openAppDb()).put('settings', settings, 'settings');
}
