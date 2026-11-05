// SPDX-License-Identifier: MIT
import type { Level } from '@siapso/engine';
import { assertLabel } from './csv.js';
import { CHECK_IDS, type OpenCheckId, type OpenDataEvent } from './events.js';

/** Small seeded generator (mulberry32): same seed, same sequence, no clock. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Number of synthetic checks per region for the test week. Chosen to show every
 * case: well above the threshold, exactly 11 (published), exactly 10
 * (suppressed), a few checks, and a region with none.
 */
export const SAMPLE_WEEK = '2026-W45';
const SAMPLE_COUNTS: readonly (readonly [string, number])[] = [
  ['dakar', 80],
  ['diourbel', 18],
  ['fatick', 10],
  ['kaffrine', 5],
  ['kaolack', 25],
  ['kedougou', 0],
  ['kolda', 11],
  ['louga', 14],
  ['matam', 3],
  ['saint-louis', 30],
  ['sedhiou', 2],
  ['tambacounda', 7],
  ['thies', 40],
  ['ziguinchor', 12],
];

const LEVEL_WEIGHTS: readonly (readonly [Level, number])[] = [
  ['unknown', 0.2],
  ['next-contact', 0.4],
  ['before-next-dose', 0.25],
  ['danger', 0.15],
];

function pickLevel(random: () => number): Level {
  let remaining = random();
  for (const [level, weight] of LEVEL_WEIGHTS) {
    if (remaining < weight) return level;
    remaining -= weight;
  }
  return 'unknown';
}

/** Synthetic events for tests and documentation. Not real data. */
export function generateSampleEvents(seed = 45): OpenDataEvent[] {
  const random = seeded(seed);
  const events: OpenDataEvent[] = [];
  for (const [region, total] of SAMPLE_COUNTS) {
    for (let i = 0; i < total; i += 1) {
      const level = pickLevel(random);
      const findings = Object.fromEntries(CHECK_IDS.map((id) => [id, 0])) as Record<
        OpenCheckId,
        number
      >;
      if (level !== 'unknown') {
        const count = 1 + Math.floor(random() * 3);
        for (let f = 0; f < count; f += 1) {
          const id = CHECK_IDS[Math.floor(random() * CHECK_IDS.length)];
          if (id !== undefined) findings[id] += 1;
        }
      }
      events.push({
        week: SAMPLE_WEEK,
        region,
        mode: random() < 0.7 ? 'woman' : 'accompanied',
        level,
        findings,
        unknownItems: level === 'unknown' ? 1 + Math.floor(random() * 2) : 0,
        unrecognisedNames: Math.floor(random() * 3),
      });
    }
  }
  return events;
}

/** JSON Lines with fixed key order; the label is written as a first comment line. */
export function renderJsonl(events: readonly OpenDataEvent[], label?: string): string {
  const lines: string[] = [];
  if (label !== undefined) {
    assertLabel(label);
    lines.push(`# ${label}`);
  }
  for (const event of events) lines.push(JSON.stringify(event));
  return `${lines.join('\n')}\n`;
}
