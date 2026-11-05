// SPDX-License-Identifier: MIT
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import {
  aggregateMonth,
  earliestMonthRelease,
  EventError,
  isAllowedDhis2OutDir,
  isMonth,
  monthOfWeek,
  parseDistricts,
  parseEvents,
  parseMapping,
  renderDhis2,
  toDataValueSets,
  type Districts,
  type Mapping,
  type MonthCell,
} from '../src/index.js';
import { makeEvent, makeEvents, REPO_ROOT } from './helpers.js';

const MONTH = '2026-11';
const FIXTURES = path.join(REPO_ROOT, 'open-data/test-data/dhis2');

async function fixtures(): Promise<{ districts: Districts; mapping: Mapping }> {
  const districts = parseDistricts(
    await readFile(path.join(FIXTURES, 'districts.fixture.yaml'), 'utf8'),
  );
  const mapping = parseMapping(
    await readFile(path.join(FIXTURES, 'mapping.fixture.yaml'), 'utf8'),
    districts,
  );
  return { districts, mapping };
}

function cellOf(cells: MonthCell[], district: string): MonthCell {
  const cell = cells.find((candidate) => candidate.district === district);
  if (cell === undefined) throw new Error(`no cell for ${district}`);
  return cell;
}

const A = (count: number, extra = {}) =>
  makeEvents(count, { district: 'test-district-a', ...extra });

describe('months and periods', () => {
  it('puts an ISO week in the month of its Thursday', () => {
    expect(monthOfWeek('2026-W45')).toBe('2026-11');
    expect(monthOfWeek('2026-W44')).toBe('2026-10');
    expect(monthOfWeek('2026-W27')).toBe('2026-07');
    expect(monthOfWeek('2026-W26')).toBe('2026-06');
    expect(monthOfWeek('2026-W01')).toBe('2026-01');
    expect(monthOfWeek('2026-W53')).toBe('2026-12');
  });

  it('accepts only real months', () => {
    expect(isMonth('2026-11')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('2026-00')).toBe(false);
    expect(isMonth('202611')).toBe(false);
    expect(isMonth('2026-1')).toBe(false);
  });

  it('allows release 28 days after the month ends', () => {
    expect(earliestMonthRelease('2026-11')).toBe('2026-12-28');
    expect(earliestMonthRelease('2026-02')).toBe('2026-03-28');
  });

  it('writes the period as YYYYMM', async () => {
    const { districts, mapping } = await fixtures();
    const cells = aggregateMonth(A(40), MONTH, districts).cells;
    const set = toDataValueSets(cells, MONTH, mapping);
    expect(set.dataValues.length).toBeGreaterThan(0);
    for (const value of set.dataValues) expect(value.period).toBe('202611');
  });
});

describe('district list', () => {
  it('refuses an empty list (the example file)', async () => {
    const text = await readFile(
      path.join(REPO_ROOT, 'open-data/dhis2/districts.example.yaml'),
      'utf8',
    );
    expect(() => parseDistricts(text)).toThrow(/no district/i);
  });

  it('refuses duplicates, bad ids and unknown regions', () => {
    const entry = (id: string, region: string) => `  - id: ${id}\n    region: ${region}\n`;
    expect(() =>
      parseDistricts(`districts:\n${entry('a-1', 'dakar')}${entry('a-1', 'dakar')}`),
    ).toThrow(/twice/);
    expect(() => parseDistricts(`districts:\n${entry('Bad Id', 'dakar')}`)).toThrow(/id/);
    expect(() => parseDistricts(`districts:\n${entry('a-1', 'atlantis')}`)).toThrow(/region/);
  });

  it('refuses an event whose district is not in the list', async () => {
    const { districts } = await fixtures();
    const events = [...A(12), makeEvent({ district: 'not-in-list' })];
    expect(() => aggregateMonth(events, MONTH, districts)).toThrow(
      /district not-in-list is not in the district list.*districts\.yaml.*event source/s,
    );
  });

  it('refuses an event whose region differs from the region of its district', async () => {
    const { districts } = await fixtures();
    const events = [makeEvent({ district: 'test-district-c', region: 'dakar' })];
    expect(() => aggregateMonth(events, MONTH, districts)).toThrow(/region/);
  });

  it('accepts the district field in the event schema and refuses a malformed one', () => {
    const line = JSON.stringify(
      makeEvent({ district: 'test-district-a', iptpReminderShown: true }),
    );
    expect(parseEvents(line)).toHaveLength(1);
    const bad = JSON.stringify(makeEvent({ district: 'Test District' }));
    expect(() => parseEvents(bad)).toThrow(EventError);
  });
});

