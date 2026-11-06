// SPDX-License-Identifier: MIT
// The evaluation of the prescription reading (SCRUM-57): the reading of the
// app (app/src/domain/prescription-reading.ts) run on the text that OCR
// engines gave for the synthetic prescriptions, and on their exact text,
// scored against what each prescription says (eval/prescription/). No image
// is read here and none is committed: only text. It fails on any false
// product above the baseline (none on printed pages for the engine the app
// ships), on a recall below the baseline, on a wrong strength or a wrong
// count per day offered on printed pages, on fewer products outside the
// pack kept as lines to add than the baseline, on any header line (the
// patient, the prescriber, a place, the date) offered as typed or quoted,
// on a combination read in part without its warning (must-warn cases), and
// on a header, stamp or place line that gives anything (negative cases).
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pack } from '@siapso/engine';
import { buildPack, loadContent } from '@siapso/pack-tools';
import { normalize } from '@siapso/resolver';
import {
  mayBePreTicked,
  readPrescription,
  unitsPerDayOf,
} from '../../app/src/domain/prescription-reading.js';
import { addScores, emptyScore, rates, scoreReading } from './metrics.mjs';
import { truthText } from './synth.mjs';

export interface TruthItem {
  written: string;
  inBase: boolean;
  /** The pack product of an item of the pack: a reading is right when it proposes its substances. */
  product?: string;
  strengthMg?: number;
  posology: string;
  /** The units per day the posology says, when it says a daily count. */
  upd?: number;
  inline: boolean;
}

export interface TruthRx {
  id: string;
  /**
   * `dev` (rx01 to rx24) and `heldout` (rx25 to rx36): the reading rules were
   * set on both (rules were added after failures of the second, and unit
   * tests use its text), so neither is held out any more; the set frozen and
   * never tuned on is `eval/prescription/fresh/` (README).
   */
  set: 'dev' | 'heldout';
  template: string;
  /** Written in a handwriting-style font (a proxy only). */
  handwriting: boolean;
  patient: string;
  age: number;
  weeks: number;
  date: string;
  prescriber: string;
  /** The places and the practice of the header, when the layout shows them. */
  region?: string;
  district?: string;
  village?: string;
  cabinet?: string;
  items: TruthItem[];
}

/** One text an engine gave for one image of one prescription. */
export interface OcrRow {
  id: string;
  /** The image: scan, photo, hard, dim, pdf-text, pdf-scan, or text (the exact text). */
  variant: string;
  text: string;
}

export interface Bars {
  recallPrint: number;
  recallHand: number;
  /** False products on printed pages, with or without the warning. */
  maxFalsePrint: number;
  /**
   * False products on handwritten pages that do not say their line names
   * more: a combination read in part with its warning is not counted here.
   */
  maxSilentHand: number;
  /** Strengths proposed on printed pages that differ from the one written. */
  maxWrongStrengthPrint: number;
  /** Counts per day offered on printed pages (daily-maximum products) that differ from the posology. */
  maxWrongOffersPrint: number;
  /** The share of products outside the pack kept as lines to add, on printed and on handwritten pages. */
  keptPrint: number;
  keptHand: number;
}

/** The bars that are shares from 0 to 1, and those that are counts. */
const SHARE_BARS = ['recallPrint', 'recallHand', 'keptPrint', 'keptHand'] as const;
const COUNT_BARS = [
  'maxFalsePrint',
  'maxSilentHand',
  'maxWrongStrengthPrint',
  'maxWrongOffersPrint',
] as const;

export interface Baseline {
  sources: Record<string, Bars>;
}

/** Lines that name a combination (or several products), read in part by the OCR. */
export interface MustWarnCase {
  lines: string[];
  /** The substance ids the lines name (a substance the pack lacks may be among them). */
  names: string[];
  why: string;
  /**
   * `false` when the line names part of what it holds by a short word or a
   * guess ("1. SP", "Efav"): nothing read from it may be pre-ticked.
   */
  preTick?: boolean;
}

