// SPDX-License-Identifier: MIT
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { LEVEL_INDEX, maskLevels, SMALL_COUNT, MIN_PUBLISHED_CHECKS } from './aggregate.js';
import { EventError, type OpenDataEvent } from './events.js';
import { isoWeekEnd, RELEASE_LAG_DAYS } from './release.js';
import { REGION_IDS } from './regions.js';

/**
 * Monthly aggregate export in the DHIS2 `dataValueSets` JSON format. See
 * docs/dhis2.md. The disclosure rules are those of the open data (suppression of
 * cells with 10 checks or fewer, counts below 5 not published, no omitted value
 * that can be recomputed), adapted to months and districts. A DHIS2 data value
 * is a number, so a masked or withheld value is simply not exported.
 */

export const PLACEHOLDER = '<to be provided by the district>';

export const INDICATORS = [
  'checks',
  'level_unknown',
  'level_next_contact',
  'level_before_next_dose',
  'level_danger',
  'iptp_reminders_shown',
] as const;
export type Indicator = (typeof INDICATORS)[number];

const LEVEL_INDICATORS = [
  'level_unknown',
  'level_next_contact',
  'level_before_next_dose',
  'level_danger',
] as const satisfies readonly Indicator[];

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_PATTERN = /^(20[0-9]{2})-(0[1-9]|1[0-2])$/;
const DISTRICT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A DHIS2 identifier (UID): 11 characters, a letter then letters or digits. */
const UID = /^[A-Za-z][A-Za-z0-9]{10}$/;

export interface District {
  id: string;
  region: string;
}
export interface Districts {
  districts: District[];
}

export interface DataElementMapping {
  dataElement: string;
  categoryOptionCombo?: string;
}
export interface Mapping {
  dataElements: Record<Indicator, DataElementMapping>;
  /** District id to DHIS2 organisation unit identifier. */
  orgUnits: Record<string, string>;
}

export interface MonthCell {
  district: string;
  status: 'exported' | 'suppressed';
  /** Only the values that may be exported; an absent key is not exported. */
  values: Partial<Record<Indicator, number>>;
}
export interface MonthAggregate {
  month: string;
  /** One cell per listed district, in district id order. */
  cells: MonthCell[];
  /** Events of other months, dropped. */
  dropped: number;
  /** Events of the month without a district, not exported. */
  withoutDistrict: number;
}

export interface DataValue {
  dataElement: string;
  period: string;
  orgUnit: string;
  categoryOptionCombo?: string;
  value: number;
}
export interface DataValueSet {
  dataValues: DataValue[];
}

export function isMonth(month: string): boolean {
  return MONTH_PATTERN.test(month);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The month of an ISO week is the month of its Thursday (the ISO convention), as YYYY-MM. */
export function monthOfWeek(week: string): string {
  const thursday = Date.parse(`${isoWeekEnd(week)}T00:00:00Z`) - 3 * DAY_MS;
  return formatDate(new Date(thursday)).slice(0, 7);
}

/** First date on which the month may be exported: month end plus the fixed lag. */
export function earliestMonthRelease(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  if (match === null) throw new Error(`Not a month: ${month}`);
  const lastDay = Date.UTC(Number(match[1]), Number(match[2]), 0);
  return formatDate(new Date(lastDay + RELEASE_LAG_DAYS * DAY_MS));
}

/** The DHIS2 monthly period, YYYYMM. */
export function dhis2Period(month: string): string {
  if (!isMonth(month)) throw new Error(`Not a month: ${month}`);
  return month.replace('-', '');
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function parseYaml(text: string, what: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parse(text);
  } catch (error) {
    throw new Error(`${what} is not valid YAML.`, { cause: error });
  }
  return asRecord(value, what);
}

/** Parses the district list; refuses an empty list, duplicates, bad ids and unknown regions. */
export function parseDistricts(text: string): Districts {
  const root = parseYaml(text, 'The district list');
  const list = root.districts;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      'The district list has no district. Complete open-data/dhis2/districts.example.yaml from the official list (79 districts).',
    );
  }
  const seen = new Set<string>();
  const districts = list.map((entry: unknown): District => {
    const item = asRecord(entry, 'A district entry');
    const { id, region } = item;
    if (typeof id !== 'string' || !DISTRICT_ID.test(id) || id.length > 40) {
      throw new Error(
        `District id ${String(id)} is invalid: lowercase letters, digits and hyphens.`,
      );
    }
    if (typeof region !== 'string' || !REGION_IDS.includes(region)) {
      throw new Error(`District ${id}: ${String(region)} is not a known region id.`);
    }
    if (seen.has(id)) throw new Error(`District ${id} is listed twice.`);
    seen.add(id);
    return { id, region };
  });
  return { districts: districts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
}

