// SPDX-License-Identifier: MIT
export { evaluate } from './evaluate.js';
export { capForEvidence, LEVELS, levelRank, maxLevel } from './levels.js';
export type { Level } from './levels.js';
export { itemMatches, substancesOf } from './match.js';
export { CONDITION_IDS, PackError, parsePack, RULE_KINDS, RULE_WHEN_KEYS } from './pack.js';
export { rangeFromMonths, UNKNOWN_TERM, weeksFromLmp } from './pregnancy.js';
export { BUILTIN_MESSAGES } from './types.js';
export type {
  BreastfeedingContext,
  CheckedItem,
  CheckId,
  Component,
  ConditionId,
  DangerSign,
  Evaluation,
  EvaluationContext,
  Evidence,
  Finding,
  ItemRef,
  Lang,
  LocalName,
  Localized,
  Message,
  Note,
  Pack,
  Plant,
  PregnancyContext,
  Product,
  Requirement,
  Reviewer,
  Rule,
  RuleKind,
  RuleWhen,
  Source,
  SourceRef,
  Subject,
  Substance,
  SubstanceClass,
  TermPrecision,
  WindowId,
} from './types.js';
export { WINDOWS, windowsCovered } from './windows.js';
export { findForbiddenWording } from './wording.js';
