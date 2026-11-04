// SPDX-License-Identifier: MIT
import { normalize } from './normalize.js';
import { trigrams } from './trigrams.js';
import type { IndexEntry, NameLang, ResolverIndex } from './types.js';

/** A word of a multi-word name, normalised, with its trigrams. */
export interface CompiledWord {
  norm: string;
  tri: Set<string>;
}

/** One name of an entry, normalised once when the index is built. */
export interface CompiledName {
  entry: IndexEntry;
  text: string;
  lang: NameLang;
  norm: string;
  tri: Set<string>;
  /** The normalised name without spaces, to match words split or merged by a speech model. */
  compact: string;
  compactTri: Set<string>;
  /** Words of at least 2 characters, only for names of several words. */
  words: CompiledWord[];
}

export interface CompiledIndex {
  size: number;
  names: CompiledName[];
  /** For each family, its products (one entry per id) sorted by strength ascending, then id. */
  families: Map<string, IndexEntry[]>;
}

/** The first strength of an entry, or Infinity when it has none (sorted last). */
export function firstStrength(entry: IndexEntry): number {
  return entry.strengths?.[0] ?? Number.POSITIVE_INFINITY;
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function buildFamilies(entries: IndexEntry[]): Map<string, IndexEntry[]> {
  const families = new Map<string, Map<string, IndexEntry>>();
  for (const entry of entries) {
    const members = families.get(entry.family) ?? new Map<string, IndexEntry>();
    const known = members.get(entry.id);
    // An id can have two entries (names and INN); keep the one that carries the strengths.
    if (!known || (known.strengths === undefined && entry.strengths !== undefined)) {
      members.set(entry.id, entry);
    }
    families.set(entry.family, members);
  }
  const sorted = new Map<string, IndexEntry[]>();
  for (const [family, members] of families) {
    sorted.set(
      family,
      [...members.values()].sort(
        (a, b) =>
          compareNumbers(firstStrength(a), firstStrength(b)) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    );
  }
  return sorted;
}

/** A word of a multi-word name shorter than this can only be matched exactly. */
export const MIN_WORD_LENGTH = 3;
/** Words shorter than this are not indexed alone. */
const MIN_ABBREVIATION_LENGTH = 2;

const compiled = new WeakMap<ResolverIndex, CompiledIndex>();

/** Builds the index. The input order does not matter: the results are sorted. */
export function buildIndex(entries: IndexEntry[]): ResolverIndex {
  const names: CompiledName[] = [];
  for (const entry of entries) {
    for (const name of entry.names) {
      const norm = normalize(name.text);
      if (norm === '') continue;
      const compact = norm.replaceAll(' ', '');
      const parts = norm.split(' ');
      names.push({
        entry,
        text: name.text,
        lang: name.lang,
        norm,
        tri: trigrams(norm),
        compact,
        compactTri: trigrams(compact),
        words:
          parts.length > 1
            ? parts
                .filter((part) => part.length >= MIN_ABBREVIATION_LENGTH)
                .map((part) => ({ norm: part, tri: trigrams(part) }))
            : [],
      });
    }
  }
  const index: ResolverIndex = Object.freeze({ size: entries.length });
  compiled.set(index, { size: entries.length, names, families: buildFamilies(entries) });
  return index;
}

/** The compiled form of an index built by buildIndex. */
export function compiledOf(index: ResolverIndex): CompiledIndex {
  const found = compiled.get(index);
  if (!found) throw new Error('The index was not built by buildIndex');
  return found;
}
