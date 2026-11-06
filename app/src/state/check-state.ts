// SPDX-License-Identifier: MIT
// The check in progress: who it is for, the items the user confirmed and the
// danger signs she gave. Kept in memory only (a reload starts a new check).
// Only confirmed items get here: the confirm screen adds a recognised product
// or remedy, the search screen adds the text of one it could not find. A
// product is never listed twice: two items of one product would read as a
// duplicate to the engine and double its daily total.
//
// In accompanied mode a visit goes from woman to woman: the unfinished list
// of each woman waits in memory while another one is looked at, and comes
// back when she is chosen again (her danger signs are asked again; within one
// check the answer is kept while products are added or taken off). Those
// lists are forgotten at every lock and at the quick exit; the list on
// screen follows the check (kept across an auto-lock with the screen held,
// forgotten at the quick exit). A passer-by can be looked up without a
// profile (accompanied mode): her answers stay in memory only (`quick`),
// never in storage, and she is let go as soon as another woman or passer-by
// is looked at, at every lock, at a change of mode, at the quick exit, at an
// erase and at a reload.
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
  /**
   * The answers of a passer-by checked without a profile, in memory only (never
   * stored, no history), when the check is hers; null otherwise.
   */
  quick: Profile | null;
  // Function properties, not methods: stable callbacks, safe to pass on alone.
  /**
   * The check is for this profile: kept when it already is (or when it was
   * for none yet). For another one, the list left waits in memory (unless it
   * is empty or a passer-by's), and the list this profile was left with comes
   * back, its danger signs to be asked again; none: an empty list.
   */
  start: (profileId: string) => void;
  /**
   * A check for a passer-by, from an empty list: her answers (pregnancy, term,
   * breastfeeding, situations) as a profile kept in memory only. The list left
   * waits as with `start`; an earlier passer-by is let go.
   */
  startQuick: (profile: Profile) => void;
  /**
   * New answers for the passer-by of the check (`profile` keeps her id): her
   * list stays, her danger signs are asked again. Nothing happens when the
   * check is not hers.
   */
  updateQuick: (profile: Profile) => void;
  /**
   * Lets the passer-by go (a lock, a change of mode): when the check is hers,
   * it is for no one now, empty; the lists waiting for the women stay.
   */
  forgetQuick: () => void;
  /** Forgets the list of this profile (deleted): the one waiting, or the one on screen. */
  forget: (profileId: string) => void;
  /** Forgets the lists waiting for the other women (a lock), keeping the one on screen. */
  forgetOthers: () => void;
  /** How many items the list of this profile holds now, on screen or waiting (0: none). */
  pendingOf: (profileId: string) => number;
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
  /**
   * Whether the voice heard the name of an item (the name she said for a
   * product shown under another name, or a text kept as she said it): it is
   * labelled "Vous avez dit", not "Vous avez écrit".
   */
  saidOf: (item: CheckedItem) => boolean;
  /** Whether she answered "Plus de 100 mg" to the dose of a box listed with no range (generic aspirin). */
  aboveOf: (item: CheckedItem) => boolean;
  /** What the last add did, until the check screen has said so (clearChanged); null otherwise. */
  changed: CheckChange | null;
  clearChanged: () => void;
  /** The answer to the signs question: the signs present now, or none (empty). */
  setSigns: (signs: string[]) => void;
  /** No answer to the signs question (yet): the result asks it first. */
  clearSigns: () => void;
  /** Back to no check at all, for no profile: every list and the passer-by forgotten. */
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
  /**
   * The voice heard the name: `written`, or the unrecognised text. Without it,
   * the name was typed.
   */
  said?: boolean;
  /**
   * The listed item this one takes the place of: she said it is the same box,
   * read another way (a dose range dropped for the more cautious reading).
   */
  replacing?: CheckedItem;
  /**
   * She answered "Plus de 100 mg" to the dose of this box (generic aspirin),
   * said with its name; without it, a box written with no range says none.
   */
  above?: boolean;
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
  /** The items whose name the voice heard (written, or the unrecognised text), by refKey. */
  said: Readonly<Record<string, true>>;
  /** The boxes listed with no range whose dose she answered "Plus de ...", by refKey. */
  above: Readonly<Record<string, true>>;
  /** The unfinished lists of the other women of the visit, by profile id. */
  others: Readonly<Record<string, KeptList>>;
  /** The passer-by's answers, when the check is hers. */
  quick: Profile | null;
}

/** A list waiting while another woman is looked at: its items and what was said about them. */
type KeptList = Pick<
  CheckData,
  'items' | 'lists' | 'families' | 'written' | 'declined' | 'said' | 'above'
>;

type Action =
  | { type: 'start'; profileId: string }
  | { type: 'startQuick'; profile: Profile }
  | { type: 'updateQuick'; profile: Profile }
  | { type: 'forgetQuick' }
  | { type: 'forget'; profileId: string }
  | { type: 'forgetOthers' }
  | { type: 'add'; item: CheckedItem; options: AddOptions }
  | { type: 'remove'; index: number }
  | { type: 'restore'; index: number; item: CheckedItem }
  | { type: 'clearChanged' }
  | { type: 'signs'; signs: string[] }
  | { type: 'clearSigns' }
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
  said: {},
  above: {},
  others: {},
  quick: null,
};

