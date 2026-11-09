// SPDX-License-Identifier: MIT
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rangeFromMonths, UNKNOWN_TERM } from '@siapso/engine';
import type { Evaluation } from '@siapso/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { contextOf, loadCases, projectOf } from '../src/cases.js';
import type { ReferenceCase } from '../src/cases.js';
import { REPO_ROOT } from './helpers.js';

const LICENCE = '# SPDX-License-Identifier: CC-BY-4.0\n';

const GOOD = `${LICENCE}id: case-99-sample
title: "Sample"
context:
  pregnancy: { weeks: 30 }
  conditions: [uterine-scar]
  items:
    - { product: advil-400-mg-63646874, units-per-day: 3, long-term: true }
    - { plant: kinkeliba }
    - { unrecognised: "market tablet" }
  signs: [fever]
expect:
  level: danger
  findings:
    - { check: C1, rule: nsaid-pregnancy-from-20-weeks, message: nsaid-pregnancy-from-20-weeks, level: before-next-dose, evidence: A, items: [0] }
  reminders: []
  notes: []
`;

const temps: string[] = [];

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'siapso-cases-'));
  temps.push(root);
  await mkdir(path.join(root, 'eval', 'cases'), { recursive: true });
  await mkdir(path.join(root, 'eval', 'schema'), { recursive: true });
  const schema = path.join(REPO_ROOT, 'eval', 'schema', 'case.schema.json');
  await writeFile(path.join(root, 'eval', 'schema', 'case.schema.json'), await readFile(schema));
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(root, 'eval', 'cases', name), text);
  }
  return root;
}

