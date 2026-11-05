// SPDX-License-Identifier: MIT
import { damerauLevenshtein } from './distance.js';
import { compiledOf, containable, infoOf, lightNameOf, MIN_WORD_LENGTH } from './index-build.js';
import type { CompiledIndex, CompiledName, Scorable } from './index-build.js';
import {
  formWords,
  lightCleaned,
  normalize,
  splitAgeWords,
  withoutStopWords,
} from './normalize.js';
import { parseStrength } from './strength.js';
import { jaccard, trigrams } from './trigrams.js';
import type {
  Candidate,
  IndexEntry,
  MatchKind,
  Mention,
  ResolverIndex,
  SearchOptions,
  WeakWord,
} from './types.js';

export const DEFAULT_LIMIT = 3;
export const DEFAULT_MIN_SCORE = 0.55;
/** A candidate scoring below this share of the best candidate's score is dropped. */
export const DEFAULT_RELATIVE_CUTOFF = 0.8;
/** Score of a query equal to a whole word of a multi-word name. */
const WORD_SCORE = 0.95;
/** Score of a query that is a prefix of a name or of one of its words. */
const PREFIX_SCORE = 0.9;
/** A fuzzy match on one word of a multi-word name never beats a prefix. */
const FUZZY_WORD_CAP = 0.85;
/** Score of a query of 1 or 2 characters equal to a whole name or word. */
const SHORT_SCORE = 0.6;
/** The shortest query that can be a prefix of a whole name or fuzzy-matched. */
const MIN_PREFIX_LENGTH = 3;
/**
 * The shortest query that can be a prefix of one word of a multi-word name: a
 * short common word ("sel") must not reach a product through the start of a
 * longer word.
 */
const MIN_WORD_PREFIX_LENGTH = 4;
const STRENGTH_EPSILON = 1e-6;

/**
 * 0.5 * jaccard(trigrams) + 0.5 * (1 - distance / max length). The distance is
 * not computed when even its best case cannot reach the floor.
 */
function fuzzy(
  query: string,
  queryTri: Set<string>,
  target: string,
  targetTri: Set<string>,
  floor: number,
): number {
  const longest = Math.max(query.length, target.length);
  if (longest === 0) return 0;
  const similarity = 0.5 * jaccard(queryTri, targetTri);
  const best = similarity + 0.5 * (1 - Math.abs(query.length - target.length) / longest);
  if (best < floor) return 0;
  return similarity + 0.5 * (1 - damerauLevenshtein(query, target) / longest);
}

/** Score of a whole name (with a word of 4 letters or more) found inside a longer query. */
const CONTAINED_SCORE = 0.9;
/** Score of a product holding exactly the substances a query names, and no other word. */
const SET_SCORE = 0.95;
/** Score of a product holding the substances a query names and others. */
const SUPERSET_SCORE = 0.9;
/** Words that join the names of a combination ("paracétamol et codéine"): they name nothing. */
const JOINING_WORDS: ReadonlySet<string> = new Set(
  ['et', 'and', 'avec', 'with', 'plus'].map(normalize),
);