/** The record without `key`. */
function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([listed]) => listed !== key));
}

/**
 * The check for another profile: the list left waits for its woman (unless it
 * is empty or a passer-by's, who is let go), and the list `profileId` was
 * left with comes back (a passer-by's always starts empty). The danger signs
 * are asked again (reduce clears them as the list changes).
 */
function switched(state: CheckData, profileId: string, quick: Profile | null): CheckData {
  const left = state.profileId;
  let others = without(state.others, profileId);
  if (left !== null && state.quick?.id !== left && state.items.length > 0) {
    const { items, lists, families, written, declined, said, above } = state;
    others = { ...others, [left]: { items, lists, families, written, declined, said, above } };
  }
  const kept = quick === null ? state.others[profileId] : undefined;
  return { ...EMPTY, ...kept, profileId, quick, others };
}

function unknownStrength(item: CheckedItem): boolean {
  return item.strengthUnknown === true && item.ref.kind === 'product';
}

/**
 * What an item is, for "never twice": the product, plant or text, with its
 * dose range ("100 mg ou moins" is another box than one read above it, so
 * neither takes the other's place); for a product whose strength is unknown,
 * its family (another key than any known strength, so it never takes a known
 * strength's place).
 */
function identity(item: CheckedItem, families: CheckData['families']): string {
  if (!unknownStrength(item) || item.ref.kind !== 'product') {
    const atMost = item.strengthAtMostMg;
    return atMost === undefined ? refKey(item.ref) : `${refKey(item.ref)}@${String(atMost)}`;
  }
  const family = families[item.ref.id];
  return family === undefined ? `unknown:${refKey(item.ref)}` : `unknown-family:${family}`;
}

function sameItem(a: CheckedItem, b: CheckedItem): boolean {
  return (
    sameRef(a.ref, b.ref) &&
    a.unitsPerDay === b.unitsPerDay &&
    (a.strengthUnknown ?? false) === (b.strengthUnknown ?? false) &&
    a.strengthAtMostMg === b.strengthAtMostMg &&
    (a.longTerm ?? false) === (b.longTerm ?? false)
  );
}

