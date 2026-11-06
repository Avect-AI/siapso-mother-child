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

  it('remembers that the voice heard a name, for the name she said and a text kept as said', () => {
    const ibuprofen: CheckedItem = { ref: { kind: 'product', id: 'ibuprofen-generic' } };
    const syrup: CheckedItem = { ref: { kind: 'unrecognised', text: 'sirop du marché' } };
    const typed: CheckedItem = { ref: { kind: 'unrecognised', text: 'poudre' } };
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('p1');
      result.current.add(ibuprofen, { written: 'birufen', said: true });
      result.current.add(syrup, { list: 'product', said: true });
      result.current.add(typed, { list: 'product' });
    });
    expect(result.current.saidOf(ibuprofen)).toBe(true);
    expect(result.current.saidOf({ ref: { kind: 'unrecognised', text: 'Sirop du marché' } })).toBe(
      true,
    );
    expect(result.current.saidOf(typed)).toBe(false);
    // Confirmed again from a typed name: it is no longer said to be heard.
    act(() => {
      result.current.add(ibuprofen, { written: 'brufenn' });
    });
    expect(result.current.saidOf(ibuprofen)).toBe(false);
    act(() => {
      result.current.reset();
    });
    expect(result.current.saidOf(syrup)).toBe(false);
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

  it('lists two boxes of one product with two dose ranges apart, never one in place of the other', () => {
    const { result } = renderHook(() => useCheckStore());
    const aspirin: CheckedItem = { ref: { kind: 'product', id: 'aspirin-generic' } };
    const low: CheckedItem = { ...aspirin, strengthAtMostMg: 100 };
    act(() => {
      result.current.add(aspirin);
    });
    act(() => {
      result.current.add(low);
    });
    // "Plus de 100 mg" then "100 mg ou moins": two boxes, the first still read above 100 mg.
    expect(result.current.items).toEqual([aspirin, low]);
    expect(result.current.changed?.kind).toBe('added');
    act(() => {
      result.current.add(low);
    });
    expect(result.current.changed?.kind).toBe('already');
    expect(result.current.items).toHaveLength(2);

    // Nor in the place of the same box read as not known ("Je ne sais pas").
    const { result: other } = renderHook(() => useCheckStore());
    act(() => {
      other.current.add({ ...aspirin, strengthUnknown: true }, { family: 'substances:aspirin' });
      other.current.add(low, { family: 'substances:aspirin' });
    });
    expect(other.current.items).toEqual([{ ...aspirin, strengthUnknown: true }, low]);
  });

  it('puts an item in the place of the one it replaces, when she said it is the same box', () => {
    const { result } = renderHook(() => useCheckStore());
    const aspirin: CheckedItem = { ref: { kind: 'product', id: 'aspirin-generic' } };
    const low: CheckedItem = { ...aspirin, strengthAtMostMg: 100 };
    act(() => {
      result.current.add(low);
      result.current.add(moringa);
    });
    act(() => {
      result.current.add(aspirin, { replacing: low });
    });
    expect(result.current.items).toEqual([aspirin, moringa]);
    expect(result.current.changed?.kind).toBe('updated');
  });

  it('refuses a dose range that is not a number greater than 0, as the engine does', () => {
    const { result } = renderHook(() => useCheckStore());
    for (const bad of [0, -100, Number.NaN, '100']) {
      expect(() => {
        result.current.add({ ...paracetamol, strengthAtMostMg: bad } as unknown as CheckedItem);
      }).toThrow(RangeError);
    }
    expect(result.current.items).toEqual([]);
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
    act(() => {
      result.current.start('p2');
    });
    expect(result.current.signsGiven).toBe(false);
  });

  it('asks the signs again once the list changes: the answer was about the list as it was', () => {
    const { result } = renderHook(() => useCheckStore());
    const answered = () => {
      act(() => {
        result.current.setSigns(['fever']);
      });
      expect(result.current).toMatchObject({ signs: ['fever'], signsGiven: true });
    };
    act(() => {
      result.current.start('p1');
    });
    answered();
    act(() => {
      result.current.add(paracetamol);
    });
    expect(result.current).toMatchObject({ signs: [], signsGiven: false });
    answered();
    act(() => {
      result.current.remove(0);
    });
    expect(result.current).toMatchObject({ signs: [], signsGiven: false });
    answered();
    act(() => {
      result.current.restore(0, paracetamol);
    });
    expect(result.current).toMatchObject({ signs: [], signsGiven: false });
    // The same item given again changes nothing: the answer stays.
    answered();
    act(() => {
      result.current.add(paracetamol);
    });
    expect(result.current.signsGiven).toBe(true);
  });

  it('forgets the signs answer on clearSigns, keeping the list', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('p1');
      result.current.add(paracetamol);
      result.current.setSigns(['fever']);
      result.current.clearSigns();
    });
    expect(result.current).toMatchObject({ items: [paracetamol], signs: [], signsGiven: false });
  });

  it('keeps the check when it starts again for the same profile, and starts empty for another', () => {
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

  it("keeps each woman's unfinished list while another woman is looked at (live test round 2)", () => {
    const cytotec: CheckedItem = { ref: { kind: 'product', id: 'misoprostol-generic' } };
    const coco: CheckedItem = { ref: { kind: 'unrecognised', text: 'huile de coco' } };
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('bineta');
      result.current.add(cytotec, { written: 'cytotec' });
      result.current.add(coco, { list: 'plant', declined: true });
      result.current.setSigns(['fever']);
      result.current.start('coumba');
      result.current.add(moringa);
    });
    expect(result.current).toMatchObject({ profileId: 'coumba', items: [moringa] });
    expect(result.current.pendingOf('bineta')).toBe(2);
    expect(result.current.pendingOf('coumba')).toBe(1);
    expect(result.current.pendingOf('awa')).toBe(0);

    act(() => {
      result.current.start('bineta');
    });
    // Her list as she left it, with what was said about each item.
    expect(result.current).toMatchObject({ profileId: 'bineta', items: [cytotec, coco] });
    expect(result.current.writtenOf(cytotec)).toBe('cytotec');
    expect(result.current.listOf(coco)).toBe('plant');
    expect(result.current.declinedOf(coco)).toBe(true);
    // The signs present now are asked again: they may have changed meanwhile.
    expect(result.current).toMatchObject({ signs: [], signsGiven: false });
    expect(result.current.pendingOf('coumba')).toBe(1);
    // A name typed for one woman is never said for another.
    act(() => {
      result.current.start('coumba');
    });
    expect(result.current.writtenOf(cytotec)).toBeUndefined();
  });

  it('forgets the lists of the other women at a lock, keeping the one on screen', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('bineta');
      result.current.add(paracetamol);
      result.current.start('coumba');
      result.current.add(moringa);
      result.current.forgetOthers();
    });
    expect(result.current).toMatchObject({ profileId: 'coumba', items: [moringa] });
    expect(result.current.pendingOf('bineta')).toBe(0);
    act(() => {
      result.current.start('bineta');
    });
    expect(result.current.items).toEqual([]);
  });

  it('forgets every list at a reset (the quick exit)', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('bineta');
      result.current.add(paracetamol);
      result.current.start('coumba');
      result.current.reset();
      result.current.start('bineta');
    });
    expect(result.current.items).toEqual([]);
  });

  it('forgets the list of one woman whose profile is deleted, and only hers', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('bineta');
      result.current.add(paracetamol);
      result.current.start('coumba');
      result.current.add(moringa);
      result.current.forget('bineta');
    });
    expect(result.current).toMatchObject({ profileId: 'coumba', items: [moringa] });
    expect(result.current.pendingOf('bineta')).toBe(0);

    act(() => {
      result.current.start('bineta');
      result.current.add(paracetamol);
      result.current.forget('bineta');
    });
    expect(result.current).toMatchObject({ profileId: null, items: [] });
    expect(result.current.pendingOf('coumba')).toBe(1);
  });

  it('checks a passer-by without a profile: her answers in memory, a new check each time', () => {
    const passerBy = profileOf({ id: 'quick-1', pseudonym: '' });
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('bineta');
      result.current.add(paracetamol);
      result.current.startQuick(passerBy);
      result.current.add(moringa);
    });
    expect(result.current).toMatchObject({ profileId: 'quick-1', items: [moringa] });
    expect(result.current.quick).toBe(passerBy);
    // The woman left for the passer-by keeps her list.
    expect(result.current.pendingOf('bineta')).toBe(1);

    // The next passer-by starts from nothing.
    const next = profileOf({ id: 'quick-2', pseudonym: '' });
    act(() => {
      result.current.startQuick(next);
    });
    expect(result.current).toMatchObject({ profileId: 'quick-2', items: [] });
    expect(result.current.pendingOf('quick-1')).toBe(0);

    // Going back to a woman lets the passer-by go: nothing of hers is kept.
    act(() => {
      result.current.add(moringa);
      result.current.start('bineta');
    });
    expect(result.current).toMatchObject({ profileId: 'bineta', items: [paracetamol] });
    expect(result.current.quick).toBeNull();
    expect(result.current.pendingOf('quick-2')).toBe(0);
  });

  it('lets a passer-by go on demand (a lock, a change of mode), keeping the lists waiting', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.start('bineta');
      result.current.add(paracetamol);
      result.current.startQuick(profileOf({ id: 'quick-1' }));
      result.current.add(moringa);
      result.current.forgetQuick();
    });
    expect(result.current).toMatchObject({ profileId: null, items: [], quick: null });
    expect(result.current.pendingOf('bineta')).toBe(1);

    // Nothing to let go: nothing changes.
    act(() => {
      result.current.start('bineta');
      result.current.forgetQuick();
    });
    expect(result.current).toMatchObject({ profileId: 'bineta', items: [paracetamol] });
  });

  it('lets a passer-by go at a reset', () => {
    const { result } = renderHook(() => useCheckStore());
    act(() => {
      result.current.startQuick(profileOf({ id: 'quick-1' }));
      result.current.add(moringa);
      result.current.reset();
    });
    expect(result.current).toMatchObject({ profileId: null, items: [], quick: null });
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

  it('is her own profile in woman mode, marked as hers, wherever it is in the list', () => {
    const mine = { ...newer, self: true };
    expect(activeProfile([older, mine], 'woman', null)).toBe(mine);
    expect(activeProfile([{ ...older, self: false }, mine], 'woman', 'a')).toBe(mine);
  });

  it("never opens another woman's profile in woman mode", () => {
    // Profiles made in accompanied mode, none of them hers.
    expect(
      activeProfile(
        [
          { ...older, self: false },
          { ...newer, self: false },
        ],
        'woman',
        null,
      ),
    ).toBeUndefined();
    expect(activeProfile([{ ...older, self: false }], 'woman', null)).toBeUndefined();
    // Older records, unmarked: one alone is hers; among several, none is taken.
    expect(activeProfile([older], 'woman', null)).toBe(older);
    expect(activeProfile([older, newer], 'woman', null)).toBeUndefined();
  });

  it('is the profile chosen for the check in accompanied mode, never one picked by default', () => {
    expect(activeProfile([older, newer, edited], 'accompanied', 'b')).toBe(newer);
    expect(activeProfile([older, newer, edited], 'accompanied', null)).toBeUndefined();
    expect(activeProfile([older, newer, edited], 'accompanied', 'gone')).toBeUndefined();
  });
});
