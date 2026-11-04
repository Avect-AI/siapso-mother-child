// SPDX-License-Identifier: MIT
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, entriesFromPack } from '@siapso/resolver';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  expectedList,
  failures,
  main,
  measureP95,
  parseBaseline,
  parseQueries,
  percentile95,
  QUERY_TYPES,
} from '../src/eval-resolver.js';
import { buildPack } from '../src/build.js';
import { loadContent } from '../src/load.js';
import { REPO_ROOT, tempCopy } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const QUERIES_FILE = path.join(ROOT, 'eval', 'resolver', 'queries.yaml');

describe('parseQueries', () => {
  it('reads one expected answer or a list of them', () => {
    const queries = parseQueries(
      [
        '- { query: doliprane, type: brand, expect: { kind: product, id: a } }',
        '- { query: bactrim, type: brand, expect: [{ kind: product, id: a }, { kind: product, id: b }] }',
      ].join('\n'),
    );
    expect(queries.map((item) => expectedList(item).length)).toEqual([1, 2]);
  });

  it('rejects a malformed file with a readable message', () => {
    expect(() => parseQueries('a: 1')).toThrow('must be a list');
    expect(() => parseQueries('- { type: brand, expect: { kind: plant, id: a } }')).toThrow(
      '"query"',
    );
    expect(() =>
      parseQueries('- { query: x, type: other, expect: { kind: plant, id: a } }'),
    ).toThrow('"type"');
    expect(() => parseQueries('- { query: x, type: brand }')).toThrow('"expect"');
    expect(() => parseQueries('- { query: x, type: brand, expect: [] }')).toThrow('"expect"');
  });

  it('reads expect none for a noise query, and only for one', () => {
    const [noise] = parseQueries('- { query: sirop, type: noise, expect: none }');
    expect(noise?.expect).toBe('none');
    expect(noise && expectedList(noise)).toEqual([]);
    expect(() => parseQueries('- { query: sirop, type: brand, expect: none }')).toThrow(
      '"expect: none"',
    );
    expect(() =>
      parseQueries('- { query: sirop, type: noise, expect: { kind: plant, id: a } }'),
    ).toThrow('"expect: none"');
    expect(() => parseQueries('- { query: sirop, type: noise, expect: nothing }')).toThrow(
      '"expect: none"',
    );
    expect(() => parseQueries('- { query: x, type: brand, expect: nothing }')).toThrow('"expect"');
  });
});

describe('refusing input that would hide a failure', () => {
  it('rejects a query file that holds no query', () => {
    expect(() => parseQueries('[]')).toThrow('no query');
    expect(() => parseQueries('# SPDX-License-Identifier: CC-BY-4.0\n')).toThrow('must be a list');
  });

  it('rejects a baseline with a missing or non-numeric key', () => {
    expect(parseBaseline('{ "top3": 0.98, "p95Ms": 12 }')).toEqual({ top3: 0.98, p95Ms: 12 });
    for (const [text, key] of [
      ['{ "p95Ms": 12 }', 'top3'],
      ['{ "top3": "0.98", "p95Ms": 12 }', 'top3'],
      ['{ "top3": 0.98 }', 'p95Ms'],
      ['{ "top3": 0.98, "p95Ms": null }', 'p95Ms'],
      ['{ "top3": 1.5, "p95Ms": 12 }', 'top3'],
      ['{ "top3": 0.98, "p95Ms": 0 }', 'p95Ms'],
    ] as const) {
      expect(() => parseBaseline(text), text).toThrow(`"${key}"`);
    }
    expect(() => parseBaseline('not json')).toThrow('baseline.json');
    expect(() => parseBaseline('[0.98, 12]')).toThrow('baseline.json');
  });

  it('fails a metric that is not a number', () => {
    const baseline = { top3: 0.9, p95Ms: 12 };
    expect(failures(0.95, 1, baseline)).toEqual([]);
    expect(failures(Number.NaN, 1, baseline)).toEqual(['top-3 accuracy is not a number (NaN)']);
    expect(failures(0.95, Number.NaN, baseline)).toEqual(['p95 latency is not a number (NaN)']);
    expect(failures(0.5, 20, baseline)).toHaveLength(2);
  });
});

describe('main', () => {
  const LICENCE = '# SPDX-License-Identifier: CC-BY-4.0\n';

  async function runWith(
    queries: string,
    baseline: string,
  ): Promise<{ code: number; text: string }> {
    const copy = await tempCopy();
    try {
      await mkdir(path.join(copy.root, 'eval', 'resolver'), { recursive: true });
      await writeFile(path.join(copy.root, 'eval', 'resolver', 'queries.yaml'), queries);
      await writeFile(path.join(copy.root, 'eval', 'resolver', 'baseline.json'), baseline);
      const lines: string[] = [];
      const code = await main(copy.root, (line) => lines.push(line), REPO_ROOT);
      return { code, text: lines.join('\n') };
    } finally {
      await copy.remove();
    }
  }

  const ONE_QUERY = `${LICENCE}- { query: nebeday, type: local-wo, expect: { kind: plant, id: moringa } }\n`;

  it('exits 0 when the bars are met', async () => {
    const { code, text } = await runWith(ONE_QUERY, '{ "top3": 0.9, "p95Ms": 1000 }');
    expect(text).toMatch(/overall\s+1\s+1\.000\s+1\.000/);
    expect(code).toBe(0);
  });

  it('exits 1 on an empty query file', async () => {
    for (const queries of [LICENCE, `${LICENCE}[]\n`]) {
      const { code, text } = await runWith(queries, '{ "top3": 0.9, "p95Ms": 1000 }');
      expect(code, queries).toBe(1);
      expect(text).toMatch(/FAIL/);
    }
  });

  it('exits 1 on a missing or non-numeric baseline key', async () => {
    for (const baseline of ['{ "p95Ms": 1000 }', '{ "top3": "high", "p95Ms": 1000 }', '{}']) {
      const { code, text } = await runWith(ONE_QUERY, baseline);
      expect(code, baseline).toBe(1);
      expect(text).toMatch(/FAIL: .*baseline/);
    }
  });

  it('exits 1 when a bar is not met', async () => {
    const miss = `${LICENCE}- { query: nebeday, type: local-wo, expect: { kind: plant, id: other } }\n`;
    const { code, text } = await runWith(miss, '{ "top3": 0.9, "p95Ms": 1000 }');
    expect(code).toBe(1);
    expect(text).toMatch(/FAIL: top-3 accuracy 0\.000 is below the baseline 0\.9/);
  });
});

