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
  SENTENCE_CASES,
  SENTENCE_LANGS,
} from '../src/eval-sentences.js';
import type { SentenceCase } from '../src/eval-sentences.js';
import { loadContent } from '../src/load.js';
import { REPO_ROOT, tempCopy } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTENCES_FILE = path.join(ROOT, 'eval', 'speech', 'sentences.yaml');
const HELD_OUT_FILE = path.join(ROOT, 'eval', 'speech', 'sentences-heldout.yaml');
/**
 * Building the repository pack and reading every sentence as heard takes about
 * 2 s alone, and over 5 s (Vitest's default) with coverage on a loaded machine.
 */
const PACK_TIMEOUT_MS = 20_000;

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

  // Review of #68: a product named but not taken (said with a negation, by
  // another person, in the past) must not come ticked.
  it('reads the products named but not taken, apart from the ones taken', () => {
    const [item] = parseSentences(
      '- { text: je prends du doliprane mais pas de cytotec, lang: fr, type: plain, expect: [{ kind: product, id: a }], notTaken: [{ kind: product, id: b }] }',
    );
    expect(item?.notTaken?.map(alternativesOf)).toEqual([[{ kind: 'product', id: 'b' }]]);
    // A sentence naming only products not taken has no product taken.
    expect(
      parseSentences(
        '- { text: je ne prends pas de cytotec, lang: fr, type: none, expect: [], notTaken: [{ kind: product, id: b }] }',
      )[0]?.notTaken,
    ).toHaveLength(1);
    expect(() =>
      parseSentences(
        '- { text: x, lang: fr, type: none, expect: [], notTaken: [{ kind: plant }] }',
      ),
    ).toThrow('"notTaken"');
  });

  it('reads the case of a held-out sentence, and rejects an unknown one', () => {
    const [item] = parseSentences(
      '- { text: mon mari prend du coartem, lang: fr, type: none, case: other-person, expect: [] }',
    );
    expect(item?.case).toBe('other-person');
    expect(() =>
      parseSentences('- { text: x, lang: fr, type: none, case: story, expect: [] }'),
    ).toThrow('"case"');
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
        '{ "precision": 0.95, "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0, "offered": 0.9 }',
      ),
    ).toEqual({
      precision: 0.95,
      recall: 0.85,
      backgroundFalseProducts: 0,
      backgroundCheckOffers: 0,
      offered: 0.9,
    });
    for (const [text, key] of [
      [
        '{ "precision": 0.95, "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0 }',
        'offered',
      ],
      [
        '{ "precision": 0.95, "recall": 0.85, "backgroundFalseProducts": 0 }',
        'backgroundCheckOffers',
      ],
      [
        '{ "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0, "offered": 0.9 }',
        'precision',
      ],
      [
        '{ "precision": 1.2, "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0, "offered": 0.9 }',
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
      // Named and offered (ticked or to confirm): the King Kyliba of the first.
      offered: 1,
    });
  });

  it('counts a product named but not taken that comes ticked as a false product', () => {
    // A first name says another person: no rule reads it.
    const report = evaluateSentences(
      index,
      families,
      parseSentences(
        [
          '- { text: du kinkéliba pour Awa, lang: fr, type: none, expect: [], notTaken: [{ kind: plant, id: kinkeliba }] }',
          '- { text: je ne bois pas de kinkéliba, lang: fr, type: none, expect: [], notTaken: [{ kind: plant, id: kinkeliba }] }',
        ].join('\n'),
      ),
    );
    expect(report.overall).toMatchObject({
      expected: 0,
      right: 0,
      notTaken: 2,
      notTakenTicked: 1,
      notTakenUnticked: 1,
    });
    expect(report.overall.false).toBe(1);
    expect(report.perCase.negation).toMatchObject({ sentences: 0 });
  });

  it('tallies each case apart', () => {
    const report = evaluateSentences(
      index,
      families,
      parseSentences(
        [
          '- { text: dama naan nebeday, lang: wo, type: plain, case: affirmative, expect: [{ kind: plant, id: moringa }] }',
          '- { text: je ne bois pas de kinkéliba, lang: fr, type: none, case: negation, expect: [], notTaken: [{ kind: plant, id: kinkeliba }] }',
        ].join('\n'),
      ),
    );
    expect(report.perCase.affirmative).toMatchObject({ sentences: 1, right: 1 });
    expect(report.perCase.negation).toMatchObject({ sentences: 1, notTaken: 1 });
    expect(report.perCase.past).toMatchObject({ sentences: 0 });
  });
});

