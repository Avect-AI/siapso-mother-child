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
  /**
   * The lowest strength in mg of an adult form: with the box of unknown
   * strength, the certain amount of a daily maximum leaves out the family's
   * strengths below it (children's powders and suspensions), unless the family
   * has no other.
   */
  adultMinStrengthMg?: number;
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
  /**
   * The family of the product (the resolver's: its brand, or the substances of
   * a generic), the products the confirm screen offers as its strengths. With
   * the strength on the box unknown, a daily maximum reads the strengths of the
   * family taken by the same route. Absent: the product is its own family, and
   * an unknown strength stays unknown.
   */
  family?: string;
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
/**
 * Another item (`with`), a situation of the profile (`condition`), or a danger
 * sign present now (`sign`, a danger sign id of the pack).
 */
export type Requirement = { with: Subject } | { condition: ConditionId } | { sign: string };
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
  /** 'max-dose' only: the rule applies when the daily total is above this many mg. */
  maxMgPerDay?: number;
  /**
   * 'max-dose' only, instead of maxMgPerDay: the rule applies when the daily
   * total is this many mg or more (a toxic amount, for example).
   */
  fromMgPerDay?: number;
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
  /**
   * Max-dose only: the message of a finding reached only with the highest
   * strength of a family (the excess depends on the box), instead of the
   * builtin max-dose-may-exceed. A possible toxic amount says its own risk.
   */
  possibleMessage?: string;
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
/** The words of a source in another language than its own entry: name, licence, version. */
export interface SourceWords {
  name: string;
  licence: string;
  version?: string;
}
export interface Source {
  id: string;
  name: string;
  licence: string;
  url: string;
  version?: string;
  /** The language its documents are written in, so a screen can say so beside a citation. */
  documents?: Lang;
  /** Its name, licence and version in French, for the French interface. */
  fr?: SourceWords;
}
export interface Message {
  fact: string;
  risk: string;
  riskDetail?: string;
  orientation?: string;
  /**
   * The orientation said to the person helping, about the woman ("elle"), in
   * accompanied mode; `orientation` otherwise. Only with an orientation.
   */
  orientationAccompanied?: string;
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
   * component strengths are read as unknown (a strengthAboveMg rule applies).
   * A daily maximum counts the lowest strength of its family taken by the same
   * route as certain and the highest as possible (Product.family); without
   * such strengths, the max-dose-not-computable note can apply.
   */
  strengthUnknown?: boolean;
  /**
   * The strength on the box is at most this many mg, as the user answered
   * a dose question by a range ("100 mg ou moins" for a box the pack has
   * no strength for, such as generic aspirin). A component of unknown
   * strength (none in the pack, or strengthUnknown) is then read as at most
   * this value: a strengthAboveMg rule at or above it does not apply, one
   * below it still does. A strength the pack knows is read as it is, and a
   * daily maximum still reads the strength as not known.
   */
  strengthAtMostMg?: number;
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
  /**
   * Set when the finding is reached only through the term look-ahead: the
   * week of amenorrhoea at which the first window it reaches starts.
   */
  windowStart?: number;
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
  /**
   * Finding of a max-dose rule exceeded only with the highest strength the
   * family of an item of unknown strength has: the excess depends on the box.
   */
  maxDoseMayExceed: 'max-dose-may-exceed',
} as const;
