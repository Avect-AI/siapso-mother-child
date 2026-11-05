// SPDX-License-Identifier: MIT
import type {
  ConditionId,
  Evidence,
  Lang,
  Level,
  LocalName,
  Localized,
  Requirement,
  Reviewer,
  RuleKind,
  SourceRef,
  Subject,
  WindowId,
} from '@siapso/engine';

/** One thing wrong in the content: the file, the path inside the file, and what is wrong. */
export interface Problem {
  /** File path relative to the content root, with forward slashes. */
  file: string;
  /** Path inside the file, such as `when.subject.class` or `[2].names`; empty for the whole file. */
  path: string;
  message: string;
}

/** A parsed YAML file. */
export interface RawFile {
  file: string;
  data: unknown;
  /** The file text, when read from disk: lets the checks see comments. */
  text?: string;
}

export const SCHEMA_NAMES = [
  'rule',
  'message',
  'danger-sign',
  'pack-meta',
  'sources',
  'substance',
  'class',
  'product',
  'plant',
] as const;

export type SchemaName = (typeof SCHEMA_NAMES)[number];

/** Every YAML file of the content, parsed but not checked, plus the JSON Schemas. */
export interface RawContent {
  schemas: Record<SchemaName, object>;
  pack?: RawFile;
  /** knowledge/sources.yaml. */
  sources?: RawFile;
  /** Other content files to scan for forbidden sources (the YAML files below eval/). */
  extra: RawFile[];
  /** README.md, .md and .json files, whose data is their text: scanned, not parsed. */
  texts: RawFile[];
  /** knowledge/rules/*.yaml, sorted by file name. */
  rules: RawFile[];
  /** knowledge/messages/*.yaml, sorted by file name. */
  messages: RawFile[];
  dangerSigns?: RawFile;
  substances?: RawFile;
  classes?: RawFile;
  /** registry/products/*.yaml, sorted by file name. */
  products: RawFile[];
  /** registry/plants/*.yaml, sorted by file name. */
  plants: RawFile[];
  /** Problems found while reading: unreadable YAML, unexpected files, missing licence line. */
  problems: Problem[];
}

// The authoring format: the same shapes as the engine, with kebab-case keys.

export interface AuthoredMeta {
  version: string;
  date: string;
  'clinically-validated': boolean;
  /** The lowest pack version still safe to use: the app never rolls back below it. */
  'minimum-safe-version'?: string;
}

/** One allowed or fact-only source of knowledge/sources.yaml. */
export interface AuthoredSource {
  id: string;
  name: string;
  publisher: string;
  licence: string;
  url: string;
  version?: string;
  accessed?: string;
  /** The attribution line for NOTICE. */
  notice: string;
  /** The language its documents are written in. */
  documents: Lang;
  /** Its name, licence and version in French (the fields above are English). */
  fr: { name: string; licence: string; version?: string };
}

export interface AuthoredForbiddenSource {
  id: string;
  reason: string;
  domains: string[];
}

export interface AuthoredSources {
  allowed: AuthoredSource[];
  'fact-only': AuthoredSource[];
  forbidden: AuthoredForbiddenSource[];
}

export interface AuthoredRule {
  id: string;
  kind: RuleKind;
  when: {
    subject?: Subject;
    requires?: Requirement[];
    'unless-conditions'?: ConditionId[];
    'unless-with'?: Subject[];
    'pregnancy-windows'?: WindowId[];
    breastfeeding?: { 'baby-age-weeks-max'?: number; premature?: boolean };
    'max-mg-per-day'?: number;
    'strength-above-mg'?: number;
  };
  level: Level;
  evidence: Evidence;
  'danger-rationale'?: string;
  message: string;
  sources: SourceRef[];
  review: { status: 'draft' | 'validated'; reviewers: Reviewer[]; 'reviewed-on'?: string };
}

export interface AuthoredText {
  fact: string;
  risk: string;
  'risk-detail'?: string;
  orientation?: string;
}

export interface AuthoredMessage {
  id: string;
  fr: AuthoredText;
  en: AuthoredText;
}

export interface AuthoredDangerSign {
  id: string;
  group: 'pregnancy' | 'postpartum' | 'baby';
  label: Localized;
  message?: string;
  sources: SourceRef[];
}

export interface AuthoredSubstance {
  id: string;
  names: Localized;
  classes: string[];
}

export interface AuthoredClass {
  id: string;
  names: Localized;
  excludes: string[];
}

export interface AuthoredProduct {
  id: string;
  names: Localized;
  brands: string[];
  'local-names': LocalName[];
  components: { substance: string; 'strength-mg'?: number }[];
  form: string;
  route: string;
  source: { bdpm: string } | { 'demo-manual': true };
  demo: boolean;
}

export interface AuthoredPlant {
  id: string;
  'latin-name': string;
  names: Localized;
  'local-names': LocalName[];
  parts: string[];
  evidence: Evidence;
  message: string;
  sources: SourceRef[];
}

/** A schema-valid entry of a file, with where it sits in that file. */
export interface Entry<T> {
  file: string;
  /** Empty for a one-entry file, `[3]` for the fourth entry of a list file. */
  at: string;
  data: T;
}

/** The schema-valid part of the content, typed. */
export interface Content {
  meta?: Entry<AuthoredMeta>;
  sources?: Entry<AuthoredSources>;
  rules: Entry<AuthoredRule>[];
  messages: Entry<AuthoredMessage>[];
  dangerSigns: Entry<AuthoredDangerSign>[];
  substances: Entry<AuthoredSubstance>[];
  classes: Entry<AuthoredClass>[];
  products: Entry<AuthoredProduct>[];
  plants: Entry<AuthoredPlant>[];
}