describe('failures', () => {
  const baseline = {
    precision: 0.95,
    recall: 0.85,
    backgroundFalseProducts: 0,
    backgroundCheckOffers: 0,
    offered: 0.9,
  };
  it('says each bar not met, and a measure that is not a number', () => {
    expect(
      failures({ precision: 1, recall: 0.9, offered: 1, background: 0, checks: 0 }, baseline),
    ).toEqual([]);
    expect(
      failures({ precision: 0.9, recall: 0.8, offered: 0.8, background: 1, checks: 1 }, baseline),
    ).toHaveLength(5);
    expect(
      failures(
        { precision: Number.NaN, recall: 0.9, offered: 1, background: 0, checks: 0 },
        baseline,
      ),
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
    '{ "precision": 0.95, "recall": 0.85, "backgroundFalseProducts": 0, "backgroundCheckOffers": 0, "offered": 0.9 }';

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

  // The held-out set is measured, never tuned on: its figures are reported as
  // they are, with no bar.
  async function runHeldOut(heldOut: string | undefined): Promise<{ code: number; text: string }> {
    const copy = await tempCopy();
    try {
      await mkdir(path.join(copy.root, 'eval', 'speech'), { recursive: true });
      if (heldOut !== undefined) {
        await writeFile(path.join(copy.root, 'eval', 'speech', 'sentences-heldout.yaml'), heldOut);
      }
      const lines: string[] = [];
      const code = await main(copy.root, (line) => lines.push(line), REPO_ROOT, 'heldout');
      return { code, text: lines.join('\n') };
    } finally {
      await copy.remove();
    }
  }

  it('reports the held-out set with no bar, and fails on a missing or malformed file', async () => {
    const wrong = `${LICENCE}- { text: dama naan nebeday, lang: wo, type: plain, case: affirmative, expect: [{ kind: plant, id: kinkeliba }] }\n`;
    const report = await runHeldOut(wrong);
    expect(report.text).toMatch(/held-out set/);
    expect(report.text).toMatch(/affirmative\s+1\s+1\s+0\s+1\s+1/);
    expect(report.text).not.toMatch(/FAIL/);
    expect(report.code).toBe(0);
    expect((await runHeldOut(undefined)).code).toBe(1);
    expect((await runHeldOut(`${LICENCE}[]\n`)).code).toBe(1);
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

  it(
    'expects only products and plants of the registry',
    async () => {
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
    },
    PACK_TIMEOUT_MS,
  );

  it(
    'reaches the recorded bars (the background is checked by pnpm eval:sentences)',
    async () => {
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
      expect(baseline.offered).toBeGreaterThanOrEqual(0.95);
      for (const tally of [report.overall, ...Object.values(report.perLang)]) {
        expect(tally.right / (tally.right + tally.false)).toBeGreaterThanOrEqual(
          baseline.precision,
        );
        expect(tally.right / tally.expected).toBeGreaterThanOrEqual(baseline.recall);
        expect(tally.offered / tally.expected).toBeGreaterThanOrEqual(baseline.offered);
      }
    },
    PACK_TIMEOUT_MS,
  );
});

// Review of #68: a set written before the rules for products not taken, and
// never tuned on. These tests check its shape only, never its figures.
describe('the committed held-out set', () => {
  const plain = (text: string): string =>
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  it('has at least 120 new sentences in French and Wolof, of every case', async () => {
    const heldOut = parseSentences(await readFile(HELD_OUT_FILE, 'utf8'));
    const tuning = new Set(
      parseSentences(await readFile(SENTENCES_FILE, 'utf8')).map((item) => plain(item.text)),
    );
    expect(heldOut.length).toBeGreaterThanOrEqual(120);
    expect(heldOut.filter((item) => item.lang === 'fr').length).toBeGreaterThanOrEqual(50);
    expect(heldOut.filter((item) => item.lang === 'wo').length).toBeGreaterThanOrEqual(40);
    const least: Record<SentenceCase, number> = {
      affirmative: 20,
      negation: 20,
      'other-person': 15,
      past: 15,
      food: 10,
      list: 15,
      question: 10,
    };
    for (const name of SENTENCE_CASES) {
      expect(heldOut.filter((item) => item.case === name).length, name).toBeGreaterThanOrEqual(
        least[name],
      );
    }
    for (const item of heldOut) {
      expect(item.case, item.text).toBeDefined();
      expect(tuning.has(plain(item.text)), `also in the tuning set: ${item.text}`).toBe(false);
    }
    expect(
      heldOut.filter((item) => (item.notTaken?.length ?? 0) > 0).length,
    ).toBeGreaterThanOrEqual(40);
  });

  it(
    'expects only products and plants of the registry',
    async () => {
      const pack = buildPack(await loadContent(ROOT, ROOT));
      const known = new Set([
        ...pack.products.map((product) => `product:${product.id}`),
        ...pack.plants.map((plant) => `plant:${plant.id}`),
      ]);
      for (const item of parseSentences(await readFile(HELD_OUT_FILE, 'utf8'))) {
        for (const expected of [...item.expect, ...(item.notTaken ?? [])].flatMap(alternativesOf)) {
          expect(known.has(`${expected.kind}:${expected.id}`), `${item.text}: ${expected.id}`).toBe(
            true,
          );
        }
      }
    },
    PACK_TIMEOUT_MS,
  );
});
