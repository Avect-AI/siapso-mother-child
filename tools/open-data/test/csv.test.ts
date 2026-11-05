// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregate, COLUMNS, REGIONS, renderCsv } from '../src/index.js';
import { makeEvents, REPO_ROOT } from './helpers.js';

const WEEK = '2026-W45';
const events = [
  ...makeEvents(12, { region: 'thies', level: 'unknown' }),
  ...makeEvents(11, { region: 'dakar' }),
  ...makeEvents(3, { region: 'kolda' }),
  ...makeEvents(10, { region: 'matam' }),
];

describe('renderCsv', () => {
  it('is deterministic whatever the input order', () => {
    const first = renderCsv(aggregate(events, WEEK));
    expect(renderCsv(aggregate([...events].reverse(), WEEK))).toBe(first);
    expect(renderCsv(aggregate(events, WEEK))).toBe(first);
  });

  it('uses LF line endings only and ends with one newline', () => {
    const csv = renderCsv(aggregate(events, WEEK), 'TEST DATA');
    expect(csv).not.toContain('\r');
    expect(csv.endsWith('\n')).toBe(true);
    expect(csv.endsWith('\n\n')).toBe(false);
  });

  it('writes the fixed header and one row per region, with no footer', () => {
    const lines = renderCsv(aggregate(events, WEEK)).trimEnd().split('\n');
    expect(lines[0]).toBe(COLUMNS.map((column) => column.name).join(','));
    expect(lines).toHaveLength(1 + 14);
    expect(lines.some((line) => line.startsWith('#'))).toBe(false);
    expect(lines.slice(1).map((line) => line.split(',').slice(0, 3).join(','))).toContain(
      '2026-W45,kedougou,suppressed',
    );
  });

  it('writes empty value cells for a suppressed row', () => {
    const lines = renderCsv(aggregate(events, WEEK)).split('\n');
    const matam = lines.find((line) => line.startsWith('2026-W45,matam,')) ?? '';
    expect(matam).toBe(`2026-W45,matam,suppressed${','.repeat(COLUMNS.length - 3)}`);
  });

  it('puts a label comment first when asked', () => {
    const csv = renderCsv(aggregate(events, WEEK), 'TEST DATA: synthetic');
    expect(csv.split('\n')[0]).toBe('# TEST DATA: synthetic');
  });

  it('refuses a label outside the allowed characters', () => {
    const dash = String.fromCharCode(0x2014);
    for (const label of ['a\nb', `a${dash}b`, 'a<b>', '', 'x'.repeat(101), 'name@mail']) {
      expect(() => renderCsv(aggregate(events, WEEK), label)).toThrow();
    }
  });

  it('writes the same number of fields on every row', () => {
    const lines = renderCsv(aggregate(events, WEEK)).trimEnd().split('\n');
    for (const line of lines) expect(line.split(',')).toHaveLength(COLUMNS.length);
  });
});

describe('field dictionary', () => {
  it('describes every column and no other', async () => {
    const dictionary = await readFile(path.join(REPO_ROOT, 'open-data/fields.md'), 'utf8');
    const section = dictionary.split('## Columns of the published CSV')[1]?.split('\n## ')[0] ?? '';
    const documented = [...section.matchAll(/^\| `([a-zA-Z0-9_]+)`\s*\|/gm)].map(
      (match) => match[1],
    );
    expect(documented).toEqual(COLUMNS.map((column) => column.name));
  });

  it('lists the 14 regions with their id and official name', async () => {
    const dictionary = await readFile(path.join(REPO_ROOT, 'open-data/fields.md'), 'utf8');
    for (const region of REGIONS) {
      expect(dictionary).toMatch(new RegExp(`\\| \`${region.id}\`\\s*\\| ${region.name}\\s*\\|`));
    }
  });

  it('explains the suppressed, <5, withheld and band marks', async () => {
    const dictionary = await readFile(path.join(REPO_ROOT, 'open-data/fields.md'), 'utf8');
    for (const mark of ['`suppressed`', '`<5`', '`withheld`', '`101+`']) {
      expect(dictionary).toContain(mark);
    }
  });

  it('publishes no column that could identify a woman', () => {
    const names = COLUMNS.map((column) => column.name.toLowerCase()).join(' ');
    for (const forbidden of ['profile', 'name_', 'product', 'note', 'text', 'date', 'phone']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('published sample', () => {
  it('has the test label, 14 regions, no small exact count and no footer', async () => {
    const csv = await readFile(
      path.join(REPO_ROOT, 'open-data/published/2026-W45-r1-test.csv'),
      'utf8',
    );
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^# TEST DATA/);
    expect(csv).not.toContain('\r');
    expect(lines.filter((line) => line.startsWith('#'))).toHaveLength(1);
    const rows = lines.slice(2).map((line) => line.split(','));
    expect(rows).toHaveLength(14);
    const names = COLUMNS.map((column) => column.name);
    const share = names.indexOf('grey_share_percent');
    for (const row of rows) {
      row.forEach((value, i) => {
        if (i < 3 || !/^\d+$/.test(value)) return;
        if (i === share) expect(Number(value) % 5).toBe(0);
        else expect(Number(value)).toBeGreaterThanOrEqual(5);
      });
      expect(row[names.indexOf('checks')]).toMatch(/^(|11-20|21-50|51-100|101\+)$/);
    }
    const suppressed = rows.filter((row) => row[2] === 'suppressed').length;
    expect(suppressed).toBeGreaterThan(0);
  });
});
