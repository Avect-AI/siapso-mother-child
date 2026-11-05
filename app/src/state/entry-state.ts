// SPDX-License-Identifier: MIT
// What a screen leaves on its history entry, tied to a visit and, when it
// comes from a profile, to the open session.
//
// - The visit is kept for the tab (a reload keeps it) and changes at a quick
//   exit or a forgotten code: an entry left before reads as empty. The signs
//   ticked on the danger signs screen, given without the code, live as long
//   as the visit.
// - The epoch changes at every lock (two minutes without interaction, a
//   quick exit) and at every page load (it is never stored): what comes from
//   a profile (a result's instruction and signs, a product searched or
//   confirmed) is read only in the epoch it was left in, so neither a lock
//   nor a reload while locked brings it back.

const KEY = 'siapso-visit';

let visit: string | null = null;
let epoch: string = crypto.randomUUID();

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

/** A new visit: every entry left before reads as empty from now on. */
export function newVisit(): void {
  visit = crypto.randomUUID();
  remember(visit);
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

/** The state of the current history entry when it was left in this visit, else an empty record. */
export function visitState(): Record<string, unknown> {
  const record = entryRecord();
  return record?.['visit'] === visitToken() ? record : {};
}

/**
 * The state of the current history entry when it was left in this visit and
 * this epoch (what comes from a profile), else an empty record.
 */
export function sessionState(): Record<string, unknown> {
  const record = visitState();
  return record['epoch'] === epoch ? record : {};
}

/** `values` with this visit's mark, to leave on a history entry (given without the code). */
export function inVisit(values: Record<string, unknown>): Record<string, unknown> {
  return { ...values, visit: visitToken() };
}

/** `values` with this visit's and this epoch's marks: what comes from a profile. */
export function inSession(values: Record<string, unknown>): Record<string, unknown> {
  return { ...values, visit: visitToken(), epoch };
}

/** `state` moved to this epoch, when it belongs to this visit (a screen given back after the code). */
export function intoThisEpoch(state: unknown): Record<string, unknown> | null {
  if (typeof state !== 'object' || state === null) return null;
  const record = state as Record<string, unknown>;
  return record['visit'] === visitToken() ? { ...record, epoch } : null;
}

/**
 * Takes off the current entry a state left in another visit, or by a
 * profile in another epoch, so it is gone from the history, not only unread.
 */
export function forgetStaleEntry(): void {
  const record = entryRecord();
  if (record === null) return;
  const stale =
    record['visit'] !== visitToken() || ('epoch' in record && record['epoch'] !== epoch);
  if (stale) window.history.replaceState(null, '');
}
