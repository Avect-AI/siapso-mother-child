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
] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

export interface Expected {
  kind: EntryKind;
  id: string;
}

export interface EvalQuery {
  query: string;
  /** One acceptable answer, or a list when several products of a brand are equally right. */
  expect: Expected | Expected[];
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

export function expectedList(item: EvalQuery): Expected[] {
  return Array.isArray(item.expect) ? item.expect : [item.expect];
}

/** Parses the queries file; throws a readable error when an item is malformed. */
export function parseQueries(text: string): EvalQuery[] {
  const data: unknown = parse(text);
  if (!Array.isArray(data)) throw new Error('The queries file must be a list');
  return data.map((raw, position) => {
    const item = raw as Partial<EvalQuery> | null;
    const where = `query #${String(position + 1)}`;
    if (typeof item?.query !== 'string' || item.query.trim() === '') {
      throw new Error(`${where}: "query" must be a non-empty string`);
    }
    if (!QUERY_TYPES.includes(item.type as QueryType)) {
      throw new Error(`${where} (${item.query}): "type" must be one of ${QUERY_TYPES.join(', ')}`);
    }
    const list = Array.isArray(item.expect) ? item.expect : [item.expect];
    if (list.length === 0 || list.some((e) => !e || typeof e.id !== 'string')) {
      throw new Error(`${where} (${item.query}): "expect" needs { kind, id } or a list of them`);
    }
    return item as EvalQuery;
  });
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
    for (const tally of [perType[item.type], overall]) {
      tally.count += 1;
      if (hits[0]) tally.top1 += 1;
      if (hits.some(Boolean)) tally.top3 += 1;
    }
    if (!hits.some(Boolean)) {
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

/** Runs the evaluation on the repository at root; returns the exit code. */
export async function main(
  root: string,
  out: (line: string) => void = console.log,
): Promise<number> {
  const raw = await loadContent(root, root);
  const pack = buildPack(raw);
  const index = buildIndex(entriesFromPack(pack));
  const queries = parseQueries(
    await readFile(path.join(root, 'eval', 'resolver', 'queries.yaml'), 'utf8'),
  );
  const baseline = JSON.parse(
    await readFile(path.join(root, 'eval', 'resolver', 'baseline.json'), 'utf8'),
  ) as Baseline;

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

  let failed = false;
  if (top3 < baseline.top3) {
    out(`FAIL: top-3 accuracy ${top3.toFixed(3)} is below the baseline ${String(baseline.top3)}`);
    failed = true;
  }
  if (p95 > baseline.p95Ms) {
    out(
      `FAIL: p95 latency ${p95.toFixed(3)} ms is above the baseline ${String(baseline.p95Ms)} ms`,
    );
    failed = true;
  }
  return failed ? 1 : 0;
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