describe('mapping file', () => {
  it('refuses the committed example while placeholders remain', async () => {
    const { districts } = await fixtures();
    const text = await readFile(
      path.join(REPO_ROOT, 'open-data/dhis2/mapping.example.yaml'),
      'utf8',
    );
    expect(() => parseMapping(text, districts)).toThrow(/to be provided by the district/);
  });

  it('refuses one remaining placeholder', async () => {
    const { districts } = await fixtures();
    const text = (await readFile(path.join(FIXTURES, 'mapping.fixture.yaml'), 'utf8')).replace(
      'FAKEouDisC1',
      '<to be provided by the district>',
    );
    expect(() => parseMapping(text, districts)).toThrow(/to be provided by the district/);
  });

  it('refuses identifiers that are not 11 characters, a missing district and a missing element', async () => {
    const { districts } = await fixtures();
    const text = await readFile(path.join(FIXTURES, 'mapping.fixture.yaml'), 'utf8');
    expect(() => parseMapping(text.replace('FAKEouDisC1', 'short'), districts)).toThrow(
      /identifier/,
    );
    expect(() => parseMapping(text.replace(/ {2}test-district-c: .*\n/, ''), districts)).toThrow(
      /test-district-c/,
    );
    expect(() =>
      parseMapping(text.replace(/ {2}checks:\n {4}dataElement: .*\n/, ''), districts),
    ).toThrow(/checks/);
  });

  it('accepts the fixture and keeps the optional category option combination', async () => {
    const { mapping } = await fixtures();
    expect(mapping.dataElements.level_unknown.categoryOptionCombo).toBe('FAKEcocDf01');
  });
});

describe('cell threshold', () => {
  it('exports nothing for a cell with 10 checks and something for 11', async () => {
    const { districts } = await fixtures();
    const ten = aggregateMonth(A(10), MONTH, districts).cells;
    expect(cellOf(ten, 'test-district-a').status).toBe('suppressed');
    const eleven = aggregateMonth(A(11), MONTH, districts).cells;
    expect(cellOf(eleven, 'test-district-a').status).toBe('exported');
  });

  it('counts events of all the weeks of the month, not of other months', async () => {
    const { districts } = await fixtures();
    const events = [
      ...A(6, { week: '2026-W45' }),
      ...A(6, { week: '2026-W48' }),
      ...A(40, { week: '2026-W44' }),
    ];
    const result = aggregateMonth(events, MONTH, districts);
    expect(cellOf(result.cells, 'test-district-a').values.level_next_contact).toBe(12);
    expect(result.dropped).toBe(40);
  });

  it('drops events without a district and counts them', async () => {
    const { districts } = await fixtures();
    const result = aggregateMonth([...A(11), ...makeEvents(30)], MONTH, districts);
    expect(result.withoutDistrict).toBe(30);
    expect(cellOf(result.cells, 'test-district-a').values.level_next_contact).toBe(11);
  });

  it('exports no value at all for a suppressed cell', async () => {
    const { districts, mapping } = await fixtures();
    const cells = aggregateMonth(A(10, { level: 'danger' }), MONTH, districts).cells;
    expect(toDataValueSets(cells, MONTH, mapping).dataValues).toEqual([]);
  });
});

