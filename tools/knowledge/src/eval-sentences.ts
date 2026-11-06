// SPDX-License-Identifier: MIT
// The products found inside a sentence (SCRUM-61), measured on
// eval/speech/sentences.yaml: `pnpm eval:sentences`. See eval/speech/README.md.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, entriesFromPack, productsInSentence } from '@siapso/resolver';
import type { EntryKind, ResolverIndex, SentenceProduct } from '@siapso/resolver';
import { parse } from 'yaml';
import { buildPack } from './build.js';
import { loadContent } from './load.js';
import { percentile95 } from './eval-resolver.js';

export const SENTENCE_LANGS = ['fr', 'wo', 'mix'] as const;
export type SentenceLang = (typeof SENTENCE_LANGS)[number];

/** `plain`: names said as written; `misspelt`: at least one name spelt as heard; `none`: no product. */
export const SENTENCE_TYPES = ['plain', 'misspelt', 'none'] as const;
export type SentenceType = (typeof SENTENCE_TYPES)[number];

export interface Expected {
  kind: EntryKind;
  id: string;
}

/** One product the sentence names: one entry, or several equally right; `mg` when a strength is said. */
export type ExpectedProduct = (Expected | { any: Expected[] }) & { mg?: number };

export interface EvalSentence {
  text: string;
  lang: SentenceLang;
  type: SentenceType;
  expect: ExpectedProduct[];
}

export interface SentenceBaseline {
  /** Minimum precision, overall and in each language. */
  precision: number;
  /** Minimum recall, overall and in each language. */
  recall: number;
  /** Maximum number of products found (ticked) in the background transcripts. */
  backgroundFalseProducts: number;
  /** Maximum number of names offered to check ("Vérifiez", read from words joined) in the background. */
  backgroundCheckOffers: number;
}

export interface SentenceTally {
  sentences: number;
  /** Products the sentences name. */
  expected: number;
  /** Products found (ticked) that the sentence names. */
  right: number;
  /** Products found (ticked) that the sentence does not name. */
  false: number;
  /** Products the sentence names that were not found (ticked). */
  missed: number;
  /** Products offered unticked. */
  unticked: number;
  /** Names offered to check, read from words the voice split, that the sentence names. */
  checksRight: number;
  /** Names offered to check that the sentence does not name. */
  checksWrong: number;
}

export interface SentenceMiss {
  text: string;
  lang: SentenceLang;
  found: string[];
  missed: string[];
}

export interface SentenceReport {
  perLang: Record<SentenceLang, SentenceTally>;
  perType: Record<SentenceType, SentenceTally>;
  overall: SentenceTally;
  misses: SentenceMiss[];
  /** Strengths said with a name found: how many, and how many were read right. */
  strengths: { said: number; read: number };
}

/** The entries that are equally right for one product. */
export function alternativesOf(product: ExpectedProduct): Expected[] {
  return 'any' in product ? product.any : [{ kind: product.kind, id: product.id }];
}

function isExpected(value: unknown): value is Expected {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, id } = value as Partial<Expected>;
  return (kind === 'product' || kind === 'plant') && typeof id === 'string' && id !== '';
}

function isProduct(value: unknown): value is ExpectedProduct {
  if (typeof value !== 'object' || value === null) return false;
  const { mg } = value as { mg?: unknown };
  if (mg !== undefined && (typeof mg !== 'number' || !(mg > 0))) return false;
  if ('any' in value) {
    const { any } = value;
    return Array.isArray(any) && any.length > 0 && any.every(isExpected);
  }
  return isExpected(value);
}

