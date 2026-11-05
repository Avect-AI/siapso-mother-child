// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { aggregate, MIN_PUBLISHED_CHECKS, REGION_IDS, type Row } from '../src/index.js';
import { makeEvent, makeEvents } from './helpers.js';

const WEEK = '2026-W45';

function rowOf(result: ReturnType<typeof aggregate>, region: string): Row {
  const row = result.rows.find((candidate) => candidate.region === region);
  if (row === undefined) throw new Error(`no row for ${region}`);
  return row;
}

describe('suppression of small rows', () => {
  it('suppresses a row with exactly 10 checks', () => {
    const row = rowOf(aggregate(makeEvents(10), WEEK), 'dakar');
    expect(row.status).toBe('suppressed');
  });

  it('publishes a row with 11 checks', () => {
    const row = rowOf(aggregate(makeEvents(11), WEEK), 'dakar');
    expect(MIN_PUBLISHED_CHECKS).toBe(11);
    expect(row.status).toBe('published');
    expect(row.checks).toBe('11-20');
  });

  it('empties every value cell of a suppressed row', () => {
    const events = makeEvents(10, { level: 'danger', unrecognisedNames: 1, unknownItems: 2 });
    const row = rowOf(aggregate(events, WEEK), 'dakar');
    const values = Object.entries(row).filter(
      ([key]) => !['week', 'region', 'status'].includes(key),
    );
    expect(values.length).toBeGreaterThan(10);
    for (const [, value] of values) expect(value).toBe('');
  });

  it('counts a (week, region) cell: other weeks are ignored', () => {
    const events = [...makeEvents(6, { week: '2026-W44' }), ...makeEvents(6, { week: '2026-W45' })];
    expect(rowOf(aggregate(events, WEEK), 'dakar').status).toBe('suppressed');
    expect(rowOf(aggregate(events, '2026-W44'), 'dakar').status).toBe('suppressed');
  });

  it('does not let the two modes dodge the threshold or leak a split', () => {
    const events = [...makeEvents(6, { mode: 'woman' }), ...makeEvents(5, { mode: 'accompanied' })];
    const row = rowOf(aggregate(events, WEEK), 'dakar');
    expect(row.status).toBe('published');
    expect(Object.keys(row)).not.toContain('mode');
  });
});

describe('all regions appear', () => {
  it('has one row for each of the 14 regions even with no event', () => {
    const result = aggregate([], WEEK);
    expect(result.rows.map((row) => row.region)).toEqual([...REGION_IDS].sort());
    for (const row of result.rows) expect(row.status).toBe('suppressed');
  });

  it('makes a region with no event identical to a region with 10 checks', () => {
    const result = aggregate(makeEvents(10, { region: 'fatick' }), WEEK);
    expect({ ...rowOf(result, 'fatick'), region: 'x' }).toEqual({
      ...rowOf(result, 'kedougou'),
      region: 'x',
    });
  });

  it('is sorted by region whatever the input order', () => {
    const events = [
      ...makeEvents(11, { region: 'thies' }),
      ...makeEvents(11, { region: 'saint-louis' }),
      ...makeEvents(11, { region: 'kaolack' }),
    ];
    expect(aggregate([...events].reverse(), WEEK)).toEqual(aggregate(events, WEEK));
  });
});

describe('masking of small counts', () => {
  it('publishes checks as a band', () => {
    const band = (n: number) => rowOf(aggregate(makeEvents(n), WEEK), 'dakar').checks;
    expect([11, 20, 21, 50, 51, 100, 101, 250].map(band)).toEqual([
      '11-20',
      '11-20',
      '21-50',
      '21-50',
      '51-100',
      '51-100',
      '101+',
      '101+',
    ]);
  });

  it('publishes every count below 5 as <5 and others exactly', () => {
    const events = [
      ...makeEvents(10, { level: 'next-contact' }),
      ...makeEvents(4, { level: 'danger', unknownItems: 1 }),
      makeEvent({ level: 'danger', findings: { ...makeEvent().findings, C3: 3, C7: 6 } }),
    ];
    const row = rowOf(aggregate(events, WEEK), 'dakar');
    expect(row.levelDanger).toBe('5');
    expect(row.levelNextContact).toBe('10');
    expect(row.levelUnknown).toBe('<5');
    expect(row.findingsC3).toBe('<5');
    expect(row.findingsC7).toBe('6');
    expect(row.findingsC1).toBe('<5');
    expect(row.unknownItems).toBe('<5');
    expect(row.unrecognisedNames).toBe('<5');
  });

  it('rounds the grey share to 5 points, only from 20 checks', () => {
    const others = ['next-contact', 'before-next-dose', 'danger'] as const;
    const grey = (total: number, unknown: number) =>
      rowOf(
        aggregate(
          [
            ...makeEvents(unknown, { level: 'unknown' }),
            ...Array.from({ length: total - unknown }, (_, i) =>
              makeEvent({ level: others[i % 3] ?? 'danger' }),
            ),
          ],
          WEEK,
        ),
        'dakar',
      ).greyShare;
    expect(grey(19, 6)).toBe('suppressed');
    expect(grey(20, 5)).toBe('25');
    expect(grey(22, 7)).toBe('30');
    expect(grey(40, 15)).toBe('40');
    expect(grey(40, 18)).toBe('45');
    expect(grey(100, 52)).toBe('50');
  });
});