/** What the reading made of a must-warn case. */
export type MustWarnOutcome =
  'whole' | 'warned' | 'typed' | 'silent' | 'false' | 'lost' | 'pre-ticked';

/** A line of a header, a stamp, a place or a date: it must give no product and no line to add. */
export interface NegativeCase {
  lines: string[];
  why: string;
}

/** What the reading made of a negative case. */
export type NegativeOutcome = 'clean' | 'product' | 'typed';

type Score = ReturnType<typeof emptyScore>;

export interface Group {
  images: number;
  score: Score;
  /** Units per day offered (daily-maximum products only): right, or wrong. */
  offers: { right: number; wrong: number };
  /**
   * False products that are a part of a combination of the prescription and
   * say what else their line names (never pre-ticked, the line offered as typed).
   */
  partialWarned: number;
  /** Products read right that say their line names more (another product read on the same line, or noise). */
  rightWarned: number;
  /**
   * Lines offered as typed, and lines quoted under a product, that hold a
   * word of the header of the prescription: the patient's name, the
   * prescriber's, a place, the practice, the date or the age.
   */
  headerOffered: number;
}

export interface Summary {
  /** By `<set or variant or all>/<print or hand or all>`. */
  groups: Map<string, Group>;
  /** Time of each reading, in milliseconds. */
  ms: number[];
}

/** The name of the exact-text source, read from the truth itself. */
export const TEXT_SOURCE = 'text';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} is not valid JSON`);
  }
}

/** Reads truth.json; throws a readable error for a prescription that is not whole. */
export function parseTruth(text: string): TruthRx[] {
  const data = parseJson(text, 'truth.json');
  if (!Array.isArray(data) || data.length === 0)
    throw new Error('truth.json holds no prescription');
  return data.map((raw: unknown, position) => {
    const rx = raw as Partial<TruthRx> | null;
    const where = `truth.json #${String(position + 1)} (${String(rx?.id)})`;
    if (typeof rx?.id !== 'string' || !Array.isArray(rx.items) || rx.items.length === 0) {
      throw new Error(`${where}: needs an id and items`);
    }
    for (const item of rx.items) {
      if (typeof item.written !== 'string' || typeof item.posology !== 'string') {
        throw new Error(`${where}: an item needs "written" and "posology"`);
      }
      if (item.inBase && typeof item.product !== 'string') {
        throw new Error(`${where}: the item "${item.written}" of the pack needs its product`);
      }
    }
    return rx as TruthRx;
  });
}

/** Reads a file of OCR texts (a JSON list); every row must be of a prescription of the truth. */
export function parseRows(text: string, truth: readonly TruthRx[], file: string): OcrRow[] {
  const ids = new Set(truth.map((rx) => rx.id));
  const data = parseJson(text, file);
  if (!Array.isArray(data) || data.length === 0) throw new Error(`${file} holds no row`);
  return data.map((row: unknown, at) => {
    const where = `${file} row ${String(at + 1)}`;
    if (
      !isRecord(row) ||
      typeof row['id'] !== 'string' ||
      typeof row['variant'] !== 'string' ||
      typeof row['text'] !== 'string'
    ) {
      throw new Error(`${where}: needs "id", "variant" and "text"`);
    }
    if (!ids.has(row['id'])) throw new Error(`${where}: no prescription ${row['id']}`);
    return { id: row['id'], variant: row['variant'], text: row['text'] };
  });
}

/** Reads baseline.json: per source, recall bars from 0 to 1 and false-product limits of 0 or more. */
export function parseBaseline(text: string): Baseline {
  const data = parseJson(text, 'baseline.json');
  const sources = isRecord(data) ? data['sources'] : undefined;
  if (!isRecord(sources) || Object.keys(sources).length === 0) {
    throw new Error('baseline.json must have "sources", one entry per source');
  }
  for (const [name, bars] of Object.entries(sources)) {
    if (!isRecord(bars)) throw new Error(`baseline.json: ${name} is not an object`);
    for (const key of SHARE_BARS) {
      const value = bars[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`baseline.json: ${name}.${key} must be a number from 0 to 1`);
      }
    }
    for (const key of COUNT_BARS) {
      const value = bars[key];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`baseline.json: ${name}.${key} must be a whole number, 0 or more`);
      }
    }
  }
  return data as Baseline;
}

