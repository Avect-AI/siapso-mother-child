// SPDX-License-Identifier: MIT
// Whether a pack rule applies to an evaluation context, and to which items.
import { itemMatches, productOf, strengthOf, substanceMatches } from './match.js';
import type {
  BreastfeedingContext,
  CheckedItem,
  CheckId,
  EvaluationContext,
  Pack,
  Requirement,
  Rule,
  RuleKind,
  RuleWhen,
  Subject,
  TermPrecision,
  WindowId,
} from './types.js';
import { WINDOWS } from './windows.js';

/** The check reported for each rule kind. */
export const CHECK_OF_KIND: Readonly<Record<RuleKind, CheckId>> = Object.freeze({
  pregnancy: 'C1',
  breastfeeding: 'C2',
  interaction: 'C3',
  'herb-drug': 'C4',
  toxicity: 'C5',
  duplicate: 'C6',
  'max-dose': 'C7',
  condition: 'C8',
  'contraception-info': 'C9',
  reminder: 'C10',
});

/** Everything rule matching needs, computed once per evaluation. */
export interface RuleScope {
  pack: Pack;
  context: EvaluationContext;
  /**
   * Windows covered by the pregnancy range with its upper end moved
   * TERM_LOOKAHEAD_DAYS on: what a rule that gives a finding is looked up in.
   * Empty without a pregnancy.
   */
  covered: readonly WindowId[];
  /**
   * Windows covered by the pregnancy range as it is today: what a reminder or
   * a note is looked up in (they are about what has been done, not about a
   * treatment that goes on). Empty without a pregnancy.
   */
  coveredToday: readonly WindowId[];
  /** entryKey of each context item; undefined for an unrecognised item. */
  keys: readonly (string | undefined)[];
}

/** A rule that applies: the items involved and, for a range term, its precision. */
export interface RuleMatch {
  items: number[];
  term?: TermPrecision;
  /** For a finding reached only through the term look-ahead: where its first window starts. */
  windowStart?: number;
  /**
   * A max-dose rule exceeded only by the possible total (the highest strength
   * of the family of an item of unknown strength): the excess depends on the box.
   */
  possible?: true;
}

function matchingItems(scope: RuleScope, subject: Subject, strengthAboveMg?: number): number[] {
  const indexes: number[] = [];
  scope.context.items.forEach((item, index) => {
    if (itemMatches(scope.pack, item, subject, strengthAboveMg)) indexes.push(index);
  });
  return indexes;
}

function breastfeedingApplies(
  bound: NonNullable<RuleWhen['breastfeeding']>,
  breastfeeding: BreastfeedingContext | undefined,
): boolean {
  if (!breastfeeding) return false;
  const { babyAgeWeeks, premature } = breastfeeding;
  // An unknown age or prematurity keeps the rule: missing a risk is the worse error.
  const ageOk =
    bound.babyAgeWeeksMax === undefined ||
    babyAgeWeeks === undefined ||
    babyAgeWeeks <= bound.babyAgeWeeksMax;
  const prematureOk =
    bound.premature === undefined || premature === undefined || premature === bound.premature;
  return ageOk && prematureOk;
}

/**
 * The lowest and highest strengths in mg of a substance that an item of
 * unknown strength may have: those of the products of its family taken by the
 * same route (Product.family), the products without a strength left out. The
 * lowest leaves out the strengths below the substance's adult minimum
 * (`adultMinStrengthMg`: a family's children's powders), unless the family
 * has no other. Undefined when the strength is not said unknown, when the
 * product has no family, or when no product of it gives a strength.
 */
function strengthRange(
  pack: Pack,
  item: CheckedItem,
  substance: string,
): { min: number; max: number } | undefined {
  if (item.strengthUnknown !== true) return undefined;
  const own = productOf(pack, item);
  if (own?.family === undefined) return undefined;
  const strengths = pack.products.flatMap((product) =>
    product.family === own.family && product.route === own.route
      ? product.components.flatMap((c) =>
          c.substance === substance && c.strengthMg !== undefined ? [c.strengthMg] : [],
        )
      : [],
  );
  if (strengths.length === 0) return undefined;
  const adultMin = pack.substances.find((s) => s.id === substance)?.adultMinStrengthMg;
  const adult = strengths.filter((s) => adultMin === undefined || s >= adultMin);
  const certain = adult.length > 0 ? adult : strengths;
  return { min: Math.min(...certain), max: Math.max(...strengths) };
}

