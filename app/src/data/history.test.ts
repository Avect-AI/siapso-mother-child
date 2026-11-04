// SPDX-License-Identifier: MIT
import type { Evaluation } from '@siapso/engine';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../domain/types.js';
import { breakIndexedDB } from '../test/idb.js';
import { closeAppDb } from './db.js';
import {
  forgetVisit,
  HISTORY_PER_PROFILE,
  historyEntryOf,
  listHistory,
  recordHistory,
  recordHistoryOnce,
} from './history.js';

function entry(profileId: string, n: number): HistoryEntry {
  return {
    id: `${profileId}-${String(n)}`,
    profileId,
    // One minute apart, in order.
    at: new Date(Date.UTC(2026, 10, 4, 8, n)).toISOString(),
    packVersion: '0.1.0',
    level: 'unknown',
    ruleIds: [],
    items: [{ ref: { kind: 'plant', id: 'kinkeliba' } }],
    signs: [],
  };
}

describe('recordHistory', () => {
  it('keeps an evaluation on the phone, newest first', async () => {
    await recordHistory(entry('p1', 1));
    await recordHistory(entry('p1', 2));
    expect((await listHistory('p1')).map((e) => e.id)).toEqual(['p1-2', 'p1-1']);
    expect(await listHistory('p2')).toEqual([]);
  });

  it('keeps the last 20 evaluations of each profile, and only of that profile', async () => {
    expect(HISTORY_PER_PROFILE).toBe(20);
    await recordHistory(entry('p2', 0));
    for (let n = 1; n <= 23; n += 1) await recordHistory(entry('p1', n));
    const kept = await listHistory('p1');
    expect(kept).toHaveLength(20);
    expect(kept[0]?.id).toBe('p1-23');
    expect(kept.at(-1)?.id).toBe('p1-4');
    expect((await listHistory('p2')).map((e) => e.id)).toEqual(['p2-0']);
  });
});

describe('recordHistoryOnce', () => {
  it('records a check once in a visit: same profile, items, signs and pack version', async () => {
    const first = entry('p1', 1);
    expect(await recordHistoryOnce(first)).toBe(true);
    // The screen opened again on the same check (back, then forward): not again.
    expect(await recordHistoryOnce({ ...entry('p1', 2), items: first.items })).toBe(false);
    // The same items in another order are the same check.
    const two: HistoryEntry = {
      ...entry('p1', 3),
      items: [
        { ref: { kind: 'plant', id: 'kinkeliba' } },
        { ref: { kind: 'plant', id: 'moringa' } },
      ],
    };
    expect(await recordHistoryOnce(two)).toBe(true);
    expect(await recordHistoryOnce({ ...entry('p1', 4), items: [...two.items].reverse() })).toBe(
      false,
    );
    expect((await listHistory('p1')).map((e) => e.id)).toEqual(['p1-3', 'p1-1']);
  });

  it('records another check: other signs, items, units, pack version or profile', async () => {
    const base = entry('p1', 1);
    expect(await recordHistoryOnce(base)).toBe(true);
    expect(await recordHistoryOnce({ ...entry('p1', 2), signs: ['fever'] })).toBe(true);
    expect(
      await recordHistoryOnce({
        ...entry('p1', 3),
        items: [{ ref: { kind: 'plant', id: 'kinkeliba' }, unitsPerDay: 2 }],
      }),
    ).toBe(true);
    expect(await recordHistoryOnce({ ...entry('p1', 4), packVersion: '0.2.0' })).toBe(true);
    expect(await recordHistoryOnce(entry('p2', 5))).toBe(true);
    expect(await listHistory('p1')).toHaveLength(4);
  });

  it('records the same check again in a new visit, or after a failed write', async () => {
    expect(await recordHistoryOnce(entry('p1', 1))).toBe(true);
    forgetVisit();
    expect(await recordHistoryOnce(entry('p1', 2))).toBe(true);
    expect(await listHistory('p1')).toHaveLength(2);

    forgetVisit();
    breakIndexedDB('storage refused');
    closeAppDb();
    await expect(recordHistoryOnce(entry('p3', 1))).rejects.toThrow('storage refused');
    globalThis.indexedDB = new IDBFactory();
    closeAppDb();
    expect(await recordHistoryOnce(entry('p3', 2))).toBe(true);
  });
});

describe('historyEntryOf', () => {
  it('keeps every rule id of the findings, even those the screen merges, and the pack version', () => {
    const evaluation: Evaluation = {
      level: 'before-next-dose',
      findings: [
        {
          level: 'before-next-dose',
          check: 'C1',
          ruleId: 'from-20',
          items: [0],
          message: 'a',
          capped: false,
          sources: [],
        },
        {
          level: 'next-contact',
          check: 'C1',
          ruleId: 'before-20',
          items: [0],
          message: 'b',
          capped: false,
          sources: [],
        },
        {
          level: 'danger',
          check: 'C11',
          items: [],
          message: 'danger-sign',
          sign: 'fever',
          capped: false,
          sources: [],
        },
      ],
      reminders: [{ ruleId: 'iptp-reminder', message: 'iptp-reminder', sources: [] }],
      notes: [],
      pack: { version: '0.1.0', date: '2026-11-04', clinicallyValidated: false },
    };
    const items = [{ ref: { kind: 'product' as const, id: 'advil' }, unitsPerDay: 2 }];
    const made = historyEntryOf({
      id: 'h1',
      at: '2026-11-04T09:00:00.000Z',
      profileId: 'p1',
      evaluation,
      items,
      signs: ['fever'],
    });
    expect(made).toEqual({
      id: 'h1',
      profileId: 'p1',
      at: '2026-11-04T09:00:00.000Z',
      packVersion: '0.1.0',
      level: 'before-next-dose',
      ruleIds: ['from-20', 'before-20'],
      items,
      signs: ['fever'],
    });
    // A copy: changing the check later does not change the history.
    expect(made.items[0]).not.toBe(items[0]);
  });
});