/** Reads must-warn.json. */
export function parseMustWarn(text: string): MustWarnCase[] {
  const data = parseJson(text, 'must-warn.json');
  if (!Array.isArray(data) || data.length === 0) throw new Error('must-warn.json holds no case');
  return data.map((raw: unknown, position) => {
    const item = raw as Partial<MustWarnCase> | null;
    const strings = (list: unknown) =>
      Array.isArray(list) && list.length > 0 && list.every((x) => typeof x === 'string');
    if (!strings(item?.lines) || !strings(item?.names) || typeof item?.why !== 'string') {
      throw new Error(
        `must-warn case ${String(position + 1)}: needs "lines" and "names" (non-empty lists) and "why"`,
      );
    }
    if (item.preTick !== undefined && typeof item.preTick !== 'boolean') {
      throw new Error(`must-warn case ${String(position + 1)}: "preTick" is true or false`);
    }
    return item as MustWarnCase;
  });
}

/** Reads negative.json. */
export function parseNegative(text: string): NegativeCase[] {
  const data = parseJson(text, 'negative.json');
  if (!Array.isArray(data) || data.length === 0) throw new Error('negative.json holds no case');
  return data.map((raw: unknown, position) => {
    const item = raw as Partial<NegativeCase> | null;
    const lines: unknown = item?.lines;
    if (
      !Array.isArray(lines) ||
      lines.length === 0 ||
      !lines.every((x) => typeof x === 'string') ||
      typeof item?.why !== 'string'
    ) {
      throw new Error(
        `negative case ${String(position + 1)}: needs "lines" (a non-empty list) and "why"`,
      );
    }
    return item as NegativeCase;
  });
}

/** The sorted substances of a product of the pack, `plant:<id>` for a remedy. */
function substancesFor(pack: Pack): (kind: string, id: string) => string {
  const byId = new Map(
    pack.products.map((p) => [
      p.id,
      p.components
        .map((c) => c.substance)
        .sort()
        .join('+'),
    ]),
  );
  return (kind, id) => (kind === 'plant' ? `plant:${id}` : (byId.get(id) ?? `unknown:${id}`));
}

/**
 * The warnings that a line names more than the product read: on a product
 * that is a part of a combination of the prescription (a false product of
 * fewer substances than an item: the warning that matters), and on a
 * product read right (noise she looks at for nothing).
 */
function warningsOf(
  pack: Pack,
  rx: TruthRx,
  reading: ReturnType<typeof readPrescription>,
): { partial: number; right: number } {
  const substances = substancesFor(pack);
  const expected = rx.items.flatMap((it) =>
    it.inBase && it.product !== undefined ? [substances('product', it.product)] : [],
  );
  const counts = { partial: 0, right: 0 };
  for (const product of reading.products) {
    const warns =
      product.missingSubstances.length > 0 ||
      product.extraSubstances.length > 0 ||
      product.namesMore;
    if (!warns) continue;
    const got = substances(product.ref.kind, product.ref.id);
    if (expected.includes(got)) {
      counts.right += 1;
      continue;
    }
    const parts = got.split('+');
    const partOf = expected.some((want) => {
      const all = want.split('+');
      return parts.length < all.length && parts.every((s) => all.includes(s));
    });
    if (partOf) counts.partial += 1;
  }
  return counts;
}