/** Whether a daily total reaches a max-dose rule: above maxMgPerDay, or at least fromMgPerDay. */
function reaches(when: RuleWhen, total: number): boolean {
  if (when.fromMgPerDay !== undefined) return total >= when.fromMgPerDay;
  return when.maxMgPerDay !== undefined && total > when.maxMgPerDay;
}

/**
 * Sums of strength x units per day over the items holding the subject: the
 * certain one (an item of unknown strength counted at the lowest strength of
 * its family, `strengthRange`) and the possible one (at the highest). An item
 * without a unit count or any strength adds nothing to either sum but does not
 * cancel them: the rule triggers as soon as the known part alone reaches the
 * threshold. 'certain' when the certain sum reaches it, 'possible' when only
 * the possible sum does, undefined otherwise.
 */
function doseExcess(
  rule: Rule,
  subjectItems: number[],
  scope: RuleScope,
): 'certain' | 'possible' | undefined {
  const { subject } = rule.when;
  if (subject === undefined) return undefined;
  let certain = 0;
  let possible = 0;
  for (const index of subjectItems) {
    const item = scope.context.items[index];
    const units = item?.unitsPerDay;
    if (item === undefined || units === undefined) continue;
    for (const component of productOf(scope.pack, item)?.components ?? []) {
      if (!substanceMatches(scope.pack, component.substance, subject)) continue;
      const strength = strengthOf(item, component);
      const range =
        strength === undefined
          ? strengthRange(scope.pack, item, component.substance)
          : { min: strength, max: strength };
      if (range === undefined) continue;
      certain += range.min * units;
      possible += range.max * units;
    }
  }
  if (reaches(rule.when, certain)) return 'certain';
  return reaches(rule.when, possible) ? 'possible' : undefined;
}

function subjectPresent(rule: Rule, subjectItems: number[]): boolean {
  if (rule.when.subject === undefined) return rule.kind === 'reminder';
  return rule.kind === 'duplicate' ? subjectItems.length >= 2 : subjectItems.length > 0;
}

/**
 * Any-of requirements. Returns the partner items of the satisfied `with`
 * requirements, or undefined when no requirement is satisfied. A `with`
 * partner must be another item and another product or plant than the subject
 * item, so an item never interacts with itself. A `condition` is a situation
 * of the profile, a `sign` a danger sign present now; neither adds an item.
 */
function requirementPartners(
  requires: Requirement[] | undefined,
  subjectItems: number[],
  scope: RuleScope,
): number[] | undefined {
  if (requires === undefined || requires.length === 0) return [];
  let satisfied = false;
  const partners: number[] = [];
  for (const requirement of requires) {
    if ('condition' in requirement) {
      if (scope.context.conditions.includes(requirement.condition)) satisfied = true;
      continue;
    }
    if ('sign' in requirement) {
      if (scope.context.signs.includes(requirement.sign)) satisfied = true;
      continue;
    }
    for (const candidate of matchingItems(scope, requirement.with)) {
      const paired =
        subjectItems.length === 0 ||
        subjectItems.some((s) => scope.keys[s] !== scope.keys[candidate]);
      if (paired) {
        satisfied = true;
        partners.push(candidate);
      }
    }
  }
  return satisfied ? partners : undefined;
}

/**
 * Population gating: a pregnancy rule applies only during a pregnancy (to
 * every window when it lists none), a breastfeeding rule only while
 * breastfeeding (at any baby age when it sets no bound).
 */
function populationApplies(kind: RuleKind, context: EvaluationContext): boolean {
  if (kind === 'pregnancy') return context.pregnancy !== undefined;
  if (kind === 'breastfeeding') return context.breastfeeding !== undefined;
  return true;
}

/** Whether a rule gives a finding (a level), rather than a reminder or a note. */
function givesFinding(kind: RuleKind): boolean {
  return kind !== 'reminder' && kind !== 'contraception-info';
}