describe('masked values are omitted', () => {
  it('omits a level below 5 and the number of checks when a level is masked', async () => {
    const { districts, mapping } = await fixtures();
    const events = [...A(30, { level: 'next-contact' }), ...A(3, { level: 'danger' })];
    const cells = aggregateMonth(events, MONTH, districts).cells;
    const values = cellOf(cells, 'test-district-a').values;
    expect(values.level_danger).toBeUndefined();
    expect(values.checks).toBeUndefined();
    const set = toDataValueSets(cells, MONTH, mapping);
    const ids = set.dataValues.map((value) => value.dataElement);
    expect(ids).not.toContain('FAKEdeLvD01');
    expect(ids).not.toContain('FAKEdeChk01');
    expect(ids).toContain('FAKEdeLvN01');
  });

  it('exports every value as a finite non-negative integer, never text', async () => {
    const { districts, mapping } = await fixtures();
    const events = [
      ...A(30, { level: 'next-contact' }),
      ...A(8, { level: 'danger', iptpReminderShown: true }),
    ];
    const set = toDataValueSets(aggregateMonth(events, MONTH, districts).cells, MONTH, mapping);
    for (const value of set.dataValues) {
      expect(typeof value.value).toBe('number');
      expect(Number.isInteger(value.value)).toBe(true);
      expect(value.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('omits an IPTp count below 5 and exports one of 5 or more', async () => {
    const { districts } = await fixtures();
    const few = aggregateMonth([...A(20), ...A(4, { iptpReminderShown: true })], MONTH, districts);
    expect(cellOf(few.cells, 'test-district-a').values.iptp_reminders_shown).toBeUndefined();
    const many = aggregateMonth([...A(20), ...A(5, { iptpReminderShown: true })], MONTH, districts);
    expect(cellOf(many.cells, 'test-district-a').values.iptp_reminders_shown).toBe(5);
  });

  it('exports the number of checks when no level is masked', async () => {
    const { districts, mapping } = await fixtures();
    const events = [
      ...A(6, { level: 'unknown' }),
      ...A(20, { level: 'next-contact' }),
      ...A(7, { level: 'before-next-dose' }),
      ...A(6, { level: 'danger' }),
    ];
    const cells = aggregateMonth(events, MONTH, districts).cells;
    expect(cellOf(cells, 'test-district-a').values.checks).toBe(39);
    const set = toDataValueSets(cells, MONTH, mapping);
    expect(set.dataValues.find((v) => v.dataElement === 'FAKEdeChk01')?.value).toBe(39);
    expect(set.dataValues.find((v) => v.dataElement === 'FAKEdeLvU01')?.categoryOptionCombo).toBe(
      'FAKEcocDf01',
    );
  });
});

describe('no omitted value can be recomputed from the exported ones', () => {
  const LEVELS = ['unknown', 'next-contact', 'before-next-dose', 'danger'] as const;

  /** Deterministic pseudo-random counts so the property test needs no clock. */
  function counts(seed: number): number[] {
    let state = seed >>> 0;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const pick = () => {
      const r = next();
      return r < 0.45 ? Math.floor(next() * 5) : 5 + Math.floor(next() * 40);
    };
    return LEVELS.map(pick);
  }

  it('keeps every value 0 to 4 possible for each omitted level, over many random cells', async () => {
    const { districts } = await fixtures();
    for (let seed = 1; seed <= 300; seed += 1) {
      const per = counts(seed);
      const total = per.reduce((a, b) => a + b, 0);
      if (total < 11) continue;
      const events = LEVELS.flatMap((level, i) => A(per[i] ?? 0, { level }));
      const cell = cellOf(aggregateMonth(events, MONTH, districts).cells, 'test-district-a');
      const keys = [
        'level_unknown',
        'level_next_contact',
        'level_before_next_dose',
        'level_danger',
      ] as const;
      const exported = keys.map((key) => cell.values[key]);
      const omittedTrue = keys.map((_, i) => ((per[i] ?? 0) < 5 ? i : -1)).filter((i) => i >= 0);
      if (omittedTrue.length === 0) continue;
      const known = exported.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      const hasWithheld = exported.some((v, i) => v === undefined && (per[i] ?? 0) >= 5);
      const totalExported = cell.values.checks;
      for (const index of omittedTrue) {
        // Enumerate every assignment of the other omitted cells (0..4) and check
        // that each value 0..4 of this cell stays consistent with what is exported.
        const feasible = new Set<number>();
        const others = omittedTrue.filter((i) => i !== index);
        const walk = (position: number, sum: number): void => {
          if (position === others.length) {
            for (let value = 0; value < 5; value += 1) {
              const all = known + sum + value;
              const ok =
                totalExported !== undefined
                  ? all === totalExported
                  : hasWithheld
                    ? true
                    : all >= 11;
              if (ok) feasible.add(value);
            }
            return;
          }
          for (let v = 0; v < 5; v += 1) walk(position + 1, sum + v);
        };
        walk(0, 0);
        expect([...feasible].sort(), `seed ${String(seed)}`).toEqual([0, 1, 2, 3, 4]);
      }
    }
  });
});

describe('deterministic and immutable output', () => {
  it('renders the same text for the same events in any order', async () => {
    const { districts, mapping } = await fixtures();
    const events = [
      ...A(30, { level: 'danger' }),
      ...makeEvents(25, { district: 'test-district-b', level: 'next-contact' }),
      ...makeEvents(14, { district: 'test-district-c', region: 'thies', iptpReminderShown: true }),
    ];
    const first = renderDhis2(
      toDataValueSets(aggregateMonth(events, MONTH, districts).cells, MONTH, mapping),
    );
    const second = renderDhis2(
      toDataValueSets(
        aggregateMonth([...events].reverse(), MONTH, districts).cells,
        MONTH,
        mapping,
      ),
    );
    expect(second).toBe(first);
    expect(first.endsWith('\n')).toBe(true);
    expect(first).not.toContain('\r');
    expect(Object.keys(JSON.parse(first) as object)).toEqual(['dataValues']);
  });

  it('carries no field outside the DHIS2 data value', async () => {
    const { districts, mapping } = await fixtures();
    const set = toDataValueSets(aggregateMonth(A(30), MONTH, districts).cells, MONTH, mapping);
    for (const value of set.dataValues) {
      expect(
        Object.keys(value).every((k) =>
          ['dataElement', 'period', 'orgUnit', 'categoryOptionCombo', 'value'].includes(k),
        ),
      ).toBe(true);
    }
  });
});

describe('command line', () => {
  const temporary: string[] = [];
  afterEach(async () => {
    await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'siapso-dhis2-'));
    temporary.push(dir);
    const lines = [...A(30, { level: 'next-contact' }), ...A(8, { level: 'danger' })].map((e) =>
      JSON.stringify(e),
    );
    await writeFile(path.join(dir, 'events.jsonl'), `${lines.join('\n')}\n`, 'utf8');
    return dir;
  }

  async function run(args: string[], cwd: string) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(args, { cwd, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { code, out, err };
  }

  const base = (mapping = path.join(FIXTURES, 'mapping.fixture.yaml')) => [
    'dhis2',
    '--input',
    'events.jsonl',
    '--month',
    MONTH,
    '--release',
    'r1',
    '--release-date',
    '2026-12-28',
    '--districts',
    path.join(FIXTURES, 'districts.fixture.yaml'),
    '--mapping',
    mapping,
    '--out-dir',
    'out',
    '--test',
  ];

  it('writes <YYYYMM>-<release>-test.json once', async () => {
    const dir = await setup();
    const first = await run(base(), dir);
    expect(first.err).toEqual([]);
    expect(first.code).toBe(0);
    expect(await readdir(path.join(dir, 'out'))).toEqual([
      '202611-r1-restricted-test.json',
      '202611-r1-restricted-test.notice.txt',
    ]);
  });

  it('refuses a second file for the same month, even with another release id', async () => {
    const dir = await setup();
    await run(base(), dir);
    const again = base();
    again[again.indexOf('r1')] = 'r2';
    const second = await run(again, dir);
    expect(second.code).toBe(1);
    expect(second.err.join('\n')).toMatch(/already exported/);
    expect(await readdir(path.join(dir, 'out'))).toEqual([
      '202611-r1-restricted-test.json',
      '202611-r1-restricted-test.notice.txt',
    ]);
  });

  it('writes a sidecar notice and keeps the data file valid for import', async () => {
    const dir = await setup();
    await run(base(), dir);
    const data = await readFile(path.join(dir, 'out', '202611-r1-restricted-test.json'), 'utf8');
    expect(Object.keys(JSON.parse(data) as object)).toEqual(['dataValues']);
    const names = await readdir(path.join(dir, 'out'));
    expect(names).toEqual([
      '202611-r1-restricted-test.json',
      '202611-r1-restricted-test.notice.txt',
    ]);
    const notice = await readFile(path.join(dir, 'out', names[1] ?? ''), 'utf8');
    expect(notice).toContain('not for publication; for the district DHIS2 instance only');
  });

  it.each([
    'open-data/published',
    'open-data/published/sub',
    'open-data/test-data',
    'open-data/dhis2',
    'open-data',
  ])('refuses to write inside the committed folder %s', async (folder) => {
    const dir = await setup();
    const args = base();
    args[args.indexOf('out')] = path.join(REPO_ROOT, folder);
    const result = await run(args, dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/restricted/);
  });

  it('refuses an output path that has a published segment', async () => {
    const dir = await setup();
    const args = base();
    args[args.indexOf('out')] = path.join(dir, 'published');
    const result = await run(args, dir);
    expect(result.code).toBe(1);
  });

  it('accepts only the ignored folder open-data/dhis2/out inside open-data', () => {
    expect(isAllowedDhis2OutDir(path.join(REPO_ROOT, 'open-data/dhis2/out'))).toBe(true);
    expect(isAllowedDhis2OutDir(path.join(REPO_ROOT, 'open-data/dhis2/out/x'))).toBe(true);
    expect(isAllowedDhis2OutDir(path.join(REPO_ROOT, 'open-data/dhis2/outside'))).toBe(false);
  });

  it('refuses before the lag has passed', async () => {
    const dir = await setup();
    const args = base();
    args[args.indexOf('2026-12-28')] = '2026-12-27';
    const result = await run(args, dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/2026-12-28/);
    await expect(readdir(path.join(dir, 'out'))).rejects.toThrow();
  });

  it('refuses to run with the placeholder mapping and writes nothing', async () => {
    const dir = await setup();
    const result = await run(
      base(path.join(REPO_ROOT, 'open-data/dhis2/mapping.example.yaml')),
      dir,
    );
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/to be provided by the district/);
    await expect(readdir(path.join(dir, 'out'))).rejects.toThrow();
  });
});
