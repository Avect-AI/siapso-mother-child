// SPDX-License-Identifier: MIT
// Whether a pack rule applies to an evaluation context, and to which items.
import { itemMatches, productOf, strengthOf, substanceMatches } from './match.js';
import type {
  BreastfeedingContext,
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
 * Known sum of strength x units per day over the items holding the subject,
 * compared with the rule threshold. An item without a unit count or a
 * strength (or whose strength the user does not know) adds nothing to the sum
 * but does not cancel it: the rule triggers as soon as the known part alone is
 * greater than the threshold.
 */
function exceedsMaxDose(rule: Rule, subjectItems: number[], scope: RuleScope): boolean {
  const { subject, maxMgPerDay } = rule.when;
  if (subject === undefined || maxMgPerDay === undefined) return false;
  let known = 0;
  for (const index of subjectItems) {
    const item = scope.context.items[index];
    if (item === undefined) continue;
    const units = item.unitsPerDay;
    for (const component of productOf(scope.pack, item)?.components ?? []) {
      if (!substanceMatches(scope.pack, component.substance, subject)) continue;
      const strength = strengthOf(item, component);
      if (units !== undefined && strength !== undefined) known += strength * units;
    }
  }
  return known > maxMgPerDay;
}

function subjectPresent(rule: Rule, subjectItems: number[], scope: RuleScope): boolean {
  if (rule.when.subject === undefined) return rule.kind === 'reminder';
  switch (rule.kind) {
    case 'duplicate':
      return subjectItems.length >= 2;
    case 'max-dose':
      return subjectItems.length > 0 && exceedsMaxDose(rule, subjectItems, scope);
    default:
      return subjectItems.length > 0;
  }
}

/**
 * Any-of requirements. Returns the partner items of the satisfied `with`
 * requirements, or undefined when no requirement is satisfied. A `with`
 * partner must be another item and another product or plant than the subject
 * item, so an item never interacts with itself.
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
 * The conditions that do not depend on the subject: population, exceptions,
 * pregnancy windows and breastfeeding bound. Returns the term precision to
 * report (undefined for an exact term or no window), or false when the rule
 * cannot apply to the context.
 */
function gate(rule: Rule, scope: RuleScope): { term?: TermPrecision } | false {
  const { when } = rule;
  const { context } = scope;
  if (!populationApplies(rule.kind, context)) return false;
  if (when.unlessConditions?.some((c) => context.conditions.includes(c))) return false;
  if (when.unlessWith?.some((s) => matchingItems(scope, s).length > 0)) return false;

  let term: TermPrecision | undefined;
  if (when.pregnancyWindows !== undefined) {
    const pregnancy = context.pregnancy;
    const covered = givesFinding(rule.kind) ? scope.covered : scope.coveredToday;
    if (!pregnancy || !when.pregnancyWindows.some((w) => covered.includes(w))) return false;
    if (pregnancy.precision !== 'exact') term = pregnancy.precision;
  }
  if (when.breastfeeding && !breastfeedingApplies(when.breastfeeding, context.breastfeeding)) {
    return false;
  }
  return term ? { term } : {};
}

/** Applies one rule; undefined when it does not apply. */
export function applyRule(rule: Rule, scope: RuleScope): RuleMatch | undefined {
  const { when } = rule;
  const gated = gate(rule, scope);
  if (!gated) return undefined;

  const subjectItems = when.subject ? matchingItems(scope, when.subject, when.strengthAboveMg) : [];
  if (!subjectPresent(rule, subjectItems, scope)) return undefined;
  const partners = requirementPartners(when.requires, subjectItems, scope);
  if (!partners) return undefined;

  const items = [...new Set([...subjectItems, ...partners])].sort((a, b) => a - b);
  return gated.term ? { items, term: gated.term } : { items };
}

/**
 * The items for which a max-dose rule cannot compute the daily total: they
 * hold the subject and have a unit count, but a component of the subject has
 * no strength (in the pack, or because the user does not know it). Empty for
 * another kind of rule, or when the rule cannot apply to the context (its
 * conditions and requirements are checked as for C7).
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
        strengthOf(item, c) === undefined && substanceMatches(scope.pack, c.substance, subject),
    );
  });
}