function identifier(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new Error(`${where}: an identifier is required.`);
  if (value.startsWith('<') && value.endsWith('>')) {
    throw new Error(`${where}: placeholder "${value}" must be replaced (${PLACEHOLDER}).`);
  }
  if (!UID.test(value)) {
    throw new Error(
      `${where}: "${value}" is not a DHIS2 identifier (11 characters, a letter first).`,
    );
  }
  return value;
}

/** Parses the mapping; refuses placeholders, malformed identifiers and any missing entry. */
export function parseMapping(text: string, districts: Districts): Mapping {
  const root = parseYaml(text, 'The mapping');
  const elements = asRecord(root.dataElements, 'dataElements');
  const orgUnits = asRecord(root.orgUnits, 'orgUnits');
  // Placeholders first, so the message is the same whatever else is missing.
  const placeholders = JSON.stringify([root.dataElements, root.orgUnits]);
  if (placeholders.includes(`"${PLACEHOLDER}"`)) {
    throw new Error(
      `The mapping still holds "${PLACEHOLDER}". Replace every placeholder with a DHIS2 identifier.`,
    );
  }
  for (const key of Object.keys(elements)) {
    if (!(INDICATORS as readonly string[]).includes(key))
      throw new Error(`Unknown indicator ${key}.`);
  }
  const dataElements = {} as Record<Indicator, DataElementMapping>;
  for (const indicator of INDICATORS) {
    const entry = asRecord(elements[indicator], `dataElements.${indicator}`);
    const item: DataElementMapping = {
      dataElement: identifier(entry.dataElement, `dataElements.${indicator}.dataElement`),
    };
    if (entry.categoryOptionCombo !== undefined) {
      item.categoryOptionCombo = identifier(
        entry.categoryOptionCombo,
        `dataElements.${indicator}.categoryOptionCombo`,
      );
    }
    dataElements[indicator] = item;
  }
  const listed = new Set(districts.districts.map((district) => district.id));
  for (const id of Object.keys(orgUnits)) {
    if (!listed.has(id)) throw new Error(`orgUnits has ${id}, which is not in the district list.`);
  }
  const units: Record<string, string> = {};
  for (const id of listed) {
    if (!(id in orgUnits)) throw new Error(`orgUnits has no entry for district ${id}.`);
    units[id] = identifier(orgUnits[id], `orgUnits.${id}`);
  }
  return { dataElements, orgUnits: units };
}

interface Counts {
  checks: number;
  levels: [number, number, number, number];
  iptp: number;
}

function cellValues(counts: Counts): Partial<Record<Indicator, number>> {
  // The number of checks is not exported, so a reader only knows it is at least 11.
  const levels = maskLevels(counts.levels, {
    min: MIN_PUBLISHED_CHECKS,
    max: Number.POSITIVE_INFINITY,
  });
  const values: Partial<Record<Indicator, number>> = {};
  LEVEL_INDICATORS.forEach((indicator, i) => {
    const value = levels[i];
    if (typeof value === 'number') values[indicator] = value;
  });
  // The exact number of checks is exported only when every level is exported:
  // it is then the sum of the exported levels and reveals nothing more.
  if (levels.every((value) => typeof value === 'number')) values.checks = counts.checks;
  if (counts.iptp >= SMALL_COUNT) values.iptp_reminders_shown = counts.iptp;
  return values;
}

