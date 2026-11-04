// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { entriesFromPack } from '../src/index.js';

const PACK = {
  substances: [
    { id: 'paracetamol', names: { fr: 'paracétamol', en: 'paracetamol' } },
    { id: 'codeine', names: { fr: 'codéine', en: 'codeine' } },
  ],
  products: [
    {
      id: 'doliprane-1000',
      names: { fr: 'DOLIPRANE 1000 mg, comprimé', en: 'DOLIPRANE 1000 mg, tablet' },
      brands: ['DOLIPRANE'],
      localNames: [{ text: 'dolipran', lang: 'wo' as const }],
      components: [{ substance: 'paracetamol', strengthMg: 1000 }],
    },
    {
      id: 'paracetamol-generic',
      names: { fr: 'Paracétamol (générique)', en: 'Paracetamol (generic)' },
      brands: [],
      localNames: [],
      components: [{ substance: 'paracetamol' }],
    },
    {
      id: 'combo',
      names: { fr: 'Combo', en: 'Combo' },
      brands: ['Combo'],
      localNames: [],
      components: [
        { substance: 'paracetamol', strengthMg: 500 },
        { substance: 'codeine', strengthMg: 30 },
      ],
    },
  ],
  plants: [
    {
      id: 'moringa',
      latinName: 'Moringa oleifera',
      names: { fr: 'Moringa', en: 'Moringa' },
      localNames: [{ text: 'nebeday', lang: 'wo' as const }],
    },
  ],
};

const entries = entriesFromPack(PACK);
const byKey = (id: string, priority: number) =>
  entries.find((item) => item.id === id && item.priority === priority);

describe('entriesFromPack', () => {
  it('indexes a brand product at priority 3 with its names, brands and local names', () => {
    const item = byKey('doliprane-1000', 3);
    expect(item?.kind).toBe('product');
    expect(item?.display).toEqual({
      fr: 'DOLIPRANE 1000 mg, comprimé',
      en: 'DOLIPRANE 1000 mg, tablet',
    });
    expect(item?.names).toContainEqual({ text: 'DOLIPRANE', lang: 'brand' });
    expect(item?.names).toContainEqual({ text: 'DOLIPRANE 1000 mg, comprimé', lang: 'fr' });
    expect(item?.names).toContainEqual({ text: 'DOLIPRANE 1000 mg, tablet', lang: 'en' });
    expect(item?.names).toContainEqual({ text: 'dolipran', lang: 'wo' });
  });

  it('puts the INN names of a brand product in a separate entry at priority 1', () => {
    const inn = byKey('doliprane-1000', 1);
    expect(inn?.names).toEqual([
      { text: 'paracétamol', lang: 'inn' },
      { text: 'paracetamol', lang: 'inn' },
    ]);
    expect(byKey('doliprane-1000', 3)?.names.some((name) => name.lang === 'inn')).toBe(false);
  });

  it('indexes a generic product (no brand) at priority 2 with its INN names inside', () => {
    const item = byKey('paracetamol-generic', 2);
    expect(item?.names).toContainEqual({ text: 'paracétamol', lang: 'inn' });
    expect(item?.names).toContainEqual({ text: 'Paracétamol (générique)', lang: 'fr' });
    expect(byKey('paracetamol-generic', 1)).toBeUndefined();
  });

  it('describes the substances and strengths in detail', () => {
    expect(byKey('doliprane-1000', 3)?.detail).toBe('paracétamol 1000 mg');
    expect(byKey('paracetamol-generic', 2)?.detail).toBe('paracétamol');
    expect(byKey('combo', 3)?.detail).toBe('paracétamol 500 mg, codéine 30 mg');
  });

  it('indexes a plant at priority 2 with its Latin name and local names', () => {
    const item = byKey('moringa', 2);
    expect(item?.kind).toBe('plant');
    expect(item?.names).toContainEqual({ text: 'Moringa oleifera', lang: 'latin' });
    expect(item?.names).toContainEqual({ text: 'nebeday', lang: 'wo' });
    expect(item?.names).toContainEqual({ text: 'Moringa', lang: 'fr' });
  });

  it('does not repeat identical names', () => {
    const item = byKey('moringa', 2);
    const texts = item?.names.map((name) => `${name.lang}:${name.text}`) ?? [];
    expect(new Set(texts).size).toBe(texts.length);
    expect(item?.names.filter((name) => name.text === 'Moringa')).toHaveLength(1);
  });

  it('gives each entry a family: the brand, or the sorted substances of a generic', () => {
    expect(byKey('doliprane-1000', 3)?.family).toBe('brand:dolipran');
    expect(byKey('doliprane-1000', 1)?.family).toBe('brand:dolipran');
    expect(byKey('paracetamol-generic', 2)?.family).toBe('substances:paracetamol');
    expect(byKey('moringa', 2)?.family).toBe('moringa');
    const odd = entriesFromPack({
      ...PACK,
      products: PACK.products.slice(2).map((product) => ({ ...product, brands: [] })),
    });
    expect(odd[0]?.family).toBe('substances:codeine+paracetamol');
  });

  it('records the strengths and the number of components', () => {
    expect(byKey('combo', 3)).toMatchObject({ strengths: [500, 30], componentCount: 2 });
    expect(byKey('paracetamol-generic', 2)).toMatchObject({ strengths: [], componentCount: 1 });
    expect(byKey('doliprane-1000', 1)).toMatchObject({ strengths: [1000], componentCount: 1 });
  });

  it('skips an unknown substance instead of failing', () => {
    const odd = entriesFromPack({
      ...PACK,
      products: PACK.products.slice(0, 1).map((product) => ({
        ...product,
        components: [{ substance: 'unknown' }],
      })),
      plants: [],
    });
    expect(odd[0]?.detail).toBe('');
  });
});
