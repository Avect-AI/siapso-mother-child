// SPDX-License-Identifier: MIT
// The way through a check: Check, then Search, then Confirm, each a history
// entry, so the browser back goes one step back. Each entry's state says how
// many steps back the check is, so that adding an item goes back to the check
// entry instead of stacking a new one (back from the check would otherwise
// return to a search already done). An entry opened directly, with no such
// state, goes to the check by replacing itself.
//
// What was searched and confirmed says what she takes (a product can say an
// HIV treatment): it never goes in the address, only in the entry's state,
// tied to the visit and the session's epoch (entry-state.ts), so neither a
// lock nor a reload brings it back.
import type { EntryKind } from '@siapso/resolver';
import { inSession, sessionState } from '../state/entry-state.js';

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
  /** On the confirm entry, the id of the product or remedy chosen. */
  id?: string;
  /**
   * On the search entry, the text in the field is what the voice heard, not
   * yet edited: with candidates on offer it is not added as typed, even
   * after Back. On the confirm entry, the query was heard: the name she said
   * is labelled "Vous avez dit".
   */
  heard?: boolean;
  /**
   * On the confirm entry, the words the voice heard for a name to confirm
   * ("King Kyliba", "quinine qu'il y va"): shown with it (review of #68).
   */
  heardAs?: string;
  /**
   * On the confirm entry of a product ticked in a sentence (SCRUM-61), the
   * products ticked after it, each confirmed in turn on its confirm screen.
   */
  queue?: QueuedProduct[];
  /** With `queue`: how many products were ticked in the sentence. */
  queueTotal?: number;
  /** With `queue`: a product ticked before this one was added to the check. */
  queueAdded?: boolean;
}

/** A product ticked in a sentence, still to confirm: as a candidate opens its confirm screen. */
export interface QueuedProduct {
  kind: EntryKind;
  id: string;
  /** The words of the sentence that name it (a strength said with it is preselected). */
  query: string;
  /** The name it was found by. */
  matched: string;
  /** The words the voice heard for it, when it is a name to confirm. */
  heardAs?: string;
}

function isQueuedProduct(value: unknown): value is QueuedProduct {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, id, query, matched, heardAs } = value as Partial<
    Record<keyof QueuedProduct, unknown>
  >;
  return (
    (kind === 'product' || kind === 'plant') &&
    typeof id === 'string' &&
    id !== '' &&
    typeof query === 'string' &&
    typeof matched === 'string' &&
    (heardAs === undefined || typeof heardAs === 'string')
  );
}

/**
 * The flow state of the current history entry, when left in this visit and
 * epoch: each field kept only when it has its type (a positive whole number
 * of steps, strings, a list of products to confirm), anything else on the
 * entry ignored; empty when there is none.
 */
export function flowState(): FlowState {
  const { stepsToCheck, query, matched, id, heard, heardAs, queue, queueTotal, queueAdded } =
    sessionState();
  const flow: FlowState = {};
  if (typeof stepsToCheck === 'number' && Number.isInteger(stepsToCheck) && stepsToCheck > 0) {
    flow.stepsToCheck = stepsToCheck;
  }
  if (typeof query === 'string') flow.query = query;
  if (typeof matched === 'string') flow.matched = matched;
  if (typeof id === 'string' && id !== '') flow.id = id;
  if (heard === true) flow.heard = true;
  if (typeof heardAs === 'string') flow.heardAs = heardAs;
  if (
    Array.isArray(queue) &&
    queue.every(isQueuedProduct) &&
    typeof queueTotal === 'number' &&
    Number.isInteger(queueTotal) &&
    queueTotal > queue.length
  ) {
    flow.queue = queue.map(({ kind, id: queued, query: words, matched: name, heardAs: heard }) => ({
      kind,
      id: queued,
      query: words,
      matched: name,
      ...(heard === undefined ? {} : { heardAs: heard }),
    }));
    flow.queueTotal = queueTotal;
    if (queueAdded === true) flow.queueAdded = true;
  }
  return flow;
}

/** A flow state to leave on a new history entry (a field not known yet: undefined), marked with the visit and epoch. */
export function flowEntry(flow: {
  [K in keyof FlowState]?: FlowState[K] | undefined;
}): Record<string, unknown> {
  return inSession({ ...flow });
}

/** Keeps `patch` on the current entry's state, without a new entry. */
export function keepOnEntry(patch: FlowState): void {
  window.history.replaceState(flowEntry({ ...flowState(), ...patch }), '');
}

/** The steps to the check after one more entry, or undefined when the way is not known. */
export function oneMoreStep(steps: number | undefined): number | undefined {
  return steps !== undefined && Number.isInteger(steps) && steps > 0 ? steps + 1 : undefined;
}

export function searchPath(kind: EntryKind): string {
  return `/search/${kind}`;
}

/** The confirm screen of a list; the id chosen goes in the entry's state (FlowState.id). */
export function confirmPath(kind: EntryKind): string {
  return `/confirm/${kind}`;
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
