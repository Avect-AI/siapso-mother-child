// SPDX-License-Identifier: MIT
import type { CheckedItem, Pack, Rule } from '@siapso/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { translate, type MessageKey, type Vars } from '../i18n/index.js';
import { knowledgePack } from '../test/knowledge-pack.js';
import { bandedName, doseBandLine, doseBandOf, lowDoseTyped } from './dose-band.js';
import { productDoseRangeOf } from './search-index.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

const aspirin: CheckedItem = { ref: { kind: 'product', id: 'aspirin-generic' } };
const translator =
  (lang: 'fr' | 'en') =>
  (key: MessageKey, vars?: Vars): string =>
    translate(lang, key, vars);
const t = translator('fr');

describe('doseBandOf', () => {
  it('reads "100 mg ou moins" from the range said, "Plus de 100 mg" only when she answered it', () => {
    expect(doseBandOf(pack, { ...aspirin, strengthAtMostMg: 100 })).toEqual({
      kind: 'at-most',
      mg: 100,
    });
    expect(doseBandOf(pack, aspirin, true)).toEqual({ kind: 'above', mg: 100 });
    // A box listed without that answer (a long-term one, an older check) says no range.
    expect(doseBandOf(pack, aspirin)).toBeUndefined();
  });

  it('says no range for "Je ne sais pas", a box with a strength or a remedy', () => {
    expect(doseBandOf(pack, { ...aspirin, strengthUnknown: true }, true)).toBeUndefined();
    expect(
      doseBandOf(pack, { ref: { kind: 'product', id: 'kardegic-75-mg-64755969' } }, true),
    ).toBeUndefined();
    expect(doseBandOf(pack, { ref: { kind: 'plant', id: 'moringa' } }, true)).toBeUndefined();
  });
});

describe('the words of a dose range', () => {
  it('says it on a line of its own and after the name in a sentence', () => {
    // Each strength is held to its unit by a no-break space.
    expect(doseBandLine(t, { kind: 'at-most', mg: 100 }, 'fr')).toBe('100\u00a0mg ou moins');
    expect(doseBandLine(t, { kind: 'above', mg: 100 }, 'fr')).toBe('Plus de 100\u00a0mg');
    expect(bandedName(pack, aspirin, 'Aspirine (générique)', 'fr', t, true)).toBe(
      'Aspirine (générique), plus de 100\u00a0mg',
    );
    // Without that answer, no range is said.
    expect(bandedName(pack, aspirin, 'Aspirine (générique)', 'fr', t)).toBe('Aspirine (générique)');
    expect(
      bandedName(pack, { ...aspirin, strengthAtMostMg: 100 }, 'Aspirine (générique)', 'fr', t),
    ).toBe('Aspirine (générique), 100\u00a0mg ou moins');
    // "Je ne sais pas", or a box a name typed looks like: its dose not given, said.
    expect(
      bandedName(pack, { ...aspirin, strengthUnknown: true }, 'Aspirine (générique)', 'fr', t),
    ).toBe('Aspirine (générique), dosage non précisé');
    // A box with a strength keeps its name.
    expect(
      bandedName(
        pack,
        { ref: { kind: 'product', id: 'kardegic-75-mg-64755969' }, strengthUnknown: true },
        'KARDEGIC',
        'fr',
        t,
      ),
    ).toBe('KARDEGIC');
    expect(bandedName(pack, aspirin, 'Aspirin (generic)', 'en', translator('en'), true)).toBe(
      'Aspirin (generic), more than 100\u00a0mg',
    );
  });
});

describe('lowDoseTyped: a low dose chosen for her only from a typed "50 to 100 mg"', () => {
  const rows: [string, boolean][] = [
    ['aspirine 75 mg', true],
    ['aspirine 100 mg', true],
    ['aspirine 50 mg', true],
    ['aspirine 75mg', true],
    // No unit, a gram, below 50 mg or above the threshold: nothing chosen.
    ['aspirine 75', false],
    ['aspirine 0,5', false],
    ['aspirine 1', false],
    ['aspirine 0,075 g', false],
    ['aspirine 40 mg', false],
    ['aspirine 160 mg', false],
    ['aspirine 500 mg', false],
    // The count before "x" is never the strength.
    ['aspirine 2 x 500 mg', false],
    ['aspirine 2 x 50 mg', true],
    // Two strengths: which one is on the box is not said.
    ['aspirine 75 mg ou 500 mg', false],
    ['aspirine 75 mg 100 mg', false],
    ['aspirine', false],
  ];
  for (const [query, low] of rows) {
    it(`${low ? 'chooses' : 'never chooses'} "100 mg ou moins" for "${query}"`, () => {
      expect(lowDoseTyped(query, false, 100)).toBe(low);
    });
  }

  it('never chooses it from what the voice heard', () => {
    expect(lowDoseTyped('aspirine 75 mg', true, 100)).toBe(false);
  });
});

describe('productDoseRangeOf', () => {
  it('reads the lowest threshold of the substance, whatever their order', () => {
    expect(productDoseRangeOf(pack, 'aspirin-generic')).toBe(100);
    const rule = pack.rules.find((r) => r.id === 'aspirin-renal-failure') as Rule;
    const withThreshold = (mg: number): Pack => ({
      ...pack,
      rules: [
        ...pack.rules,
        { ...rule, id: `aspirin-test-${String(mg)}`, when: { ...rule.when, strengthAboveMg: mg } },
      ],
    });
    expect(productDoseRangeOf(withThreshold(300), 'aspirin-generic')).toBe(100);
    expect(productDoseRangeOf(withThreshold(50), 'aspirin-generic')).toBe(50);
  });

  it('reads none for a box with a strength', () => {
    expect(productDoseRangeOf(pack, 'kardegic-75-mg-64755969')).toBeUndefined();
  });
});
