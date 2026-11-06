// SPDX-License-Identifier: MIT
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pack } from '@siapso/engine';
import { buildPack, loadContent } from '@siapso/pack-tools';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  failures,
  main,
  mustWarnOutcome,
  negativeOutcome,
  parseBaseline,
  parseMustWarn,
  parseNegative,
  parseRows,
  parseTruth,
  scoreSource,
  type Bars,
  type Baseline,
  type Summary,
  type TruthRx,
} from './evaluate.js';
import { emptyScore } from './metrics.mjs';
import { makeRx } from './synth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let pack: Pack;
beforeAll(async () => {
  pack = buildPack(await loadContent(ROOT));
}, 60_000);

const rx = (patch: Partial<TruthRx> = {}): TruthRx => ({
  id: 'rx01',
  set: 'dev',
  template: 'post',
  handwriting: false,
  patient: 'Awa Diop',
  age: 27,
  weeks: 30,
  date: '06/09/2026',
  prescriber: 'Dr Moussa Diop',
  items: [
    {
      written: 'Doliprane 1000 mg cp',
      inBase: true,
      product: 'doliprane-1000-mg-60234100',
      strengthMg: 1000,
      posology: '1 cp x 3/jour si douleur',
      upd: 3,
      inline: true,
    },
    { written: 'Spasfon Lyoc 80 mg', inBase: false, posology: '1 lyoc x 3/j', inline: false },
  ],
  ...patch,
});

const BARS: Bars = {
  recallPrint: 1,
  recallHand: 0.9,
  maxFalsePrint: 0,
  maxSilentHand: 1,
  maxWrongStrengthPrint: 0,
  maxWrongOffersPrint: 0,
  keptPrint: 1,
  keptHand: 0.5,
};

describe('eval/prescription/truth.json', () => {
  it('is what the generator gives: the OCR texts were made from these prescriptions', async () => {
    const truth = parseTruth(
      await readFile(path.join(ROOT, 'eval', 'prescription', 'truth.json'), 'utf8'),
    );
    const substancesOf = (id: string) =>
      (pack.products.find((p) => p.id === id)?.components ?? [])
        .map((c) => c.substance)
        .sort()
        .join('+');
    expect(truth).toHaveLength(36);
    truth.forEach((saved, i) => {
      const made = makeRx(i, substancesOf) as unknown as TruthRx;
      expect(saved.set).toBe(i < 24 ? 'dev' : 'heldout');
      const key = (rx: TruthRx) => ({
        id: rx.id,
        handwriting: rx.handwriting,
        patient: rx.patient,
        date: rx.date,
        prescriber: rx.prescriber,
        items: rx.items.map((it) => [it.written, it.product, it.posology, it.upd, it.inline]),
      });
      expect(key(saved), saved.id).toEqual(key(made));
    });
  });
});

