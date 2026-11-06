// SPDX-License-Identifier: MIT
import type { CheckedItem, Pack } from '@siapso/engine';
import { search, type Candidate } from '@siapso/resolver';
import { beforeAll, describe, expect, it } from 'vitest';
import { knowledgePack } from '../test/knowledge-pack.js';
import { oneTapItem } from './one-tap.js';
import { searchIndexOf } from './search-index.js';

let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

/** The first candidate the search proposes for `query` in a list. */
function first(query: string, kind: 'product' | 'plant' = 'product'): Candidate {
  const [best] = search(searchIndexOf(pack), query, { kinds: [kind] });
  if (best === undefined) throw new Error(`no candidate for ${query}`);
  return best;
}

function tap(query: string, options: { heard?: boolean; items?: CheckedItem[] } = {}) {
  return oneTapItem(pack, first(query), query, {
    heard: options.heard ?? false,
    items: options.items ?? [],
  });
}

describe('one tap adds a product (SCRUM-56, S11, as the safety review set it)', () => {
  it('adds a product found by its whole name, nothing to ask: the tap is the confirmation', () => {
    const item = tap('ibuprofene');
    expect(item?.ref).toMatchObject({ kind: 'product' });
  });

  it('keeps the strength typed when it agrees with the box', () => {
    const item = tap('clamoxyl 1g');
    expect(item?.ref.kind === 'product' ? item.ref.id : '').toMatch(/^clamoxyl-1-g-/);
    expect(item).not.toHaveProperty('strengthUnknown');
  });

  it('asks first when the strength typed is on no box of the family, never dropping it (clamoxyl 3g)', () => {
    expect(first('clamoxyl 3g').match).toBe('exact');
    expect(tap('clamoxyl 3g')).toBeNull();
    expect(tap('advilmed 200')).toBeNull();
    expect(tap('advilmed 400')).not.toBeNull();
  });

  it('keeps a family no rule reads the strength of with its strength not given, said so', () => {
    expect(tap('clamoxyl')).toMatchObject({ strengthUnknown: true });
  });

  it('asks first ("Est-ce bien ce produit ?") when a substance named is not in the product', () => {
    const advil = first('advil');
    expect(advil.id).toMatch(/^advil-/);
    expect(oneTapItem(pack, advil, 'advil', { heard: false, items: [] })).not.toBeNull();
    // The same row found by a name that also says codeine: ADVIL holds none.
    expect(oneTapItem(pack, advil, 'advil codeine', { heard: false, items: [] })).toBeNull();
  });

  it('asks first for a spelling close to a name, never the name itself', () => {
    expect(first('ibuprofne').match).not.toBe('exact');
    expect(tap('ibuprofne')).toBeNull();
  });

  it('asks first for a local name, which nobody has checked against the box', () => {
    const nebeday = first('nebeday', 'plant');
    expect(oneTapItem(pack, nebeday, 'nebeday', { heard: false, items: [] })).toBeNull();
  });

  it('asks first what a rule needs: the strength of aspirin, the daily count of paracetamol', () => {
    expect(tap('kardegic')).toBeNull();
    expect(tap('doliprane')).toBeNull();
    expect(tap('paracetamol')).toBeNull();
  });

  it('asks first for a name the voice heard unless it is a whole name', () => {
    expect(tap('ibuprofne', { heard: true })).toBeNull();
    expect(tap('ibuprofene', { heard: true })?.ref).toMatchObject({ kind: 'product' });
  });

  it('asks first when the family is listed already (is it the same box?)', () => {
    const listed = tap('clamoxyl 1g');
    expect(listed).not.toBeNull();
    expect(tap('clamoxyl', { items: listed === null ? [] : [listed] })).toBeNull();
  });
});
