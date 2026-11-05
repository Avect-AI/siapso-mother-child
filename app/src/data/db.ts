// SPDX-License-Identifier: MIT
// The app's IndexedDB database. Everything stays on the phone: nothing in it
// is ever sent anywhere.
import type { Pack } from '@siapso/engine';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  claimTry,
  isCodeVerifier,
  isLockoutState,
  verifierFields,
  type CodeClaim,
  type CodeVerifier,
  type LockoutState,
} from '../domain/code.js';
import type { Sealed } from '../domain/crypto.js';
import type { HistoryEntry, Profile, ReferralContact, Settings } from '../domain/types.js';
import { CodeExistsError, requireCodeForSettings } from './code-guard.js';
import { compareVersions, isVersion, originKey, type PackOrigin } from './pack-verify.js';

export type PackSlot = 'current' | 'previous';

type SettingsKey = 'settings' | 'code' | 'lockout' | 'tabs';

/** The copy of the tabs' epoch (state/tab-sync.ts): opaque random marks, one per kind of event. */
type TabMarks = string[];

/**
 * A validated pack and its fingerprint: the version, date and clinical
 * validation from the manifest and the sha256 of every fragment, so an
 * identical download is recognised without rewriting it.
 */
export interface StoredPack {
  pack: Pack;
  fingerprint: string;
  /** The sha256 of each fragment file, so an update downloads only the changed ones. */
  hashes?: Record<string, string>;
  /** Who signed it (absent for a pack stored before packs were signed). */
  origin?: PackOrigin;
  /**
   * Set on a pack restored by a rollback: the version it replaced, which the
   * loader does not bring back (a higher version is needed).
   */
  rolledBackFrom?: string;
  /** The minimum safe version of its signed manifest: no rollback below it. */
  minimumSafeVersion?: string;
}

/** What storePack keeps next to the pack. */
export type PackDetails = Pick<StoredPack, 'hashes' | 'origin' | 'minimumSafeVersion'>;

/** The version of a stored record, or undefined for a corrupted one that holds no pack. */
export function versionOf(stored: StoredPack): unknown {
  return (stored.pack as Partial<Pack> | undefined)?.version;
}

/** 'unchanged': the same version with the same fragments was already stored. */
export type StoreOutcome = 'stored' | 'unchanged';

/**
 * A profile as stored since SCRUM-39: its id (random) and the profile sealed
 * (domain/crypto.ts). A record in clear is a Profile an older version kept,
 * sealed at the first unlock (data/migration.ts).
 */
export interface SealedProfile {
  id: string;
  sealed: Sealed;
}

/** A history entry as stored since SCRUM-39: its id, its profile's id (the index), the entry sealed. */
export interface SealedHistoryEntry {
  id: string;
  profileId: string;
  sealed: Sealed;
}

/** The saved contacts as stored since SCRUM-39: the list sealed. */
export interface SealedContacts {
  sealed: Sealed;
}

interface SiapsoDb extends DBSchema {
  /** The active knowledge pack and the one before it. */
  pack: { key: PackSlot; value: StoredPack };
  /**
   * The settings, the verifier of the code (never the code itself) and the
   * wrong codes in a row with the end of their wait, each under its own key.
   */
  settings: { key: SettingsKey; value: Settings | CodeVerifier | LockoutState | TabMarks };
  /** Sealed, or in clear when an older version kept them (sealed at the first unlock). */
  profiles: { key: string; value: SealedProfile | Profile };
  history: {
    key: string;
    value: SealedHistoryEntry | HistoryEntry;
    indexes: { profileId: string };
  };
  /** The referral contacts saved on this phone, in their order, under one key (version 2). */
  contacts: { key: 'saved'; value: SealedContacts | ReferralContact[] };
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

export interface StoreOptions {
  /**
   * The fingerprint of the stored pack the loader set aside (not trusted by
   * this build, not valid, or below its floor): that one is replaced
   * whatever its version. Any other stored pack is compared first.
   */
  replaces?: string;
}

/** Why `version` must not replace `current`, or null (versions that are not semantic are not compared). */
function refusalOf(version: string, current: StoredPack): string | null {
  if (!isVersion(version)) return null;
  const rolledBack = current.rolledBackFrom;
  if (isVersion(rolledBack) && compareVersions(version, rolledBack) <= 0) {
    return `version ${version} was rolled back on this device`;
  }
  const stored = versionOf(current);
  if (isVersion(stored) && compareVersions(version, stored) <= 0) {
    return `version ${stored} is already on this device`;
  }
  return null;
}

/**
 * Stores `pack` as current, unless the current one has the same fingerprint
 * and origin. The versions are checked again inside the transaction (another
 * tab may have stored a pack meanwhile): a pack that is not newer than the
 * stored one, or not above a version rolled back on this device, is refused,
 * unless it is the same content (the same pack signed again) or the stored
 * one is the pack the loader set aside. A current pack of another version
 * becomes the previous one; a rewrite of the same content keeps its rollback
 * mark.
 */
export async function storePack(
  pack: Pack,
  fingerprint: string,
  details: PackDetails = {},
  options: StoreOptions = {},
): Promise<StoreOutcome> {
  const tx = (await openAppDb()).transaction('pack', 'readwrite');
  const current = await tx.store.get('current');
  if (
    current?.fingerprint === fingerprint &&
    originKey(current.origin) === originKey(details.origin)
  ) {
    await tx.done;
    return 'unchanged';
  }
  if (
    current !== undefined &&
    current.fingerprint !== fingerprint &&
    current.fingerprint !== options.replaces
  ) {
    const refusal = refusalOf(pack.version, current);
    if (refusal !== null) {
      await tx.done;
      throw new Error(`not stored: ${refusal}`);
    }
  }
  const entry: StoredPack = { pack, fingerprint, ...details };
  if (current && versionOf(current) !== pack.version) {
    await tx.store.put(current, 'previous');
  } else if (current?.rolledBackFrom !== undefined) {
    entry.rolledBackFrom = current.rolledBackFrom;
  }
  await tx.store.put(entry, 'current');
  await tx.done;
  return 'stored';
}

/**
 * Makes the previous pack the current one, in one transaction, once `check`
 * accepted it, knowing the current one (`check` throws to refuse, and then
 * nothing changes). The pack it replaces is dropped and its version kept as
 * `rolledBackFrom`. Resolves with the restored pack, or undefined when there
 * is no previous pack.
 */
export async function restorePreviousPack(
  check: (previous: StoredPack, current: StoredPack | undefined) => void,
): Promise<StoredPack | undefined> {
  const tx = (await openAppDb()).transaction('pack', 'readwrite');
  const previous = await tx.store.get('previous');
  const current = await tx.store.get('current');
  if (previous === undefined) {
    await tx.done;
    return undefined;
  }
  try {
    check(previous, current);
  } catch (error) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw error;
  }
  const left = current === undefined ? undefined : versionOf(current);
  const restored: StoredPack =
    typeof left === 'string' ? { ...previous, rolledBackFrom: left } : previous;
  await tx.store.put(restored, 'current');
  await tx.store.delete('previous');
  await tx.done;
  return restored;
}

