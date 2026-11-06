// SPDX-License-Identifier: MIT
// Reference cases: files of eval/cases that say what the engine must output
// for a situation, loaded, checked against eval/schema/case.schema.json and
// converted to an engine EvaluationContext.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONDITION_IDS, rangeFromMonths, UNKNOWN_TERM } from '@siapso/engine';
import type {
  CheckedItem,
  CheckId,
  ConditionId,
  Evaluation,
  Evidence,
  EvaluationContext,
  Level,
  TermPrecision,
} from '@siapso/engine';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseDocument } from 'yaml';
import { LICENCE_LINE } from './load.js';
import type { Problem } from './types.js';

export const CASE_SCHEMA_FILE = 'eval/schema/case.schema.json';
export const CASES_FOLDER = 'eval/cases';

/** The engine output the case compares: no sources, no capped flag. */
export interface ExpectedFinding {
  check: CheckId;
  /** The rule id, for a finding produced by a rule. */
  rule?: string;
  /** The message id, for every finding: the rule's message, or a built-in one. */
  message: string;
  level: Level;
  evidence?: Evidence;
  items: number[];
  sign?: string;
  term?: TermPrecision;
  /** For a finding reached only through the term look-ahead: where its window starts. */
  'window-start'?: number;
}

export interface ExpectedOutput {
  level: Level;
  findings: ExpectedFinding[];
  /** Rule ids of the reminders. */
  reminders: string[];
  /** Rule ids of the notes. */
  notes: string[];
}

export interface CaseItem {
  product?: string;
  plant?: string;
  unrecognised?: string;
  'units-per-day'?: number;
  'long-term'?: boolean;
  /** The product is confirmed but the strength on its box is not known. */
  'strength-unknown'?: boolean;
  /** The dose answered by a range: the box holds at most this many mg ("100 mg ou moins"). */
  'strength-at-most-mg'?: number;
}

export interface ReferenceCase {
  id: string;
  title: string;
  context: {
    pregnancy?: { weeks?: number; months?: number; unknown?: true };
    breastfeeding?: { 'baby-age-weeks'?: number; premature?: boolean };
    conditions?: string[];
    items: CaseItem[];
    signs?: string[];
  };
  expect: ExpectedOutput;
}

function pathOf(pointer: string): string {
  let result = '';
  for (const raw of pointer.split('/').slice(1)) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    result += /^\d+$/.test(segment) ? `[${segment}]` : `${result === '' ? '' : '.'}${segment}`;
  }
  return result;
}

/** Keeps the deepest errors: the ones of oneOf branches that do not apply are noise. */
function schemaProblems(
  validate: ReturnType<Ajv2020['compile']>,
  data: unknown,
  file: string,
): Problem[] {
  if (validate(data)) return [];
  const errors = validate.errors ?? [];
  const specific = errors.filter((e) => e.keyword !== 'oneOf');
  return (specific.length > 0 ? specific : errors).map((error) => {
    const params = error.params as Record<string, unknown>;
    const base = pathOf(error.instancePath);
    switch (error.keyword) {
      case 'additionalProperties': {
        const key = String(params.additionalProperty);
        return {
          file,
          path: base === '' ? key : `${base}.${key}`,
          message: `unknown key "${key}"`,
        };
      }
      case 'required': {
        const key = String(params.missingProperty);
        return {
          file,
          path: base === '' ? key : `${base}.${key}`,
          message: `missing required key "${key}"`,
        };
      }
      default:
        return { file, path: base, message: error.message ?? 'is not valid' };
    }
  });
}

/**
 * Reads every `.yaml` file of `eval/cases` under `root`, in name order, and
 * checks it: licence line, schema, id equal to the file name, known
 * conditions. README.md is the only other file allowed. A missing folder holds
 * no case.
 */