/** The reading of one text, as metrics.mjs scores it, and the units per day offered. */
function readingOf(pack: Pack, text: string) {
  const substances = substancesFor(pack);
  const reading = readPrescription(pack, text.split(/\r?\n/));
  const proposals = (offered: boolean) =>
    reading.products.map((p) => ({
      substances: substances(p.ref.kind, p.ref.id),
      strengthMg: p.strengthMg,
      // The posology reader on every product, and what the list offers (daily-maximum products only).
      unitsPerDay: offered
        ? p.unitsPerDayOffer
        : p.posology === undefined
          ? undefined
          : unitsPerDayOf(p.posology),
      line: p.line,
    }));
  const leftovers = reading.typed.map((t) => t.line);
  return {
    reading,
    read: { proposals: proposals(false), leftovers },
    offered: { proposals: proposals(true), leftovers },
  };
}

/** The words of a text as the resolver reads them. */
function wordsOf(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((word) => word !== '');
}

/** Titles and words of the prescriber line that are no one's name, as the resolver reads them. */
const NOT_A_NAME = new Set(['dr', 'mme', 'm', 'icp', 'sage', 'femme', 'd', 'etat'].map(normalize));
/** Words of the practice names that are no place and no name. */
const NOT_A_PLACE = new Set(
  ['cabinet', 'medical', 'clinique', 'de', 'la', 'du', 'des'].map(normalize),
);

/**
 * The lines the reading offers as typed or quotes under a product that hold
 * a word of the header of the prescription (its patient, prescriber, places
 * and practice, as words the items do not have), its date or an age.
 */
function headerLinesOffered(rx: TruthRx, reading: ReturnType<typeof readPrescription>): number {
  const own = new Set(rx.items.flatMap((it) => wordsOf(it.written)));
  const header = new Set(
    [
      ...wordsOf(rx.patient),
      ...wordsOf(rx.prescriber).filter((word) => !NOT_A_NAME.has(word)),
      ...[rx.region, rx.district, rx.village].flatMap((place) => wordsOf(place ?? '')),
      ...wordsOf(rx.cabinet ?? '').filter((word) => !NOT_A_PLACE.has(word)),
    ].filter((word) => !own.has(word)),
  );
  const holdsHeader = (text: string) =>
    text.includes(rx.date) ||
    /\b\d{1,3}\s*ans\b/i.test(text) ||
    wordsOf(text).some((word) => header.has(word));
  const outputs = [
    ...reading.typed.map((t) => `${t.text} ${t.line}`),
    ...reading.products.map((p) => `${p.query} ${p.line}`),
  ];
  return outputs.filter(holdsHeader).length;
}

function median(values: readonly number[], at = 0.5): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(at * sorted.length))] ?? 0;
}

/** Scores the rows of one source, by set, variant and kind of writing. */
export function scoreSource(
  pack: Pack,
  truth: readonly TruthRx[],
  rows: readonly OcrRow[],
): Summary {
  const substances = substancesFor(pack);
  const substancesOf = (id: string) => substances('product', id);
  const summary: Summary = { groups: new Map(), ms: [] };
  for (const row of rows) {
    const rx = truth.find((t) => t.id === row.id);
    if (rx === undefined) continue;
    const started = performance.now();
    const { reading, read, offered } = readingOf(pack, row.text);
    summary.ms.push(performance.now() - started);
    const score = scoreReading(rx, read, substancesOf, normalize);
    const offers = scoreReading(rx, offered, substancesOf, normalize).units;
    const warned = warningsOf(pack, rx, reading);
    const headerOffered = headerLinesOffered(rx, reading);
    const kind = rx.handwriting ? 'hand' : 'print';
    for (const part of [rx.set, row.variant, 'all']) {
      for (const key of [`${part}/${kind}`, `${part}/all`]) {
        const group = summary.groups.get(key) ?? {
          images: 0,
          score: emptyScore(),
          offers: { right: 0, wrong: 0 },
          partialWarned: 0,
          rightWarned: 0,
          headerOffered: 0,
        };
        group.images += 1;
        group.score = addScores(group.score, score);
        group.offers.right += offers.right;
        group.offers.wrong += offers.wrong;
        group.partialWarned += warned.partial;
        group.rightWarned += warned.right;
        group.headerOffered += headerOffered;
        summary.groups.set(key, group);
      }
    }
  }
  return summary;
}

