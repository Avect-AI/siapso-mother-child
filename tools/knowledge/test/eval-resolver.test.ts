// SPDX-License-Identifier: MIT
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, entriesFromPack } from '@siapso/resolver';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  expectedList,
  measureP95,
  parseQueries,
  percentile95,
  QUERY_TYPES,
} from '../src/eval-resolver.js';
import { buildPack } from '../src/build.js';
import { loadContent } from '../src/load.js';

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

  it('measures a latency', () => {
    const queries = parseQueries(
      '- { query: nebeday, type: local-wo, expect: { kind: plant, id: moringa } }',
    );
    expect(measureP95(index, queries)).toBeGreaterThanOrEqual(0);
  });
});

describe('the committed evaluation set', () => {
  it('has at least 100 queries covering the six types and the required ones', async () => {
    const queries = parseQueries(await readFile(QUERIES_FILE, 'utf8'));
    expect(queries.length).toBeGreaterThanOrEqual(100);
    for (const type of QUERY_TYPES) {
      expect(queries.filter((item) => item.type === type).length).toBeGreaterThanOrEqual(10);
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