/** Parses the sentences file; throws a readable error when an item is malformed. */
export function parseSentences(text: string): EvalSentence[] {
  const data: unknown = parse(text);
  if (!Array.isArray(data)) throw new Error('The sentences file must be a list');
  // An empty set would measure nothing (0 / 0) and pass every bar.
  if (data.length === 0) throw new Error('The sentences file holds no sentence');
  return data.map((raw, position) => {
    const item = raw as Partial<EvalSentence> | null;
    const where = `sentence #${String(position + 1)}`;
    if (typeof item?.text !== 'string' || item.text.trim() === '') {
      throw new Error(`${where}: "text" must be a non-empty string`);
    }
    if (!SENTENCE_LANGS.includes(item.lang as SentenceLang)) {
      throw new Error(
        `${where} (${item.text}): "lang" must be one of ${SENTENCE_LANGS.join(', ')}`,
      );
    }
    if (!SENTENCE_TYPES.includes(item.type as SentenceType)) {
      throw new Error(
        `${where} (${item.text}): "type" must be one of ${SENTENCE_TYPES.join(', ')}`,
      );
    }
    if (!Array.isArray(item.expect) || !item.expect.every(isProduct)) {
      throw new Error(
        `${where} (${item.text}): "expect" must be a list of { kind, id }, { any: [...] }, with an optional mg`,
      );
    }
    if ((item.type === 'none') !== (item.expect.length === 0)) {
      throw new Error(
        `${where} (${item.text}): a sentence of "type: none", and only one, expects []`,
      );
    }
    return item as EvalSentence;
  });
}

const BASELINE_FILE = 'sentences-baseline.json';

function ratioIn(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${BASELINE_FILE}: "${key}" must be a number from 0 to 1`);
  }
  return value;
}

/** Parses sentences-baseline.json: every bar must be a number in its range. */
export function parseSentenceBaseline(text: string): SentenceBaseline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${BASELINE_FILE} is not valid JSON`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${BASELINE_FILE} must be an object`);
  }
  const record = data as Record<string, unknown>;
  return {
    precision: ratioIn(record, 'precision'),
    recall: ratioIn(record, 'recall'),
    backgroundFalseProducts: countIn(record, 'backgroundFalseProducts'),
    backgroundCheckOffers: countIn(record, 'backgroundCheckOffers'),
  };
}

function countIn(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${BASELINE_FILE}: "${key}" must be a whole number, 0 or more`);
  }
  return value;
}

function emptyTally(): SentenceTally {
  return {
    sentences: 0,
    expected: 0,
    right: 0,
    false: 0,
    missed: 0,
    unticked: 0,
    checksRight: 0,
    checksWrong: 0,
  };
}

/** The products read in a sentence, as the voice heard it (names read from split words included). */
const read = (index: ResolverIndex, text: string): SentenceProduct[] =>
  productsInSentence(index, text, { heard: true });

const precisionOf = (tally: SentenceTally): number =>
  tally.right + tally.false === 0 ? 1 : tally.right / (tally.right + tally.false);
const recallOf = (tally: SentenceTally): number =>
  tally.expected === 0 ? 1 : tally.right / tally.expected;

/** The family of an expected entry: the product family of the pack, or the plant. */
function familyOf(families: ReadonlyMap<string, string>, expected: Expected): string {
  return families.get(expected.id) ?? expected.id;
}

/**
 * Reads every sentence and tallies the products found (ticked), by family:
 * right when the sentence names it, false otherwise; a product named and not
 * found is missed. `families` maps each entry id to its family.
 */