interface Match {
  score: number;
  /** How the score was reached. */
  kind: MatchKind;
  name: CompiledName;
  strengthMatch: boolean;
  /** How many form words of the query ("sirop", "effervescent") the product's name has. */
  formMatch: number;
  /** The query holds an age word of the product's age group (see splitAgeWords). */
  ageMatch: boolean;
  /**
   * The query names no age and the product is only for newborns or children
   * ("NOUVEAU-NE", "ENFANTS"): a maternal tool shows the others first.
   */
  childOnly: boolean;
  /** How many substances named in the query the product lacks. */
  missing: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order of the matches, best first: fewer substances named in the query and
 * missing from the product, then score, then a matching strength, then the
 * form words of the query, then a matching age word, then a product that is
 * not only for children, then a single-substance product before a
 * combination, then entry priority, then (within a family, `byName`) the
 * plainest French name, then id.
 */
function compare(a: Match, b: Match, byName = false): number {
  const combinationA = (a.name.entry.componentCount ?? 1) > 1 ? 1 : 0;
  const combinationB = (b.name.entry.componentCount ?? 1) > 1 ? 1 : 0;
  return (
    a.missing - b.missing ||
    b.score - a.score ||
    Number(b.strengthMatch) - Number(a.strengthMatch) ||
    b.formMatch - a.formMatch ||
    Number(b.ageMatch) - Number(a.ageMatch) ||
    Number(a.childOnly) - Number(b.childOnly) ||
    combinationA - combinationB ||
    b.name.entry.priority - a.name.entry.priority ||
    (byName ? compareText(infoOf(a.name.entry).sortName, infoOf(b.name.entry).sortName) : 0) ||
    compareText(a.name.entry.id, b.name.entry.id)
  );
}

/** Only for newborns or children: an age group, and not the adults'. */
function onlyForChildren(ages: ReadonlySet<string>): boolean {
  return ages.size > 0 && !ages.has('adult');
}

/** The family prefix of generic products, grouped by their substances (see entriesFromPack). */
const GENERIC_FAMILY = 'substances:';

/**
 * Order of the products of one family: as `compare`, except that in a family
 * of generics, when the query gives no strength, the product without strength
 * (the generic named by its substance only) stands for the family before its
 * strengths, which are then offered as variants. In a brand family, a product
 * without a strength in mg is a liquid or a cream, not the brand itself, so
 * the usual order applies.
 */
function compareInFamily(a: Match, b: Match, strengthTyped: boolean): number {
  if (a.missing !== b.missing) return a.missing - b.missing;
  // An age word typed in the query ("doliprane enfant") picks the variant of
  // that age, after a typed strength.
  if (a.score === b.score && a.strengthMatch === b.strengthMatch && a.ageMatch !== b.ageMatch) {
    return Number(b.ageMatch) - Number(a.ageMatch);
  }
  if (!strengthTyped && a.score === b.score && a.name.entry.family.startsWith(GENERIC_FAMILY)) {
    const strengthA = (a.name.entry.strengths ?? []).length > 0 ? 1 : 0;
    const strengthB = (b.name.entry.strengths ?? []).length > 0 ? 1 : 0;
    if (strengthA !== strengthB) return strengthA - strengthB;
  }
  return compare(a, b, true);
}

/**
 * Whether the query is a prefix of the whole name (3 characters or more) or of
 * one of the words of a multi-word name (4 characters or more), so that a
 * short common word ("sel") does not reach "Fer et sélénium" through the start
 * of a longer word inside the name.
 */
function prefixMatches(name: Scorable, query: string): boolean {
  if (name.norm.startsWith(query)) return true;
  return (
    query.length >= MIN_WORD_PREFIX_LENGTH && name.words.some((word) => word.norm.startsWith(query))
  );
}

/** A score and how it was reached. */
interface Scored {
  score: number;
  kind: MatchKind;
}

/** The query as scoreName reads it. */
interface ScoredQuery {
  text: string;
  tri: Set<string>;
  compact: string;
  compactTri: Set<string>;
}

/** A whole name of this many letters or more, spelt within one edit, is a near match. */
const NEAR_NAME_LENGTH = 6;

function scoreName(name: Scorable, query: ScoredQuery, floor: number): Scored {
  const text = query.text;
  if (text.length < MIN_PREFIX_LENGTH) {
    // 1 or 2 characters: an exact whole name or whole word only.
    if (name.norm === text) return { score: SHORT_SCORE, kind: 'exact' };
    return name.words.some((word) => word.norm === text)
      ? { score: SHORT_SCORE, kind: 'word' }
      : { score: 0, kind: 'fuzzy' };
  }
  if (name.norm === text) return { score: 1, kind: 'exact' };
  let best: Scored = { score: 0, kind: 'fuzzy' };
  const better = (score: number, kind: MatchKind) => {
    if (score > best.score) best = { score, kind };
  };
  if (name.words.some((word) => word.norm === text)) better(WORD_SCORE, 'word');
  else if (prefixMatches(name, text)) better(PREFIX_SCORE, 'prefix');
  // The whole name, its words one after the other, inside a longer text,
  // whatever the words around it ("mon cytotec", "huile de ricin bio").
  if (name.containable && ` ${text} `.includes(` ${name.norm} `)) {
    better(CONTAINED_SCORE, 'contained');
  }
  // A spelling of the whole name within one edit ("misopristol") says which name it is.
  // (Only for a spelling already close enough to be scored: cheap checks first.)
  const whole = fuzzy(text, query.tri, name.norm, name.tri, floor);
  const near =
    whole > 0 &&
    name.norm.length >= NEAR_NAME_LENGTH &&
    Math.abs(text.length - name.norm.length) <= 1 &&
    damerauLevenshtein(text, name.norm) <= 1;
  better(whole, near ? 'near' : 'fuzzy');
  if (text !== query.compact || name.norm !== name.compact) {
    better(fuzzy(query.compact, query.compactTri, name.compact, name.compactTri, floor), 'fuzzy');
  }
  // Words merged as said, carrier words included ("huiledericin").
  if (name.spoken !== undefined && text === query.compact) {
    better(
      fuzzy(query.compact, query.compactTri, name.spoken.text, name.spoken.tri, floor),
      'fuzzy',
    );
  }
  // Inside a multi-word name a query of 3 characters is not fuzzy-matched
  // against one word ("sel" would reach "sels ferreux").
  for (const word of text.length >= MIN_WORD_PREFIX_LENGTH ? name.words : []) {
    if (word.norm.length < MIN_WORD_LENGTH) continue;
    better(
      Math.min(FUZZY_WORD_CAP, fuzzy(text, query.tri, word.norm, word.tri, floor)),
      'fuzzy-word',
    );
  }
  return best;
}

interface CleanQuery {
  /** The strength typed, in mg. */
  wanted: number | undefined;
  /** The name part: normalised, without strength, stop-words, salt words or age words. */
  normalized: string;
  /** The age groups the query names. */
  ages: string[];
  /** The form words of the query: they choose between the forms of one product. */
  forms: string[];
  /** The text of the name part, for lightCleaned. */
  text: string;
}

function cleanQuery(query: string, compiled: CompiledIndex): CleanQuery {
  const parsed = parseStrength(query);
  // Form and packaging words are ignored; a query made only of them ("sirop",
  // "comprimé") names no medicine and gets no candidate. Age words have no
  // weight on their own: they only choose between the variants of a product.
  const { text, ages } = splitAgeWords(
    withoutStopWords(normalize(parsed.text), compiled.keepSalts),
  );
  return {
    wanted: parsed.strengthMg,
    normalized: text,
    ages,
    forms: formWords(parsed.text),
    text: parsed.text,
  };
}

/**
 * A query of this many letters or fewer (as matched, spaces aside) reaches a
 * name it does not equal only when the match holds on both spelt as written
 * too (lightCleaned): read as it sounds, the short word "raisin" is one
 * letter from "ricin" and "Coura" starts "CURACNE" (review of SCRUM-51).
 */
const SHORT_FOLDED_LENGTH = 6;

/** The kinds of match that a short query must also reach as written. */
const CHECKED_AS_WRITTEN: ReadonlySet<MatchKind> = new Set([
  'prefix',
  'near',
  'fuzzy',
  'fuzzy-word',
]);

/** The query as written (lightCleaned), as scoreName reads a query. */
function scoredAsWritten(text: string, compiled: CompiledIndex): ScoredQuery {
  const light = lightCleaned(text, compiled.keepSalts);
  const compact = light.replaceAll(' ', '');
  return { text: light, tri: trigrams(light), compact, compactTri: trigrams(compact) };
}

/** Whether a product has the strength typed, in mg, or writes it in its name when it has none. */
function hasStrength(entry: IndexEntry, wanted: number | undefined): boolean {
  if (wanted === undefined) return false;
  const near = (mg: number) => Math.abs(mg - wanted) < STRENGTH_EPSILON;
  const strengths = entry.strengths ?? [];
  if (strengths.length > 0) return strengths.some(near);
  const written = infoOf(entry).nameStrength;
  return written !== undefined && near(written);
}

/** What a cleaned query names: substances, brands, and its other words. */
interface Mentions {
  /** The substances it names by one of their names. */
  substances: Set<string>;
  /** The substances its brands imply ("advil": ibuprofen), named or not. */
  implied: Set<string>;
  /** Each substance and brand it names, in the order of the query, each once. */
  mentions: Mention[];
  /** The words that name no substance, the words that join a combination aside. */
  rest: string[];
}

/** A mention and the word of the query it starts at. */
interface Placed {
  at: number;
  mention: Mention;
}

/**
 * The substances a cleaned query names, by any of their names (the longest
 * name first: "acide ascorbique" before "acide"), and its other words, the
 * words that join a combination ("et", "avec") left out.
 */
function substancesIn(
  compiled: CompiledIndex,
  words: readonly string[],
): { placed: Placed[]; rest: string[] } {
  const placed: Placed[] = [];
  const rest: string[] = [];
  let at = 0;
  while (at < words.length) {
    let length = Math.min(compiled.substanceWords, words.length - at);
    for (; length > 0; length -= 1) {
      const key = words.slice(at, at + length).join(' ');
      const id = compiled.substances.get(key);
      if (id === undefined) continue;
      const name = compiled.substanceTexts.get(key) ?? key;
      placed.push({ at, mention: { name, kind: 'substance', substances: [id] } });
      break;
    }
    if (length > 0) {
      at += length;
      continue;
    }
    const word = words[at] ?? '';
    if (!JOINING_WORDS.has(word)) rest.push(word);
    at += 1;
  }
  return { placed, rest };
}

/**
 * The brands a cleaned query names, the longest first ("ANTARENE CODEINE"
 * before a brand of one word). A short brand ("SP") is a brand only as the
 * whole query, as a short name is never found inside a longer text.
 */
function brandsIn(compiled: CompiledIndex, words: readonly string[]): Placed[] {
  const placed: Placed[] = [];
  let at = 0;
  while (at < words.length) {
    let length = Math.min(compiled.brandWords, words.length - at);
    for (; length > 0; length -= 1) {
      const key = words.slice(at, at + length).join(' ');
      const brand = compiled.brands.get(key);
      if (brand === undefined || !(containable(key) || length === words.length)) continue;
      placed.push({
        at,
        mention: { name: brand.name, kind: 'brand', substances: brand.substances },
      });
      break;
    }
    at += Math.max(length, 1);
  }
  return placed;
}

/**
 * The substances a cleaned query names, the brands it names with the
 * substances they imply, and its words that name no substance.
 */
function mentionsOf(compiled: CompiledIndex, normalized: string): Mentions {
  const words = normalized === '' ? [] : normalized.split(' ');
  const { placed: named, rest } = substancesIn(compiled, words);
  const brands = brandsIn(compiled, words);
  const mentions: Mention[] = [];
  for (const { mention } of [...brands, ...named].sort((a, b) => a.at - b.at)) {
    if (!mentions.some((m) => m.kind === mention.kind && m.name === mention.name)) {
      mentions.push(mention);
    }
  }
  return {
    substances: new Set(named.flatMap(({ mention }) => mention.substances)),
    implied: new Set(brands.flatMap(({ mention }) => mention.substances)),
    mentions,
    rest,
  };
}

/**
 * The substances a query names ("efferalgan codéine": codeine), sorted: the
 * confirm screen says when the product chosen lacks one of them.
 */
export function namedSubstances(index: ResolverIndex, query: string): string[] {
  const compiled = compiledOf(index);
  const { normalized } = cleanQuery(query, compiled);
  return [...mentionsOf(compiled, normalized).substances].sort();
}

/**
 * The brands and substances a query names, in its order, each with the
 * substances it stands for ("Advil codéine": the brand ADVIL, ibuprofen, and
 * the substance codeine): the confirm screen says when the product chosen
 * lacks the substances of a brand typed, and a name kept as typed is looked
 * up again for each of them.
 */
export function queryMentions(index: ResolverIndex, query: string): Mention[] {
  const compiled = compiledOf(index);
  const { normalized } = cleanQuery(query, compiled);
  return mentionsOf(compiled, normalized).mentions;
}

/** How many of the named substances an entry lacks (a plant lacks them all). */
function missingFrom(entry: IndexEntry, named: ReadonlySet<string>): number {
  if (named.size === 0) return 0;
  const held = entry.substances ?? [];
  let missing = 0;
  for (const id of named) if (!held.includes(id)) missing += 1;
  return missing;
}

/**
 * Why a whole word of a name may name none of its products (Candidate.weakWord):
 * the names of several families have it, or it starts no name of the product.
 */
function weakWordOf(kind: MatchKind, shared: boolean, leading: boolean): { weakWord?: WeakWord } {
  if (kind !== 'word') return {};
  if (shared) return { weakWord: 'shared' };
  return leading ? {} : { weakWord: 'inner' };
}

/**
 * Proposes the products and plants whose names look like the query, best
 * first, at most one candidate per family (its best product, or the one whose
 * strength is typed in the query) with the other products of the family as
 * `variants`. Sorted by score, then strength match, then single-substance
 * before combination, then entry priority, then id. A strength in the query
 * ("1 g", "400", "0,5 g") and form or packaging words ("comprimé", "sirop")
 * are not part of the name matching; a query made only of them gets no
 * candidate. Candidates below minScore, or below relativeCutoff times the
 * best score, are dropped. Never returns a level: the user confirms and the
 * engine decides.
 */
export function search(
  index: ResolverIndex,
  query: string,
  options: SearchOptions = {},
): Candidate[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const relativeCutoff = options.relativeCutoff ?? DEFAULT_RELATIVE_CUTOFF;
  const kinds = options.kinds;
  const compiled = compiledOf(index);
  const { wanted, normalized, ages: queryAges, forms, text } = cleanQuery(query, compiled);
  if (normalized === '' || limit <= 0) return [];
  const queryTri = trigrams(normalized);
  const compactQuery = normalized.replaceAll(' ', '');
  const scored: ScoredQuery = {
    text: normalized,
    tri: queryTri,
    compact: compactQuery,
    compactTri: compactQuery === normalized ? queryTri : trigrams(compactQuery),
  };
  // A query made only of substance names ("paracétamol codéine") finds the
  // products that hold them all, whatever their names.
  const mentions = mentionsOf(compiled, normalized);
  const named = mentions.substances;
  const onlySubstances = named.size >= 2 && mentions.rest.length === 0;
  // A brand named implies its substances ("Advil codéine": ibuprofen and
  // codeine): a product lacking one ranks after the ones that hold them all.
  const required = new Set([...named, ...mentions.implied]);
  // A short query reaches a name it does not equal only as written too.
  const asWritten =
    compactQuery.length <= SHORT_FOLDED_LENGTH ? scoredAsWritten(text, compiled) : undefined;

  const bestById = new Map<string, Match>();
  // The products one of whose names starts with the query as a whole word.
  const leading = new Set<string>();
  for (const name of compiled.names) {
    if (kinds && !kinds.includes(name.entry.kind)) continue;
    const missing = missingFrom(name.entry, required);
    let { score: raw, kind } = scoreName(name, scored, minScore);
    if (
      asWritten !== undefined &&
      raw >= minScore &&
      CHECKED_AS_WRITTEN.has(kind) &&
      scoreName(lightNameOf(name), asWritten, minScore).score < minScore
    ) {
      raw = 0;
    }
    if (kind === 'word' && name.leading.has(normalized)) leading.add(name.entry.id);
    if (onlySubstances && name.substance !== undefined && missing === 0) {
      const exact = (name.entry.substances ?? []).length === named.size;
      const bySubstances = exact ? SET_SCORE : SUPERSET_SCORE;
      if (bySubstances > raw) {
        raw = bySubstances;
        kind = 'substances';
      }
    }
    const score = Math.round(raw * 10000) / 10000;
    if (score < minScore || score === 0) continue;
    const strengthMatch = hasStrength(name.entry, wanted);
    const productForms = infoOf(name.entry).forms;
    const formMatch = forms.filter((form) => productForms.has(form)).length;
    const ageMatch = queryAges.some((age) => name.ages.has(age));
    const childOnly = queryAges.length === 0 && onlyForChildren(name.ages);
    const match: Match = {
      score,
      kind,
      name,
      strengthMatch,
      formMatch,
      ageMatch,
      childOnly,
      missing,
    };
    const known = bestById.get(name.entry.id);
    if (!known || compare(match, known) < 0) bestById.set(name.entry.id, match);
  }

  const bestByFamily = new Map<string, Match>();
  for (const match of bestById.values()) {
    const known = bestByFamily.get(match.name.entry.family);
    if (!known || compareInFamily(match, known, wanted !== undefined) < 0) {
      bestByFamily.set(match.name.entry.family, match);
    }
  }

  const ranked = [...bestByFamily.values()].sort(compare);
  const floor = (ranked[0]?.score ?? 0) * relativeCutoff;
  // A candidate lacking a substance the query names is kept only when its
  // name matches at least as well as the best candidate that lacks none.
  const holding = ranked[0]?.missing === 0 ? ranked[0].score : 0;
  return ranked
    .filter((match) => match.score >= floor && (match.missing === 0 || match.score >= holding))
    .slice(0, limit)
    .map(({ score, kind, name }) => ({
      id: name.entry.id,
      kind: name.entry.kind,
      family: name.entry.family,
      display: name.entry.display,
      detail: name.entry.detail,
      matched: name.text,
      matchedLang: name.lang,
      score,
      match: kind,
      ...weakWordOf(kind, compiled.sharedWords.has(normalized), leading.has(name.entry.id)),
      queryLength: compactQuery.length,
      variants: (compiled.families.get(name.entry.family) ?? [])
        .filter((member) => member.id !== name.entry.id)
        .map((member) => member.id),
    }));
}
