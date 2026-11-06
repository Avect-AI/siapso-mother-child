// SPDX-License-Identifier: MIT
// The safety net of the result. A name added as unrecognised ("Je ne trouve
// pas ce produit") stays unrecognised, but it is looked up again in both
// lists, medicines and remedies: when it clearly names a product or a remedy
// of the base (see strengthOf), that product or remedy is evaluated too, as a
// possible match, so that a name kept as free text is not evaluated lower
// than what the base knows for what it clearly names. A weak resemblance
// (a few letters in common, the start of a first name) is not kept after she
// said it was none of the products proposed, and only a very strong one may
// raise the result to a danger. Pure: the result screen hands in the pack and
// the items of the context. The resolver only proposes; the engine sets the
// level of the possible match, which cappedEvaluation may only lower.
import { levelRank, maxLevel, type CheckedItem, type Evaluation, type Pack } from '@siapso/engine';
import { parseStrength, search, type Candidate } from '@siapso/resolver';
import {
  productDoseRangeOf,
  productFamilyOf,
  searchIndexOf,
  strengthChoiceOf,
} from './search-index.js';

/**
 * How clearly a name names its possible match: `very-strong` (the whole name,
 * a whole word of it, its name inside a longer text, or a score of 0.9 or
 * more), `strong` (a score of 0.8 or more, or the whole name of 6 letters or
 * more spelt within one edit: "cytotek"), `weak` otherwise. A prefix of
 * fewer than 6 letters ("Anta", a first name), a spelling close to one word
 * of a longer name ("vitamines") and a whole word that names none of its
 * products alone (one the names of several families share, a laboratory,
 * "biogaran"; one that starts none of its names, a qualifier or a word of a
 * description, "chrono", "cutanée") are never more than weak.
 */
export type MatchStrength = 'weak' | 'strong' | 'very-strong';

/** An item added as a possible match of a text typed as unrecognised. */
export interface PossibleMatch {
  /** The index of the unrecognised item, among the items given. */
  forItem: number;
  /** The text typed. */
  typed: string;
  strength: MatchStrength;
}

export interface WithPossibleMatches {
  /** The items given, in their order, then one item per possible match. */
  items: CheckedItem[];
  /** The possible match each added item stands for, by its index in `items`. */
  possible: Map<number, PossibleMatch>;
}

export interface PossibleOptions {
  /**
   * Whether she said this unrecognised item is none of the products and
   * remedies proposed ("Non, aucun de ces produits"): only a strong
   * resemblance is then kept.
   */
  declined?: (item: CheckedItem) => boolean;
}

/** A prefix shorter than this (letters, spaces aside) is a weak resemblance. */
const SHORT_PREFIX = 6;
const STRONG_SCORE = 0.8;
const VERY_STRONG_SCORE = 0.9;

/** How clearly the text names the candidate (see MatchStrength). */
export function strengthOf(candidate: Candidate): MatchStrength {
  if (candidate.match === 'fuzzy-word') return 'weak';
  // One word that names none of the products alone: a laboratory many have
  // ("biogaran"), a qualifier after the brand or a word of a description
  // ("chrono", "cutanée"). A brand after a substance ("acnetrait") is not one.
  if (candidate.weakWord !== undefined) return 'weak';
  if (candidate.match === 'prefix' && candidate.queryLength < SHORT_PREFIX) return 'weak';
  if (candidate.match === 'contained' || candidate.score >= VERY_STRONG_SCORE) {
    return 'very-strong';
  }
  // The whole name of 6 letters or more spelt within one edit ("cytotek"): it says which name.
  if (candidate.match === 'near') return 'strong';
  return candidate.score >= STRONG_SCORE ? 'strong' : 'weak';
}

/** What an item is for "never twice": a remedy, or the family of a product. */
function keyOf(pack: Pack, item: CheckedItem): string | undefined {
  const { ref } = item;
  if (ref.kind === 'unrecognised') return undefined;
  if (ref.kind === 'plant') return `plant:${ref.id}`;
  return `family:${productFamilyOf(pack, ref.id) ?? ref.id}`;
}