export function evaluateSentences(
  index: ResolverIndex,
  families: ReadonlyMap<string, string>,
  sentences: readonly EvalSentence[],
): SentenceReport {
  const perLang = Object.fromEntries(SENTENCE_LANGS.map((lang) => [lang, emptyTally()])) as Record<
    SentenceLang,
    SentenceTally
  >;
  const perType = Object.fromEntries(SENTENCE_TYPES.map((type) => [type, emptyTally()])) as Record<
    SentenceType,
    SentenceTally
  >;
  const overall = emptyTally();
  const misses: SentenceMiss[] = [];
  const strengths = { said: 0, read: 0 };
  for (const item of sentences) {
    const found = read(index, item.text);
    const ticked = found.filter((product) => product.checked);
    const checks = found.filter((product) => product.heardAs !== undefined);
    const left = [...ticked];
    let right = 0;
    let checksRight = 0;
    const missed: string[] = [];
    for (const product of item.expect) {
      const wanted = new Set(alternativesOf(product).map((entry) => familyOf(families, entry)));
      const at = left.findIndex((candidate) => wanted.has(candidate.candidate.family));
      const hit = at >= 0 ? left.splice(at, 1)[0] : undefined;
      if (hit === undefined) {
        missed.push(alternativesOf(product)[0]?.id ?? '');
        if (checks.some((check) => wanted.has(check.candidate.family))) checksRight += 1;
        continue;
      }
      right += 1;
      if (product.mg !== undefined) {
        strengths.said += 1;
        if (hit.strengthMg === product.mg) strengths.read += 1;
      }
    }
    for (const tally of [perLang[item.lang], perType[item.type], overall]) {
      tally.sentences += 1;
      tally.expected += item.expect.length;
      tally.right += right;
      tally.false += left.length;
      tally.missed += missed.length;
      tally.unticked += found.length - ticked.length;
      tally.checksRight += checksRight;
      tally.checksWrong += checks.length - checksRight;
    }
    if (left.length > 0 || missed.length > 0) {
      misses.push({ text: item.text, lang: item.lang, found: describe(ticked), missed });
    }
  }
  return { perLang, perType, overall, misses, strengths };
}

function describe(products: readonly SentenceProduct[]): string[] {
  return products.map(
    (product) =>
      `${product.candidate.id} (${product.text}${product.readAs === undefined ? '' : `, read as ${product.readAs}`})`,
  );
}

/**
 * The transcripts of the speech evaluation (eval/speech/results/*.json, the
 * model's text for general sentences of FLEURS, no product names): every
 * product found there, ticked, is a false product.
 */
export async function backgroundTranscripts(root: string): Promise<string[]> {
  const folder = path.join(root, 'eval', 'speech', 'results');
  let files: string[];
  try {
    files = (await readdir(folder)).filter((file) => file.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const texts: string[] = [];
  for (const file of files) {
    const data: unknown = JSON.parse(await readFile(path.join(folder, file), 'utf8'));
    collectHypotheses(data, texts);
  }
  return texts;
}

function collectHypotheses(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectHypotheses(item, into);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'hypothesis' && typeof inner === 'string') into.push(inner);
    else collectHypotheses(inner, into);
  }
}

/** The bars that a measure does not meet; a measure that is not a number fails. */
export function failures(
  measured: { precision: number; recall: number; background: number; checks: number },
  baseline: SentenceBaseline,
  label = '',
): string[] {
  const found: string[] = [];
  const prefix = label === '' ? '' : `${label}: `;
  for (const key of ['precision', 'recall'] as const) {
    const value = measured[key];
    if (!Number.isFinite(value)) found.push(`${prefix}${key} is not a number (${String(value)})`);
    else if (value < baseline[key]) {
      found.push(
        `${prefix}${key} ${value.toFixed(3)} is below the baseline ${String(baseline[key])}`,
      );
    }
  }
  if (measured.background > baseline.backgroundFalseProducts) {
    found.push(
      `${prefix}${String(measured.background)} false products in the background transcripts, above ${String(baseline.backgroundFalseProducts)}`,
    );
  }
  if (measured.checks > baseline.backgroundCheckOffers) {
    found.push(
      `${prefix}${String(measured.checks)} names offered to check in the background transcripts, above ${String(baseline.backgroundCheckOffers)}`,
    );
  }
  return found;
}

function row(label: string, tally: SentenceTally): string {
  const cells = [tally.sentences, tally.expected, tally.right, tally.false, tally.missed].map(
    (value) => String(value).padStart(6),
  );
  const checks = `${String(tally.checksRight)}/${String(tally.checksWrong)}`;
  return `${label.padEnd(9)}${cells.join('')} ${precisionOf(tally).toFixed(3).padStart(9)} ${recallOf(tally).toFixed(3).padStart(8)} ${String(tally.unticked).padStart(9)} ${checks.padStart(7)}`;
}

