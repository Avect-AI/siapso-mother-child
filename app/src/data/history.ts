// SPDX-License-Identifier: MIT
// The history of evaluations, kept in IndexedDB on the phone only and never
// sent anywhere: what was looked at, the level, the rules that gave it and
// the pack version, so a later visit can see what was said and why. Each
// entry is sealed with its own data key under the code's wrapping key
// (domain/crypto.ts): what is stored is its random id, its profile's random
// id (the index that deletes it with her profile) and the sealed entry. Read
// and written only while the code is open in this page (vault.ts).
import { LEVELS, levelRank, type CheckedItem, type Evaluation, type Level } from '@siapso/engine';
import { isSealed, UnsealError } from '../domain/crypto.js';
import type { HistoryEntry } from '../domain/types.js';
import { requireCode } from './code-guard.js';
import { openAppDb, type SealedHistoryEntry } from './db.js';
import { historyScope, openRecord, sealRecord, vaultKey } from './vault.js';

/** Evaluations kept per profile; older ones are removed. */
export const HISTORY_PER_PROFILE = 20;

/** Newest first, then by id, so the order never depends on storage. */
function newestFirst(
  a: Pick<HistoryEntry, 'id' | 'at'>,
  b: Pick<HistoryEntry, 'id' | 'at'>,
): number {
  if (a.at !== b.at) return a.at > b.at ? -1 : 1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The entry of an evaluation: every rule id of its findings, in engine order
 * (the screen shows one card per item set and check; the history keeps them
 * all), and copies of the items and signs.
 */
export function historyEntryOf({
  id,
  at,
  profileId,
  evaluation,
  items,
  signs,
}: {
  id: string;
  at: string;
  profileId: string;
  evaluation: Evaluation;
  items: readonly CheckedItem[];
  signs: readonly string[];
}): HistoryEntry {
  return {
    id,
    profileId,
    at,
    packVersion: evaluation.pack.version,
    level: evaluation.level,
    ruleIds: evaluation.findings.flatMap((f) => (f.ruleId === undefined ? [] : [f.ruleId])),
    items: items.map((item) => ({ ...item, ref: { ...item.ref } })),
    signs: [...signs],
  };
}

/**
 * The entry of a check whose result is on the check screen and changes as
 * products are added or taken off (SCRUM-56, S15): one entry per check, with
 * the id and the time of its first showing, the last list and signs, and the
 * highest level shown during the check with the rule ids of its findings at
 * that level (the ids of every showing at that level, each once), so a
 * product taken off later never lowers what the history says: a danger shown
 * once stays in her history. `previous` is the entry written so far for this
 * check, undefined at its first showing.
 */
export function checkEntryOf(
  previous: HistoryEntry | undefined,
  shown: {
    id: string;
    at: string;
    profileId: string;
    evaluation: Evaluation;
    items: readonly CheckedItem[];
    signs: readonly string[];
  },
): HistoryEntry {
  const { evaluation } = shown;
  const now = historyEntryOf({
    ...shown,
    ...(previous ? { id: previous.id, at: previous.at } : {}),
  });
  const atLevel = [
    ...new Set(
      evaluation.findings.flatMap((f) =>
        f.level === evaluation.level && f.ruleId !== undefined ? [f.ruleId] : [],
      ),
    ),
  ];
  // A level kept by another version that this one does not know reads lowest.
  const kept = previous === undefined ? -1 : LEVELS.indexOf(previous.level as Level);
  if (previous === undefined || levelRank(evaluation.level) > kept) {
    return { ...now, level: evaluation.level, ruleIds: atLevel };
  }
  if (levelRank(evaluation.level) < kept) {
    return { ...now, level: previous.level, ruleIds: [...previous.ruleIds] };
  }
  return { ...now, ruleIds: [...new Set([...previous.ruleIds, ...atLevel])] };
}

function isSealedEntry(record: SealedHistoryEntry | HistoryEntry): record is SealedHistoryEntry {
  return 'sealed' in record && isSealed(record.sealed);
}

/**
 * The entry a stored record holds, opened with the session's key. Undefined
 * for a record the code does not open (another code, a change), and for a
 * record in clear, which no version since SCRUM-39 writes (migration.ts).
 */
async function entryOf(
  record: SealedHistoryEntry | HistoryEntry,
): Promise<HistoryEntry | undefined> {
  if (!isSealedEntry(record)) return undefined;
  try {
    const value = await openRecord(record.sealed, historyScope(record.profileId, record.id));
    if (typeof value === 'object' && value !== null && (value as HistoryEntry).id === record.id) {
      return value as HistoryEntry;
    }
  } catch (failure) {
    if (!(failure instanceof UnsealError)) throw failure;
  }
  return undefined;
}

/**
 * The ids of the entries of a profile to remove once `entry` is kept: past
 * the newest HISTORY_PER_PROFILE, an entry the code does not open counting
 * as the oldest.
 */
async function staleIds(entry: HistoryEntry): Promise<string[]> {
  const records = await (
    await openAppDb()
  ).getAllFromIndex('history', 'profileId', entry.profileId);
  const known = await Promise.all(
    records
      .filter((record) => record.id !== entry.id)
      .map(async (record) => ({ id: record.id, at: (await entryOf(record))?.at ?? '' })),
  );
  return [...known, { id: entry.id, at: entry.at }]
    .sort(newestFirst)
    .slice(HISTORY_PER_PROFILE)
    .map((stale) => stale.id);
}

/**
 * Stores an evaluation sealed, then keeps only the last HISTORY_PER_PROFILE
 * of its profile, in one transaction with the profiles and the code: nothing
 * is kept for a profile no longer on the phone (deleted while its result was
 * open), so a deletion never leaves part of her behind. The entries to remove
 * are worked out before the transaction (their dates are sealed, and a
 * transaction cannot wait for WebCrypto): one kept meanwhile by another tab
 * is removed at a later record. Resolves whether it stored; NoCodeError while
 * the code this tab opened is not on the phone, LockedError while the code is
 * not open here.
 */
export async function recordHistory(entry: HistoryEntry): Promise<boolean> {
  const sealed = await sealRecord(entry, historyScope(entry.profileId, entry.id));
  const stale = await staleIds(entry);
  const tx = (await openAppDb()).transaction(['profiles', 'history', 'settings'], 'readwrite');
  await requireCode(tx);
  const history = tx.objectStore('history');
  if ((await tx.objectStore('profiles').getKey(entry.profileId)) === undefined) {
    await tx.done;
    return false;
  }
  await history.put({ id: entry.id, profileId: entry.profileId, sealed });
  await Promise.all(stale.map((id) => history.delete(id)));
  await tx.done;
  return true;
}

/** When the latest evaluation of a profile was kept (an ISO instant), or undefined. */
export async function latestHistoryAt(profileId: string): Promise<string | undefined> {
  return (await listHistory(profileId))[0]?.at;
}

/** The checks recorded since the app was opened (a visit), by checkKey. */
const recordedThisVisit = new Set<string>();

/**
 * What makes two evaluations the same check: the profile, the pack version,
 * the items (whatever their order, with their units and flags), the signs,
 * and what the evaluation gave (its level and rules, in engine order): the
 * same items looked at again after a change of profile (a corrected term)
 * give another evaluation, which is kept.
 */
function checkKey(entry: HistoryEntry): string {
  const items = entry.items
    .map((item) =>
      JSON.stringify([
        item.ref,
        item.unitsPerDay ?? null,
        item.longTerm === true,
        item.strengthUnknown === true,
        item.strengthAtMostMg ?? null,
      ]),
    )
    .sort();
  return JSON.stringify([
    entry.profileId,
    entry.packVersion,
    items,
    [...entry.signs].sort(),
    entry.level,
    entry.ruleIds,
  ]);
}

/**
 * Records an evaluation unless the same check was already recorded in this
 * visit: opening the result again (back, then forward; a language change)
 * does not add an entry. Resolves true when it recorded. A failed write is
 * forgotten, so the next opening tries again.
 */
export async function recordHistoryOnce(entry: HistoryEntry): Promise<boolean> {
  const key = checkKey(entry);
  if (recordedThisVisit.has(key)) return false;
  recordedThisVisit.add(key);
  try {
    return await recordHistory(entry);
  } catch (error) {
    recordedThisVisit.delete(key);
    throw error;
  }
}

/** A new visit: every check may be recorded again (for tests; a reload does the same). */
export function forgetVisit(): void {
  recordedThisVisit.clear();
}

/**
 * The evaluations kept for a profile, newest first (one its code does not
 * open is left out, with a warning). LockedError while the code is not open.
 */
export async function listHistory(profileId: string): Promise<HistoryEntry[]> {
  vaultKey();
  const records = await (await openAppDb()).getAllFromIndex('history', 'profileId', profileId);
  const entries = await Promise.all(records.map(entryOf));
  const opened = entries.filter((entry) => entry !== undefined);
  if (opened.length < entries.length) {
    console.warn('A history entry on this phone does not open with this code: it is left out');
  }
  return opened.sort(newestFirst);
}