describe('parsing', () => {
  it('reads the truth and refuses an item of the pack without its product', () => {
    expect(parseTruth(JSON.stringify([rx()]))).toHaveLength(1);
    const broken = rx();
    delete broken.items[0]?.product;
    expect(() => parseTruth(JSON.stringify([broken]))).toThrow(/rx01.*product/);
    expect(() => parseTruth('[]')).toThrow(/no prescription/);
  });

  it('reads OCR rows of text only, and refuses a row of an unknown prescription', () => {
    const truth = [rx()];
    const rows = parseRows('[{"id":"rx01","variant":"scan","text":"a"}]\n', truth, 'x.json');
    expect(rows).toEqual([{ id: 'rx01', variant: 'scan', text: 'a' }]);
    expect(() => parseRows('[{"id":"rx99","variant":"scan","text":"a"}]', truth, 'x.json')).toThrow(
      /x.json row 1: no prescription rx99/,
    );
    expect(() => parseRows('[{"id":"rx01","variant":"scan"}]', truth, 'x.json')).toThrow(/text/);
    expect(() => parseRows('[]', truth, 'x.json')).toThrow(/no row/);
    expect(() => parseRows('', truth, 'x.json')).toThrow(/not valid JSON/);
  });

  it('reads the baseline and refuses a bar that is not a number in range', () => {
    const ok = { sources: { text: BARS } };
    expect(parseBaseline(JSON.stringify(ok))).toEqual(ok);
    const without = (key: keyof Bars) => ({
      sources: { text: Object.fromEntries(Object.entries(BARS).filter(([name]) => name !== key)) },
    });
    for (const bad of [
      { sources: {} },
      { sources: { text: { ...BARS, recallPrint: 1.2 } } },
      { sources: { text: { ...BARS, maxFalsePrint: -1 } } },
      { sources: { text: { ...BARS, keptHand: 2 } } },
      { sources: { text: { ...BARS, maxWrongStrengthPrint: 0.5 } } },
      without('maxFalsePrint'),
      without('maxWrongStrengthPrint'),
      without('maxWrongOffersPrint'),
      without('keptPrint'),
    ]) {
      expect(() => parseBaseline(JSON.stringify(bad)), JSON.stringify(bad)).toThrow(/baseline/);
    }
  });

  it('reads the negative cases and refuses one without lines', () => {
    expect(parseNegative(JSON.stringify([{ lines: ['Pharmacie Guigon'], why: 'x' }]))).toHaveLength(
      1,
    );
    expect(() => parseNegative(JSON.stringify([{ lines: [], why: 'x' }]))).toThrow(
      /negative case 1/,
    );
    expect(() => parseNegative('[]')).toThrow(/no case/);
  });

  it('reads the must-warn cases and refuses one without lines or names', () => {
    const cases = parseMustWarn(
      JSON.stringify([{ lines: ['1. SP'], names: ['sulfadoxine'], why: 'x' }]),
    );
    expect(cases).toHaveLength(1);
    expect(() => parseMustWarn(JSON.stringify([{ lines: [], names: ['x'], why: 'x' }]))).toThrow(
      /must-warn case 1/,
    );
    expect(() => parseMustWarn('[]')).toThrow(/no case/);
  });
});

describe('scoreSource', () => {
  it('scores products found, strengths, units and the lines kept for products outside the pack', () => {
    const truth = [rx()];
    const text = [
      'ORDONNANCE',
      'Nom et prénom : Awa Diop',
      '1. Doliprane 1000 mg cp : 1 cp x 3/jour si douleur',
      '2. Spasfon Lyoc 80 mg',
      '1 lyoc x 3/j',
    ].join('\n');
    const summary = scoreSource(pack, truth, [{ id: 'rx01', variant: 'scan', text }]);
    const all = summary.groups.get('all/print');
    expect(all?.score.found).toBe(1);
    expect(all?.score.expected).toBe(1);
    expect(all?.score.falseProducts).toBe(0);
    expect(all?.score.strength).toEqual({ expected: 1, right: 1, wrong: 0 });
    expect(all?.score.units).toEqual({ expected: 1, right: 1, wrong: 0 });
    expect(all?.offers).toEqual({ right: 1, wrong: 0 });
    expect(all?.score.outOfBase).toEqual({ items: 1, kept: 1 });
    expect(summary.groups.get('dev/print')?.images).toBe(1);
    expect(summary.groups.get('scan/print')?.images).toBe(1);
    expect(summary.ms).toHaveLength(1);
  });

  it('says how many false products read in part carry the warning', () => {
    const iron = rx({
      items: [
        {
          written: 'Fer + Acide folique cp',
          inBase: true,
          product: 'fer-acide-folique',
          posology: '1 cp/jour pendant 3 mois',
          upd: 1,
          inline: true,
        },
      ],
    });
    const warned = scoreSource(
      pack,
      [iron],
      [{ id: 'rx01', variant: 'scan', text: '1. Fer + Ac. folique cp' }],
    ).groups.get('all/print');
    expect(warned?.score.falsePartial).toBe(1);
    expect(warned?.partialWarned).toBe(1);
    const silent = scoreSource(
      pack,
      [iron],
      [{ id: 'rx01', variant: 'scan', text: '1. Fer cp' }],
    ).groups.get('all/print');
    expect(silent?.score.falsePartial).toBe(1);
    expect(silent?.partialWarned).toBe(0);
  });

  it('counts the warnings on products read right: noise for her to look at', () => {
    const two = rx({
      items: [
        {
          written: 'Paracétamol 500 mg cp',
          inBase: true,
          product: 'paracetamol-500-generic',
          strengthMg: 500,
          posology: '1 cp x 3/j',
          upd: 3,
          inline: true,
        },
      ],
    });
    const group = scoreSource(
      pack,
      [two],
      [{ id: 'rx01', variant: 'scan', text: '1. Paracétamol 500 mg cp Amoxicilline 500 mg' }],
    ).groups.get('all/print');
    expect(group?.score.found).toBe(1);
    expect(group?.rightWarned).toBe(1);
  });

  it('counts a product of other substances as false, on the printed or the handwritten pages', () => {
    const hand = rx({ id: 'rx03', handwriting: true });
    const summary = scoreSource(
      pack,
      [hand],
      [{ id: 'rx03', variant: 'scan', text: '1. Flagyl 500 mg cp' }],
    );
    expect(summary.groups.get('all/hand')?.score.falseProducts).toBe(1);
    expect(summary.groups.get('all/print')).toBeUndefined();
  });
});

