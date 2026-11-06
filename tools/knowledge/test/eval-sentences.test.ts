// SPDX-License-Identifier: MIT
// The evaluation of the products found inside a sentence (SCRUM-61):
// eval/speech/sentences.yaml, read by `pnpm eval:sentences`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, entriesFromPack } from '@siapso/resolver';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/build.js';
import {
  alternativesOf,
  evaluateSentences,
  failures,
  main,
  parseSentenceBaseline,
  parseSentences,
  SENTENCE_LANGS,
} from '../src/eval-sentences.js';
import { loadContent } from '../src/load.js';
import { REPO_ROOT, tempCopy } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTENCES_FILE = path.join(ROOT, 'eval', 'speech', 'sentences.yaml');

describe('parseSentences', () => {
  it('reads one product, alternatives, a strength and no product', () => {
    const sentences = parseSentences(
      [
        '- { text: dama naan nebeday, lang: wo, type: plain, expect: [{ kind: plant, id: moringa }] }',
        '- text: doliprane 1000 ak nivaquine',
        '  lang: mix',
        '  type: plain',
        '  expect:',
        '    - { kind: product, id: a, mg: 1000 }',
        '    - { any: [{ kind: product, id: b }, { kind: product, id: c }] }',
        '- { text: ceeb ak jën, lang: wo, type: none, expect: [] }',
      ].join('\n'),
    );
    expect(sentences.map((item) => item.expect.length)).toEqual([1, 2, 0]);
    expect(sentences[1]?.expect.map(alternativesOf)).toEqual([
      [{ kind: 'product', id: 'a' }],
      [
        { kind: 'product', id: 'b' },
        { kind: 'product', id: 'c' },
      ],
    ]);
  });

  it('rejects a malformed file with a readable message', () => {
    expect(() => parseSentences('a: 1')).toThrow('must be a list');
    expect(() => parseSentences('[]')).toThrow('no sentence');
    expect(() => parseSentences('- { lang: fr, type: none, expect: [] }')).toThrow('"text"');
    expect(() => parseSentences('- { text: x, lang: es, type: none, expect: [] }')).toThrow(
      '"lang"',
    );
    expect(() => parseSentences('- { text: x, lang: fr, type: other, expect: [] }')).toThrow(
      '"type"',
    );
    expect(() => parseSentences('- { text: x, lang: fr, type: plain }')).toThrow('"expect"');
    expect(() =>
      parseSentences('- { text: x, lang: fr, type: plain, expect: [{ kind: plant }] }'),
    ).toThrow('"expect"');
  });

  it('expects no product for a sentence of type none, and only for one', () => {
    expect(() => parseSentences('- { text: x, lang: fr, type: plain, expect: [] }')).toThrow(
      '"type: none"',
    );
    expect(() =>
      parseSentences('- { text: x, lang: fr, type: none, expect: [{ kind: plant, id: moringa }] }'),
    ).toThrow('"type: none"');
  });
});

describe('parseSentenceBaseline', () => {
  it('reads the bars, and rejects a missing or non-numeric one', () => {
    expect(
      parseSentenceBaseline(
        '{ "precision": 0.95, "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0 }',
      ),
    ).toEqual({
      precision: 0.95,
      recall: 0.85,
      backgroundFalseProducts: 0,
      backgroundCheckOffers: 0,
    });
    for (const [text, key] of [
      [
        '{ "precision": 0.95, "recall": 0.85, "backgroundFalseProducts": 0 }',
        'backgroundCheckOffers',
      ],
      ['{ "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0 }', 'precision'],
      [
        '{ "precision": 1.2, "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0 }',
        'precision',
      ],
      [
        '{ "precision": 0.95, "recall": "high", "backgroundFalseProducts": 0, "backgroundCheckOffers": 0 }',
        'recall',
      ],
      ['{ "precision": 0.95, "recall": 0.85 }', 'backgroundFalseProducts'],
      [
        '{ "precision": 0.95, "recall": 0.85, "backgroundFalseProducts": -1 }',
        'backgroundFalseProducts',
      ],
    ] as const) {
      expect(() => parseSentenceBaseline(text), text).toThrow(`"${key}"`);
    }
    expect(() => parseSentenceBaseline('not json')).toThrow('sentences-baseline.json');
  });
});

