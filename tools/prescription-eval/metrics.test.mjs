// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { addScores, emptyScore, rates, scoreReading } from './metrics.mjs';

const normalize = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const substancesOf = (id) =>
  ({ dolip: 'paracetamol', parac: 'paracetamol', sp: 'pyrimethamine+sulfadoxine' })[id] ?? id;

const rx = {
  items: [
    { written: 'Doliprane 1000 mg', product: 'dolip', inBase: true, strengthMg: 1000, upd: 3 },
    { written: 'Fansidar cp', product: 'sp', inBase: true, upd: 3 },
    { written: 'Spasfon Lyoc 80 mg', inBase: false },
  ],
};

describe('scoreReading', () => {
  it('counts a product found by its substances, with its strength and units per day', () => {
    const s = scoreReading(
      rx,
      {
        proposals: [
          {
            substances: 'paracetamol',
            strengthMg: 1000,
            unitsPerDay: 3,
            line: 'Doliprane 1000 mg',
          },
        ],
        leftovers: ['Spasfon Lyoc 80 mg'],
      },
      substancesOf,
      normalize,
    );
    expect(s.expected).toBe(2);
    expect(s.found).toBe(1);
    expect(s.falseProducts).toBe(0);
    expect(s.strength).toEqual({ expected: 1, right: 1, wrong: 0 });
    expect(s.units).toEqual({ expected: 1, right: 1, wrong: 0 });
    expect(s.outOfBase).toEqual({ items: 1, kept: 1 });
  });

  it('counts a product of other substances as false, and says when it comes from a product outside the pack', () => {
    const s = scoreReading(
      rx,
      {
        proposals: [
          { substances: 'phloroglucinol', line: 'Spasfon Lyoc 80 mg' },
          { substances: 'tramadol', line: 'Nom : Awa' },
        ],
        leftovers: [],
      },
      substancesOf,
      normalize,
    );
    expect(s.falseProducts).toBe(2);
    expect(s.falseFromOutOfBase).toBe(1);
    expect(s.outOfBase.kept).toBe(0);
  });

  it('says when a false product is one part of a combination of the prescription', () => {
    const s = scoreReading(
      rx,
      { proposals: [{ substances: 'pyrimethamine', line: 'SP (Pyriméthamine)' }], leftovers: [] },
      substancesOf,
      normalize,
    );
    expect(s.falseProducts).toBe(1);
    expect(s.falsePartial).toBe(1);
    expect(s.falseFromOutOfBase).toBe(0);
  });

  it('never counts a second proposal of a product found as a new product, and a wrong strength as wrong', () => {
    const s = scoreReading(
      rx,
      {
        proposals: [
          { substances: 'paracetamol', strengthMg: 500, line: 'Doliprane 1000 mg' },
          { substances: 'paracetamol', line: 'Doliprane' },
        ],
        leftovers: [],
      },
      substancesOf,
      normalize,
    );
    expect(s.found).toBe(1);
    expect(s.falseProducts).toBe(0);
    expect(s.strength).toEqual({ expected: 1, right: 0, wrong: 1 });
    expect(s.units).toEqual({ expected: 1, right: 0, wrong: 0 });
  });
});

describe('addScores and rates', () => {
  it('adds scores and gives recall and precision', () => {
    const a = { ...emptyScore(), expected: 4, found: 3, falseProducts: 1 };
    const b = { ...emptyScore(), expected: 2, found: 1, falseProducts: 0 };
    const sum = addScores(a, b);
    expect(sum.expected).toBe(6);
    expect(rates(sum)).toEqual({ recall: 4 / 6, precision: 4 / 5 });
    expect(rates(emptyScore())).toEqual({ recall: 0, precision: 0 });
  });
});
