// SPDX-License-Identifier: MIT
import { CHECK_IDS, type OpenCheckId, type OpenDataEvent } from './events.js';
import { REGION_IDS } from './regions.js';

/**
 * A (week, region) row is published only when it counts strictly more than 10
 * checks, that is at least 11. Below that the whole row is suppressed. The
 * threshold counts events (checks), not women: see open-data/README.md.
 */
export const MIN_PUBLISHED_CHECKS = 11;
/** A count below this is published as "<5". */
export const SMALL_COUNT = 5;
/** The grey share is published only for rows with at least this many checks. */
export const MIN_SHARE_CHECKS = 20;

export const SMALL_MARK = '<5';
export const WITHHELD_MARK = 'withheld';
export const SUPPRESSED_MARK = 'suppressed';

export type FindingsKey = `findings${OpenCheckId}`;
export const LEVEL_KEYS = [
  'levelUnknown',
  'levelNextContact',
  'levelBeforeNextDose',
  'levelDanger',
] as const;
export type LevelKey = (typeof LEVEL_KEYS)[number];

/**
 * A published row. Every value is the text that is published: a number, "<5",
 * "withheld", "suppressed", a band, or an empty text for a suppressed row.
 */
export type Row = {
  week: string;
  region: string;
  status: 'published' | 'suppressed';
  /** Band of the number of checks: "11-20", "21-50", "51-100" or "101+". */
  checks: string;
  /** Percentage of grey results rounded to the nearest 5 points, or "suppressed". */
  greyShare: string;
  unknownItems: string;
  unrecognisedNames: string;
} & Record<LevelKey, string> &
  Record<FindingsKey, string>;

export interface Aggregate {
  week: string;
  /** One row per region of Senegal, in region id order. */
  rows: Row[];
}

const BANDS: readonly { min: number; max: number; label: string }[] = [
  { min: 11, max: 20, label: '11-20' },
  { min: 21, max: 50, label: '21-50' },
  { min: 51, max: 100, label: '51-100' },
  { min: 101, max: Number.POSITIVE_INFINITY, label: '101+' },
];

function bandOf(checks: number) {
  const band = BANDS.find((candidate) => checks >= candidate.min && checks <= candidate.max);
  if (band === undefined) throw new Error('A published row must have at least 11 checks.');
  return band;
}

function maskCount(count: number): string {
  return count < SMALL_COUNT ? SMALL_MARK : String(count);
}

function roundShare(unknown: number, checks: number): number {
  return Math.round((unknown * 100) / checks / 5) * 5;
}

/**
 * Feasible values of each masked level cell, given the published cells: a
 * level cell is a number (published), null (masked, "<5": 0 to 4) or
 * undefined (withheld: any value). Used to refuse a row where a masked cell
 * could be recomputed from the others.
 */
function maskedValues(
  levels: readonly (number | null | undefined)[],
  band: { min: number; max: number },
  share: number | undefined,
): Set<number>[] {
  const feasible = levels.map(() => new Set<number>());
  const known = levels.reduce<number>((sum, cell) => sum + (cell ?? 0), 0);
  const hasWithheld = levels.includes(undefined);
  const assigned: number[] = levels.map((cell) => cell ?? 0);
  const walk = (index: number, sum: number): void => {
    if (index === levels.length) {
      const total = known + sum;
      const inBand = hasWithheld ? total <= band.max : total >= band.min && total <= band.max;
      const unknown = assigned[0] ?? 0;
      const shareOk =
        share === undefined || levels[0] === undefined || roundShare(unknown, total) === share;
      if (inBand && shareOk) {
        levels.forEach((cell, i) => {
          if (cell === null) feasible[i]?.add(assigned[i] ?? 0);
        });
      }
      return;
    }
    if (levels[index] === null) {
      for (let value = 0; value < SMALL_COUNT; value += 1) {
        assigned[index] = value;
        walk(index + 1, sum + value);
      }
      assigned[index] = 0;
    } else {
      walk(index + 1, sum);
    }
  };
  walk(0, 0);
  return levels.flatMap((cell, i) => (cell === null ? [feasible[i] ?? new Set<number>()] : []));
}

