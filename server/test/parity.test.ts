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
          continue; // the app refuses a term past 45 weeks
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
    expect(widest).toBeGreaterThan(45);
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