/** Brute-force check of what a reader can recompute from the published cells of one row. */
function feasibleValues(row: Row): Map<string, Set<number>> {
  const keys = ['levelUnknown', 'levelNextContact', 'levelBeforeNextDose', 'levelDanger'] as const;
  const cells = keys.map((key) => row[key]);
  const masked = keys.filter((key) => row[key] === '<5');
  const hasWithheld = cells.includes('withheld');
  const known = cells.reduce((sum, cell) => sum + (/^\d+$/.test(cell) ? Number(cell) : 0), 0);
  const [min, max] = {
    '11-20': [11, 20],
    '21-50': [21, 50],
    '51-100': [51, 100],
    '101+': [101, 100000],
  }[row.checks] as [number, number];
  const result = new Map<string, Set<number>>(masked.map((key) => [key, new Set<number>()]));
  const combinations = 5 ** masked.length;
  for (let n = 0; n < combinations; n += 1) {
    const values = new Map<string, number>();
    let rest = n;
    for (const key of masked) {
      values.set(key, rest % 5);
      rest = Math.floor(rest / 5);
    }
    const total = known + [...values.values()].reduce((a, b) => a + b, 0);
    if (hasWithheld ? total > max : total < min || total > max) continue;
    if (/^\d+$/.test(row.greyShare)) {
      const unknownCell = row.levelUnknown;
      if (unknownCell === 'withheld') continue;
      const unknown =
        unknownCell === '<5' ? (values.get('levelUnknown') ?? 0) : Number(unknownCell);
      if (Math.round((unknown * 100) / total / 5) * 5 !== Number(row.greyShare)) continue;
    }
    for (const [key, value] of values) result.get(key)?.add(value);
  }
  return result;
}

describe('no masked cell can be recomputed', () => {
  it('holds on every published row of many pseudo-random weeks', () => {
    let seed = 7;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const levels = ['unknown', 'next-contact', 'before-next-dose', 'danger'] as const;
    let maskedRows = 0;
    let withheldRows = 0;
    for (let round = 0; round < 400; round += 1) {
      const events = REGION_IDS.flatMap((region) => {
        const size = 8 + Math.floor(random() * 30);
        const skew = Math.floor(random() * 4);
        return Array.from({ length: size }, () => {
          const roll = random();
          const level =
            roll < 0.5
              ? (levels[skew] ?? 'unknown')
              : (levels[Math.floor(random() * 4)] ?? 'unknown');
          return makeEvent({ region, level });
        });
      });
      for (const row of aggregate(events, WEEK).rows) {
        if (row.status !== 'published') continue;
        const sets = feasibleValues(row);
        if (sets.size > 0) maskedRows += 1;
        if ([row.levelUnknown, row.levelDanger].includes('withheld')) withheldRows += 1;
        for (const [key, values] of sets) {
          expect(values.size, `${row.region} ${key} ${JSON.stringify(row)}`).toBe(5);
        }
      }
    }
    expect(maskedRows).toBeGreaterThan(50);
    expect(withheldRows).toBeGreaterThan(0);
  });

  const byLevel = (unknown: number, next: number, before: number, danger: number) => [
    ...makeEvents(unknown, { level: 'unknown' }),
    ...makeEvents(next, { level: 'next-contact' }),
    ...makeEvents(before, { level: 'before-next-dose' }),
    ...makeEvents(danger, { level: 'danger' }),
  ];

  it('does not let the band edge narrow a masked cell to 0 or 1 (rows 7,7,5,1)', () => {
    const row = rowOf(aggregate(byLevel(7, 7, 5, 1), WEEK), 'dakar');
    expect(row.levelDanger).toBe('<5');
    expect([row.levelUnknown, row.levelNextContact, row.levelBeforeNextDose]).toEqual([
      'withheld',
      'withheld',
      'withheld',
    ]);
    expect(row.greyShare).toBe('suppressed');
    for (const values of feasibleValues(row).values()) expect(values.size).toBe(5);
  });

  it('does not let the band edge narrow two masked cells to 3 or 4 (rows 8,6,4,3)', () => {
    const row = rowOf(aggregate(byLevel(8, 6, 4, 3), WEEK), 'dakar');
    expect(row.checks).toBe('21-50');
    expect(row.levelBeforeNextDose).toBe('<5');
    expect(row.levelDanger).toBe('<5');
    expect(row.levelUnknown).toBe('withheld');
    expect(row.levelNextContact).toBe('withheld');
    for (const values of feasibleValues(row).values()) expect(values.size).toBe(5);
  });

  it('publishes the exact level counts when every masked value stays feasible', () => {
    const row = rowOf(aggregate(byLevel(20, 20, 20, 3), WEEK), 'dakar');
    expect(row.levelDanger).toBe('<5');
    expect(row.levelUnknown).toBe('20');
    expect(row.greyShare).toBe('suppressed');
  });

  it('withholds the exact level cells when one masked cell would be determined', () => {
    // 20 checks in the band 11-20, two cells of 10: the two masked cells must be 0 and 0.
    const events = [
      ...makeEvents(10, { level: 'next-contact' }),
      ...makeEvents(10, { level: 'danger' }),
    ];
    const row = rowOf(aggregate(events, WEEK), 'dakar');
    expect(row.levelUnknown).toBe('<5');
    expect(row.levelBeforeNextDose).toBe('<5');
    expect(row.levelNextContact).toBe('withheld');
    expect(row.levelDanger).toBe('withheld');
    expect(row.greyShare).toBe('suppressed');
  });
});
