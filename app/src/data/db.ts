// SPDX-License-Identifier: MIT
// The app's IndexedDB database. Everything stays on the phone: nothing in it
// is ever sent anywhere.
import type { Pack } from '@siapso/engine';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  claimTry,
  isCodeVerifier,
  isLockoutState,
  type CodeClaim,
  type CodeVerifier,
  type LockoutState,
} from '../domain/code.js';
import type { HistoryEntry, Profile, ReferralContact, Settings } from '../domain/types.js';

export type PackSlot = 'current' | 'previous';

type SettingsKey = 'settings' | 'code' | 'lockout';

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
  /**
   * The settings, the verifier of the code (never the code itself) and the
   * wrong codes in a row with the end of their wait, each under its own key.
   */
  settings: { key: SettingsKey; value: Settings | CodeVerifier | LockoutState };
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
  return (await (await openAppDb()).get('settings', 'settings')) as Settings | undefined;
}

export async function storeSettings(settings: Settings): Promise<void> {
  await (await openAppDb()).put('settings', settings, 'settings');
}

/** The verifier of the code, when one was made on this phone (a stored value that is not one: none). */
export async function getStoredVerifier(): Promise<CodeVerifier | undefined> {
  const stored = await (await openAppDb()).get('settings', 'code');
  return isCodeVerifier(stored) ? stored : undefined;
}

export async function storeVerifier(verifier: CodeVerifier): Promise<void> {
  const { salt, hash, iterations } = verifier;
  await (await openAppDb()).put('settings', { salt, hash, iterations }, 'code');
}

/** The wrong codes in a row and their wait, kept across a reload (a stored value that is not one: none). */
export async function getStoredLockout(): Promise<LockoutState | undefined> {
  const stored = await (await openAppDb()).get('settings', 'lockout');
  return isLockoutState(stored) ? stored : undefined;
}

export async function storeLockout(lockout: LockoutState): Promise<void> {
  const { failures, lockedUntil } = lockout;
  await (await openAppDb()).put('settings', { failures, lockedUntil }, 'lockout');
}

/**
 * Claims one try at the code in a single readwrite transaction: the stored
 * lockout is read, merged with what this tab knows, the wait checked, and
 * the try counted before the code is worked out (domain/code.ts claimTry).
 * Every tab of the app shares the count.
 */
export async function claimCodeTry(known: LockoutState, nowMs: number): Promise<CodeClaim> {
  const tx = (await openAppDb()).transaction('settings', 'readwrite');
  const stored = await tx.store.get('lockout');
  const claim = claimTry(known, isLockoutState(stored) ? stored : undefined, nowMs);
  const { failures, lockedUntil } = claim.after;
  await tx.store.put({ failures, lockedUntil }, 'lockout');
  await tx.done;
  return claim;
}

/**
 * The code is forgotten: the profiles, their history, the contacts saved on
 * the phone, the verifier and the wrong codes are erased, in one
 * transaction. The settings (language) and the knowledge pack stay.
 */
export async function eraseProfilesAndCode(): Promise<void> {
  const tx = (await openAppDb()).transaction(
    ['profiles', 'history', 'contacts', 'settings'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('profiles').clear(),
    tx.objectStore('history').clear(),
    tx.objectStore('contacts').clear(),
    tx.objectStore('settings').delete('code'),
    tx.objectStore('settings').delete('lockout'),
  ]);
  await tx.done;
}
