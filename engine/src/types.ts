// SPDX-License-Identifier: MIT
import type { Level } from './levels.js';

export type { Level };

export type Evidence = 'A' | 'B' | 'C' | 'D' | 'E' | '0';
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
export type CheckId =
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C4'
  | 'C5'
  | 'C6'
  | 'C7'
  | 'C8'
  | 'C9'
  | 'C10'
  | 'C11'
  | 'C12'
  | 'no-finding';
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
  /** The rule applies only to a pregnancy intersecting these windows. */
  pregnancyWindows?: WindowId[];
  /** The rule applies only when breastfeeding. */
  breastfeeding?: { babyAgeWeeksMax?: number; premature?: boolean };
  /** 'max-dose' only. */
  maxMgPerDay?: number;
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
export interface Note {
  ruleId: string;
  message: string;
  sources: SourceRef[];
}
export interface Evaluation {
  level: Level;
  findings: Finding[];
  reminders: Note[];
  notes: Note[];
  pack: { version: string; date: string; clinicallyValidated: boolean };
}

export const BUILTIN_MESSAGES = {
  nothingFound: 'nothing-found',
  notRecognised: 'not-recognised',
  dangerSign: 'danger-sign',
} as const;
