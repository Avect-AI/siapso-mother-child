// SPDX-License-Identifier: MIT
import type { Level } from './levels.js';

export type { Level };

export const EVIDENCE_GRADES = ['A', 'B', 'C', 'D', 'E', '0'] as const;
export type Evidence = (typeof EVIDENCE_GRADES)[number];
export type WindowId = 'lt12' | '12-19' | '20-29' | '30-plus';
export type TermPrecision = 'exact' | 'estimated' | 'unknown';
export type ConditionId =
  | 'hiv-cotrimoxazole'
  | 'tuberculosis-treatment'
  | 'epilepsy-treatment'
  | 'uterine-scar'
  | 'renal-failure'
  | 'hepatic-failure'
  | 'sickle-cell';
export type RuleKind =
  | 'pregnancy'
  | 'breastfeeding'
  | 'interaction'
  | 'herb-drug'
  | 'toxicity'
  | 'duplicate'
  | 'max-dose'
  | 'condition'
  | 'contraception-info'
  | 'reminder';
export const CHECK_IDS = [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
  'C12',
  'no-finding',
] as const;
export type CheckId = (typeof CHECK_IDS)[number];
export type Lang = 'fr' | 'en';

export interface Localized {
  fr: string;
  en: string;
}
export interface LocalName {
  text: string;
  lang: 'fr' | 'wo' | 'en';
  checked: boolean;
}
export interface SourceRef {
  source: string;
  locator: string;
  url?: string;
  accessed: string;
  quote?: string;
}
export interface Substance {
  id: string;
  names: Localized;
  classes: string[];
}
export interface SubstanceClass {
  id: string;
  names: Localized;
  excludes: string[];
}
export interface Component {
  substance: string;
  strengthMg?: number;
}
export interface Product {
  id: string;
  names: Localized;
  brands: string[];
  localNames: LocalName[];
  components: Component[];
  form: string;
  route: string;
  demo: boolean;
}
export interface Plant {
  id: string;
  latinName: string;
  names: Localized;
  localNames: LocalName[];
  evidence: Evidence;
  message: string;
  sources: SourceRef[];
}
export type Subject = { substance: string } | { class: string } | { plant: string };
export type Requirement = { with: Subject } | { condition: ConditionId };
export interface RuleWhen {
  /** Required for every kind except 'reminder'. */
  subject?: Subject;
  /** Any-of; absent means no requirement. */
  requires?: Requirement[];
  /** The rule does not apply when one of these conditions is present. */
  unlessConditions?: ConditionId[];
  /**
   * The rule does not apply when any item matches one of these subjects (for
   * example a co-trimoxazole item, even without the matching condition).
   */
  unlessWith?: Subject[];
  /** The rule applies only to a pregnancy intersecting these windows. */
  pregnancyWindows?: WindowId[];
  /** The rule applies only when breastfeeding. */
  breastfeeding?: { babyAgeWeeksMax?: number; premature?: boolean };
  /** 'max-dose' only. */
  maxMgPerDay?: number;
  /**
   * Substance subject only: the subject item matches only if its component for
   * that substance is stronger than this many mg. An unknown strength matches.
   */
  strengthAboveMg?: number;
}
export interface Reviewer {
  name: string;
  role: string;
}
export interface Rule {
  id: string;
  kind: RuleKind;
  when: RuleWhen;
  level: Level;
  evidence: Evidence;
  dangerRationale?: string;
  message: string;
  sources: SourceRef[];
  review: { status: 'draft' | 'validated'; reviewers: Reviewer[]; reviewedOn?: string };
}
export interface DangerSign {
  id: string;
  group: 'pregnancy' | 'postpartum' | 'baby';
  label: Localized;
  /** Message id of its C11 finding; the standard danger-sign message when absent. */
  message?: string;
  sources: SourceRef[];
}
export interface Source {
  id: string;
  name: string;
  licence: string;
  url: string;
  version?: string;
}
export interface Message {
  fact: string;
  risk: string;
  riskDetail?: string;
  orientation?: string;
}
export interface Pack {
  schema: 1;
  version: string;
  date: string;
  clinicallyValidated: boolean;
  substances: Substance[];
  classes: SubstanceClass[];
  products: Product[];
  plants: Plant[];
  rules: Rule[];
  dangerSigns: DangerSign[];
  sources: Source[];
  messages: Record<Lang, Record<string, Message>>;
}
export interface PregnancyContext {
  weeksMin: number;
  weeksMax: number;
  precision: TermPrecision;
}
export interface BreastfeedingContext {
  babyAgeWeeks?: number;
  premature?: boolean;
}
export type ItemRef =
  { kind: 'product' | 'plant'; id: string } | { kind: 'unrecognised'; text: string };
export interface CheckedItem {
  ref: ItemRef;
  unitsPerDay?: number;
  longTerm?: boolean;
  /**
   * The product is confirmed but the strength on its box is not known: its
   * component strengths are read as unknown (a strengthAboveMg rule applies,
   * the max-dose sum skips the item, the max-dose-not-computable note can apply).
   */
  strengthUnknown?: boolean;
}
export interface EvaluationContext {
  pregnancy?: PregnancyContext;
  breastfeeding?: BreastfeedingContext;
  conditions: ConditionId[];
  items: CheckedItem[];
  signs: string[];
}
export interface Finding {
  level: Level;
  check: CheckId;
  ruleId?: string;
  evidence?: Evidence;
  items: number[];
  message: string;
  sign?: string;
  term?: TermPrecision;
  capped: boolean;
  sources: SourceRef[];
}
/** A preventive reminder (C10), shown in accompanied mode only. */
export interface Reminder {
  ruleId: string;
  message: string;
  sources: SourceRef[];
}
/**
 * Which notes an app shows in which mode: `contraception` (C9) in accompanied
 * mode only, `dose` (max-dose-not-computable) in both modes.
 */
export type NoteKind = 'contraception' | 'dose';
export interface Note extends Reminder {
  kind: NoteKind;
}
export interface Evaluation {
  level: Level;
  findings: Finding[];
  reminders: Reminder[];
  notes: Note[];
  pack: { version: string; date: string; clinicallyValidated: boolean };
}

export const BUILTIN_MESSAGES = {
  /** A known product that no rule of the pack reads: nothing found in the base. */
  nothingFound: 'nothing-found',
  /** A known product that a rule reads, when no rule applies to the situation: no alert here. */
  nothingApplies: 'nothing-applies',
  notRecognised: 'not-recognised',
  dangerSign: 'danger-sign',
  /** Note of a max-dose rule when a unit count is given for an item of unknown strength. */
  maxDoseNotComputable: 'max-dose-not-computable',
} as const;