describe('scoreSource: header lines', () => {
  it('counts a typed line or a quoted line that holds the patient, the prescriber, a place or the date', () => {
    const truth = [rx({ district: 'Mbour', village: 'Ngaparou' })];
    const clean = scoreSource(pack, truth, [
      {
        id: 'rx01',
        variant: 'scan',
        text: ['1. Doliprane 1000 mg cp', '2. Spasfon Lyoc 80 mg'].join('\n'),
      },
    ]).groups.get('all/print');
    expect(clean?.headerOffered).toBe(0);
    // A numbered line of a name the reading does not know is kept as typed:
    // the evaluation knows the patient's name.
    const unknown = [rx({ patient: 'Zeyna Kouyaté', district: 'Mbour', village: 'Ngaparou' })];
    const leaked = scoreSource(pack, unknown, [
      {
        id: 'rx01',
        variant: 'scan',
        text: ['1. Doliprane 1000 mg cp', '5. Zeyna Kouyaté'].join('\n'),
      },
    ]).groups.get('all/print');
    expect(leaked?.headerOffered).toBe(1);
  });
});

describe('mustWarnOutcome', () => {
  it('says whole when the combination is read whole', () => {
    expect(
      mustWarnOutcome(pack, {
        lines: ['1. SP (Sulfadoxine', 'Pyriméthamine)'],
        names: ['pyrimethamine', 'sulfadoxine'],
        why: '',
      }),
    ).toBe('whole');
  });

  it('says warned when a part is read with the warning and the line as typed', () => {
    expect(
      mustWarnOutcome(pack, {
        lines: ['1. Pyriméthamine 25 mg Sulfadox'],
        names: ['pyrimethamine', 'sulfadoxine'],
        why: '',
      }),
    ).toBe('warned');
  });

  it('says silent when a part is read and nothing says what the line also names', () => {
    // The line names only pyrimethamine: nothing can tell, so a case that
    // expects sulfadoxine there is read in part, silently.
    expect(
      mustWarnOutcome(pack, {
        lines: ['Pyriméthamine)'],
        names: ['pyrimethamine', 'sulfadoxine'],
        why: '',
      }),
    ).toBe('silent');
  });

  it('says warned for a product that says what it holds more, and is never pre-ticked', () => {
    expect(
      mustWarnOutcome(pack, {
        lines: ['Ténofovir Lamivudine'],
        names: ['lamivudine', 'tenofovir'],
        why: '',
      }),
    ).toBe('warned');
    // A line that names more than its product, even what the base does not know.
    expect(
      mustWarnOutcome(pack, {
        lines: ['Amoxicilline + acide clavulanique'],
        names: ['amoxicillin', 'clavulanic-acid'],
        why: '',
      }),
    ).toBe('warned');
  });

  it('says pre-ticked when a case that must be checked reads a product that may be pre-ticked', () => {
    const sp = { lines: ['1. SP'], names: ['pyrimethamine', 'sulfadoxine'], why: '' };
    expect(mustWarnOutcome(pack, { ...sp, preTick: false })).toBe('whole');
    expect(
      mustWarnOutcome(pack, {
        lines: ['1. SP (Sulfadoxine Pyriméthamine)'],
        names: ['pyrimethamine', 'sulfadoxine'],
        why: '',
        preTick: false,
      }),
    ).toBe('pre-ticked');
  });

  it('says false for a product of another substance, and typed when only a typed line is offered', () => {
    expect(
      mustWarnOutcome(pack, { lines: ['1. Flagyl 500 mg cp'], names: ['sulfadoxine'], why: '' }),
    ).toBe('false');
    expect(
      mustWarnOutcome(pack, { lines: ['1. Spasfon Lyoc 80 mg'], names: ['sulfadoxine'], why: '' }),
    ).toBe('typed');
    expect(mustWarnOutcome(pack, { lines: ['Signature'], names: ['sulfadoxine'], why: '' })).toBe(
      'lost',
    );
  });
});

