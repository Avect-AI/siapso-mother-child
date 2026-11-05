// SPDX-License-Identifier: MIT
import type { Aggregate, FindingsKey, Row } from './aggregate.js';
import { CHECK_IDS } from './events.js';

export interface Column {
  /** Name in the CSV header; documented in open-data/fields.md. */
  name: string;
  key: keyof Row;
}

/** Fixed column order. */
export const COLUMNS: readonly Column[] = [
  { name: 'week', key: 'week' },
  { name: 'region', key: 'region' },
  { name: 'status', key: 'status' },
  { name: 'checks', key: 'checks' },
  { name: 'level_unknown', key: 'levelUnknown' },
  { name: 'level_next_contact', key: 'levelNextContact' },
  { name: 'level_before_next_dose', key: 'levelBeforeNextDose' },
  { name: 'level_danger', key: 'levelDanger' },
  { name: 'grey_share_percent', key: 'greyShare' },
  ...CHECK_IDS.map((id) => ({
    name: `findings_${id.toLowerCase()}`,
    key: `findings${id}` satisfies FindingsKey,
  })),
  { name: 'unknown_items', key: 'unknownItems' },
  { name: 'unrecognised_names', key: 'unrecognisedNames' },
];

const LABEL_PATTERN = /^[A-Za-z0-9 ,.:;()_-]{1,100}$/;

/** A label is one short line made of letters, digits, spaces and a few punctuation marks. */
export function assertLabel(label: string): void {
  if (!LABEL_PATTERN.test(label)) {
    throw new Error(
      'The label must be 1 to 100 characters: letters, digits, space and , . : ; ( ) _ -',
    );
  }
}

/** Deterministic CSV: LF endings, fixed columns, rows sorted by region, an optional label comment first. */
export function renderCsv(result: Aggregate, label?: string): string {
  const lines: string[] = [];
  if (label !== undefined) {
    assertLabel(label);
    lines.push(`# ${label}`);
  }
  lines.push(COLUMNS.map((column) => column.name).join(','));
  for (const row of result.rows) lines.push(COLUMNS.map((column) => row[column.key]).join(','));
  return `${lines.join('\n')}\n`;
}
