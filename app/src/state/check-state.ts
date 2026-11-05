// SPDX-License-Identifier: MIT
// The check in progress: who it is for, the items the user confirmed and the
// danger signs she gave. Kept in memory only for now (a reload starts a new
// check); the history of checks comes with Task 14. Only confirmed items get
// here: the confirm screen adds a recognised product or remedy, the search
// screen adds the text of one it could not find. A product is never listed
// twice: two items of one product would read as a duplicate to the engine
// and double its daily total.
import type { CheckedItem, ItemRef } from '@siapso/engine';
import type { EntryKind } from '@siapso/resolver';
import { createContext, useCallback, useContext, useMemo, useReducer } from 'react';
import type { Mode, Profile } from '../domain/types.js';
import { isUnitsPerDay } from '../domain/units.js';

/** What the last add did: listed a new item, found it already listed as given, or updated it. */
export interface CheckChange {
  kind: 'added' | 'already' | 'updated';
  item: CheckedItem;
}

export interface CheckState {
  /** The profile the check is for; null until a screen starts it. */
  profileId: string | null;
  items: CheckedItem[];
  /** The danger signs present now, as answered before the result (none: empty). */
  signs: string[];
  /** The signs question was answered: an empty `signs` is then "none of these", not "not asked yet". */
  signsGiven: boolean;
  // Function properties, not methods: stable callbacks, safe to pass on alone.
  /**
   * The check is for this profile: kept when it already is (or when it was
   * for none yet), emptied when it was for another one.
   */
  start: (profileId: string) => void;
  /**
   * Lists the item at the end, unless it is already there, then updated in
   * its place: never listed twice. A known strength is the product itself
   * (its id); an unknown strength is the box of a family whose strength is not
   * known, so `family` (the product's resolver family) identifies it. An
   * unknown strength never takes the place of a known one (it is another box
   * unless the user says it is the same, then the known product is given
   * again); a known strength takes the place of an unknown one of its family
   * (more information, never less) unless `anotherBox` says it is another
   * box (the confirm screen asks). `list` is the list an unrecognised text
   * was typed in. Throws a RangeError for a unit count other than a whole
   * number from 1 to 24 or a blank text, a TypeError for a strengthUnknown that
   * is not a boolean.
   */
  add: (item: CheckedItem, options?: AddOptions) => void;
  /** Removes the item at this index; nothing happens for an index out of the list. */
  remove: (index: number) => void;
  /** Puts a removed item back at its index (the check screen's undo); checked as `add` does. */
  restore: (index: number, item: CheckedItem) => void;
  /** The index of the first item of this product (or unrecognised text), -1 when none is listed. */
  indexOf: (ref: ItemRef) => number;
  /** The list an unrecognised item was typed in (medicines or remedies), when known. */
  listOf: (item: CheckedItem) => EntryKind | undefined;
  /** The name typed for a product or remedy shown under another name ("cytotec"), when known. */
  writtenOf: (item: CheckedItem) => string | undefined;
  /** Whether she said an unrecognised text is none of the products proposed ("Non, aucun de ces..."). */
  declinedOf: (item: CheckedItem) => boolean;
  /** What the last add did, until the check screen has said so (clearChanged); null otherwise. */
  changed: CheckChange | null;
  clearChanged: () => void;
  /** The answer to the signs question: the signs present now, or none (empty). */
  setSigns: (signs: string[]) => void;
  /** Back to no check at all, for no profile. */
  reset: () => void;
}

export interface AddOptions {
  /** The list an unrecognised text was typed in. */
  list?: EntryKind;
  /**
   * She said the unrecognised text is none of the products proposed: the
   * result keeps only a strong resemblance (domain/possible-matches.ts).
   */
  declined?: boolean;
  /** The resolver family of a product (domain/search-index.ts productFamilyOf). */
  family?: string;
  /**
   * She said this box is not the one of its family listed with its strength
   * unknown: a known strength is then listed apart instead of taking its place.
   */
  anotherBox?: boolean;
  /**
   * The name she typed, when the product or remedy is shown under another
   * name (domain/search-index.ts writtenNameOf); without it, the product is
   * said under its own name only.
   */
  written?: string;
}

/**
 * One key per product, plant or unrecognised text (the same text whatever its
 * case and spaces).
 */
