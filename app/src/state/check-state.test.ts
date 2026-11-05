// SPDX-License-Identifier: MIT
import type { CheckedItem } from '@siapso/engine';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { profileOf } from '../test/knowledge-pack.js';
import { activeProfile, sameRef, useCheckStore } from './check-state.js';

const paracetamol: CheckedItem = { ref: { kind: 'product', id: 'paracetamol-generic' } };
const moringa: CheckedItem = { ref: { kind: 'plant', id: 'moringa' } };
const EFFERALGAN = 'brand:efferalgan';
const EFFERALGAN_1000 = { kind: 'product', id: 'efferalgan-1000-mg-60025403' } as const;
const EFFERALGAN_500 = { kind: 'product', id: 'efferalgan-500-mg-67326925' } as const;

describe('useCheckStore', () => {
  it('starts empty, for no profile', () => {
    const { result } = renderHook(() => useCheckStore());
    expect(result.current).toMatchObject({ profileId: null, items: [], signs: [] });
  });

  it('adds items in order and removes one by its index', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('p1');
      result.current.add(paracetamol);
      result.current.add({ ...moringa });
      result.current.add({ ref: { kind: 'unrecognised', text: 'poudre' } });
    });
    expect(result.current.items).toEqual([
      paracetamol,
      moringa,
      { ref: { kind: 'unrecognised', text: 'poudre' } },
    ]);

    act(() => {
      result.current.remove(1);
    });
    expect(result.current.items).toEqual([
      paracetamol,
      { ref: { kind: 'unrecognised', text: 'poudre' } },
    ]);

    act(() => {
      result.current.remove(5);
    });
    expect(result.current.items).toHaveLength(2);
  });

  it('keeps the name typed for a product shown under another name, until the check is reset', () => {
    const cytotec: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('p1');
      result.current.add(cytotec, { written: 'cytotec' });
      result.current.add(moringa);
    });
    expect(result.current.writtenOf({ ...cytotec, ref: { ...cytotec.ref } })).toBe('cytotec');
    expect(result.current.writtenOf(moringa)).toBeUndefined();
    // Confirmed again under its own name: the name typed before is no longer said.
    act(() => {
      result.current.add(cytotec);
    });
    expect(result.current.writtenOf(cytotec)).toBeUndefined();
    act(() => {
      result.current.add(cytotec, { written: 'cytotec' });
      result.current.reset();
    });
    expect(result.current.writtenOf(cytotec)).toBeUndefined();
  });

  it('remembers a name kept as typed after "none of these", until the check is reset', () => {
    const coco: CheckedItem = { ref: { kind: 'unrecognised', text: 'huile de coco' } };
    const market: CheckedItem = { ref: { kind: 'unrecognised', text: 'poudre du marché' } };
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('p1');
      result.current.add(coco, { list: 'product', declined: true });
      result.current.add(market, { list: 'product' });
    });
    expect(
      result.current.declinedOf({ ref: { kind: 'unrecognised', text: 'Huile de coco ' } }),
    ).toBe(true);
    expect(result.current.declinedOf(market)).toBe(false);
    act(() => {
      result.current.reset();
    });
    expect(result.current.declinedOf(coco)).toBe(false);
  });

  it('keeps a count of units per day from 1 to 24 and refuses any other', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add({ ...paracetamol, unitsPerDay: 24 });
    });
    expect(result.current.items).toEqual([{ ...paracetamol, unitsPerDay: 24 }]);
    for (const unitsPerDay of [0, 25, 1.5, Number.NaN, -1]) {
      expect(() => {
        result.current.add({ ...paracetamol, unitsPerDay });
      }).toThrow(RangeError);
    }
    expect(() => {
      result.current.add({ ref: { kind: 'unrecognised', text: '  ' } });
    }).toThrow(RangeError);
    expect(result.current.items).toHaveLength(1);
  });

  it('keeps what the last add changed until the check screen has said so', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add(moringa);
    });
    expect(result.current.changed).toEqual({ kind: 'added', item: moringa });
    act(() => {
      result.current.clearChanged();
    });
    expect(result.current.changed).toBeNull();
    expect(result.current.items).toEqual([moringa]);
  });

  it('never lists the same product twice: a second add updates it in its place', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add({ ...paracetamol, unitsPerDay: 2 });
      result.current.add(moringa);
    });
    act(() => {
      result.current.add({ ...paracetamol, unitsPerDay: 2 });
    });
    expect(result.current.items).toEqual([{ ...paracetamol, unitsPerDay: 2 }, moringa]);
    expect(result.current.changed).toEqual({
      kind: 'already',
      item: { ...paracetamol, unitsPerDay: 2 },
    });

    act(() => {
      result.current.add({ ...paracetamol, unitsPerDay: 4 });
    });
    expect(result.current.items).toEqual([{ ...paracetamol, unitsPerDay: 4 }, moringa]);
    expect(result.current.changed?.kind).toBe('updated');

    // Units left blank this time: the item no longer has a count.
    act(() => {
      result.current.add(paracetamol);
    });
    expect(result.current.items[0]).toEqual(paracetamol);
  });

  it('never lets an item of unknown strength overwrite a known strength', () => {
    const { result } = renderHook(() => useCheckStore());
    const known: CheckedItem = { ref: EFFERALGAN_1000, unitsPerDay: 4 };
    act(() => {
      result.current.add(known, { family: EFFERALGAN });
      // "Non, une autre boîte": a separate item, the strength unknown.
      result.current.add(
        { ref: EFFERALGAN_1000, unitsPerDay: 2, strengthUnknown: true },
        { family: EFFERALGAN },
      );
    });
    expect(result.current.items).toEqual([
      known,
      { ref: EFFERALGAN_1000, unitsPerDay: 2, strengthUnknown: true },
    ]);
    expect(result.current.changed?.kind).toBe('added');
  });

  it('knows an item of unknown strength by its family: a second one of the family updates it', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add({ ref: EFFERALGAN_1000, strengthUnknown: true }, { family: EFFERALGAN });
      result.current.add(
        { ref: EFFERALGAN_500, strengthUnknown: true, unitsPerDay: 3 },
        { family: EFFERALGAN },
      );
    });
    expect(result.current.items).toEqual([
      { ref: EFFERALGAN_500, strengthUnknown: true, unitsPerDay: 3 },
    ]);
    expect(result.current.changed?.kind).toBe('updated');
  });

  it('puts a known strength in the place of an item of the family whose strength was unknown', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add(moringa);
      result.current.add(
        { ref: EFFERALGAN_1000, strengthUnknown: true, unitsPerDay: 2 },
        { family: EFFERALGAN },
      );
      result.current.add(paracetamol);
    });
    act(() => {
      result.current.add({ ref: EFFERALGAN_500, unitsPerDay: 2 }, { family: EFFERALGAN });
    });
    expect(result.current.items).toEqual([
      moringa,
      { ref: EFFERALGAN_500, unitsPerDay: 2 },
      paracetamol,
    ]);
    expect(result.current.changed?.kind).toBe('updated');
  });

  it('lists a known strength apart when she said it is another box', () => {
    const { result } = renderHook(() => useCheckStore());
    const unknown: CheckedItem = { ref: EFFERALGAN_1000, strengthUnknown: true, unitsPerDay: 2 };
    act(() => {
      result.current.add(unknown, { family: EFFERALGAN });
      result.current.add({ ref: EFFERALGAN_500 }, { family: EFFERALGAN, anotherBox: true });
    });
    expect(result.current.items).toEqual([unknown, { ref: EFFERALGAN_500 }]);
    expect(result.current.changed?.kind).toBe('added');
  });

  it('refuses a strengthUnknown that is not a boolean, as the engine does', () => {
    const { result } = renderHook(() => useCheckStore());
    expect(() => {
      result.current.add({ ...paracetamol, strengthUnknown: 'yes' } as unknown as CheckedItem);
    }).toThrow(TypeError);
    expect(result.current.items).toEqual([]);
  });

  it('never lists the same text twice as unrecognised, whatever its case and spaces', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add(
        { ref: { kind: 'unrecognised', text: 'Poudre du marché' } },
        { list: 'plant' },
      );
      result.current.add(
        { ref: { kind: 'unrecognised', text: 'poudre du marché' } },
        { list: 'plant' },
      );
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.changed?.kind).toBe('already');
  });

  it('remembers the list an unrecognised item was typed in', () => {
    const { result } = renderHook(() => useCheckStore());
    const powder: CheckedItem = { ref: { kind: 'unrecognised', text: 'poudre' } };
    const syrup: CheckedItem = { ref: { kind: 'unrecognised', text: 'sirop rouge' } };
    act(() => {
      result.current.add(powder, { list: 'plant' });
      result.current.add(syrup, { list: 'product' });
      result.current.add(paracetamol);
    });
    expect(result.current.listOf(powder)).toBe('plant');
    expect(result.current.listOf(syrup)).toBe('product');
    expect(result.current.listOf(paracetamol)).toBeUndefined();
  });

  it('finds the item of a product already listed', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add(moringa);
      result.current.add({ ...paracetamol, unitsPerDay: 3 });
    });
    expect(result.current.indexOf(paracetamol.ref)).toBe(1);
    expect(result.current.indexOf({ kind: 'plant', id: 'kinkeliba' })).toBe(-1);
    expect(sameRef(paracetamol.ref, { kind: 'product', id: 'paracetamol-generic' })).toBe(true);
    expect(sameRef(paracetamol.ref, moringa.ref)).toBe(false);
  });

  it('puts a removed item back at its place', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add(paracetamol);
      result.current.add(moringa);
      result.current.remove(0);
    });
    expect(result.current.changed).toBeNull();
    act(() => {
      result.current.restore(0, paracetamol);
    });
    expect(result.current.items).toEqual([paracetamol, moringa]);
    act(() => {
      result.current.restore(9, { ref: { kind: 'unrecognised', text: 'poudre' } });
    });
    expect(result.current.items.at(-1)).toEqual({ ref: { kind: 'unrecognised', text: 'poudre' } });
    expect(() => {
      result.current.restore(0, { ...paracetamol, unitsPerDay: 0 });
    }).toThrow(RangeError);
  });

  it('keeps the danger signs given', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.setSigns(['bleeding', 'fever']);
    });
    expect(result.current.signs).toEqual(['bleeding', 'fever']);
  });

  it('tells "none of these signs" from no answer yet', () => {
    const { result } = renderHook(() => useCheckStore());
    expect(result.current).toMatchObject({ signs: [], signsGiven: false });
    act(() => {
      result.current.start('p1');
      result.current.setSigns([]);
    });
    expect(result.current).toMatchObject({ signs: [], signsGiven: true });
    // The answer stays while the list changes; a check for another profile asks again.
    act(() => {
      result.current.add(paracetamol);
    });
    expect(result.current.signsGiven).toBe(true);
    act(() => {
      result.current.start('p2');
    });
    expect(result.current.signsGiven).toBe(false);
  });

  it('keeps the check when it starts again for the same profile, and empties it for another', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('p1');
      result.current.add(paracetamol);
      result.current.setSigns(['fever']);
      result.current.start('p1');
    });
    expect(result.current).toMatchObject({ profileId: 'p1', items: [paracetamol] });

    act(() => {
      result.current.start('p2');
    });
    expect(result.current).toMatchObject({ profileId: 'p2', items: [], signs: [] });
  });

  it('gives the items added before any profile to the first profile it starts for', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.add(moringa);
      result.current.start('p1');
    });
    expect(result.current).toMatchObject({ profileId: 'p1', items: [moringa] });
  });

  it('resets to no check at all', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('p1');
      result.current.add(paracetamol);
      result.current.setSigns(['fever']);
      result.current.reset();
    });
    expect(result.current).toMatchObject({ profileId: null, items: [], signs: [] });
  });
});

describe('activeProfile', () => {
  const older = profileOf({
    id: 'a',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
  });
  const newer = profileOf({
    id: 'b',
    createdAt: '2026-11-02T08:00:00.000Z',
    updatedAt: '2026-11-03T08:00:00.000Z',
  });
  const edited = profileOf({
    id: 'c',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-11-04T08:00:00.000Z',
  });

  it('is none without a profile', () => {
    expect(activeProfile([], 'woman', null)).toBeUndefined();
    expect(activeProfile([], 'accompanied', 'a')).toBeUndefined();
  });

  it('is her profile in woman mode', () => {
    expect(activeProfile([older, newer], 'woman', null)).toBe(older);
  });

  it('is the profile chosen for the check in accompanied mode, never one picked by default', () => {
    expect(activeProfile([older, newer, edited], 'accompanied', 'b')).toBe(newer);
    expect(activeProfile([older, newer, edited], 'accompanied', null)).toBeUndefined();
    expect(activeProfile([older, newer, edited], 'accompanied', 'gone')).toBeUndefined();
  });
});