/**
 * Whether the text gives the strength of the product: the strength question
 * preselects it, or the product has no other and the text gives none that
 * differs ("ascofer 50" is not the 33 mg box).
 */
function strengthGiven(pack: Pack, candidate: Candidate, text: string): boolean {
  const choice = strengthChoiceOf(pack, candidate, text);
  if (choice !== null) return choice.preselected !== null;
  const typed = parseStrength(text).strengthMg;
  if (typed === undefined) return true;
  const strengths = (pack.products.find((p) => p.id === candidate.id)?.components ?? []).flatMap(
    (c) => (c.strengthMg === undefined ? [] : [c.strengthMg]),
  );
  return strengths.length === 0 || strengths.some((mg) => Math.abs(mg - typed) < 1e-6);
}

/**
 * The items, then, for each unrecognised one, the product or remedy its text
 * looks like (the first candidate of both lists, at the resolver's threshold),
 * unless the check already holds it or its family, and unless she declined
 * the products proposed and the resemblance is weak. A product whose strength
 * the text does not give is read with its strength unknown, as "Je ne sais
 * pas" on the confirm screen.
 */
export function withPossibleMatches(
  pack: Pack,
  items: readonly CheckedItem[],
  options: PossibleOptions = {},
): WithPossibleMatches {
  const all = items.map((item) => ({ ...item, ref: { ...item.ref } }));
  const possible = new Map<number, PossibleMatch>();
  const held = new Set(items.flatMap((item) => keyOf(pack, item) ?? []));
  const index = searchIndexOf(pack);
  items.forEach((item, forItem) => {
    if (item.ref.kind !== 'unrecognised') return;
    const text = item.ref.text;
    const [best] = search(index, text);
    if (best === undefined) return;
    const strength = strengthOf(best);
    if (strength === 'weak' && options.declined?.(item) === true) return;
    let added: CheckedItem = { ref: { kind: best.kind, id: best.id } };
    // A box whose dose the confirm screen asks by a range (generic aspirin) is
    // never read in one she did not give: its dose is not given, said so.
    if (
      best.kind === 'product' &&
      (!strengthGiven(pack, best, text) || productDoseRangeOf(pack, best.id) !== undefined)
    ) {
      added = { ...added, strengthUnknown: true };
    }
    const key = keyOf(pack, added);
    if (key === undefined || held.has(key)) return;
    held.add(key);
    possible.set(all.length, { forItem, typed: text, strength });
    all.push(added);
  });
  return { items: all, possible };
}

/**
 * The evaluation as the result shows it: a danger found through a possible
 * match that is not very strong is held at "before the next dose", so that a
 * resemblance short of a clear name never makes the result a danger; the
 * findings are sorted again by level and the level of the result follows. A
 * danger sign is never held down. The same evaluation when nothing changes.
 */
export function cappedEvaluation(
  evaluation: Evaluation,
  possible: ReadonlyMap<number, PossibleMatch>,
): Evaluation {
  const held = (index: number) => {
    const strength = possible.get(index)?.strength;
    return strength !== undefined && strength !== 'very-strong';
  };
  const holds = (finding: Evaluation['findings'][number]) =>
    finding.level === 'danger' && finding.sign === undefined && finding.items.some(held);
  if (!evaluation.findings.some(holds)) return evaluation;
  const findings = evaluation.findings.map((finding) =>
    holds(finding) ? { ...finding, level: 'before-next-dose' as const } : finding,
  );
  // Stable: the engine's order within a level is kept.
  const sorted = findings
    .map((finding, order) => ({ finding, order }))
    .sort((a, b) => levelRank(b.finding.level) - levelRank(a.finding.level) || a.order - b.order)
    .map(({ finding }) => finding);
  return { ...evaluation, findings: sorted, level: maxLevel(sorted.map((f) => f.level)) };
}