describe('evaluateSentences', () => {
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
    {
      id: 'kinkeliba',
      family: 'kinkeliba',
      kind: 'plant',
      display: { fr: 'Kinkéliba', en: 'Kinkeliba' },
      names: [{ text: 'Kinkéliba', lang: 'fr' }],
      priority: 2,
      detail: '',
    },
  ]);
  const families = new Map([
    ['moringa', 'moringa'],
    ['kinkeliba', 'kinkeliba'],
  ]);

  it('counts products right, false and missed, per language', () => {
    const report = evaluateSentences(
      index,
      families,
      parseSentences(
        [
          '- { text: dama naan nebeday, lang: wo, type: plain, expect: [{ kind: plant, id: moringa }] }',
          '- { text: nebeday ak kinkeliba, lang: wo, type: plain, expect: [{ kind: plant, id: moringa }] }',
          "- { text: j'ai pris du kinkéliba, lang: fr, type: plain, expect: [{ kind: plant, id: moringa }] }",
          '- { text: ceeb ak jën, lang: wo, type: none, expect: [] }',
        ].join('\n'),
      ),
    );
    expect(report.perLang.wo).toMatchObject({ sentences: 3, expected: 2, right: 2, false: 1 });
    expect(report.perLang.fr).toMatchObject({ sentences: 1, expected: 1, right: 0, false: 1 });
    expect(report.overall).toMatchObject({ sentences: 4, expected: 3, right: 2, false: 2 });
    expect(report.misses.map((miss) => miss.text)).toEqual([
      'nebeday ak kinkeliba',
      "j'ai pris du kinkéliba",
    ]);
  });

  // The sentences are read as the voice heard them: a name read from words
  // the voice split is offered unticked ("Vérifiez"), never counted as found.
  it('counts the names offered to check, right or wrong, apart from the products found', () => {
    const report = evaluateSentences(
      index,
      families,
      parseSentences(
        [
          '- { text: je bois du King Kyliba, lang: fr, type: misspelt, expect: [{ kind: plant, id: kinkeliba }] }',
          '- { text: je bois du King Kyliba, lang: fr, type: misspelt, expect: [{ kind: plant, id: moringa }] }',
        ].join('\n'),
      ),
    );
    expect(report.overall).toMatchObject({
      right: 0,
      missed: 2,
      false: 0,
      checksRight: 1,
      checksWrong: 1,
    });
  });
});

describe('failures', () => {
  const baseline = {
    precision: 0.95,
    recall: 0.85,
    backgroundFalseProducts: 0,
    backgroundCheckOffers: 0,
  };
  it('says each bar not met, and a measure that is not a number', () => {
    expect(failures({ precision: 1, recall: 0.9, background: 0, checks: 0 }, baseline)).toEqual([]);
    expect(
      failures({ precision: 0.9, recall: 0.8, background: 1, checks: 1 }, baseline),
    ).toHaveLength(4);
    expect(
      failures({ precision: Number.NaN, recall: 0.9, background: 0, checks: 0 }, baseline),
    ).toEqual(['precision is not a number (NaN)']);
  });
});