describe('negativeOutcome', () => {
  it('says clean when a line gives no product and no typed line, else what it gave', () => {
    expect(negativeOutcome(pack, { lines: ['Pharmacie Guigon'], why: '' })).toBe('clean');
    expect(negativeOutcome(pack, { lines: ['1. Doliprane 1000 mg cp'], why: '' })).toBe('product');
    expect(negativeOutcome(pack, { lines: ['1. Spasfon Lyoc 80 mg'], why: '' })).toBe('typed');
  });
});

describe('failures', () => {
  const baseline: Baseline = { sources: { text: BARS } };
  /** A summary whose printed and handwritten totals are [expected, found, false products]. */
  const summaryOf = (print: [number, number, number], hand: [number, number, number]): Summary => {
    const summary: Summary = { groups: new Map(), ms: [] };
    for (const [key, [expected, found, falseProducts]] of [
      ['all/print', print],
      ['all/hand', hand],
    ] as const) {
      summary.groups.set(key, {
        images: 1,
        score: { ...emptyScore(), expected, found, falseProducts },
        offers: { right: 0, wrong: 0 },
        partialWarned: 0,
        rightWarned: 0,
        headerOffered: 0,
      });
    }
    return summary;
  };

  it('passes when every bar holds', () => {
    expect(failures(new Map([['text', summaryOf([10, 10, 0], [10, 9, 1])]]), baseline, [])).toEqual(
      [],
    );
  });

  it('fails on a false product on printed pages, a recall below the baseline, or a silent must-warn case', () => {
    const found = failures(new Map([['text', summaryOf([10, 9, 1], [10, 8, 2])]]), baseline, [
      'silent',
      'warned',
      'false',
      'lost',
    ]);
    expect(found).toEqual([
      'text: 1 false product on printed pages (at most 0)',
      'text: 2 false products without the warning on handwritten pages (at most 1)',
      'text: recall on printed pages 0.900 is below the baseline 1',
      'text: recall on handwritten pages 0.800 is below the baseline 0.9',
      'must-warn case 1 is read in part without the warning',
      'must-warn case 3 proposes a product of another substance',
      'must-warn case 4 is lost: no product and no line to add as typed',
    ]);
  });

  it('counts on handwritten pages only the false products that do not say their line names more', () => {
    const summary = summaryOf([10, 10, 0], [10, 9, 3]);
    const hand = summary.groups.get('all/hand');
    if (hand !== undefined) hand.partialWarned = 2;
    expect(failures(new Map([['text', summary]]), baseline, [])).toEqual([]);
    if (hand !== undefined) hand.partialWarned = 1;
    expect(failures(new Map([['text', summary]]), baseline, [])).toEqual([
      'text: 2 false products without the warning on handwritten pages (at most 1)',
    ]);
  });

  it('fails on a wrong strength or a wrong count offered on printed pages, and on fewer lines kept', () => {
    const summary = summaryOf([10, 10, 0], [10, 9, 1]);
    const print = summary.groups.get('all/print');
    const hand = summary.groups.get('all/hand');
    if (print === undefined || hand === undefined) throw new Error('no groups');
    print.score.strength = { expected: 5, right: 4, wrong: 1 };
    print.offers = { right: 2, wrong: 1 };
    print.score.outOfBase = { items: 4, kept: 3 };
    hand.score.outOfBase = { items: 4, kept: 1 };
    // Wrong strengths on handwritten pages have no bar: the proxy is noisy.
    hand.score.strength = { expected: 5, right: 2, wrong: 3 };
    expect(failures(new Map([['text', summary]]), baseline, [])).toEqual([
      'text: 1 wrong strength on printed pages (at most 0)',
      'text: 1 wrong count per day offered on printed pages (at most 0)',
      'text: products outside the pack kept on printed pages 0.750 is below the baseline 1',
      'text: products outside the pack kept on handwritten pages 0.250 is below the baseline 0.5',
    ]);
  });

  it('fails on any header line offered, on printed or handwritten pages', () => {
    const summary = summaryOf([10, 10, 0], [10, 9, 1]);
    const hand = summary.groups.get('all/hand');
    if (hand !== undefined) hand.headerOffered = 2;
    expect(failures(new Map([['text', summary]]), baseline, [])).toEqual([
      'text: 2 header lines offered as typed or quoted (at most 0)',
    ]);
  });

  it('fails on a negative case that gives a product or a typed line', () => {
    expect(failures(new Map(), { sources: {} }, [], ['clean', 'product', 'typed'])).toEqual([
      'negative case 2 proposes a product',
      'negative case 3 offers a line to add as typed',
    ]);
  });

  it('fails on a must-warn case read as a product that may be pre-ticked', () => {
    expect(failures(new Map(), { sources: {} }, ['pre-ticked'])).toEqual([
      'must-warn case 1 reads a product that may be pre-ticked, though the line is unsure',
    ]);
  });

  it('fails for a source measured without a baseline, and for a baseline without its source', () => {
    expect(failures(new Map([['other', summaryOf([1, 1, 0], [1, 1, 0])]]), baseline, [])).toEqual([
      'other: no baseline',
      'text: in the baseline, not measured',
    ]);
  });
});