/**
 * Where a rule's windows are reached only through the look-ahead: the start,
 * in weeks, of the first of its windows that the look-ahead covers, when none
 * of them is covered by the term as it is today. Undefined otherwise.
 */
function lookaheadStart(windows: readonly WindowId[], scope: RuleScope): number | undefined {
  if (windows.some((w) => scope.coveredToday.includes(w))) return undefined;
  const starts = WINDOWS.filter((w) => windows.includes(w.id) && scope.covered.includes(w.id)).map(
    (w) => w.from,
  );
  return starts.length === 0 ? undefined : Math.min(...starts);
}

/**
 * The conditions that do not depend on the subject: population, exceptions,
 * pregnancy windows and breastfeeding bound. Returns the term precision to
 * report (undefined for an exact term or no window) and, for a rule that gives
 * a finding reached only through the look-ahead, where its window starts; or
 * false when the rule cannot apply to the context.
 */
function gate(
  rule: Rule,
  scope: RuleScope,
): { term?: TermPrecision; windowStart?: number } | false {
  const { when } = rule;
  const { context } = scope;
  if (!populationApplies(rule.kind, context)) return false;
  if (when.unlessConditions?.some((c) => context.conditions.includes(c))) return false;
  if (when.unlessWith?.some((s) => matchingItems(scope, s).length > 0)) return false;

  const gated: { term?: TermPrecision; windowStart?: number } = {};
  if (when.pregnancyWindows !== undefined) {
    const pregnancy = context.pregnancy;
    const finding = givesFinding(rule.kind);
    const covered = finding ? scope.covered : scope.coveredToday;
    if (!pregnancy || !when.pregnancyWindows.some((w) => covered.includes(w))) return false;
    if (pregnancy.precision !== 'exact') gated.term = pregnancy.precision;
    const start = finding ? lookaheadStart(when.pregnancyWindows, scope) : undefined;
    if (start !== undefined) gated.windowStart = start;
  }
  if (when.breastfeeding && !breastfeedingApplies(when.breastfeeding, context.breastfeeding)) {
    return false;
  }
  return gated;
}

/** Applies one rule; undefined when it does not apply. */
export function applyRule(rule: Rule, scope: RuleScope): RuleMatch | undefined {
  const { when } = rule;
  const gated = gate(rule, scope);
  if (!gated) return undefined;

  const subjectItems = when.subject ? matchingItems(scope, when.subject, when.strengthAboveMg) : [];
  if (!subjectPresent(rule, subjectItems)) return undefined;
  const dose = rule.kind === 'max-dose' ? doseExcess(rule, subjectItems, scope) : 'certain';
  if (dose === undefined) return undefined;
  const partners = requirementPartners(when.requires, subjectItems, scope);
  if (!partners) return undefined;

  const match: RuleMatch = {
    items: [...new Set([...subjectItems, ...partners])].sort((a, b) => a - b),
  };
  if (gated.term) match.term = gated.term;
  if (gated.windowStart !== undefined) match.windowStart = gated.windowStart;
  if (dose === 'possible') match.possible = true;
  return match;
}

/**
 * The items for which a max-dose rule cannot compute the daily total: they
 * hold the subject and have a unit count, but a component of the subject has
 * no strength (in the pack, or because the user does not know it) and no
 * strength of its family either (`strengthRange`). Empty for another kind of
 * rule, or when the rule cannot apply to the context (its conditions and
 * requirements are checked as for C7).
 */
export function uncomputableDoseItems(rule: Rule, scope: RuleScope): number[] {
  const { subject, requires } = rule.when;
  if (rule.kind !== 'max-dose' || subject === undefined || !gate(rule, scope)) return [];
  const subjectItems = matchingItems(scope, subject);
  if (!requirementPartners(requires, subjectItems, scope)) return [];
  return subjectItems.filter((index) => {
    const item = scope.context.items[index];
    if (item?.unitsPerDay === undefined) return false;
    const components = productOf(scope.pack, item)?.components ?? [];
    return components.some(
      (c) =>
        substanceMatches(scope.pack, c.substance, subject) &&
        strengthOf(item, c) === undefined &&
        strengthRange(scope.pack, item, c.substance) === undefined,
    );
  });
}