export async function getStoredSettings(): Promise<Settings | undefined> {
  return (await (await openAppDb()).get('settings', 'settings')) as Settings | undefined;
}

/**
 * Stores the settings. A change of the mode or of the welcome goes through
 * only from the tab that opened the code stored, or from a phone with no code
 * (code-guard.ts): NoCodeError otherwise, and nothing is stored. The language
 * changes from any tab.
 */
export async function storeSettings(settings: Settings): Promise<void> {
  const tx = (await openAppDb()).transaction('settings', 'readwrite');
  const before = (await tx.store.get('settings')) as Settings | undefined;
  if (before?.mode !== settings.mode || before.onboarded !== settings.onboarded) {
    await requireCodeForSettings(tx);
  }
  await tx.store.put(settings, 'settings');
  await tx.done;
}

/** The verifier of the code, when one was made on this phone (a stored value that is not one: none). */
export async function getStoredVerifier(): Promise<CodeVerifier | undefined> {
  const stored = await (await openAppDb()).get('settings', 'code');
  return isCodeVerifier(stored) ? stored : undefined;
}

export async function storeVerifier(verifier: CodeVerifier): Promise<void> {
  await (await openAppDb()).put('settings', verifierFields(verifier), 'code');
}

/**
 * Stores the verifier of a code just made, in one readwrite transaction that
 * refuses (CodeExistsError, nothing changed) when a code is already stored: a
 * tab left on the welcome never makes a second code over hers.
 */
export async function storeNewVerifier(verifier: CodeVerifier): Promise<void> {
  const tx = (await openAppDb()).transaction('settings', 'readwrite');
  if (isCodeVerifier(await tx.store.get('code'))) {
    // Abandoned on purpose: its end is not an error to report.
    tx.done.catch(() => undefined);
    tx.abort();
    throw new CodeExistsError();
  }
  await tx.store.put(verifierFields(verifier), 'code');
  await tx.done;
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

/** The copy of the tabs' epoch, as stored (state/tab-sync.ts reads only its marks). */
export async function readTabMarks(): Promise<unknown> {
  return (await openAppDb()).get('settings', 'tabs');
}

/** Changes the copy of the tabs' epoch in one transaction: `change` gets what is stored. */
export async function updateTabMarks(change: (stored: unknown) => unknown): Promise<void> {
  const tx = (await openAppDb()).transaction('settings', 'readwrite');
  const stored: unknown = await tx.store.get('tabs');
  await tx.store.put(change(stored) as TabMarks, 'tabs');
  await tx.done;
}

/** Takes the copy of the tabs' epoch off (a new code: nothing tells what was done before). */
export async function clearTabMarks(): Promise<void> {
  await (await openAppDb()).delete('settings', 'tabs');
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
 * the phone, the verifier, the wrong codes and the tabs' marks are erased, in
 * one transaction. The settings (language) and the knowledge pack stay.
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
    tx.objectStore('settings').delete('tabs'),
  ]);
  await tx.done;
}