/**
 * What the reading made of a must-warn case (see MustWarnOutcome). A product
 * is read whole when it holds what the lines name; read with the warning
 * when it says what else the lines name (or that they name more) and what
 * it holds more, is never pre-ticked, and comes with the lines as typed;
 * false when it holds a substance the lines do not name without saying so.
 */
export function mustWarnOutcome(pack: Pack, item: MustWarnCase): MustWarnOutcome {
  const reading = readPrescription(pack, item.lines);
  const named = new Set(item.names);
  const substances = substancesFor(pack);
  let outcome: MustWarnOutcome | undefined;
  for (const [index, product] of reading.products.entries()) {
    if (item.preTick === false && mayBePreTicked(product)) return 'pre-ticked';
    const held = substances(product.ref.kind, product.ref.id).split('+');
    const extra = held.filter((s) => !named.has(s));
    const missing = item.names.filter((s) => !held.includes(s));
    const offered = reading.typed.some(
      (t) => t.forProduct === index && (t.reason === 'names-more' || t.reason === 'holds-more'),
    );
    const said =
      extra.every((s) => product.extraSubstances.includes(s)) &&
      (product.namesMore || missing.every((s) => product.missingSubstances.includes(s)));
    if (extra.length > 0 && !said) return 'false';
    if (extra.length === 0 && missing.length === 0) {
      outcome ??= 'whole';
      continue;
    }
    if (!said || mayBePreTicked(product) || !offered) return 'silent';
    if (outcome !== 'whole') outcome = 'warned';
  }
  if (outcome !== undefined) return outcome;
  return reading.typed.length > 0 ? 'typed' : 'lost';
}

/** What the reading made of a negative case: nothing, a product, or a line to add as typed. */
export function negativeOutcome(pack: Pack, item: NegativeCase): NegativeOutcome {
  const reading = readPrescription(pack, item.lines);
  if (reading.products.length > 0) return 'product';
  return reading.typed.length > 0 ? 'typed' : 'clean';
}

