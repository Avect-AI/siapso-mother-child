// SPDX-License-Identifier: MIT
import {
  ageMarkersOf,
  formWords,
  isFormWord,
  isSaltWord,
  normalize,
  splitAgeWords,
  withoutStopWords,
} from './normalize.js';
import { parseStrength } from './strength.js';
import { trigrams } from './trigrams.js';
import type { IndexEntry, NameLang, ResolverIndex } from './types.js';

/** A word of a multi-word name, normalised, with its trigrams. */
export interface CompiledWord {
  norm: string;
  tri: Set<string>;
}

/** What the ranking reads of a product, shared by all its names. */
export interface EntryInfo {
  /** Its French name, normalised: the plainest name of a family sorts first. */
  sortName: string;
  /** The form words of its French name ("comprim", "efervescent"). */
  forms: ReadonlySet<string>;
  /** For a product without a strength in mg, the strength its name writes ("ADULTES 1000 mg"). */
  nameStrength?: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const infos = new WeakMap<IndexEntry, EntryInfo>();

/** The ranking information of an entry, computed once. */
export function infoOf(entry: IndexEntry): EntryInfo {
  let info = infos.get(entry);
  if (info === undefined) {
    const strength =
      (entry.strengths ?? []).length === 0 ? parseStrength(entry.display.fr).strengthMg : undefined;
    info = {
      sortName: normalize(entry.display.fr),
      forms: new Set(formWords(entry.display.fr)),
      ...(strength === undefined ? {} : { nameStrength: strength }),
    };
    infos.set(entry, info);
  }
  return info;
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
  /**
   * The name without spaces as it is said, its carrier and generic words kept
   * ("huiledericin"), when it differs from `compact`: a speech model merges
   * the words it hears.
   */
  spoken?: { text: string; tri: Set<string> };
  /** Words of at least 2 characters, only for names of several words. */
  words: CompiledWord[];
  /**
   * The age groups (adult, child, infant) named by any name of the product
   * this name belongs to. The age words are not part of `norm`.
   */
  ages: ReadonlySet<string>;
  /** The substance an INN name names. */
  substance?: string;
  /**
   * Whether the name can be found inside a longer query, its words one after
   * the other ("Advil pour les douleurs", "mon cytotec", "huile de ricin
   * bio"): it has a word of 4 letters or more, so a short name ("fer", "nim")
   * is not found inside any text.
   */
  containable: boolean;
  /**
   * The words that lead the name, so a query equal to one of them names it
   * (normalised, as matched): the first word of the name and of each part in
   * brackets ("oseille" of "Bissap (oseille de Guinée)"), and the first word
   * after the substance names and short prefixes a brand may follow
   * ("acnetrait" of "ISOTRETINOINE ACNETRAIT", "codion" of "Néo-Codion",
   * "profenid" of "BI PROFENID LP"). A word after the brand word ("chrono"
   * of "DEPAKINE CHRONO") does not lead it.
   */
  leading: ReadonlySet<string>;
}

/** A word this short before a brand is a prefix joined to it ("Néo-Codion", "BI PROFENID"). */
const PREFIX_LENGTH = 3;

/** The words that lead a name (CompiledName.leading); `cleaned` cleans a text as names are. */
function leadingWordsOf(
  text: string,
  cleaned: (text: string) => string,
  substances: ReadonlyMap<string, string>,
  substanceWords: number,
): Set<string> {
  const leading = new Set<string>();
  for (const part of text.split(/[()]/)) {
    const words = cleaned(part)
      .split(' ')
      .filter((word) => word !== '');
    const [first] = words;
    if (first === undefined) continue;
    leading.add(first);
    let at = 0;
    while (at < words.length) {
      let length = Math.min(substanceWords, words.length - at);
      while (length > 0 && !substances.has(words.slice(at, at + length).join(' '))) length -= 1;
      if (length > 0) at += length;
      else if ((words[at] ?? '').length <= PREFIX_LENGTH) at += 1;
      else break;
    }
    const brand = words[at];
    if (brand !== undefined) leading.add(brand);
  }
  return leading;
}

/** A name needs a word of this many letters or more to be found inside a longer text. */
export const MIN_CONTAINED_WORD_LENGTH = 4;

/** Whether a cleaned name has a word of 4 letters or more (digits aside). */
export function containable(cleaned: string): boolean {
  return cleaned
    .split(' ')
    .some((word) => word.length >= MIN_CONTAINED_WORD_LENGTH && /\p{L}/u.test(word));
}

export interface CompiledIndex {
  size: number;
  names: CompiledName[];
  /** The salt words that are substances of their own in this index ("calcium"): never removed. */
  keepSalts: ReadonlySet<string>;
  /**
   * For each family, its products (one entry per id) sorted by strength
   * ascending, then French name (the plainest form first), then id: the same
   * order for every brand.
   */
  families: Map<string, IndexEntry[]>;
  /** Every substance name (normalised, as matched) and the substance it names; the first wins. */
  substances: Map<string, string>;
  /** The number of words of the longest substance name. */
  substanceWords: number;
  /** The words (normalised, as matched) found in the names of two families or more. */
  sharedWords: ReadonlySet<string>;
}

/** The words of the names that two families or more have in their names. */
function sharedWordsOf(names: readonly CompiledName[]): Set<string> {
  const families = new Map<string, Set<string>>();
  for (const name of names) {
    for (const word of new Set(name.norm.split(' '))) {
      const seen = families.get(word) ?? new Set<string>();
      seen.add(name.entry.family);
      families.set(word, seen);
    }
  }
  return new Set([...families].filter(([, seen]) => seen.size > 1).map(([word]) => word));
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
          compareText(infoOf(a).sortName, infoOf(b).sortName) ||
          compareText(a.id, b.id),
      ),
    );
  }
  return sorted;
}

