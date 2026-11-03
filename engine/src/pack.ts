// SPDX-License-Identifier: MIT
// Structural validation of a runtime pack. Anything evaluate reads is checked,
// so that a corrupted or outdated pack fails loudly instead of yielding a
// level outside the four levels, bypassing the evidence cap, or silently
// never applying a rule.
import { LEVELS } from './levels.js';
import { CHECK_OF_KIND } from './rules.js';
import { BUILTIN_MESSAGES } from './types.js';
import type { ConditionId, Evidence, Lang, Level, Pack, RuleKind, Subject } from './types.js';
import { WINDOWS } from './windows.js';

export class PackError extends Error {
  override name = 'PackError';
}

type Json = Record<string, unknown>;

// Records keyed by the union types, so the compiler keeps these lists complete.
const CONDITIONS: Record<ConditionId, true> = {
  'hiv-cotrimoxazole': true,
  'tuberculosis-treatment': true,
  'epilepsy-treatment': true,
  'uterine-scar': true,
  'renal-failure': true,
  'hepatic-failure': true,
  'sickle-cell': true,
};
const EVIDENCE: Record<Evidence, true> = { A: true, B: true, C: true, D: true, E: true, '0': true };
const LANGS: Record<Lang, true> = { fr: true, en: true };

const CONDITION_IDS = Object.keys(CONDITIONS);
const EVIDENCE_LEVELS = Object.keys(EVIDENCE);
const LANG_IDS = Object.keys(LANGS) as Lang[];
const RULE_KINDS = Object.keys(CHECK_OF_KIND) as RuleKind[];
const WINDOW_IDS = WINDOWS.map((w) => w.id);

function fail(where: string, problem: string): never {
  throw new PackError(`${where}: ${problem}`);
}

function object(value: unknown, where: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'must be an object');
  }
  return value as Json;
}

function array(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) fail(where, 'must be an array');
  return value;
}

function string(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, 'must be a string');
  return value;
}

function id(value: unknown, where: string): string {
  if (typeof value !== 'string' || value === '') fail(where, 'must be a non-empty string');
  return value;
}

function boolean(value: unknown, where: string): void {
  if (typeof value !== 'boolean') fail(where, 'must be a boolean');
}