/** The bars a source does not meet, then the must-warn and the negative cases that fail. */
export function failures(
  summaries: ReadonlyMap<string, Summary>,
  baseline: Baseline,
  outcomes: readonly MustWarnOutcome[],
  negatives: readonly NegativeOutcome[] = [],
): string[] {
  const found: string[] = [];
  const count = (n: number, what: string) => `${String(n)} ${what}${n === 1 ? '' : 's'}`;
  const plural = (n: number) => count(n, 'false product');
  for (const [name, summary] of summaries) {
    const bars = baseline.sources[name];
    if (bars === undefined) {
      found.push(`${name}: no baseline`);
      continue;
    }
    const print = summary.groups.get('all/print')?.score;
    const handGroup = summary.groups.get('all/hand');
    const hand = handGroup?.score;
    if (print !== undefined && print.falseProducts > bars.maxFalsePrint) {
      found.push(
        `${name}: ${plural(print.falseProducts)} on printed pages (at most ${String(bars.maxFalsePrint)})`,
      );
    }
    const silent = hand === undefined ? 0 : hand.falseProducts - (handGroup?.partialWarned ?? 0);
    if (silent > bars.maxSilentHand) {
      found.push(
        `${name}: ${plural(silent)} without the warning on handwritten pages (at most ${String(bars.maxSilentHand)})`,
      );
    }
    for (const [label, score, bar] of [
      ['printed', print, bars.recallPrint],
      ['handwritten', hand, bars.recallHand],
    ] as const) {
      if (score === undefined) continue;
      const { recall } = rates(score);
      if (recall < bar) {
        found.push(
          `${name}: recall on ${label} pages ${recall.toFixed(3)} is below the baseline ${String(bar)}`,
        );
      }
    }
    if (print !== undefined && print.strength.wrong > bars.maxWrongStrengthPrint) {
      found.push(
        `${name}: ${count(print.strength.wrong, 'wrong strength')} on printed pages (at most ${String(bars.maxWrongStrengthPrint)})`,
      );
    }
    const printGroup = summary.groups.get('all/print');
    const wrongOffers = printGroup?.offers.wrong ?? 0;
    if (wrongOffers > bars.maxWrongOffersPrint) {
      found.push(
        `${name}: ${count(wrongOffers, 'wrong count')} per day offered on printed pages (at most ${String(bars.maxWrongOffersPrint)})`,
      );
    }
    for (const [label, score, bar] of [
      ['printed', print, bars.keptPrint],
      ['handwritten', hand, bars.keptHand],
    ] as const) {
      if (score === undefined || score.outOfBase.items === 0) continue;
      const kept = score.outOfBase.kept / score.outOfBase.items;
      if (kept < bar) {
        found.push(
          `${name}: products outside the pack kept on ${label} pages ${kept.toFixed(3)} is below the baseline ${String(bar)}`,
        );
      }
    }
    // A name read from the paper must never reach an output: no baseline.
    const headers = (printGroup?.headerOffered ?? 0) + (handGroup?.headerOffered ?? 0);
    if (headers > 0) {
      found.push(
        `${name}: ${count(headers, 'header line')} offered as typed or quoted (at most 0)`,
      );
    }
  }
  for (const name of Object.keys(baseline.sources)) {
    if (!summaries.has(name)) found.push(`${name}: in the baseline, not measured`);
  }
  outcomes.forEach((outcome, at) => {
    const which = `must-warn case ${String(at + 1)}`;
    if (outcome === 'silent') found.push(`${which} is read in part without the warning`);
    if (outcome === 'false') found.push(`${which} proposes a product of another substance`);
    if (outcome === 'lost') {
      found.push(`${which} is lost: no product and no line to add as typed`);
    }
    if (outcome === 'pre-ticked') {
      found.push(`${which} reads a product that may be pre-ticked, though the line is unsure`);
    }
  });
  negatives.forEach((outcome, at) => {
    const which = `negative case ${String(at + 1)}`;
    if (outcome === 'product') found.push(`${which} proposes a product`);
    if (outcome === 'typed') found.push(`${which} offers a line to add as typed`);
  });
  return found;
}

const percent = (part: number, whole: number) =>
  whole === 0 ? '    -' : ((100 * part) / whole).toFixed(1).padStart(5);

function row(name: string, key: string, group: Group): string {
  const { score } = group;
  const { recall, precision } = rates(score);
  const proposed = score.found + score.falseProducts;
  return [
    name.padEnd(30),
    key.padEnd(16),
    String(group.images).padStart(4),
    `${percent(recall * score.expected, score.expected)}% ${`${String(score.found)}/${String(score.expected)}`.padEnd(7)}`,
    `${percent(precision * proposed, proposed)}%`,
    `${String(score.falseProducts).padStart(3)} (${String(score.falsePartial)}, ${String(group.partialWarned)} warned / ${String(score.falseFromOutOfBase)})`.padEnd(
      24,
    ),
    `${String(score.strength.right)}/${String(score.strength.expected)} (${String(score.strength.wrong)})`.padStart(
      12,
    ),
    `${String(score.units.right)}/${String(score.units.expected)} (${String(score.units.wrong)})`.padStart(
      12,
    ),
    `${String(group.offers.right)} (${String(group.offers.wrong)})`.padStart(8),
    `${String(score.outOfBase.kept)}/${String(score.outOfBase.items)}`.padStart(7),
    String(group.rightWarned).padStart(6),
    String(group.headerOffered).padStart(6),
  ].join('  ');
}

const ORDER = [
  'all',
  'dev',
  'heldout',
  'scan',
  'photo',
  'hard',
  'dim',
  'pdf-text',
  'pdf-scan',
  'text',
];

/**
 * Runs the evaluation of the folder `folder` (eval/prescription by default)
 * with the pack built from the repository at `root`; returns the exit code:
 * 0 when every bar holds, 1 otherwise or for an unreadable folder.
 */
