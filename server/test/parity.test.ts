// SPDX-License-Identifier: MIT
// Parity: the same context gives the same Evaluation through the HTTP API and
// through the engine library (the code the offline app runs).
import { evaluate } from '@siapso/engine';
import type { Pack } from '@siapso/engine';
import { contextOf, loadCases } from '@siapso/pack-tools';
import type { ReferenceCase } from '@siapso/pack-tools';
import { addDays } from '../../app/src/domain/dates.js';
import { termDisplay } from '../../app/src/domain/term.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTestPack, post, REPO_ROOT, start } from './helpers.js';
import type { Running } from './helpers.js';

let pack: Pack;
let running: Running;
let cases: ReferenceCase[];

beforeAll(async () => {
  pack = await loadTestPack();
  running = await start(pack);
  const loaded = await loadCases(REPO_ROOT);
  expect(loaded.problems).toEqual([]);
  cases = loaded.cases;
});
afterAll(async () => {
  await running.close();
});

describe('parity with the library', () => {
  it('covers every reference case', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15);
  });

  it('gives a deep-equal evaluation for every reference case', async () => {
    for (const reference of cases) {
      const context = contextOf(reference);
      const response = await post(running, { pack_version: pack.version, context });
      expect(response.status, reference.id).toBe(200);
      const overHttp: unknown = await response.json();
      // The wire format is JSON: the library output goes through it too.
      const direct: unknown = JSON.parse(JSON.stringify(evaluate(pack, context)));
      expect(overHttp, reference.id).toStrictEqual(direct);
    }
  });

  it('gives the same result at every term the app can emit (months 1 to 9, 0 to 13 weeks on)', async () => {
    const today = '2026-11-05';
    let tried = 0;
    let widest = 0;
    for (let months = 1; months <= 9; months += 1) {
      for (let since = 0; since <= 13; since += 1) {
        let term;
        try {
          term = termDisplay(
            { kind: 'months', months, givenOn: addDays(today, -7 * since) },
            today,
          );
        } catch {
          continue; // past 42 weeks the term is outdated: the app asks before any result
        }
        const context = {
          conditions: [],
          signs: [],
          items: [{ ref: { kind: 'product' as const, id: pack.products[0]?.id ?? '' } }],
          pregnancy: {
            weeksMin: term.weeksMin,
            weeksMax: term.weeksMax,
            precision: term.precision,
          },
        };
        widest = Math.max(widest, term.weeksMax);
        const response = await post(running, { pack_version: pack.version, context });
        expect(response.status, `${String(months)} months, ${String(since)} weeks on`).toBe(200);
        expect(await response.json()).toStrictEqual(
          JSON.parse(JSON.stringify(evaluate(pack, context))),
        );
        tried += 1;
      }
    }
    expect(tried).toBeGreaterThan(60);
    // The app never works out a result past 42 weeks (profileTermStatus: outdated).
    expect(widest).toBe(42);
  });

  it('gives the same result for weeks given 0 to 8 days ago (N weeks and 0 to 6 days)', async () => {
    const today = '2026-11-05';
    let tried = 0;
    for (let weeks = 0; weeks <= 42; weeks += 1) {
      // The days where a bound moves on: the same day, the next, the last of the week, then on.
      for (const days of [0, 1, 6, 7, 8]) {
        let term;
        try {
          term = termDisplay({ kind: 'weeks', weeks, givenOn: addDays(today, -days) }, today);
        } catch {
          continue; // outdated: the app asks before any result
        }
        const context = {
          conditions: ['uterine-scar' as const],
          signs: [],
          items: [{ ref: { kind: 'plant' as const, id: 'castor-oil' } }],
          pregnancy: {
            weeksMin: term.weeksMin,
            weeksMax: term.weeksMax,
            precision: term.precision,
          },
        };
        const response = await post(running, { pack_version: pack.version, context });
        expect(response.status, `${String(weeks)} weeks, ${String(days)} days on`).toBe(200);
        expect(await response.json()).toStrictEqual(
          JSON.parse(JSON.stringify(evaluate(pack, context))),
        );
        tried += 1;
      }
    }
    expect(tried).toBeGreaterThan(200);
  });

  it('gives the same result at every exact week, across the 28-day look-ahead', async () => {
    const ibuprofen = pack.products.find((p) =>
      p.components.some((c) => c.substance === 'ibuprofen'),
    );
    expect(ibuprofen).toBeDefined();
    const levels = new Set<string>();
    for (let weeks = 0; weeks <= 42; weeks += 1) {
      const context = {
        conditions: ['uterine-scar' as const],
        signs: [],
        items: [
          { ref: { kind: 'product' as const, id: ibuprofen?.id ?? '' } },
          { ref: { kind: 'plant' as const, id: 'castor-oil' } },
        ],
        pregnancy: { weeksMin: weeks, weeksMax: weeks, precision: 'exact' as const },
      };
      const response = await post(running, { pack_version: pack.version, context });
      expect(response.status, `${String(weeks)} weeks`).toBe(200);
      const overHttp = (await response.json()) as { level: string };
      expect(overHttp, `${String(weeks)} weeks`).toStrictEqual(
        JSON.parse(JSON.stringify(evaluate(pack, context))),
      );
      levels.add(`${String(weeks)}:${overHttp.level}`);
    }
    // The look-ahead reaches 30 weeks from 26: castor oil with a scar is held at
    // before the next dose there (a window still ahead), and a danger from 30.
    expect(levels.has('26:before-next-dose')).toBe(true);
    expect(levels.has('29:danger')).toBe(false);
    expect(levels.has('30:danger')).toBe(true);
  });

  it('gives the same result with the strength unknown, a family to read, and a baby sign', async () => {
    const generic = pack.products.find((p) => p.id === 'paracetamol-generic');
    expect(generic?.family).toBeDefined();
    const contexts = [
      {
        conditions: [],
        signs: [],
        pregnancy: { weeksMin: 24, weeksMax: 24, precision: 'exact' as const },
        items: [
          {
            ref: { kind: 'product' as const, id: 'paracetamol-generic' },
            unitsPerDay: 12,
            strengthUnknown: true,
          },
        ],
      },
      {
        conditions: [],
        signs: ['baby-very-sleepy'],
        breastfeeding: { babyAgeWeeks: 12 },
        items: [{ ref: { kind: 'product' as const, id: 'codoliprane-500-mg-30-mg-60904643' } }],
      },
    ];
    for (const context of contexts) {
      const response = await post(running, { pack_version: pack.version, context });
      expect(response.status).toBe(200);
      const overHttp = (await response.json()) as { level: string };
      expect(overHttp).toStrictEqual(JSON.parse(JSON.stringify(evaluate(pack, context))));
      expect(overHttp.level).toBe('danger');
    }
  });

  it('gives the same result with the strength unknown and the unit count set', async () => {
    const context = {
      conditions: [],
      signs: [],
      items: [
        {
          ref: { kind: 'unrecognised' as const, text: 'tisane du quartier' },
          unitsPerDay: 2,
          strengthUnknown: true,
        },
      ],
    };
    const response = await post(running, { pack_version: pack.version, context });
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(
      JSON.parse(JSON.stringify(evaluate(pack, context))),
    );
  });
});