// Each run builds the pack from the repository: a few seconds, longer on a busy machine.
describe('main', { timeout: 60_000 }, () => {
  let dir: string;
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs on an evaluation folder and fails below its baseline', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'rx-eval-'));
    await mkdir(path.join(dir, 'ocr'));
    await writeFile(path.join(dir, 'truth.json'), JSON.stringify([rx()]));
    await writeFile(
      path.join(dir, 'ocr', 'engine.json'),
      JSON.stringify([{ id: 'rx01', variant: 'scan', text: '1. Doliprane 1000 mg cp' }]),
    );
    await writeFile(
      path.join(dir, 'must-warn.json'),
      JSON.stringify([
        {
          lines: ['1. Pyriméthamine 25 mg Sulfadox'],
          names: ['pyrimethamine', 'sulfadoxine'],
          why: 'x',
        },
      ]),
    );
    // The engine's text lost the product outside the pack: no bar on lines kept.
    const bars = { ...BARS, recallHand: 0, maxSilentHand: 0, keptPrint: 0, keptHand: 0 };
    await writeFile(
      path.join(dir, 'baseline.json'),
      JSON.stringify({ sources: { text: bars, engine: bars } }),
    );
    const lines: string[] = [];
    expect(await main(ROOT, (line) => lines.push(line), dir)).toBe(0);
    expect(lines.join('\n')).toMatch(
      /must-warn: 1 cases, 0 read whole, 1 read in part with the warning/,
    );

    await writeFile(
      path.join(dir, 'ocr', 'engine.json'),
      JSON.stringify([{ id: 'rx01', variant: 'scan', text: '1. Flagyl 500 mg cp' }]),
    );
    lines.length = 0;
    expect(await main(ROOT, (line) => lines.push(line), dir)).toBe(1);
    expect(lines.join('\n')).toMatch(/FAIL: engine: 1 false product on printed pages/);
  });

  it('fails with a message for a folder that is not an evaluation', async () => {
    const lines: string[] = [];
    expect(await main(ROOT, (line) => lines.push(line), path.join(dir, 'missing'))).toBe(1);
    expect(lines.at(-1)).toMatch(/^FAIL: /);
  });
});
