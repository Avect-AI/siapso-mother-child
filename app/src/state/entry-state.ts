// SPDX-License-Identifier: MIT
// What a screen leaves on its history entry, tied to a visit and, when it
// comes from a profile, to the open session.
//
// - The values stay in this page's memory. The history entry holds only
//   marks (the visit, the epoch, and the mark of the values), because the
//   browser writes history.state to disk to restore a session: a product
//   searched or a sign ticked never goes there, and nothing is read back
//   after a reload.
// - The visit is kept for the tab and changes at a quick exit or a forgotten
//   code, which also forget every value: an entry left before reads as empty.
// - The epoch changes at every lock (two minutes without interaction, a
//   quick exit, a lock from another tab), at every page load (it is never
//   stored), and while locked after two minutes without interaction or hidden
//   (session.tsx): what comes from a profile (a result's instruction and
//   signs, a product searched or confirmed) and the danger signs ticked are
//   read only in the epoch they were left in.

const KEY = 'siapso-visit';
/** The marks on a history entry; anything else on it is ignored, and taken off. */
const MARKS = new Set(['visit', 'epoch', 'held']);

let visit: string | null = null;
let epoch: string = crypto.randomUUID();
/** The values of the entries of this page, under their mark, in memory only. */
let values = new Map<string, Record<string, unknown>>();

function remember(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // No session storage (a private mode): the visit lasts until a reload.
  }
}

function recalled(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** This visit's mark. */
export function visitToken(): string {
  if (visit === null) {
    visit = recalled() ?? crypto.randomUUID();
    remember(visit);
  }
  return visit;
}

/** A new visit: every entry left before reads as empty from now on, and its values are forgotten. */
export function newVisit(): void {
  visit = crypto.randomUUID();
  remember(visit);
  values = new Map();
}

/** This epoch's mark: the session as opened since the last lock or page load. */
export function epochToken(): string {
  return epoch;
}

/** A new epoch, at every lock: what a profile left on an entry is no longer read. */
export function newEpoch(): void {
  epoch = crypto.randomUUID();
}

function entryRecord(): Record<string, unknown> | null {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : null;
}

/** The values kept in memory for an entry's marks, with the marks; null when memory has none. */
function resolved(record: Record<string, unknown>): Record<string, unknown> | null {
  const mark = record['held'];
  const kept = typeof mark === 'string' ? values.get(mark) : undefined;
  if (kept === undefined) return null;
  const marks: Record<string, unknown> = { visit: record['visit'] };
  if ('epoch' in record) marks['epoch'] = record['epoch'];
  return { ...kept, ...marks };
}

/** The state of the current history entry when it was left in this visit, else an empty record. */
export function visitState(): Record<string, unknown> {
  const record = entryRecord();
  if (record?.['visit'] !== visitToken()) return {};
  return resolved(record) ?? {};
}

/**
 * The state of the current history entry when it was left in this visit and
 * this epoch (what comes from a profile), else an empty record.
 */
export function sessionState(): Record<string, unknown> {
  const record = visitState();
  return record['epoch'] === epoch ? record : {};
}

/** Keeps `given` in memory (without marks) and gives its mark. */
function keep(given: Record<string, unknown>): string {
  const mark = crypto.randomUUID();
  values.set(mark, Object.fromEntries(Object.entries(given).filter(([key]) => !MARKS.has(key))));
  return mark;
}

/** The marks to leave on a history entry for `given` (values given without the code), in this visit. */
export function inVisit(given: Record<string, unknown>): Record<string, unknown> {
  return { visit: visitToken(), held: keep(given) };
}

/** The marks to leave on a history entry for `given`, in this visit and this epoch: what comes from a profile. */
export function inSession(given: Record<string, unknown>): Record<string, unknown> {
  return { visit: visitToken(), epoch, held: keep(given) };
}

/** `state` moved to this epoch, when it belongs to this visit (a screen given back after the code). */
export function intoThisEpoch(state: unknown): Record<string, unknown> | null {
  if (typeof state !== 'object' || state === null) return null;
  const record = state as Record<string, unknown>;
  return record['visit'] === visitToken()
    ? { visit: record['visit'], epoch, held: record['held'] }
    : null;
}

/**
 * Takes off the current entry a state left in another visit, by a profile in
 * another epoch, or by another page load (or an older version that wrote its
 * values on the entry), so it is gone from the history, not only unread.
 */
export function forgetStaleEntry(): void {
  const record = entryRecord();
  if (record === null) return;
  const stale =
    record['visit'] !== visitToken() ||
    ('epoch' in record && record['epoch'] !== epoch) ||
    Object.keys(record).some((key) => !MARKS.has(key)) ||
    resolved(record) === null;
  if (stale) window.history.replaceState(null, '');
}