/**
 * Runs the evaluation on the repository at root (schemas read from `schemas`,
 * the root by default); returns the exit code: 0 when every bar is met, 1
 * otherwise, and 1 for an unreadable or empty sentence file or baseline.
 */
export async function main(
  root: string,
  out: (line: string) => void = console.log,
  schemas: string = root,
): Promise<number> {
  try {
    return await run(root, out, schemas);
  } catch (error) {
    out(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function run(root: string, out: (line: string) => void, schemas: string): Promise<number> {
  const pack = buildPack(await loadContent(root, schemas));
  const entries = entriesFromPack(pack);
  const index = buildIndex(entries);
  const families = new Map(entries.map((entry) => [entry.id, entry.family]));
  const folder = path.join(root, 'eval', 'speech');
  const sentences = parseSentences(await readFile(path.join(folder, 'sentences.yaml'), 'utf8'));
  const baseline = parseSentenceBaseline(await readFile(path.join(folder, BASELINE_FILE), 'utf8'));

  const report = evaluateSentences(index, families, sentences);
  const background = await backgroundTranscripts(root);
  let backgroundFalse = 0;
  let backgroundUnticked = 0;
  let backgroundChecks = 0;
  const times: number[] = [];
  for (const text of [...sentences.map((item) => item.text), ...background]) {
    const start = performance.now();
    read(index, text);
    times.push(performance.now() - start);
  }
  for (const text of background) {
    const found = read(index, text);
    const ticked = found.filter((product) => product.checked);
    const checks = found.filter((product) => product.heardAs !== undefined);
    backgroundFalse += ticked.length;
    backgroundUnticked += found.length - ticked.length;
    backgroundChecks += checks.length;
    if (ticked.length + checks.length > 0) {
      out(`background: "${text}" -> ${describe([...ticked, ...checks]).join(', ')}`);
    }
  }

  const header = ['sentences', 'named', 'right', 'false', 'missed'];
  out(
    `${'lang'.padEnd(9)}${header.map((cell) => cell.slice(0, 6).padStart(6)).join('')} ${'precision'.padStart(9)} ${'recall'.padStart(8)} ${'unticked'.padStart(9)} ${'checks'.padStart(7)}`,
  );
  out('(checks: names read from words the voice split, offered unticked: right/wrong)');
  for (const lang of SENTENCE_LANGS) out(row(lang, report.perLang[lang]));
  out(row('overall', report.overall));
  for (const type of SENTENCE_TYPES) out(row(type, report.perType[type]));
  out(
    `strengths said with a name found: ${String(report.strengths.said)}, read right: ${String(report.strengths.read)}`,
  );
  for (const miss of report.misses) {
    out(
      `miss: [${miss.lang}] "${miss.text}" -> found ${miss.found.join(', ') || '(nothing)'}; missed ${miss.missed.join(', ') || '(nothing)'}`,
    );
  }
  out(
    `background: ${String(background.length)} transcripts of eval/speech/results, ${String(backgroundFalse)} false products, ${String(backgroundUnticked)} offered unticked, of which ${String(backgroundChecks)} names offered to check`,
  );
  out(`p95 time of one sentence: ${percentile95(times).toFixed(3)} ms`);
  out(
    `baseline: precision >= ${String(baseline.precision)} and recall >= ${String(baseline.recall)} overall and per language, background false products <= ${String(baseline.backgroundFalseProducts)}, background names to check <= ${String(baseline.backgroundCheckOffers)}`,
  );

  const failed = [
    ...failures(
      {
        precision: precisionOf(report.overall),
        recall: recallOf(report.overall),
        background: backgroundFalse,
        checks: backgroundChecks,
      },
      baseline,
    ),
    ...SENTENCE_LANGS.filter((lang) => report.perLang[lang].sentences > 0).flatMap((lang) =>
      failures(
        {
          precision: precisionOf(report.perLang[lang]),
          recall: recallOf(report.perLang[lang]),
          background: 0,
          checks: 0,
        },
        baseline,
        lang,
      ),
    ),
  ];
  for (const failure of failed) out(`FAIL: ${failure}`);
  return failed.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  main(root).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