export async function loadCases(
  root: string,
): Promise<{ cases: ReferenceCase[]; problems: Problem[] }> {
  const schema = JSON.parse(await readFile(path.join(root, CASE_SCHEMA_FILE), 'utf8')) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  let names: string[];
  try {
    names = (await readdir(path.join(root, CASES_FOLDER))).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { cases: [], problems: [] };
    throw error;
  }

  const cases: ReferenceCase[] = [];
  const problems: Problem[] = [];
  for (const name of names) {
    const file = `${CASES_FOLDER}/${name}`;
    if (name === 'README.md') continue;
    if (!name.endsWith('.yaml')) {
      problems.push({ file, path: '', message: 'unexpected file: cases must be .yaml files' });
      continue;
    }
    const text = await readFile(path.join(root, file), 'utf8');
    if (text.split(/\r?\n/, 1)[0] !== LICENCE_LINE) {
      problems.push({ file, path: '', message: `the first line must be "${LICENCE_LINE}"` });
    }
    const document = parseDocument(text, { uniqueKeys: true });
    const [yamlError] = document.errors;
    if (yamlError) {
      problems.push({ file, path: '', message: `YAML error: ${yamlError.message}` });
      continue;
    }
    const data = document.toJS() as unknown;
    const found = schemaProblems(validate, data, file);
    problems.push(...found);
    if (found.length > 0) continue;
    const loaded = data as ReferenceCase;
    const before = problems.length;
    if (loaded.id !== name.slice(0, -'.yaml'.length)) {
      problems.push({ file, path: 'id', message: 'must equal the file name without .yaml' });
    }
    (loaded.context.conditions ?? []).forEach((condition, index) => {
      if (!CONDITION_IDS.includes(condition)) {
        problems.push({
          file,
          path: `context.conditions[${String(index)}]`,
          message: `unknown condition "${condition}"`,
        });
      }
    });
    if (problems.length === before) cases.push(loaded);
  }
  return { cases, problems };
}

function itemOf(item: CaseItem): CheckedItem {
  const checked: CheckedItem = {
    ref:
      item.product !== undefined
        ? { kind: 'product', id: item.product }
        : item.plant !== undefined
          ? { kind: 'plant', id: item.plant }
          : { kind: 'unrecognised', text: item.unrecognised ?? '' },
  };
  if (item['units-per-day'] !== undefined) checked.unitsPerDay = item['units-per-day'];
  if (item['long-term'] !== undefined) checked.longTerm = item['long-term'];
  if (item['strength-unknown'] !== undefined) checked.strengthUnknown = item['strength-unknown'];
  if (item['strength-at-most-mg'] !== undefined) {
    checked.strengthAtMostMg = item['strength-at-most-mg'];
  }
  return checked;
}

/**
 * The engine input of a case. Weeks give an exact range, months an estimated
 * range and an unknown term the whole pregnancy with precision unknown.
 */
export function contextOf(reference: ReferenceCase): EvaluationContext {
  const { pregnancy, breastfeeding } = reference.context;
  const context: EvaluationContext = {
    conditions: (reference.context.conditions ?? []) as ConditionId[],
    items: reference.context.items.map(itemOf),
    signs: reference.context.signs ?? [],
  };
  if (pregnancy?.weeks !== undefined) {
    context.pregnancy = {
      weeksMin: pregnancy.weeks,
      weeksMax: pregnancy.weeks,
      precision: 'exact',
    };
  } else if (pregnancy?.months !== undefined) {
    context.pregnancy = { ...rangeFromMonths(pregnancy.months), precision: 'estimated' };
  } else if (pregnancy?.unknown) {
    context.pregnancy = { ...UNKNOWN_TERM, precision: 'unknown' };
  }
  if (breastfeeding) {
    context.breastfeeding = {};
    if (breastfeeding['baby-age-weeks'] !== undefined) {
      context.breastfeeding.babyAgeWeeks = breastfeeding['baby-age-weeks'];
    }
    if (breastfeeding.premature !== undefined)
      context.breastfeeding.premature = breastfeeding.premature;
  }
  return context;
}

/** The part of an engine output that a case compares, in the shape of `expect`. */
export function projectOf(evaluation: Evaluation): ExpectedOutput {
  return {
    level: evaluation.level,
    findings: evaluation.findings.map((f) => {
      // The message id is compared for rule findings too: a rule pointing to
      // another message changes what the woman reads.
      const out: ExpectedFinding = {
        check: f.check,
        message: f.message,
        level: f.level,
        items: f.items,
      };
      if (f.ruleId !== undefined) out.rule = f.ruleId;
      if (f.evidence !== undefined) out.evidence = f.evidence;
      if (f.sign !== undefined) out.sign = f.sign;
      if (f.term !== undefined) out.term = f.term;
      if (f.windowStart !== undefined) out['window-start'] = f.windowStart;
      return out;
    }),
    reminders: evaluation.reminders.map((n) => n.ruleId),
    notes: evaluation.notes.map((n) => n.ruleId),
  };
}