/** The index of an item of unknown strength that a known strength of the same product or family replaces. */
function unknownToReplace(state: CheckData, item: CheckedItem): number {
  const ref = item.ref;
  // A dose range never takes the place of a box read as not known: it would read lower.
  if (unknownStrength(item) || ref.kind !== 'product' || item.strengthAtMostMg !== undefined) {
    return -1;
  }
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
  const key = refKey(item.ref);
  // The name typed goes with the product or remedy as it was last confirmed.
  let written = base.written;
  if (item.ref.kind !== 'unrecognised') {
    const others = Object.entries(base.written).filter(([listed]) => listed !== key);
    written = Object.fromEntries(
      options.written === undefined ? others : [...others, [key, options.written]],
    );
  }
  const declined =
    item.ref.kind === 'unrecognised' && options.declined === true
      ? { ...base.declined, [refKey(item.ref)]: true as const }
      : base.declined;
  // Heard or typed, as it was last confirmed.
  const said =
    options.said === true ? { ...base.said, [key]: true as const } : without(base.said, key);
  // "Plus de ..." goes with the box listed without a range, as it was last confirmed.
  const plain =
    item.ref.kind === 'product' &&
    item.strengthAtMostMg === undefined &&
    item.strengthUnknown !== true;
  let above = base.above;
  if (plain) above = options.above === true ? { ...above, [key]: true } : without(above, key);
  const state = { ...base, lists, families, written, declined, said, above };
  const same = identity(item, families);
  const replacing = options.replacing;
  const replaced =
    replacing === undefined ? -1 : state.items.findIndex((listed) => sameItem(listed, replacing));
  if (replaced >= 0) {
    // Listed already as it is now read: the one replaced goes, never twice.
    const elsewhere = state.items.some(
      (listed, i) => i !== replaced && identity(listed, families) === same,
    );
    const items = elsewhere
      ? state.items.filter((_, i) => i !== replaced)
      : state.items.map((listed, i) => (i === replaced ? item : listed));
    return { ...state, items, changed: { kind: 'updated', item } };
  }
  let index = state.items.findIndex((listed) => identity(listed, families) === same);
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

/** No answer to the signs question: they are asked again before the result. */
function withoutSigns(state: CheckData): CheckData {
  return state.signsGiven || state.signs.length > 0
    ? { ...state, signs: [], signsGiven: false }
    : state;
}

/**
 * The danger signs answer is kept within one check (SCRUM-56, S14, a change
 * of the rule of the implementation design, section 2): adding or taking off
 * a product does not ask it again. It is forgotten when another woman or a
 * passer-by is looked at, when the passer-by's answers change or she is let
 * go, at the quick exit (reset), and on clearSigns: the check screen calls it
 * when it is left and when her answers change, the session at every lock,
 * "Changer" and "Oui, au moins un" when the question is asked again.
 */
function reduce(state: CheckData, action: Action): CheckData {
  switch (action.type) {
    case 'start':
      if (state.profileId === action.profileId) return state;
      // Items added before any profile go to the first one.
      if (state.profileId === null && Object.keys(state.others).length === 0) {
        return { ...state, profileId: action.profileId };
      }
      return switched(state, action.profileId, null);
    case 'startQuick':
      return switched(state, action.profile.id, action.profile);
    case 'updateQuick':
      return state.quick?.id === action.profile.id && state.profileId === action.profile.id
        ? withoutSigns({ ...state, quick: action.profile })
        : state;
    case 'forgetQuick':
      if (state.quick === null) return state;
      return state.profileId === state.quick.id
        ? { ...EMPTY, others: state.others }
        : { ...state, quick: null };
    case 'forget': {
      const others = without(state.others, action.profileId);
      if (state.profileId === action.profileId) return { ...EMPTY, others };
      return action.profileId in state.others ? { ...state, others } : state;
    }
    case 'forgetOthers':
      return Object.keys(state.others).length === 0 ? state : { ...state, others: {} };
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
    case 'clearSigns':
      return withoutSigns(state);
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
  const atMost: unknown = item.strengthAtMostMg;
  if (
    atMost !== undefined &&
    !(typeof atMost === 'number' && Number.isFinite(atMost) && atMost > 0)
  ) {
    throw new RangeError(
      `A dose range must be a number of mg greater than 0: ${typeof atMost === 'number' ? String(atMost) : typeof atMost}`,
    );
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
  const startQuick = useCallback((profile: Profile) => {
    dispatch({ type: 'startQuick', profile });
  }, []);
  const updateQuick = useCallback((profile: Profile) => {
    dispatch({ type: 'updateQuick', profile });
  }, []);
  const forgetQuick = useCallback(() => {
    dispatch({ type: 'forgetQuick' });
  }, []);
  const forget = useCallback((profileId: string) => {
    dispatch({ type: 'forget', profileId });
  }, []);
  const forgetOthers = useCallback(() => {
    dispatch({ type: 'forgetOthers' });
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
  const clearSigns = useCallback(() => {
    dispatch({ type: 'clearSigns' });
  }, []);
  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);
  const {
    profileId,
    items,
    signs,
    signsGiven,
    changed,
    lists,
    written,
    declined,
    said,
    above,
    others,
    quick,
  } = data;
  const pendingOf = useCallback(
    (id: string) => (id === profileId ? items.length : (others[id]?.items.length ?? 0)),
    [profileId, items, others],
  );
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
  const saidOf = useCallback((item: CheckedItem) => said[refKey(item.ref)] === true, [said]);
  const aboveOf = useCallback(
    (item: CheckedItem) =>
      item.strengthAtMostMg === undefined &&
      item.strengthUnknown !== true &&
      above[refKey(item.ref)] === true,
    [above],
  );
  return useMemo(
    () => ({
      profileId,
      items,
      signs,
      signsGiven,
      changed,
      quick,
      start,
      startQuick,
      updateQuick,
      forgetQuick,
      forget,
      forgetOthers,
      pendingOf,
      add,
      remove,
      restore,
      indexOf,
      listOf,
      writtenOf,
      declinedOf,
      saidOf,
      aboveOf,
      clearChanged,
      setSigns,
      clearSigns,
      reset,
    }),
    [
      profileId,
      items,
      signs,
      signsGiven,
      changed,
      quick,
      start,
      startQuick,
      updateQuick,
      forgetQuick,
      forget,
      forgetOthers,
      pendingOf,
      add,
      remove,
      restore,
      indexOf,
      listOf,
      writtenOf,
      declinedOf,
      saidOf,
      aboveOf,
      clearChanged,
      setSigns,
      clearSigns,
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
 * Her own profile on the phone: the one marked as hers (made in woman mode).
 * A record older than the mark is hers only when it is the only profile; a
 * profile made in accompanied mode (marked false) is never hers. Undefined
 * when she has none yet (the profile screen then starts an empty one).
 */
export function ownProfile(profiles: readonly Profile[]): Profile | undefined {
  const mine = profiles.find((profile) => profile.self === true);
  if (mine) return mine;
  const [only] = profiles;
  return profiles.length === 1 && only?.self === undefined ? only : undefined;
}

/**
 * The profile a new look at a product is for. In woman mode, her own
 * (ownProfile): never another woman's profile kept on the phone. In
 * accompanied mode, the profile of the check in progress, as chosen in the
 * list of profiles: never one picked by default, so a result is never for the
 * wrong woman. Undefined when there is no profile yet, or none chosen.
 */
export function activeProfile(
  profiles: readonly Profile[],
  mode: Mode,
  checkProfileId: string | null,
): Profile | undefined {
  if (mode === 'woman') return ownProfile(profiles);
  return profiles.find((profile) => profile.id === checkProfileId);
}