export async function main(
  root: string,
  out: (line: string) => void = console.log,
  folder: string = path.join(root, 'eval', 'prescription'),
): Promise<number> {
  try {
    return await run(root, out, folder);
  } catch (error) {
    out(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function run(root: string, out: (line: string) => void, folder: string): Promise<number> {
  const truth = parseTruth(await readFile(path.join(folder, 'truth.json'), 'utf8'));
  const baseline = parseBaseline(await readFile(path.join(folder, 'baseline.json'), 'utf8'));
  const cases = parseMustWarn(await readFile(path.join(folder, 'must-warn.json'), 'utf8'));
  // The negative cases are optional in a folder (a fresh set has none).
  const negativeFile = path.join(folder, 'negative.json');
  const negatives = existsSync(negativeFile)
    ? parseNegative(await readFile(negativeFile, 'utf8'))
    : [];
  const pack = buildPack(await loadContent(root));

  const sources = new Map<string, OcrRow[]>([
    [TEXT_SOURCE, truth.map((rx) => ({ id: rx.id, variant: 'text', text: truthText(rx) }))],
  ]);
  const files = (await readdir(path.join(folder, 'ocr'))).filter((f) => f.endsWith('.json'));
  for (const file of files.sort()) {
    const text = await readFile(path.join(folder, 'ocr', file), 'utf8');
    sources.set(file.replace(/\.json$/, ''), parseRows(text, truth, file));
  }

  out(
    `${'source'.padEnd(30)}  ${'group'.padEnd(16)}  imgs  ${'recall'.padEnd(14)}  precis.  ${'false (part, warned / out)'.padEnd(24)}     strengths    units read   offered     kept   noise  header`,
  );
  const summaries = new Map<string, Summary>();
  const ms: number[] = [];
  for (const [name, rows] of sources) {
    const summary = scoreSource(pack, truth, rows);
    summaries.set(name, summary);
    ms.push(...summary.ms);
    const keys = [...summary.groups.keys()].sort((a, b) => {
      const [pa = '', ka = ''] = a.split('/');
      const [pb = '', kb = ''] = b.split('/');
      return ORDER.indexOf(pa) - ORDER.indexOf(pb) || ka.localeCompare(kb);
    });
    for (const key of keys) {
      const group = summary.groups.get(key);
      if (group !== undefined) out(row(name, key, group));
    }
  }

  const outcomes = cases.map((item) => mustWarnOutcome(pack, item));
  const count = (o: MustWarnOutcome) => String(outcomes.filter((x) => x === o).length);
  out(
    `must-warn: ${String(cases.length)} cases, ${count('whole')} read whole, ${count('warned')} read in part with the warning, ${count('typed')} kept as typed, ${count('silent')} silent, ${count('false')} false, ${count('lost')} lost, ${count('pre-ticked')} pre-tickable though unsure`,
  );
  const negativeOutcomes = negatives.map((item) => negativeOutcome(pack, item));
  const clean = negativeOutcomes.filter((o) => o === 'clean').length;
  out(
    `negative: ${String(negatives.length)} header, stamp, place and date lines, ${String(clean)} give nothing, ${String(negatives.length - clean)} give a product or a line to add`,
  );
  out(
    `reading time: median ${median(ms).toFixed(1)} ms, 90th percentile ${median(ms, 0.9).toFixed(1)} ms per page (${String(ms.length)} pages)`,
  );
  out(
    'columns: recall and precision of the products of the pack; false products (part of a combination, of which with the warning that the line names more / read on a product outside the pack); strengths right/expected (wrong); units per day read right/expected (wrong); units offered for daily-maximum products right (wrong); products outside the pack kept as lines to add; noise: products read right that say their line names more; header: lines offered as typed or quoted that hold the patient, the prescriber, a place, the date or an age',
  );

  const failed = failures(summaries, baseline, outcomes, negativeOutcomes);
  for (const failure of failed) out(`FAIL: ${failure}`);
  return failed.length > 0 ? 1 : 0;
}
