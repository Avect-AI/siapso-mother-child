// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { itemMatches, substancesOf } from '../src/index.js';
import type { CheckedItem, Pack } from '../src/index.js';
import { deepFreeze } from './fixtures/freeze.js';
import { fixturePack } from './fixtures/pack.js';

const pack = deepFreeze(fixturePack());
const product = (id: string): CheckedItem => deepFreeze({ ref: { kind: 'product', id } });
const plant = (id: string): CheckedItem => deepFreeze({ ref: { kind: 'plant', id } });
const unrecognised: CheckedItem = deepFreeze({ ref: { kind: 'unrecognised', text: 'Xyzol' } });

describe('itemMatches', () => {
  it('matches a substance held by a product component', () => {
    expect(itemMatches(pack, product('sp'), { substance: 'sulfadoxine' })).toBe(true);
    expect(itemMatches(pack, product('sp'), { substance: 'pyrimethamine' })).toBe(true);
    expect(itemMatches(pack, product('sp'), { substance: 'paracetamol' })).toBe(false);
  });

  it('matches a class through the substances of the product', () => {
    expect(itemMatches(pack, product('ibuprofen-400'), { class: 'nsaid' })).toBe(true);
    expect(itemMatches(pack, product('asaq'), { class: 'antimalarial' })).toBe(true);
    expect(itemMatches(pack, product('paracetamol-500'), { class: 'nsaid' })).toBe(false);
  });

  it('does not match a class through an excluded substance', () => {
    const base = fixturePack();
    const excluding: Pack = deepFreeze({
      ...base,
      classes: base.classes.map((c) =>
        c.id === 'antimalarial' ? { ...c, excludes: ['amodiaquine'] } : c,
      ),
    });
    expect(itemMatches(excluding, product('asaq'), { class: 'antimalarial' })).toBe(true);
    expect(itemMatches(excluding, product('quinine-300'), { class: 'antimalarial' })).toBe(true);
    const onlyAmodiaquine: Pack = deepFreeze({
      ...excluding,
      products: [
        {
          id: 'aq',
          names: { fr: 'aq', en: 'aq' },
          brands: [],
          localNames: [],
          components: [{ substance: 'amodiaquine' }],
          form: 'tablet',
          route: 'oral',
          demo: true,
        },
      ],
    });
    expect(itemMatches(onlyAmodiaquine, product('aq'), { class: 'antimalarial' })).toBe(false);
  });

  it('matches a plant item by its id only', () => {
    expect(itemMatches(pack, plant('moringa'), { plant: 'moringa' })).toBe(true);
    expect(itemMatches(pack, plant('moringa'), { plant: 'clay' })).toBe(false);
    expect(itemMatches(pack, plant('moringa'), { substance: 'moringa' })).toBe(false);
    expect(itemMatches(pack, plant('moringa'), { class: 'nsaid' })).toBe(false);
    expect(itemMatches(pack, product('sp'), { plant: 'moringa' })).toBe(false);
  });

  it('never matches an unrecognised item or an id missing from the pack', () => {
    expect(itemMatches(pack, unrecognised, { substance: 'paracetamol' })).toBe(false);
    expect(itemMatches(pack, unrecognised, { plant: 'moringa' })).toBe(false);
    expect(itemMatches(pack, product('missing'), { substance: 'paracetamol' })).toBe(false);
    expect(itemMatches(pack, plant('missing'), { plant: 'missing' })).toBe(false);
  });
});

describe('substancesOf', () => {
  it('lists the substances of a product in component order', () => {
    expect(substancesOf(pack, product('sp'))).toEqual(['sulfadoxine', 'pyrimethamine']);
    expect(substancesOf(pack, product('paracetamol-500'))).toEqual(['paracetamol']);
  });

  it('lists nothing for a plant, an unrecognised item or an unknown product', () => {
    expect(substancesOf(pack, plant('moringa'))).toEqual([]);
    expect(substancesOf(pack, unrecognised)).toEqual([]);
    expect(substancesOf(pack, product('missing'))).toEqual([]);
  });
});
