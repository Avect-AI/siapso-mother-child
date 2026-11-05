// SPDX-License-Identifier: MIT
import type { Evaluation } from '@siapso/engine';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../domain/types.js';
import { breakIndexedDB } from '../test/idb.js';
import { profileOf } from '../test/knowledge-pack.js';
import { openVaultOf, verifierOf } from '../test/verifier.js';
import { closeAppDb, openAppDb, storeVerifier } from './db.js';
import {
  forgetVisit,
  HISTORY_PER_PROFILE,
  historyEntryOf,
  latestHistoryAt,
  listHistory,
  recordHistory,
  recordHistoryOnce,
} from './history.js';
import { deleteProfile, saveProfile } from './profiles.js';
import { closeVault, LockedError } from './vault.js';

// Profile data is written only while a code is on the phone (code-guard.ts),
// and read or written only while the code is open in the page (vault.ts).
beforeEach(async () => {
  await storeVerifier(await verifierOf('2468'));
  await openVaultOf('2468');
});

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

// History is kept only for a profile that is on the phone.
beforeEach(async () => {
  for (const id of ['p1', 'p2', 'p3']) await saveProfile(profileOf({ id }));
});

describe('recordHistory', () => {
  it('keeps nothing for a profile no longer on the phone (deleted meanwhile)', async () => {
    await deleteProfile('p2');
    expect(await recordHistory(entry('p2', 1))).toBe(false);
    expect(await listHistory('p2')).toEqual([]);
    expect(await recordHistoryOnce(entry('p2', 2))).toBe(false);
    expect(await listHistory('p2')).toEqual([]);
  });

  it('gives the day of the latest evaluation kept for a profile', async () => {
    expect(await latestHistoryAt('p1')).toBeUndefined();
    await recordHistory(entry('p1', 2));
    await recordHistory(entry('p1', 1));
    expect(await latestHistoryAt('p1')).toBe(entry('p1', 2).at);
  });

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

describe('history at rest', () => {
  const kept = (): HistoryEntry => ({
    ...entry('p1', 1),
    level: 'danger',
    ruleIds: ['misoprostol-pregnancy'],
    items: [{ ref: { kind: 'unrecognised', text: 'pilule secrete zx' } }],
    signs: ['fever'],
  });

  it('keeps nothing readable: its id, its profile id and a sealed entry only', async () => {
    await recordHistory(kept());

    const stored: unknown = await (await openAppDb()).get('history', 'p1-1');
    expect(Object.keys(stored as object).sort()).toEqual(['id', 'profileId', 'sealed']);
    const text = JSON.stringify(stored);
    for (const clear of ['danger', 'misoprostol', 'pilule', 'fever', '2026-11-04', '0.1.0']) {
      expect(text).not.toContain(clear);
    }
    expect(await listHistory('p1')).toEqual([kept()]);
  });

  it('reads and writes nothing while the code is not open (locked)', async () => {
    await recordHistory(kept());
    closeVault();

    await expect(listHistory('p1')).rejects.toBeInstanceOf(LockedError);
    await expect(latestHistoryAt('p1')).rejects.toBeInstanceOf(LockedError);
    await expect(recordHistory(entry('p1', 2))).rejects.toBeInstanceOf(LockedError);
  });

  it('leaves out an entry its code does not open, and lets it go first when over 20', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await openVaultOf('1357');
    await recordHistory(entry('p1', 30));
    await openVaultOf('2468');
    await recordHistory(entry('p1', 1));
    expect((await listHistory('p1')).map((e) => e.id)).toEqual(['p1-1']);

    for (let n = 2; n <= 20; n += 1) await recordHistory(entry('p1', n));
    // 21 records: the one that does not open goes, the 20 that open stay.
    const db = await openAppDb();
    expect(await db.getAllKeysFromIndex('history', 'profileId', 'p1')).toHaveLength(20);
    expect(await listHistory('p1')).toHaveLength(20);
    vi.restoreAllMocks();
  });

  it('never shows an entry kept in clear: it is left out as one that does not open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await (await openAppDb()).put('history', entry('p1', 1));
    await recordHistory(entry('p1', 2));

    expect((await listHistory('p1')).map((e) => e.id)).toEqual(['p1-2']);
    expect(await latestHistoryAt('p1')).toBe(entry('p1', 2).at);
    warn.mockRestore();
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

  it('records the same items again when the evaluation changed in the visit (level or rules)', async () => {
    // The profile was corrected between two looks at the same product: the
    // same items and signs, another evaluation.
    expect(await recordHistoryOnce(entry('p1', 1))).toBe(true);
    const higher: HistoryEntry = {
      ...entry('p1', 2),
      level: 'next-contact',
      ruleIds: ['nsaid-pregnancy-before-20-weeks'],
    };
    expect(await recordHistoryOnce(higher)).toBe(true);
    // Same level, other rules: still another evaluation.
    const otherRule: HistoryEntry = { ...higher, id: 'p1-3', ruleIds: ['other-rule'] };
    expect(await recordHistoryOnce(otherRule)).toBe(true);
    // And the same evaluation again is not.
    expect(await recordHistoryOnce({ ...otherRule, id: 'p1-4' })).toBe(false);
    expect(await listHistory('p1')).toHaveLength(3);
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
    // A new, empty storage: the code, then her profile, are saved there first.
    await storeVerifier(await verifierOf('2468'));
    await saveProfile(profileOf({ id: 'p3' }));
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

  // A name typed that looks like a listed product copies its cards (SCRUM-51):
  // a rule is kept once, in the order it first appears.
  it('keeps each rule id once', () => {
    const finding = (ruleId: string, item: number) => ({
      level: 'danger' as const,
      check: 'C1' as const,
      ruleId,
      items: [item],
      message: ruleId,
      capped: false,
      sources: [],
    });
    const made = historyEntryOf({
      id: 'h2',
      at: '2026-11-05T09:00:00.000Z',
      profileId: 'p1',
      evaluation: {
        level: 'danger',
        findings: [
          finding('misoprostol-late-pregnancy', 0),
          finding('misoprostol-pregnancy', 0),
          finding('misoprostol-late-pregnancy', 2),
          finding('misoprostol-pregnancy', 2),
        ],
        reminders: [],
        notes: [],
        pack: { version: '0.1.0', date: '2026-11-04', clinicallyValidated: false },
      },
      items: [],
      signs: [],
    });
    expect(made.ruleIds).toEqual(['misoprostol-late-pregnancy', 'misoprostol-pregnancy']);
  });
});