function number(value: unknown, where: string, min: number, minIncluded: boolean): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    (!minIncluded && value === min)
  ) {
    fail(where, `must be a number ${minIncluded ? 'of at least' : 'greater than'} ${String(min)}`);
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (!(allowed as readonly unknown[]).includes(value)) {
    fail(where, `must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function optional(value: unknown, check: (value: unknown) => void): void {
  if (value !== undefined) check(value);
}

function list(value: unknown, where: string, check: (item: unknown, where: string) => void): void {
  array(value, where).forEach((item, index) => {
    check(item, `${where}[${String(index)}]`);
  });
}

function strings(value: unknown, where: string): string[] {
  return array(value, where).map((item, index) => string(item, `${where}[${String(index)}]`));
}

function localized(value: unknown, where: string): void {
  const o = object(value, where);
  string(o.fr, `${where}.fr`);
  string(o.en, `${where}.en`);
}

function localNames(value: unknown, where: string): void {
  list(value, where, (item, at) => {
    const o = object(item, at);
    string(o.text, `${at}.text`);
    oneOf(o.lang, ['fr', 'wo', 'en'], `${at}.lang`);
    boolean(o.checked, `${at}.checked`);
  });
}

function sourceRefs(value: unknown, where: string): void {
  list(value, where, (item, at) => {
    const o = object(item, at);
    id(o.source, `${at}.source`);
    string(o.locator, `${at}.locator`);
    optional(o.url, (v) => string(v, `${at}.url`));
    string(o.accessed, `${at}.accessed`);
    optional(o.quote, (v) => string(v, `${at}.quote`));
  });
}

/** Refuses a key outside `allowed`: a misspelled condition would silently be ignored. */
function onlyKeys(o: Json, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) fail(where, `unknown key "${key}"`);
  }
}

const SUBJECT_KEYS = ['substance', 'class', 'plant'];
const REQUIREMENT_KEYS = ['with', 'condition'];
const WHEN_KEYS = [
  'subject',
  'requires',
  'unlessConditions',
  'pregnancyWindows',
  'breastfeeding',
  'maxMgPerDay',
];
const BREASTFEEDING_KEYS = ['babyAgeWeeksMax', 'premature'];

function subject(value: unknown, where: string): Subject {
  const o = object(value, where);
  onlyKeys(o, SUBJECT_KEYS, where);
  const keys = SUBJECT_KEYS.filter((key) => Object.hasOwn(o, key));
  const key = keys[0];
  if (keys.length !== 1 || key === undefined) {
    fail(where, 'must have exactly one of substance, class or plant');
  }
  id(o[key], `${where}.${key}`);
  return o as Subject;
}

/**
 * The danger level is reserved for rules with a written danger rationale: it
 * is required (not blank) on a danger rule and refused on any other rule.
 */
function dangerRationale(value: unknown, level: Level, where: string): void {
  if (level === 'danger') {
    if (typeof value !== 'string' || value.trim() === '') {
      fail(where, 'is required, not blank, for a danger rule');
    }
  } else if (value !== undefined) {
    fail(where, `is only allowed for a danger rule, not for level ${level}`);
  }
}

/** Validates `when` and returns every subject it references. */
function ruleWhen(value: unknown, kind: RuleKind, where: string): Subject[] {
  const o = object(value, where);
  onlyKeys(o, WHEN_KEYS, where);
  const subjects: Subject[] = [];
  if (o.subject !== undefined) subjects.push(subject(o.subject, `${where}.subject`));
  else if (kind !== 'reminder') fail(`${where}.subject`, `is required for a ${kind} rule`);
  optional(o.requires, (v) => {
    if (array(v, `${where}.requires`).length === 0) {
      fail(`${where}.requires`, 'must not be empty (omit it for no requirement)');
    }
    list(v, `${where}.requires`, (item, at) => {
      const r = object(item, at);
      onlyKeys(r, REQUIREMENT_KEYS, at);
      if (Object.hasOwn(r, 'with') === Object.hasOwn(r, 'condition')) {
        fail(at, 'must have exactly one of with or condition');
      }
      if (Object.hasOwn(r, 'with')) subjects.push(subject(r.with, `${at}.with`));
      else oneOf(r.condition, CONDITION_IDS, `${at}.condition`);
    });
  });
  optional(o.unlessConditions, (v) => {
    list(v, `${where}.unlessConditions`, (item, at) => oneOf(item, CONDITION_IDS, at));
  });
  optional(o.pregnancyWindows, (v) => {
    if (array(v, `${where}.pregnancyWindows`).length === 0) {
      fail(`${where}.pregnancyWindows`, 'must not be empty (the rule would never apply)');
    }
    list(v, `${where}.pregnancyWindows`, (item, at) => oneOf(item, WINDOW_IDS, at));
  });
  optional(o.breastfeeding, (v) => {
    const b = object(v, `${where}.breastfeeding`);
    onlyKeys(b, BREASTFEEDING_KEYS, `${where}.breastfeeding`);
    optional(b.babyAgeWeeksMax, (n) => {
      number(n, `${where}.breastfeeding.babyAgeWeeksMax`, 0, true);
    });
    optional(b.premature, (p) => {
      boolean(p, `${where}.breastfeeding.premature`);
    });
  });
  if (o.maxMgPerDay !== undefined || kind === 'max-dose') {
    number(o.maxMgPerDay, `${where}.maxMgPerDay`, 0, false);
  }
  if (kind === 'interaction' || kind === 'herb-drug') partners(o, kind, where);
  return subjects;
}

/**
 * An interaction or herb-drug rule needs a `with` partner, otherwise it would
 * apply to the subject alone. A herb-drug rule is a plant plus a medicine: a
 * plant subject and substance or class partners.
 */
function partners(when: Json, kind: RuleKind, where: string): void {
  const requires = (when.requires ?? []) as Json[];
  if (!requires.some((r) => Object.hasOwn(r, 'with'))) {
    fail(`${where}.requires`, `must have a with partner for a ${kind} rule`);
  }
  if (kind !== 'herb-drug') return;
  if (!Object.hasOwn(when.subject as Json, 'plant')) {
    fail(`${where}.subject`, 'must be a plant for a herb-drug rule');
  }
  requires.forEach((r, index) => {
    if (Object.hasOwn(r, 'with') && Object.hasOwn(r.with as Json, 'plant')) {
      fail(
        `${where}.requires[${String(index)}].with`,
        'must be a substance or a class for a herb-drug rule',
      );
    }
  });
}

interface Collected {
  ids: Set<string>;
  entries: { where: string; o: Json }[];
}

/** Validates a collection: an array of objects with unique ids, each checked by `check`. */
function collection(pack: Json, name: string, check: (o: Json, where: string) => void): Collected {
  const ids = new Set<string>();
  const entries: { where: string; o: Json }[] = [];
  array(pack[name], `pack.${name}`).forEach((item, index) => {
    const position = `${name}[${String(index)}]`;
    const o = object(item, position);
    const entryId = id(o.id, `${position}.id`);
    const where = `${name} "${entryId}"`;
    if (ids.has(entryId)) fail(where, 'duplicate id');
    ids.add(entryId);
    check(o, where);
    entries.push({ where, o });
  });
  return { ids, entries };
}

function messages(value: unknown): Record<Lang, Json> {
  const o = object(value, 'pack.messages');
  const result: Partial<Record<Lang, Json>> = {};
  for (const lang of LANG_IDS) {
    const byId = object(o[lang], `messages.${lang}`);
    for (const [messageId, message] of Object.entries(byId)) {
      const where = `messages.${lang} "${messageId}"`;
      const m = object(message, where);
      string(m.fact, `${where}.fact`);
      string(m.risk, `${where}.risk`);
      optional(m.riskDetail, (v) => string(v, `${where}.riskDetail`));
      optional(m.orientation, (v) => string(v, `${where}.orientation`));
    }
    result[lang] = byId;
  }
  return result as Record<Lang, Json>;
}

/**
 * Checks that a JSON value is a valid runtime pack and returns it typed (the
 * same object, never modified). Throws a PackError naming the faulty
 * collection and id.
 */
export function parsePack(json: unknown): Pack {
  const pack = object(json, 'pack');
  if (pack.schema !== 1) {
    fail('pack.schema', `unsupported schema ${String(pack.schema)}, expected 1`);
  }
  id(pack.version, 'pack.version');
  id(pack.date, 'pack.date');
  boolean(pack.clinicallyValidated, 'pack.clinicallyValidated');

  const substances = collection(pack, 'substances', (o, where) => {
    localized(o.names, `${where}.names`);
    strings(o.classes, `${where}.classes`);
  });
  const classes = collection(pack, 'classes', (o, where) => {
    localized(o.names, `${where}.names`);
    strings(o.excludes, `${where}.excludes`);
  });
  const products = collection(pack, 'products', (o, where) => {
    localized(o.names, `${where}.names`);
    strings(o.brands, `${where}.brands`);
    localNames(o.localNames, `${where}.localNames`);
    list(o.components, `${where}.components`, (item, at) => {
      const c = object(item, at);
      id(c.substance, `${at}.substance`);
      optional(c.strengthMg, (v) => {
        number(v, `${at}.strengthMg`, 0, false);
      });
    });
    string(o.form, `${where}.form`);
    string(o.route, `${where}.route`);
    boolean(o.demo, `${where}.demo`);
  });
  const plants = collection(pack, 'plants', (o, where) => {
    string(o.latinName, `${where}.latinName`);
    localized(o.names, `${where}.names`);
    localNames(o.localNames, `${where}.localNames`);
    oneOf(o.evidence, EVIDENCE_LEVELS, `${where}.evidence`);
    id(o.message, `${where}.message`);
    sourceRefs(o.sources, `${where}.sources`);
  });
  const ruleSubjects: { where: string; subject: Subject }[] = [];
  const rules = collection(pack, 'rules', (o, where) => {
    const kind = oneOf(o.kind, RULE_KINDS, `${where}.kind`);
    for (const s of ruleWhen(o.when, kind, `${where}.when`)) {
      ruleSubjects.push({ where, subject: s });
    }
    const level = oneOf(o.level, LEVELS, `${where}.level`);
    oneOf(o.evidence, EVIDENCE_LEVELS, `${where}.evidence`);
    optional(o.dangerRationale, (v) => string(v, `${where}.dangerRationale`));
    dangerRationale(o.dangerRationale, level, `${where}.dangerRationale`);
    id(o.message, `${where}.message`);
    sourceRefs(o.sources, `${where}.sources`);
    const review = object(o.review, `${where}.review`);
    oneOf(review.status, ['draft', 'validated'], `${where}.review.status`);
    list(review.reviewers, `${where}.review.reviewers`, (item, at) => {
      const r = object(item, at);
      string(r.name, `${at}.name`);
      string(r.role, `${at}.role`);
    });
    optional(review.reviewedOn, (v) => string(v, `${where}.review.reviewedOn`));
  });
  collection(pack, 'dangerSigns', (o, where) => {
    oneOf(o.group, ['pregnancy', 'postpartum', 'baby'], `${where}.group`);
    localized(o.label, `${where}.label`);
    sourceRefs(o.sources, `${where}.sources`);
  });
  collection(pack, 'sources', (o, where) => {
    string(o.name, `${where}.name`);
    string(o.licence, `${where}.licence`);
    string(o.url, `${where}.url`);
    optional(o.version, (v) => string(v, `${where}.version`));
  });
  const byLang = messages(pack.messages);

  // References between collections.
  const known = (ids: Set<string>, kind: string, where: string, ref: string): void => {
    if (!ids.has(ref)) fail(where, `unknown ${kind} "${ref}"`);
  };
  for (const { where, o } of substances.entries) {
    for (const c of o.classes as string[]) known(classes.ids, 'class', where, c);
  }
  for (const { where, o } of classes.entries) {
    for (const s of o.excludes as string[]) known(substances.ids, 'substance', where, s);
  }
  for (const { where, o } of products.entries) {
    for (const c of o.components as { substance: string }[]) {
      known(substances.ids, 'substance', where, c.substance);
    }
  }
  for (const { where, subject: s } of ruleSubjects) {
    if ('substance' in s) known(substances.ids, 'substance', where, s.substance);
    else if ('class' in s) known(classes.ids, 'class', where, s.class);
    else known(plants.ids, 'plant', where, s.plant);
  }

  // Every message the engine can output exists in both languages.
  const needed = [
    ...rules.entries.map(({ where, o }) => ({ where, message: o.message as string })),
    ...plants.entries.map(({ where, o }) => ({ where, message: o.message as string })),
  ];
  for (const lang of LANG_IDS) {
    for (const { where, message } of needed) {
      if (!Object.hasOwn(byLang[lang], message)) {
        fail(where, `message "${message}" is missing in messages.${lang}`);
      }
    }
    for (const builtin of Object.values(BUILTIN_MESSAGES)) {
      if (!Object.hasOwn(byLang[lang], builtin)) {
        fail(`messages.${lang}`, `builtin message "${builtin}" is missing`);
      }
    }
  }

  return json as Pack;
}