describe('main', () => {
  const LICENCE = '# SPDX-License-Identifier: CC-BY-4.0\n';
  const ONE = `${LICENCE}- { text: dama naan nebeday, lang: wo, type: plain, expect: [{ kind: plant, id: moringa }] }\n`;

  async function runWith(
    sentences: string,
    baseline: string,
  ): Promise<{ code: number; text: string }> {
    const copy = await tempCopy();
    try {
      await mkdir(path.join(copy.root, 'eval', 'speech'), { recursive: true });
      await writeFile(path.join(copy.root, 'eval', 'speech', 'sentences.yaml'), sentences);
      await writeFile(path.join(copy.root, 'eval', 'speech', 'sentences-baseline.json'), baseline);
      const lines: string[] = [];
      const code = await main(copy.root, (line) => lines.push(line), REPO_ROOT);
      return { code, text: lines.join('\n') };
    } finally {
      await copy.remove();
    }
  }

  const BARS =
    '{ "precision": 0.95, "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0 }';

  it('exits 0 when the bars are met', async () => {
    const { code, text } = await runWith(ONE, BARS);
    expect(text).toMatch(/overall\s+1\s+1\s+1\s+0\s+0\s+1\.000\s+1\.000/);
    expect(code).toBe(0);
  });

  it('exits 1 when a bar is not met, on an empty file and on a bad baseline', async () => {
    const wrong = `${LICENCE}- { text: dama naan nebeday, lang: wo, type: plain, expect: [{ kind: plant, id: kinkeliba }] }\n`;
    expect((await runWith(wrong, BARS)).code).toBe(1);
    expect((await runWith(`${LICENCE}[]\n`, BARS)).code).toBe(1);
    const bad = await runWith(ONE, '{ "precision": 0.95 }');
    expect(bad.code).toBe(1);
    expect(bad.text).toMatch(/FAIL: .*baseline/);
  });
});

describe('the committed sentence set', () => {
  it('has at least 150 sentences in French, Wolof and both, with several, misspelt and none', async () => {
    const sentences = parseSentences(await readFile(SENTENCES_FILE, 'utf8'));
    expect(sentences.length).toBeGreaterThanOrEqual(150);
    for (const lang of SENTENCE_LANGS) {
      expect(sentences.filter((item) => item.lang === lang).length, lang).toBeGreaterThanOrEqual(
        40,
      );
    }
    expect(sentences.filter((item) => item.expect.length >= 2).length).toBeGreaterThanOrEqual(20);
    expect(sentences.filter((item) => item.type === 'misspelt').length).toBeGreaterThanOrEqual(20);
    expect(sentences.filter((item) => item.type === 'none').length).toBeGreaterThanOrEqual(30);
  });

  it('expects only products and plants of the registry', async () => {
    const pack = buildPack(await loadContent(ROOT, ROOT));
    const known = new Set([
      ...pack.products.map((product) => `product:${product.id}`),
      ...pack.plants.map((plant) => `plant:${plant.id}`),
    ]);
    for (const item of parseSentences(await readFile(SENTENCES_FILE, 'utf8'))) {
      for (const expected of item.expect.flatMap(alternativesOf)) {
        expect(known.has(`${expected.kind}:${expected.id}`), `${item.text}: ${expected.id}`).toBe(
          true,
        );
      }
    }
  });

  it('reaches the recorded bars (the background is checked by pnpm eval:sentences)', async () => {
    const pack = buildPack(await loadContent(ROOT, ROOT));
    const entries = entriesFromPack(pack);
    const index = buildIndex(entries);
    const families = new Map(entries.map((entry) => [entry.id, entry.family]));
    const report = evaluateSentences(
      index,
      families,
      parseSentences(await readFile(SENTENCES_FILE, 'utf8')),
    );
    const baseline = parseSentenceBaseline(
      await readFile(path.join(ROOT, 'eval', 'speech', 'sentences-baseline.json'), 'utf8'),
    );
    expect(baseline.precision).toBeGreaterThanOrEqual(0.95);
    expect(baseline.recall).toBeGreaterThanOrEqual(0.85);
    for (const tally of [report.overall, ...Object.values(report.perLang)]) {
      expect(tally.right / (tally.right + tally.false)).toBeGreaterThanOrEqual(baseline.precision);
      expect(tally.right / tally.expected).toBeGreaterThanOrEqual(baseline.recall);
    }
  });
});
