// SPDX-License-Identifier: MIT
// The fresh held-out set is frozen: the files committed are what the
// generator gives, so the OCR texts made from its sheets later are of these
// prescriptions. Nothing here reads the set with the reading.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pack } from '@siapso/engine';
import { buildPack, loadContent } from '@siapso/pack-tools';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseTruth, type TruthItem } from './evaluate.js';
import { FRESH_COUNT, freshSheetHtml, freshText, makeFreshRx } from './fresh.mjs';
import { makeRx } from './synth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FOLDER = path.join(ROOT, 'eval', 'prescription', 'fresh');

let pack: Pack;
beforeAll(async () => {
  pack = buildPack(await loadContent(ROOT));
}, 60_000);

const substancesOf = (id: string) =>
  (pack.products.find((p) => p.id === id)?.components ?? [])
    .map((c) => c.substance)
    .sort()
    .join('+');

describe('eval/prescription/fresh', () => {
  it('holds what the generator gives: the truth and every sheet', async () => {
    const saved: unknown = JSON.parse(await readFile(path.join(FOLDER, 'truth.json'), 'utf8'));
    const made = Array.from({ length: FRESH_COUNT }, (_, i) => makeFreshRx(i, substancesOf));
    expect(saved).toEqual(JSON.parse(JSON.stringify(made)));
    const pages: unknown = JSON.parse(await readFile(path.join(FOLDER, 'pages.json'), 'utf8'));
    expect(pages).toEqual(Object.fromEntries(made.map((rx) => [rx.id, freshSheetHtml(rx)])));
  });

  it('is a truth the evaluation reads: 8 printed and 4 handwriting-style prescriptions', async () => {
    const truth = parseTruth(await readFile(path.join(FOLDER, 'truth.json'), 'utf8'));
    expect(truth.map((rx) => rx.id)).toEqual(
      Array.from({ length: FRESH_COUNT }, (_, i) => `fx${String(i + 1).padStart(2, '0')}`),
    );
    expect(truth.filter((rx) => rx.handwriting)).toHaveLength(4);
    expect(new Set(truth.map((rx) => rx.template))).toEqual(
      new Set(['hospital', 'polyclinic', 'stamped-table']),
    );
  });

  it('is made with other seeds and layouts than the development set', () => {
    const dev = new Set(Array.from({ length: 36 }, (_, i) => makeRx(i, substancesOf).template));
    for (let i = 0; i < FRESH_COUNT; i++) {
      expect(dev.has(makeFreshRx(i, substancesOf).template)).toBe(false);
    }
  });

  it('writes every product, its posology and the header in the exact text', () => {
    for (let i = 0; i < FRESH_COUNT; i++) {
      const rx = makeFreshRx(i, substancesOf);
      const text = freshText(rx);
      const items = rx.items as TruthItem[];
      for (const it of items) {
        expect(text).toContain(it.written);
        expect(text).toContain(it.posology);
      }
      expect(text).toContain(rx.patient);
      expect(text.split('\n')[0]).not.toContain(items[0]?.written);
    }
  });
});