/**
 * A substance name, then each part of it around its brackets ("Acide
 * ascorbique (vitamine C)": "Acide ascorbique" and "vitamine C"): each one
 * says the query names that substance. They are not names of their own: a
 * part can be a description ("sels ferreux"), not a name.
 */
export function substanceNameParts(name: string): string[] {
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name);
  if (!match) return [name];
  return [name, (match[1] ?? '').trim(), (match[2] ?? '').trim()];
}

/** A word of a multi-word name shorter than this can only be matched exactly. */
export const MIN_WORD_LENGTH = 3;
/** Words shorter than this are not indexed alone. */
const MIN_ABBREVIATION_LENGTH = 2;

const compiled = new WeakMap<ResolverIndex, CompiledIndex>();

/** Builds the index. The input order does not matter: the results are sorted. */
export function buildIndex(entries: IndexEntry[]): ResolverIndex {
  const names: CompiledName[] = [];
  // A salt word that names a substance of the index ("Calcium") is a name, not a salt.
  const keepSalts = new Set(
    entries.flatMap((entry) =>
      entry.names.flatMap((name) =>
        name.substance === undefined ? [] : normalize(name.text).split(' ').filter(isSaltWord),
      ),
    ),
  );
  const clean = (text: string): string => withoutStopWords(normalize(text), keepSalts);
  // Age groups per product id: a product has several names (the age word is in
  // the full name, not in the brand), and an INN entry shares the id.
  const agesById = new Map<string, Set<string>>();
  for (const entry of entries) {
    const ages = agesById.get(entry.id) ?? new Set<string>();
    for (const name of entry.names) {
      const cleaned = clean(name.text);
      for (const age of splitAgeWords(cleaned).ages) ages.add(age);
      for (const age of ageMarkersOf(cleaned)) ages.add(age);
    }
    agesById.set(entry.id, ages);
  }
  const substances = new Map<string, string>();
  let substanceWords = 0;
  for (const entry of entries) {
    for (const name of entry.names) {
      // Form, packaging and age words are not part of the matching; a name
      // made only of them can never be matched (such a query gets no candidate).
      const norm = splitAgeWords(clean(name.text)).text;
      if (norm === '') continue;
      const compact = norm.replaceAll(' ', '');
      const spoken = splitAgeWords(
        normalize(name.text)
          .split(' ')
          .filter((word) => !isFormWord(word))
          .join(' '),
      ).text.replaceAll(' ', '');
      const parts = norm.split(' ');
      if (name.substance !== undefined) {
        for (const part of substanceNameParts(name.text)) {
          const key = splitAgeWords(clean(part)).text;
          if (key === '') continue;
          if (!substances.has(key)) substances.set(key, name.substance);
          substanceWords = Math.max(substanceWords, key.split(' ').length);
        }
      }
      names.push({
        entry,
        text: name.text,
        lang: name.lang,
        norm,
        tri: trigrams(norm),
        compact,
        compactTri: trigrams(compact),
        ...(spoken !== compact && spoken !== ''
          ? { spoken: { text: spoken, tri: trigrams(spoken) } }
          : {}),
        words:
          parts.length > 1
            ? parts
                .filter((part) => part.length >= MIN_ABBREVIATION_LENGTH)
                .map((part) => ({ norm: part, tri: trigrams(part) }))
            : [],
        ages: agesById.get(entry.id) ?? new Set<string>(),
        ...(name.substance === undefined ? {} : { substance: name.substance }),
        containable: containable(norm),
        // Once every substance name is known (below).
        leading: new Set<string>(),
      });
    }
  }
  const cleanedPart = (part: string) => splitAgeWords(clean(part)).text;
  for (const name of names) {
    name.leading = leadingWordsOf(name.text, cleanedPart, substances, substanceWords);
  }
  const index: ResolverIndex = Object.freeze({ size: entries.length });
  compiled.set(index, {
    size: entries.length,
    names,
    keepSalts,
    families: buildFamilies(entries),
    substances,
    substanceWords,
    sharedWords: sharedWordsOf(names),
  });
  return index;
}

/** The compiled form of an index built by buildIndex. */
export function compiledOf(index: ResolverIndex): CompiledIndex {
  const found = compiled.get(index);
  if (!found) throw new Error('The index was not built by buildIndex');
  return found;
}
