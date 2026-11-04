// SPDX-License-Identifier: MIT
import { damerauLevenshtein } from './distance.js';
import { compiledOf, MIN_WORD_LENGTH } from './index-build.js';
import type { CompiledName } from './index-build.js';
import { normalize } from './normalize.js';
import { parseStrength } from './strength.js';
import { jaccard, trigrams } from './trigrams.js';
import type { Candidate, ResolverIndex, SearchOptions } from './types.js';

export const DEFAULT_LIMIT = 3;
export const DEFAULT_MIN_SCORE = 0.45;
/** Score of a query equal to a whole word of a multi-word name. */
const WORD_SCORE = 0.95;
/** Score of a query that is a prefix of a name or of one of its words. */
const PREFIX_SCORE = 0.9;
/** A fuzzy match on one word of a multi-word name never beats a prefix. */
const FUZZY_WORD_CAP = 0.85;
/** Score of a query of 1 or 2 characters equal to a whole name or word. */
const SHORT_SCORE = 0.6;
/** The shortest query that can be a prefix or fuzzy-matched. */
const MIN_PREFIX_LENGTH = 3;
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

interface Match {
  score: number;
  name: CompiledName;
  strengthMatch: boolean;
}

/**
 * Order of the matches, best first: score, then a matching strength, then a
 * single-substance product before a combination, then entry priority, then id.
 */
function compare(a: Match, b: Match): number {
  const combinationA = (a.name.entry.componentCount ?? 1) > 1 ? 1 : 0;
  const combinationB = (b.name.entry.componentCount ?? 1) > 1 ? 1 : 0;
  const idA = a.name.entry.id;
  const idB = b.name.entry.id;
  return (
    b.score - a.score ||
    Number(b.strengthMatch) - Number(a.strengthMatch) ||
    combinationA - combinationB ||
    b.name.entry.priority - a.name.entry.priority ||
    (idA < idB ? -1 : idA > idB ? 1 : 0)
  );
}

function scoreName(
  name: CompiledName,
  query: string,
  queryTri: Set<string>,
  compactQuery: string,
  compactTri: Set<string>,
  floor: number,
): number {
  if (query.length < MIN_PREFIX_LENGTH) {
    // 1 or 2 characters: an exact whole name or whole word only.
    return name.norm === query || name.words.some((word) => word.norm === query) ? SHORT_SCORE : 0;
  }
  if (name.norm === query) return 1;
  let score = 0;
  if (name.words.some((word) => word.norm === query)) score = WORD_SCORE;
  else if (name.norm.startsWith(query) || name.words.some((word) => word.norm.startsWith(query))) {
    score = PREFIX_SCORE;
  }
  score = Math.max(score, fuzzy(query, queryTri, name.norm, name.tri, floor));
  if (query !== compactQuery || name.norm !== name.compact) {
    score = Math.max(score, fuzzy(compactQuery, compactTri, name.compact, name.compactTri, floor));
  }
  for (const word of name.words) {
    if (word.norm.length < MIN_WORD_LENGTH) continue;
    score = Math.max(
      score,
      Math.min(FUZZY_WORD_CAP, fuzzy(query, queryTri, word.norm, word.tri, floor)),
    );
  }
  return score;
}

/**
 * Proposes the products and plants whose names look like the query, best
 * first, at most one candidate per family (its best product, or the one whose
 * strength is typed in the query) with the other products of the family as
 * `variants`. Sorted by score, then strength match, then single-substance
 * before combination, then entry priority, then id. A strength in the query
 * ("1 g", "400", "0,5 g") is not part of the name matching. Never returns a
 * level: the user confirms and the engine decides.
 */
export function search(
  index: ResolverIndex,
  query: string,
  options: SearchOptions = {},
): Candidate[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const kinds = options.kinds;
  const parsed = parseStrength(query);
  const wanted = parsed.strengthMg;
  const normalized = normalize(parsed.text);
  if (normalized === '' || limit <= 0) return [];
  const queryTri = trigrams(normalized);
  const compactQuery = normalized.replaceAll(' ', '');
  const compactTri = compactQuery === normalized ? queryTri : trigrams(compactQuery);
  const compiled = compiledOf(index);

  const bestById = new Map<string, Match>();
  for (const name of compiled.names) {
    if (kinds && !kinds.includes(name.entry.kind)) continue;
    const raw = scoreName(name, normalized, queryTri, compactQuery, compactTri, minScore);
    const score = Math.round(raw * 10000) / 10000;
    if (score < minScore || score === 0) continue;
    const strengthMatch =
      wanted !== undefined &&
      (name.entry.strengths ?? []).some((mg) => Math.abs(mg - wanted) < STRENGTH_EPSILON);
    const match: Match = { score, name, strengthMatch };
    const known = bestById.get(name.entry.id);
    if (!known || compare(match, known) < 0) bestById.set(name.entry.id, match);
  }

  const bestByFamily = new Map<string, Match>();
  for (const match of bestById.values()) {
    const known = bestByFamily.get(match.name.entry.family);
    if (!known || compare(match, known) < 0) bestByFamily.set(match.name.entry.family, match);
  }

  return [...bestByFamily.values()]
    .sort(compare)
    .slice(0, limit)
    .map(({ score, name }) => ({
      id: name.entry.id,
      kind: name.entry.kind,
      family: name.entry.family,
      display: name.entry.display,
      detail: name.entry.detail,
      matched: name.text,
      matchedLang: name.lang,
      score,
      variants: (compiled.families.get(name.entry.family) ?? [])
        .filter((member) => member.id !== name.entry.id)
        .map((member) => member.id),
    }));
}