export function refKey(ref: ItemRef): string {
  if (ref.kind === 'unrecognised') {
    return `unrecognised:${ref.text.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  }
  return `${ref.kind}:${ref.id}`;
}

/** Whether two refs name the same product, plant or unrecognised text. */
export function sameRef(a: ItemRef, b: ItemRef): boolean {
  return refKey(a) === refKey(b);
}

interface CheckData {
  profileId: string | null;
  items: CheckedItem[];
  signs: string[];
  signsGiven: boolean;
  changed: CheckChange | null;
  /** The list each unrecognised text was typed in, by refKey. */
  lists: Readonly<Record<string, EntryKind>>;
  /** The resolver family of each product added with one, by product id. */
  families: Readonly<Record<string, string>>;
  /** The name typed for each product or remedy shown under another name, by refKey. */
  written: Readonly<Record<string, string>>;
  /** The unrecognised texts she said were none of the products proposed, by refKey. */
  declined: Readonly<Record<string, true>>;
}

type Action =
  | { type: 'start'; profileId: string }
  | { type: 'add'; item: CheckedItem; options: AddOptions }
  | { type: 'remove'; index: number }
  | { type: 'restore'; index: number; item: CheckedItem }
  | { type: 'clearChanged' }
  | { type: 'signs'; signs: string[] }
  | { type: 'reset' };

const EMPTY: CheckData = {
  profileId: null,
  items: [],
  signs: [],
  signsGiven: false,
  changed: null,
  lists: {},
  families: {},
  written: {},
  declined: {},
};

function unknownStrength(item: CheckedItem): boolean {
  return item.strengthUnknown === true && item.ref.kind === 'product';
}

/**
 * What an item is, for "never twice": the product, plant or text; for a
 * product whose strength is unknown, its family (another key than any known
 * strength, so it never takes a known strength's place).
 */
function identity(item: CheckedItem, families: CheckData['families']): string {
  if (!unknownStrength(item) || item.ref.kind !== 'product') return refKey(item.ref);
  const family = families[item.ref.id];
  return family === undefined ? `unknown:${refKey(item.ref)}` : `unknown-family:${family}`;
}

function sameItem(a: CheckedItem, b: CheckedItem): boolean {
  return (
    sameRef(a.ref, b.ref) &&
    a.unitsPerDay === b.unitsPerDay &&
    (a.strengthUnknown ?? false) === (b.strengthUnknown ?? false) &&
    (a.longTerm ?? false) === (b.longTerm ?? false)
  );
}

/** The index of an item of unknown strength that a known strength of the same product or family replaces. */
function unknownToReplace(state: CheckData, item: CheckedItem): number {
  const ref = item.ref;
  if (unknownStrength(item) || ref.kind !== 'product') return -1;
  const family = state.families[ref.id];
  return state.items.findIndex(
    (listed) =>
      unknownStrength(listed) &&
      listed.ref.kind === 'product' &&
      (listed.ref.id === ref.id ||
        (family !== undefined && state.families[listed.ref.id] === family)),
  );
}

function added(base: CheckData, item: CheckedItem, options: AddOptions): CheckData {
  const lists =
    item.ref.kind === 'unrecognised' && options.list !== undefined
      ? { ...base.lists, [refKey(item.ref)]: options.list }
      : base.lists;
  const families =
    item.ref.kind === 'product' && options.family !== undefined
      ? { ...base.families, [item.ref.id]: options.family }
      : base.families;
  // The name typed goes with the product or remedy as it was last confirmed.
  let written = base.written;
  if (item.ref.kind !== 'unrecognised') {
    const key = refKey(item.ref);
    const others = Object.entries(base.written).filter(([listed]) => listed !== key);
    written = Object.fromEntries(
      options.written === undefined ? others : [...others, [key, options.written]],
    );
  }
  const declined =
    item.ref.kind === 'unrecognised' && options.declined === true
      ? { ...base.declined, [refKey(item.ref)]: true as const }
      : base.declined;
  const state = { ...base, lists, families, written, declined };
  const key = identity(item, families);
  let index = state.items.findIndex((listed) => identity(listed, families) === key);
  if (index < 0 && options.anotherBox !== true) index = unknownToReplace(state, item);
  if (index < 0) {
    return { ...state, items: [...state.items, item], changed: { kind: 'added', item } };
  }
  const before = state.items[index];
  if (before !== undefined && sameItem(before, item)) {
    return { ...state, changed: { kind: 'already', item: before } };
  }
  const items = state.items.map((listed, i) => (i === index ? item : listed));
  return { ...state, items, changed: { kind: 'updated', item } };
}

function reduce(state: CheckData, action: Action): CheckData {
  switch (action.type) {
    case 'start':
      if (state.profileId === action.profileId) return state;
      return state.profileId === null
        ? { ...state, profileId: action.profileId }
        : { ...EMPTY, profileId: action.profileId };
    case 'add':
      return added(state, action.item, action.options);
    case 'remove':
      return action.index >= 0 && action.index < state.items.length
        ? { ...state, items: state.items.filter((_, i) => i !== action.index), changed: null }
        : state;
    case 'restore': {
      // Listed again in the meantime: never twice.
      const key = identity(action.item, state.families);
      if (state.items.some((listed) => identity(listed, state.families) === key)) return state;
      const index = Math.min(Math.max(0, action.index), state.items.length);
      return {
        ...state,
        items: [...state.items.slice(0, index), action.item, ...state.items.slice(index)],
      };
    }
    case 'clearChanged':
      return state.changed === null ? state : { ...state, changed: null };
    case 'signs':
      return { ...state, signs: [...new Set(action.signs)], signsGiven: true };
    case 'reset':
      return EMPTY;
  }
}

/** A copy of the item the engine will accept, or a RangeError (a TypeError for a wrong flag). */
function checkedCopy(item: CheckedItem): CheckedItem {
  if (item.unitsPerDay !== undefined && !isUnitsPerDay(item.unitsPerDay)) {
    throw new RangeError(
      `Units per day must be a whole number from 1 to 24: ${String(item.unitsPerDay)}`,
    );
  }
  const unknown: unknown = item.strengthUnknown;
  if (unknown !== undefined && typeof unknown !== 'boolean') {
    throw new TypeError(`strengthUnknown must be a boolean, not ${typeof unknown}`);
  }
  if (item.ref.kind === 'unrecognised' && item.ref.text.trim() === '') {
    throw new RangeError('An unrecognised item needs the text typed');
  }
  return { ...item, ref: { ...item.ref } };
}

/** The check state, held by the AppProvider for the whole app. */
export function useCheckStore(): CheckState {
  const [data, dispatch] = useReducer(reduce, EMPTY);
  const start = useCallback((profileId: string) => {
    dispatch({ type: 'start', profileId });
  }, []);
  const add = useCallback((item: CheckedItem, options: AddOptions = {}) => {
    dispatch({ type: 'add', item: checkedCopy(item), options });
  }, []);
  const remove = useCallback((index: number) => {
    dispatch({ type: 'remove', index });
  }, []);
  const restore = useCallback((index: number, item: CheckedItem) => {
    dispatch({ type: 'restore', index, item: checkedCopy(item) });
  }, []);
  const clearChanged = useCallback(() => {
    dispatch({ type: 'clearChanged' });
  }, []);
  const setSigns = useCallback((signs: string[]) => {
    dispatch({ type: 'signs', signs });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);
  const { profileId, items, signs, signsGiven, changed, lists, written, declined } = data;
  const indexOf = useCallback(
    (ref: ItemRef) => items.findIndex((item) => sameRef(item.ref, ref)),
    [items],
  );
  const listOf = useCallback((item: CheckedItem) => lists[refKey(item.ref)], [lists]);
  const writtenOf = useCallback((item: CheckedItem) => written[refKey(item.ref)], [written]);
  const declinedOf = useCallback(
    (item: CheckedItem) => declined[refKey(item.ref)] === true,
    [declined],
  );
  return useMemo(
    () => ({
      profileId,
      items,
      signs,
      signsGiven,
      changed,
      start,
      add,
      remove,
      restore,
      indexOf,
      listOf,
      writtenOf,
      declinedOf,
      clearChanged,
      setSigns,
      reset,
    }),
    [
      profileId,
      items,
      signs,
      signsGiven,
      changed,
      start,
      add,
      remove,
      restore,
      indexOf,
      listOf,
      writtenOf,
      declinedOf,
      clearChanged,
      setSigns,
      reset,
    ],
  );
}

export const CheckContext = createContext<CheckState | null>(null);

/** The check in progress. */
export function useCheck(): CheckState {
  const check = useContext(CheckContext);
  if (check === null) throw new Error('useCheck needs an AppProvider');
  return check;
}

/**
 * The profile a new look at a product is for. In woman mode, hers (the first
 * one, as the profile screen opens it). In accompanied mode, the profile of the
 * check in progress, as chosen in the list of profiles: never one picked by
 * default, so a result is never for the wrong woman. Undefined when there is
 * no profile yet, or none chosen.
 */
export function activeProfile(
  profiles: readonly Profile[],
  mode: Mode,
  checkProfileId: string | null,
): Profile | undefined {
  if (mode === 'woman') return profiles[0];
  return profiles.find((profile) => profile.id === checkProfileId);
}