function suppressedRow(week: string, region: string): Row {
  const row = {
    week,
    region,
    status: 'suppressed',
    checks: '',
    greyShare: '',
    unknownItems: '',
    unrecognisedNames: '',
    levelUnknown: '',
    levelNextContact: '',
    levelBeforeNextDose: '',
    levelDanger: '',
  } as Row;
  for (const id of CHECK_IDS) row[`findings${id}`] = '';
  return row;
}

interface Cell {
  checks: number;
  levels: [number, number, number, number];
  findings: Record<OpenCheckId, number>;
  unknownItems: number;
  unrecognisedNames: number;
}

function publishedRow(week: string, region: string, cell: Cell): Row {
  const row = suppressedRow(week, region);
  const band = bandOf(cell.checks);
  row.status = 'published';
  row.checks = band.label;
  const levels: (number | null | undefined)[] = cell.levels.map((count) =>
    count < SMALL_COUNT ? null : count,
  );
  // The grey share is published only from 20 checks and only when no level
  // cell of the row is masked (the share would narrow a masked cell).
  const share =
    cell.checks >= MIN_SHARE_CHECKS && !levels.includes(null)
      ? roundShare(cell.levels[0], cell.checks)
      : undefined;
  row.greyShare = share === undefined ? SUPPRESSED_MARK : String(share);
  // A masked cell is acceptable only if every value 0 to 4 stays feasible given
  // the published cells and the band bounds. Otherwise the exact level cells of
  // the row are withheld; if that is not enough, every level cell is.
  const leaks = (): boolean =>
    maskedValues(levels, band, share).some((values) => values.size < SMALL_COUNT);
  if (leaks()) {
    levels.forEach((value, i) => {
      if (value !== null) levels[i] = undefined;
    });
    if (leaks()) levels.fill(undefined);
  }
  LEVEL_KEYS.forEach((key, i) => {
    const value = levels[i];
    row[key] = value === null ? SMALL_MARK : value === undefined ? WITHHELD_MARK : String(value);
  });
  for (const id of CHECK_IDS) row[`findings${id}`] = maskCount(cell.findings[id]);
  row.unknownItems = maskCount(cell.unknownItems);
  row.unrecognisedNames = maskCount(cell.unrecognisedNames);
  return row;
}

const LEVEL_INDEX = {
  unknown: 0,
  'next-contact': 1,
  'before-next-dose': 2,
  danger: 3,
} as const;

/**
 * One row for each of the 14 regions for the given week. Events of other weeks
 * are ignored. A region with fewer than MIN_PUBLISHED_CHECKS checks, including
 * none, is a suppressed row with every value empty, so a region without events
 * cannot be told from a suppressed one. Pure and deterministic.
 */
export function aggregate(events: readonly OpenDataEvent[], week: string): Aggregate {
  const cells = new Map<string, Cell>();
  for (const event of events) {
    if (event.week !== week) continue;
    let cell = cells.get(event.region);
    if (cell === undefined) {
      cell = {
        checks: 0,
        levels: [0, 0, 0, 0],
        findings: Object.fromEntries(CHECK_IDS.map((id) => [id, 0])) as Record<OpenCheckId, number>,
        unknownItems: 0,
        unrecognisedNames: 0,
      };
      cells.set(event.region, cell);
    }
    cell.checks += 1;
    cell.levels[LEVEL_INDEX[event.level]] += 1;
    cell.unknownItems += event.unknownItems;
    cell.unrecognisedNames += event.unrecognisedNames;
    for (const id of CHECK_IDS) cell.findings[id] += event.findings[id];
  }
  const rows = [...REGION_IDS].sort().map((region) => {
    const cell = cells.get(region);
    return cell === undefined || cell.checks < MIN_PUBLISHED_CHECKS
      ? suppressedRow(week, region)
      : publishedRow(week, region, cell);
  });
  return { week, rows };
}
