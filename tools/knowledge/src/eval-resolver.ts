// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, entriesFromPack, search } from '@siapso/resolver';
import type { EntryKind, ResolverIndex } from '@siapso/resolver';
import { parse } from 'yaml';
import { buildPack } from './build.js';
import { loadContent } from './load.js';

export const QUERY_TYPES = [
  'brand',
  'inn',
  'misspelling',
  'local-fr',
  'local-wo',
  'voice-like',
  'noise',
] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

export interface Expected {
  kind: EntryKind;
  id: string;
}

/** The expectation of a noise query (a form or a colour alone): no candidate at all. */
export const NO_CANDIDATE = 'none';

export interface EvalQuery {
  query: string;
  /**
   * One acceptable answer, a list when several products of a brand are
   * equally right, or "none" for a noise query, which must get no candidate.
   */
  expect: Expected | Expected[] | typeof NO_CANDIDATE;
  type: QueryType;
}

export interface Baseline {
  top3: number;
  p95Ms: number;
}

export interface Tally {
  count: number;
  top1: number;
  top3: number;
}

export interface Report {
  perType: Record<QueryType, Tally>;
  overall: Tally;
  misses: { query: string; type: QueryType; got: string[] }[];
}

/** Repetitions of the whole query set when measuring latency. */
export const REPETITIONS = 20;

/** The acceptable answers; none for a noise query. */
export function expectedList(item: EvalQuery): Expected[] {
  if (item.expect === NO_CANDIDATE) return [];
  return Array.isArray(item.expect) ? item.expect : [item.expect];
}

/** Parses the queries file; throws a readable error when an item is malformed. */
export function parseQueries(text: string): EvalQuery[] {
  const data: unknown = parse(text);
  if (!Array.isArray(data)) throw new Error('The queries file must be a list');
  // An empty set would measure nothing (0 / 0) and pass every bar.
  if (data.length === 0) throw new Error('The queries file holds no query');
  return data.map((raw, position) => {
    const item = raw as Partial<EvalQuery> | null;
    const where = `query #${String(position + 1)}`;
    if (typeof item?.query !== 'string' || item.query.trim() === '') {
      throw new Error(`${where}: "query" must be a non-empty string`);
    }
    if (!QUERY_TYPES.includes(item.type as QueryType)) {
      throw new Error(`${where} (${item.query}): "type" must be one of ${QUERY_TYPES.join(', ')}`);
    }
    if ((item.type === 'noise') !== (item.expect === NO_CANDIDATE)) {
      throw new Error(
        `${where} (${item.query}): a noise query, and only a noise query, has "expect: none"`,
      );
    }
    if (item.expect === NO_CANDIDATE) return item as EvalQuery;
    const list = Array.isArray(item.expect) ? item.expect : [item.expect];
    if (list.length === 0 || list.some((e) => !e || typeof e.id !== 'string')) {
      throw new Error(`${where} (${item.query}): "expect" needs { kind, id } or a list of them`);
    }
    return item as EvalQuery;
  });
}

/**
 * Parses baseline.json. Both bars must be numbers (top3 from 0 to 1, p95Ms
 * greater than 0): a missing or misspelled key would make every comparison
 * false and let any result pass.
 */
export function parseBaseline(text: string): Baseline {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('baseline.json is not valid JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('baseline.json must be an object with "top3" and "p95Ms"');
  }
  const { top3, p95Ms } = data as Record<string, unknown>;
  if (typeof top3 !== 'number' || !Number.isFinite(top3) || top3 < 0 || top3 > 1) {
    throw new Error('baseline.json: "top3" must be a number from 0 to 1');
  }
  if (typeof p95Ms !== 'number' || !Number.isFinite(p95Ms) || p95Ms <= 0) {
    throw new Error('baseline.json: "p95Ms" must be a number greater than 0');
  }
  return { top3, p95Ms };
}

