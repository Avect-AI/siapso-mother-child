// SPDX-License-Identifier: MIT
// The history of evaluations, kept in IndexedDB on the phone only and never
// sent anywhere: what was looked at, the level, the rules that gave it and
// the pack version, so a later visit can see what was said and why.
import type { CheckedItem, Evaluation } from '@siapso/engine';
import type { HistoryEntry } from '../domain/types.js';
import { requireCode } from './code-guard.js';
import { openAppDb } from './db.js';

/** Evaluations kept per profile; older ones are removed. */
export const HISTORY_PER_PROFILE = 20;

/** Newest first, then by id, so the order never depends on storage. */
function newestFirst(a: HistoryEntry, b: HistoryEntry): number {
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
 * Stores an evaluation, then keeps only the last HISTORY_PER_PROFILE of its
 * profile, in one transaction with the profiles and the code: nothing is
 * kept for a profile no longer on the phone (deleted while its result was
 * open), so a deletion never leaves part of her behind. Resolves whether it
 * stored; NoCodeError while the code this tab opened is not on the phone.
 */
export async function recordHistory(entry: HistoryEntry): Promise<boolean> {
  const tx = (await openAppDb()).transaction(['profiles', 'history', 'settings'], 'readwrite');
  await requireCode(tx);
  const history = tx.objectStore('history');
  if ((await tx.objectStore('profiles').getKey(entry.profileId)) === undefined) {
    await tx.done;
    return false;
  }
  await history.put(entry);
  const all = await history.index('profileId').getAll(entry.profileId);
  const old = all.sort(newestFirst).slice(HISTORY_PER_PROFILE);
  await Promise.all(old.map((stale) => history.delete(stale.id)));
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

/** The evaluations kept for a profile, newest first. */
export async function listHistory(profileId: string): Promise<HistoryEntry[]> {
  const all = await (await openAppDb()).getAllFromIndex('history', 'profileId', profileId);
  return all.sort(newestFirst);
}