/**
 * Monthly cells for every listed district. Events of other months are dropped,
 * events without a district are not exported, and an event whose district is
 * not in the list (or whose region differs from the district's) is an error.
 * A cell of 10 checks or fewer is suppressed. Pure and deterministic.
 */
export function aggregateMonth(
  events: readonly OpenDataEvent[],
  month: string,
  districts: Districts,
): MonthAggregate {
  if (!isMonth(month)) throw new Error(`Not a month: ${month}`);
  const byId = new Map(districts.districts.map((district) => [district.id, district]));
  const counts = new Map<string, Counts>();
  let dropped = 0;
  let withoutDistrict = 0;
  for (const event of events) {
    if (monthOfWeek(event.week) !== month) {
      dropped += 1;
      continue;
    }
    if (event.district === undefined) {
      withoutDistrict += 1;
      continue;
    }
    const district = byId.get(event.district);
    if (district === undefined) {
      throw new EventError(
        `district ${event.district} is not in the district list. Add it to districts.yaml or correct the event source.`,
      );
    }
    if (district.region !== event.region) {
      throw new EventError(
        `district ${event.district} belongs to region ${district.region}, not ${event.region}`,
      );
    }
    let cell = counts.get(event.district);
    if (cell === undefined) {
      cell = { checks: 0, levels: [0, 0, 0, 0], iptp: 0 };
      counts.set(event.district, cell);
    }
    cell.checks += 1;
    cell.levels[LEVEL_INDEX[event.level]] += 1;
    if (event.iptpReminderShown === true) cell.iptp += 1;
  }
  const cells = districts.districts.map((district): MonthCell => {
    const cell = counts.get(district.id);
    return cell === undefined || cell.checks < MIN_PUBLISHED_CHECKS
      ? { district: district.id, status: 'suppressed', values: {} }
      : { district: district.id, status: 'exported', values: cellValues(cell) };
  });
  return { month, cells, dropped, withoutDistrict };
}

/** The DHIS2 `dataValueSets` object, in district then indicator order. */
export function toDataValueSets(
  cells: readonly MonthCell[],
  month: string,
  mapping: Mapping,
): DataValueSet {
  const period = dhis2Period(month);
  const dataValues: DataValue[] = [];
  for (const cell of cells) {
    const orgUnit = mapping.orgUnits[cell.district];
    if (orgUnit === undefined)
      throw new Error(`No organisation unit for district ${cell.district}.`);
    for (const indicator of INDICATORS) {
      const value = cell.values[indicator];
      if (value === undefined) continue;
      const element = mapping.dataElements[indicator];
      const entry: DataValue = { dataElement: element.dataElement, period, orgUnit, value };
      if (element.categoryOptionCombo !== undefined) {
        entry.categoryOptionCombo = element.categoryOptionCombo;
      }
      dataValues.push(entry);
    }
  }
  return { dataValues };
}

/** Deterministic JSON text: fixed key order, two-space indent, LF, final newline. */
export function renderDhis2(set: DataValueSet): string {
  const ordered = set.dataValues.map((v) => ({
    dataElement: v.dataElement,
    period: v.period,
    orgUnit: v.orgUnit,
    ...(v.categoryOptionCombo === undefined ? {} : { categoryOptionCombo: v.categoryOptionCombo }),
    value: v.value,
  }));
  return `${JSON.stringify({ dataValues: ordered }, null, 2)}\n`;
}

export const RESTRICTED_NOTICE = 'not for publication; for the district DHIS2 instance only';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OPEN_DATA = path.join(REPO_ROOT, 'open-data');
const DHIS2_OUT = path.join(OPEN_DATA, 'dhis2', 'out');

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * The DHIS2 export is restricted data, never open data. It may be written only
 * outside the committed open-data folders, or in open-data/dhis2/out (ignored
 * by version control). A folder named "published" is always refused.
 */
export function isAllowedDhis2OutDir(directory: string): boolean {
  const resolved = path.resolve(directory);
  if (resolved.split(path.sep).includes('published')) return false;
  if (isInside(DHIS2_OUT, resolved)) return true;
  return !isInside(OPEN_DATA, resolved);
}
