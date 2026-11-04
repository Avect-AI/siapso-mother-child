// SPDX-License-Identifier: MIT
// Whether a pack rule applies to an evaluation context, and to which items.
import { itemMatches, productOf, substanceMatches } from './match.js';
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
  /** Windows covered by the pregnancy range; empty without a pregnancy. */
  covered: readonly WindowId[];
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
 * strength adds nothing to the sum but does not cancel it: the rule triggers
 * as soon as the known part alone is greater than the threshold.
 */
function exceedsMaxDose(rule: Rule, subjectItems: number[], scope: RuleScope): boolean {
  const { subject, maxMgPerDay } = rule.when;
  if (subject === undefined || maxMgPerDay === undefined) return false;
  let known = 0;
  for (const index of subjectItems) {
    const item = scope.context.items[index];
    const units = item?.unitsPerDay;
    const components = item ? (productOf(scope.pack, item)?.components ?? []) : [];
    for (const component of components) {
      if (!substanceMatches(scope.pack, component.substance, subject)) continue;
      if (units !== undefined && component.strengthMg !== undefined) {
        known += component.strengthMg * units;
      }
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

/** Applies one rule; undefined when it does not apply. */
export function applyRule(rule: Rule, scope: RuleScope): RuleMatch | undefined {
  const { when } = rule;
  const { context } = scope;
  if (!populationApplies(rule.kind, context)) return undefined;
  if (when.unlessConditions?.some((c) => context.conditions.includes(c))) return undefined;

  let term: TermPrecision | undefined;
  if (when.pregnancyWindows !== undefined) {
    const pregnancy = context.pregnancy;
    if (!pregnancy || !when.pregnancyWindows.some((w) => scope.covered.includes(w))) {
      return undefined;
    }
    if (pregnancy.precision !== 'exact') term = pregnancy.precision;
  }
  if (when.breastfeeding && !breastfeedingApplies(when.breastfeeding, context.breastfeeding)) {
    return undefined;
  }

  const subjectItems = when.subject ? matchingItems(scope, when.subject, when.strengthAboveMg) : [];
  if (!subjectPresent(rule, subjectItems, scope)) return undefined;
  const partners = requirementPartners(when.requires, subjectItems, scope);
  if (!partners) return undefined;

  const items = [...new Set([...subjectItems, ...partners])].sort((a, b) => a - b);
  return term ? { items, term } : { items };
}
