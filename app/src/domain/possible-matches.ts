// SPDX-License-Identifier: MIT
// The safety net of the result. A name added as unrecognised ("Je ne trouve
// pas ce produit") stays unrecognised, but it is looked up again in both
// lists, medicines and remedies: when it clearly names a product or a remedy
// of the base (see strengthOf), that product or remedy is evaluated too, as a
// possible match, so that a name kept as free text is not evaluated lower
// than what the base knows for what it clearly names. A weak resemblance
// (a few letters in common, the start of a first name) is not kept after she
// said it was none of the products proposed, and only a very strong one may
// raise the result to a danger. Every name typed gets its own resemblance,
// even when what it looks like is already in the list (live test round 2):
// its cards are then those of that item, so the engine never reads one
// product twice. Pure: the result screen hands in the pack and the items of
// the context. The resolver only proposes; the engine sets the level of the
// possible match, which cappedEvaluation may only lower.
import {
  evaluate,
  levelRank,
  maxLevel,
  type CheckedItem,
  type Evaluation,
  type EvaluationContext,
  type Finding,
  type Pack,
} from '@siapso/engine';
import { parseStrength, queryMentions, search, type Candidate } from '@siapso/resolver';
import { productFamilyOf, searchIndexOf, strengthChoiceOf } from './search-index.js';

/**
 * How clearly a name names its possible match: `very-strong` (the whole name,
 * a whole word of it, its name inside a longer text, or a score of 0.9 or
 * more), `strong` (a score of 0.8 or more, or the whole name of 6 letters or
 * more spelt within one edit: "misopristol"), `weak` otherwise. A prefix of
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
  /**
   * The index of the item that already stands for this product family or
   * remedy (an item given, or the possible match of another name typed): the
   * engine does not read this one, its cards are those of that item
   * (evaluateWithPossibleMatches).
   */
  sameAs?: number;
  /** With `sameAs`: that item is one of the items given, already in the list. */
  listed?: true;
}

export interface WithPossibleMatches {
  /**
   * The items given, in their order, then one item per possible match: first
   * those the engine reads, then those that stand for an item already there
   * (`sameAs`), a copy of that item.
   */
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
  // The whole name of 6 letters or more spelt within one edit ("misopristol"): it says which name.
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

/** A copy of an item, so the items given are never changed. */
function copyOf(item: CheckedItem): CheckedItem {
  return { ...item, ref: { ...item.ref } };
}

/** The substances of a product item; none for a remedy or a text. */
function substancesOf(pack: Pack, item: CheckedItem): string[] {
  const { ref } = item;
  if (ref.kind !== 'product') return [];
  return (pack.products.find((p) => p.id === ref.id)?.components ?? []).map((c) => c.substance);
}

/**
 * The items, then, for each unrecognised one, the product or remedy its text
 * looks like (the first candidate of both lists, at the resolver's
 * threshold), unless she declined the products proposed and the resemblance
 * is weak; then, for each brand or substance the text names whose substances
 * that one lacks ("advil cytotec": ADVIL and Cytotec), the product it names.
 * A product whose strength the text does not give is read with its strength
 * unknown, as "Je ne sais pas" on the confirm screen. When the check already
 * holds the product family or the remedy the text looks like (an item given,
 * or the possible match of another name typed), the text still gets its own
 * possible match: a copy of that item, marked `sameAs`, put after the others.
 */
export function withPossibleMatches(
  pack: Pack,
  items: readonly CheckedItem[],
  options: PossibleOptions = {},
): WithPossibleMatches {
  const all = items.map(copyOf);
  const possible = new Map<number, PossibleMatch>();
  // The item that stands for each product family or remedy: the items given first.
  const standsFor = new Map<string, number>();
  items.forEach((item, at) => {
    const key = keyOf(pack, item);
    if (key !== undefined && !standsFor.has(key)) standsFor.set(key, at);
  });
  const same: { item: CheckedItem; match: PossibleMatch }[] = [];
  const index = searchIndexOf(pack);
  items.forEach((item, forItem) => {
    if (item.ref.kind !== 'unrecognised') return;
    const text = item.ref.text;
    const [best] = search(index, text);
    if (best === undefined) return;
    const strength = strengthOf(best);
    if (strength === 'weak' && options.declined?.(item) === true) return;
    const covered = new Set<string>();
    /** Adds a candidate; `named` for a brand or substance named in the text, after the first. */
    const add = (candidate: Candidate, found: MatchStrength, named: boolean) => {
      let added: CheckedItem = { ref: { kind: candidate.kind, id: candidate.id } };
      if (candidate.kind === 'product' && !strengthGiven(pack, candidate, text)) {
        added = { ...added, strengthUnknown: true };
      }
      for (const id of substancesOf(pack, added)) covered.add(id);
      const key = keyOf(pack, added);
      if (key === undefined) return;
      const there = standsFor.get(key);
      if (there === undefined) {
        standsFor.set(key, all.length);
        possible.set(all.length, { forItem, typed: text, strength: found });
        all.push(added);
      } else if (!named) {
        const listed = there < items.length ? { listed: true as const } : {};
        const match = { forItem, typed: text, strength: found, sameAs: there, ...listed };
        same.push({ item: all[there] ?? added, match });
      }
    };
    add(best, strength, false);
    for (const mention of queryMentions(index, text)) {
      if (mention.substances.every((id) => covered.has(id))) continue;
      const [own] = search(index, mention.name);
      if (own !== undefined) add(own, strengthOf(own), true);
    }
  });
  // After every item the engine reads, so their indexes stay the same without them.
  for (const { item, match } of same) {
    possible.set(all.length, match);
    all.push(copyOf(item));
  }
  return { items: all, possible };
}

/** Sorted by level, highest first, the order kept within a level. */
function byLevel(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, order) => ({ finding, order }))
    .sort((a, b) => levelRank(b.finding.level) - levelRank(a.finding.level) || a.order - b.order)
    .map(({ finding }) => finding);
}

/**
 * The evaluation of a context's items with their possible matches, as the
 * result shows it: the engine reads the items and the possible matches of
 * their own; a possible match that stands for an item already there
 * (`sameAs`) is not read twice: it gets a copy of each card of that item (a
 * danger sign aside), its index in place of that item's, at the same level,
 * then cappedEvaluation holds what a resemblance short of a clear name may
 * not make a danger.
 */
export function evaluateWithPossibleMatches(
  pack: Pack,
  context: EvaluationContext,
  net: WithPossibleMatches,
): Evaluation {
  const read = net.items.filter((_, at) => net.possible.get(at)?.sameAs === undefined);
  const evaluation = evaluate(pack, { ...context, items: read });
  const copies: Finding[] = [];
  for (const [at, { sameAs }] of net.possible) {
    if (sameAs === undefined) continue;
    for (const finding of evaluation.findings) {
      if (finding.sign !== undefined || !finding.items.includes(sameAs)) continue;
      copies.push({
        ...finding,
        items: finding.items.map((item) => (item === sameAs ? at : item)),
      });
    }
  }
  if (copies.length === 0) return cappedEvaluation(evaluation, net.possible);
  const findings = byLevel([...evaluation.findings, ...copies]);
  return cappedEvaluation(
    { ...evaluation, findings, level: maxLevel(findings.map((f) => f.level)) },
    net.possible,
  );
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
  // Stable: the engine's order within a level is kept.
  const sorted = byLevel(
    evaluation.findings.map((finding) =>
      holds(finding) ? { ...finding, level: 'before-next-dose' as const } : finding,
    ),
  );
  return { ...evaluation, findings: sorted, level: maxLevel(sorted.map((f) => f.level)) };
}