/** The bars that a measure does not meet; a measure that is not a number fails. */
export function failures(top3: number, p95: number, baseline: Baseline): string[] {
  const found: string[] = [];
  if (!Number.isFinite(top3)) {
    found.push(`top-3 accuracy is not a number (${String(top3)})`);
  } else if (top3 < baseline.top3) {
    found.push(`top-3 accuracy ${top3.toFixed(3)} is below the baseline ${String(baseline.top3)}`);
  }
  if (!Number.isFinite(p95)) {
    found.push(`p95 latency is not a number (${String(p95)})`);
  } else if (p95 > baseline.p95Ms) {
    found.push(
      `p95 latency ${p95.toFixed(3)} ms is above the baseline ${String(baseline.p95Ms)} ms`,
    );
  }
  return found;
}

/** The 95th percentile (nearest rank) of a list of numbers. */
export function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
}

function emptyTally(): Tally {
  return { count: 0, top1: 0, top3: 0 };
}

/** Runs every query once and tallies top-1 and top-3 hits. */
export function evaluate(index: ResolverIndex, queries: EvalQuery[]): Report {
  const perType = Object.fromEntries(QUERY_TYPES.map((type) => [type, emptyTally()])) as Record<
    QueryType,
    Tally
  >;
  const overall = emptyTally();
  const misses: Report['misses'] = [];
  for (const item of queries) {
    const wanted = expectedList(item);
    const found = search(index, item.query);
    const hits = found.map((candidate) =>
      wanted.some((e) => e.kind === candidate.kind && e.id === candidate.id),
    );
    // A noise query is right only when no candidate is proposed at all.
    const top1 = item.expect === NO_CANDIDATE ? found.length === 0 : hits[0] === true;
    const top3 = item.expect === NO_CANDIDATE ? found.length === 0 : hits.some(Boolean);
    for (const tally of [perType[item.type], overall]) {
      tally.count += 1;
      if (top1) tally.top1 += 1;
      if (top3) tally.top3 += 1;
    }
    if (!top3) {
      misses.push({
        query: item.query,
        type: item.type,
        got: found.map((candidate) => candidate.id),
      });
    }
  }
  return { perType, overall, misses };
}

/** Times every query REPETITIONS times (after one warm-up pass) and returns the p95 in ms. */
export function measureP95(index: ResolverIndex, queries: EvalQuery[]): number {
  for (const item of queries) search(index, item.query);
  const samples: number[] = [];
  for (let round = 0; round < REPETITIONS; round += 1) {
    for (const item of queries) {
      const start = performance.now();
      search(index, item.query);
      samples.push(performance.now() - start);
    }
  }
  return percentile95(samples);
}

const ratio = (hits: number, count: number): string =>
  count === 0 ? 'n/a' : (hits / count).toFixed(3);

function row(label: string, tally: Tally): string {
  return `${label.padEnd(12)} ${String(tally.count).padStart(5)} ${ratio(tally.top1, tally.count).padStart(8)} ${ratio(tally.top3, tally.count).padStart(8)}`;
}

/**
 * Runs the evaluation on the repository at root (schemas read from
 * `schemas`, the root by default); returns the exit code: 0 when every bar is
 * met, 1 otherwise, and 1 for an unreadable or empty query file or baseline.
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
  const raw = await loadContent(root, schemas);
  const pack = buildPack(raw);
  const index = buildIndex(entriesFromPack(pack));
  const queries = parseQueries(
    await readFile(path.join(root, 'eval', 'resolver', 'queries.yaml'), 'utf8'),
  );
  const baseline = parseBaseline(
    await readFile(path.join(root, 'eval', 'resolver', 'baseline.json'), 'utf8'),
  );

  const report = evaluate(index, queries);
  const p95 = measureP95(index, queries);

  out(`${'type'.padEnd(12)} ${'n'.padStart(5)} ${'top-1'.padStart(8)} ${'top-3'.padStart(8)}`);
  for (const type of QUERY_TYPES) out(row(type, report.perType[type]));
  out(row('overall', report.overall));
  for (const miss of report.misses) {
    out(`miss: [${miss.type}] "${miss.query}" -> ${miss.got.join(', ') || '(no candidate)'}`);
  }
  const top3 = report.overall.top3 / report.overall.count;
  out(`index: ${String(index.size)} entries, ${String(queries.length)} queries`);
  out(`p95 latency: ${p95.toFixed(3)} ms over ${String(REPETITIONS)} repetitions`);
  out(`baseline: top-3 >= ${String(baseline.top3)}, p95 <= ${String(baseline.p95Ms)} ms`);

  const failed = failures(top3, p95, baseline);
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