afterEach(async () => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe('loadCases', () => {
  it('loads a valid case, in file name order, and ignores the README', async () => {
    const root = await rootWith({
      'case-99-sample.yaml': GOOD,
      'case-98-other.yaml': GOOD.replace('case-99-sample', 'case-98-other'),
      'README.md': '# Cases\n',
    });
    const { cases, problems } = await loadCases(root);
    expect(problems).toEqual([]);
    expect(cases.map((c) => c.id)).toEqual(['case-98-other', 'case-99-sample']);
    expect(cases[1]?.expect.findings[0]).toEqual({
      check: 'C1',
      rule: 'nsaid-pregnancy-from-20-weeks',
      message: 'nsaid-pregnancy-from-20-weeks',
      level: 'before-next-dose',
      evidence: 'A',
      items: [0],
    });
  });

  it('requires the message id of every finding, rule findings included', async () => {
    const root = await rootWith({
      'case-99-sample.yaml': GOOD.replace(' message: nsaid-pregnancy-from-20-weeks,', ''),
    });
    const { problems } = await loadCases(root);
    expect(problems).toEqual([
      expect.objectContaining({
        file: 'eval/cases/case-99-sample.yaml',
        path: 'expect.findings[0].message',
        message: 'missing required key "message"',
      }),
    ]);
  });

  it('reports a schema problem with its file and path', async () => {
    const root = await rootWith({
      'case-99-sample.yaml': GOOD.replace('level: danger', 'level: red'),
    });
    const { problems } = await loadCases(root);
    expect(problems).toEqual([
      expect.objectContaining({
        file: 'eval/cases/case-99-sample.yaml',
        path: 'expect.level',
      }),
    ]);
  });

  it('requires the licence line, an id equal to the file name, and a known condition', async () => {
    const root = await rootWith({
      'case-97-a.yaml': GOOD.replace(LICENCE, '').replace('case-99-sample', 'case-97-a'),
      'case-96-b.yaml': GOOD,
      'case-95-c.yaml': GOOD.replace('case-99-sample', 'case-95-c').replace(
        'uterine-scar',
        'not-a-condition',
      ),
    });
    const { problems } = await loadCases(root);
    const text = problems.map((p) => `${p.file}|${p.path}|${p.message}`).join('\n');
    expect(text).toMatch(/case-97-a\.yaml\|\|the first line must be/);
    expect(text).toMatch(/case-96-b\.yaml\|id\|must equal the file name/);
    expect(text).toMatch(/case-95-c\.yaml\|context\.conditions\[0\]\|unknown condition/);
  });

  it('reports unreadable YAML and a missing cases folder', async () => {
    const root = await rootWith({ 'case-99-sample.yaml': `${LICENCE}id: [\n` });
    const { problems } = await loadCases(root);
    expect(problems[0]?.message).toMatch(/YAML error/);
    const none = await mkdtemp(path.join(tmpdir(), 'siapso-cases-'));
    temps.push(none);
    await mkdir(path.join(none, 'eval', 'schema'), { recursive: true });
    await writeFile(
      path.join(none, 'eval', 'schema', 'case.schema.json'),
      await readFile(path.join(REPO_ROOT, 'eval', 'schema', 'case.schema.json')),
    );
    expect((await loadCases(none)).cases).toEqual([]);
  });

  it('rejects any other file in the cases folder', async () => {
    const root = await rootWith({ 'notes.txt': 'x' });
    const { problems } = await loadCases(root);
    expect(problems[0]?.message).toMatch(/unexpected file/);
  });

  it('accepts the three forms of the term and the item kinds in the schema only once', async () => {
    const both = GOOD.replace(
      '{ plant: kinkeliba }',
      '{ plant: kinkeliba, product: advil-400-mg-63646874 }',
    );
    const { problems } = await loadCases(await rootWith({ 'case-99-sample.yaml': both }));
    expect(problems.length).toBeGreaterThan(0);
    for (const term of ['{ months: 5 }', '{ unknown: true }']) {
      const ok = GOOD.replace('{ weeks: 30 }', term);
      expect((await loadCases(await rootWith({ 'case-99-sample.yaml': ok }))).problems).toEqual([]);
    }
    const bad = GOOD.replace('{ weeks: 30 }', '{ weeks: 30, months: 5 }');
    expect((await loadCases(await rootWith({ 'case-99-sample.yaml': bad }))).problems).not.toEqual(
      [],
    );
  });
});

describe('contextOf', () => {
  async function sample(change: (text: string) => string = (t) => t): Promise<ReferenceCase> {
    const { cases } = await loadCases(await rootWith({ 'case-99-sample.yaml': change(GOOD) }));
    const first = cases[0];
    if (!first) throw new Error('no case');
    return first;
  }

  it('converts weeks to an exact range and the items to checked items', async () => {
    expect(contextOf(await sample())).toStrictEqual({
      pregnancy: { weeksMin: 30, weeksMax: 30, precision: 'exact' },
      conditions: ['uterine-scar'],
      items: [
        {
          ref: { kind: 'product', id: 'advil-400-mg-63646874' },
          unitsPerDay: 3,
          longTerm: true,
        },
        { ref: { kind: 'plant', id: 'kinkeliba' } },
        { ref: { kind: 'unrecognised', text: 'market tablet' } },
      ],
      signs: ['fever'],
    });
  });

  it('converts months to an estimated range and unknown to the unknown term', async () => {
    const months = contextOf(await sample((t) => t.replace('{ weeks: 30 }', '{ months: 5 }')));
    expect(months.pregnancy).toStrictEqual({ ...rangeFromMonths(5), precision: 'estimated' });
    const unknown = contextOf(await sample((t) => t.replace('{ weeks: 30 }', '{ unknown: true }')));
    expect(unknown.pregnancy).toStrictEqual({ ...UNKNOWN_TERM, precision: 'unknown' });
  });

  it('leaves the pregnancy out when absent and maps the breastfeeding keys', async () => {
    const none = contextOf(
      await sample((t) =>
        t.replace(
          '  pregnancy: { weeks: 30 }\n',
          '  breastfeeding: { baby-age-weeks: 1, premature: false }\n',
        ),
      ),
    );
    expect(none).not.toHaveProperty('pregnancy');
    expect(none.breastfeeding).toStrictEqual({ babyAgeWeeks: 1, premature: false });
    const bare = contextOf(
      await sample((t) => t.replace('  pregnancy: { weeks: 30 }\n', '  breastfeeding: {}\n')),
    );
    expect(bare.breastfeeding).toStrictEqual({});
    const defaulted = contextOf(
      await sample((t) =>
        t
          .replace('  pregnancy: { weeks: 30 }\n', '')
          .replace('  conditions: [uterine-scar]\n', '')
          .replace('  signs: [fever]\n', ''),
      ),
    );
    expect(defaulted.conditions).toEqual([]);
    expect(defaulted.signs).toEqual([]);
  });

  it('maps strength-unknown, the box whose strength is not known', async () => {
    const unknown = contextOf(
      await sample((t) =>
        t.replace('units-per-day: 3, long-term: true', 'units-per-day: 3, strength-unknown: true'),
      ),
    );
    expect(unknown.items[0]).toStrictEqual({
      ref: { kind: 'product', id: 'advil-400-mg-63646874' },
      unitsPerDay: 3,
      strengthUnknown: true,
    });
  });

  it('maps strength-at-most-mg, a dose answered by a range ("100 mg ou moins")', async () => {
    const bounded = contextOf(
      await sample((t) =>
        t.replace('units-per-day: 3, long-term: true', 'strength-at-most-mg: 100'),
      ),
    );
    expect(bounded.items[0]).toStrictEqual({
      ref: { kind: 'product', id: 'advil-400-mg-63646874' },
      strengthAtMostMg: 100,
    });
  });
});

describe('projectOf', () => {
  it('keeps the compared fields only, the message id always, and drops absent ones', () => {
    const evaluation = {
      level: 'danger',
      findings: [
        {
          level: 'danger',
          check: 'C11',
          items: [],
          message: 'danger-sign-fever',
          sign: 'fever',
          capped: false,
          sources: [],
        },
        {
          level: 'before-next-dose',
          check: 'C1',
          ruleId: 'r',
          evidence: 'A',
          items: [0],
          message: 'm',
          term: 'unknown',
          windowStart: 20,
          capped: false,
          sources: [],
        },
      ],
      reminders: [{ ruleId: 'iptp-reminder', message: 'iptp-reminder', sources: [] }],
      notes: [{ kind: 'dose', ruleId: 'n', message: 'n', sources: [] }],
      pack: { version: '0', date: '2026-01-01', clinicallyValidated: false },
    } satisfies Evaluation;
    expect(projectOf(evaluation as Evaluation)).toStrictEqual({
      level: 'danger',
      findings: [
        { check: 'C11', message: 'danger-sign-fever', level: 'danger', items: [], sign: 'fever' },
        {
          check: 'C1',
          rule: 'r',
          message: 'm',
          level: 'before-next-dose',
          evidence: 'A',
          items: [0],
          term: 'unknown',
          'window-start': 20,
        },
      ],
      reminders: ['iptp-reminder'],
      notes: ['n'],
    });
  });
});