describe('percentile95', () => {
  it('uses the nearest rank', () => {
    expect(percentile95([])).toBe(0);
    expect(percentile95([5])).toBe(5);
    const values = Array.from({ length: 100 }, (_, number) => number + 1);
    expect(percentile95(values.reverse())).toBe(95);
  });
});

describe('evaluate', () => {
  const index = buildIndex([
    {
      id: 'moringa',
      family: 'moringa',
      kind: 'plant',
      display: { fr: 'Moringa', en: 'Moringa' },
      names: [{ text: 'nebeday', lang: 'wo' }],
      priority: 2,
      detail: '',
    },
  ]);

  it('counts top-1 and top-3 hits per type and lists the misses', () => {
    const report = evaluate(
      index,
      parseQueries(
        [
          '- { query: nebeday, type: local-wo, expect: { kind: plant, id: moringa } }',
          '- { query: nebedai, type: misspelling, expect: { kind: plant, id: moringa } }',
          '- { query: nebeday, type: local-wo, expect: { kind: plant, id: other } }',
        ].join('\n'),
      ),
    );
    expect(report.overall).toEqual({ count: 3, top1: 2, top3: 2 });
    expect(report.perType['local-wo']).toEqual({ count: 2, top1: 1, top3: 1 });
    expect(report.misses).toEqual([{ query: 'nebeday', type: 'local-wo', got: ['moringa'] }]);
  });

  it('counts a noise query as a hit only when there is no candidate', () => {
    const report = evaluate(
      index,
      parseQueries(
        [
          '- { query: sirop, type: noise, expect: none }',
          '- { query: nebeday, type: noise, expect: none }',
        ].join('\n'),
      ),
    );
    expect(report.perType.noise).toEqual({ count: 2, top1: 1, top3: 1 });
    expect(report.misses).toEqual([{ query: 'nebeday', type: 'noise', got: ['moringa'] }]);
  });

  it('measures a latency', () => {
    const queries = parseQueries(
      '- { query: nebeday, type: local-wo, expect: { kind: plant, id: moringa } }',
    );
    expect(measureP95(index, queries)).toBeGreaterThanOrEqual(0);
  });
});

describe('the committed evaluation set', () => {
  it('has at least 100 queries covering the types and the required ones', async () => {
    const queries = parseQueries(await readFile(QUERIES_FILE, 'utf8'));
    expect(queries.length).toBeGreaterThanOrEqual(100);
    for (const type of QUERY_TYPES) {
      const least = type === 'noise' ? 2 : 10;
      expect(queries.filter((item) => item.type === type).length, type).toBeGreaterThanOrEqual(
        least,
      );
    }
    const texts = queries.map((item) => item.query);
    for (const required of [
      'nebeday',
      'doliprane',
      'doliprann',
      'ibuprofene',
      'kinkeliba',
      'kinkéliba',
      'huile de ricin',
      'bactrim',
      'asaq',
      'neo codion',
      'comprimé blanc',
      'sirop',
      'coartem',
      'fansidar',
      'cotrim',
    ]) {
      expect(texts).toContain(required);
    }
  });

  it('expects only products and plants that exist in the registry', async () => {
    const pack = buildPack(await loadContent(ROOT, ROOT));
    const products = new Set(pack.products.map((product) => product.id));
    const plants = new Set(pack.plants.map((plant) => plant.id));
    const queries = parseQueries(await readFile(QUERIES_FILE, 'utf8'));
    for (const item of queries) {
      for (const expected of expectedList(item)) {
        const known = expected.kind === 'product' ? products : plants;
        expect(known.has(expected.id), `${item.query}: ${expected.id}`).toBe(true);
      }
    }
  });

  it('reaches the recorded top-3 accuracy (latency is checked by pnpm eval:resolver)', async () => {
    const pack = buildPack(await loadContent(ROOT, ROOT));
    const index = buildIndex(entriesFromPack(pack));
    const queries = parseQueries(await readFile(QUERIES_FILE, 'utf8'));
    const baseline = JSON.parse(
      await readFile(path.join(ROOT, 'eval', 'resolver', 'baseline.json'), 'utf8'),
    ) as { top3: number };
    expect(baseline.top3).toBeGreaterThanOrEqual(0.9);
    const report = evaluate(index, queries);
    expect(report.overall.top3 / report.overall.count).toBeGreaterThanOrEqual(baseline.top3);
  });
});
