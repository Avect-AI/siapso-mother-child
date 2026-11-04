// SPDX-License-Identifier: MIT
// The way through a check: Check, then Search, then Confirm, each a history
// entry, so the browser back goes one step back. Each entry's state says how
// many steps back the check is, so that adding an item goes back to the check
// entry instead of stacking a new one (back from the check would otherwise
// return to a search already done). An entry opened directly, with no such
// state, goes to the check by replacing itself.
import type { EntryKind } from '@siapso/resolver';

export interface FlowState {
  /** How many entries back the check is. */
  stepsToCheck?: number;
  /**
   * On the search entry, the text typed, for the way back. On the confirm
   * entry, the query the candidate was found by (a strength in it is the one
   * preselected), which may be older than the text in the field.
   */
  query?: string;
  /** The name the chosen candidate was found by (a local name is shown with its language). */
  matched?: string;
}

/**
 * The flow state of the current history entry: each field kept only when it
 * has its type (a positive whole number of steps, strings), anything else on
 * the entry ignored; empty when there is none.
 */
export function flowState(): FlowState {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return {};
  const { stepsToCheck, query, matched } = state as Record<string, unknown>;
  const flow: FlowState = {};
  if (typeof stepsToCheck === 'number' && Number.isInteger(stepsToCheck) && stepsToCheck > 0) {
    flow.stepsToCheck = stepsToCheck;
  }
  if (typeof query === 'string') flow.query = query;
  if (typeof matched === 'string') flow.matched = matched;
  return flow;
}

/** Keeps `patch` on the current entry's state, without a new entry. */
export function keepOnEntry(patch: FlowState): void {
  window.history.replaceState({ ...flowState(), ...patch }, '');
}

/** The steps to the check after one more entry, or undefined when the way is not known. */
export function oneMoreStep(steps: number | undefined): number | undefined {
  return steps !== undefined && Number.isInteger(steps) && steps > 0 ? steps + 1 : undefined;
}

export function searchPath(kind: EntryKind): string {
  return `/search/${kind}`;
}

export function confirmPath(kind: EntryKind, id: string): string {
  return `/confirm/${kind}/${encodeURIComponent(id)}`;
}

type Navigate = (to: string, options?: { replace?: boolean; state?: unknown }) => void;

/** Back to the check entry, or to a check replacing this entry when the way back is not known. */
export function backToCheck(navigate: Navigate, steps: number | undefined): void {
  if (steps !== undefined && Number.isInteger(steps) && steps > 0) {
    window.history.go(-steps);
  } else {
    navigate('/check', { replace: true });
  }
}
