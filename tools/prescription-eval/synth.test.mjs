// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { FIRST, IN_BASE, LAST, OUT_OF_BASE } from './catalog.mjs';
import { makeRx, sceneHtml, sheetHtml, truthText, VARIANTS } from './synth.mjs';

// Substances by product id, as the pack would give them: here, the id itself,
// with the products that share substances grouped by hand.
const SAME = { 'ibuprofen-generic': 'ibuprofen', 'advil-400-mg-63646874': 'ibuprofen' };
const substancesOf = (id) => SAME[id] ?? id;

describe('makeRx', () => {
  const set = Array.from({ length: 36 }, (_, i) => makeRx(i, substancesOf));

  it('gives the same prescription for the same number', () => {
    expect(makeRx(5, substancesOf)).toEqual(makeRx(5, substancesOf));
    expect(makeRx(5, substancesOf)).not.toEqual(makeRx(6, substancesOf));
  });

  it('holds 2 to 6 products, never the same substances twice', () => {
    for (const rx of set) {
      expect(rx.items.length).toBeGreaterThanOrEqual(2);
      expect(rx.items.length).toBeLessThanOrEqual(6);
      const keys = rx.items.filter((it) => it.inBase).map((it) => substancesOf(it.product));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('writes one in three in a handwriting-style font, and mixes products outside the pack', () => {
    expect(set.filter((rx) => rx.handwriting)).toHaveLength(12);
    expect(set.some((rx) => rx.items.some((it) => !it.inBase))).toBe(true);
  });

  it('names patients only with the synthetic first and family names', () => {
    for (const rx of set) {
      const [first, ...last] = rx.patient.split(' ');
      expect(FIRST).toContain(first);
      expect(LAST).toContain(last.join(' '));
    }
  });
});

describe('catalog', () => {
  it('gives every product of the pack an id, and each posology its whole units per day', () => {
    for (const it of IN_BASE) {
      expect(it.product).toMatch(/^[a-z0-9-]+$/);
      expect(it.pos.length).toBeGreaterThan(0);
      for (const [text, upd] of it.pos) {
        expect(text.length).toBeGreaterThan(0);
        if (upd !== undefined) expect(Number.isInteger(upd)).toBe(true);
      }
    }
  });

  it('carries the units per day of the posology chosen onto the prescription', () => {
    for (let i = 0; i < 36; i++) {
      for (const it of makeRx(i, substancesOf).items.filter((x) => x.inBase)) {
        const pair = IN_BASE.find((c) => c.written === it.written).pos.find(
          ([text]) => text === it.posology,
        );
        expect(it.upd).toBe(pair[1]);
      }
    }
  });

  it('never writes a product outside the pack the way a product of the pack is written', () => {
    const inside = new Set(IN_BASE.map((it) => it.written));
    for (const it of OUT_OF_BASE) expect(inside.has(it.written)).toBe(false);
  });
});

describe('the HTML', () => {
  const rx = makeRx(2, substancesOf);

  it('shows every product and its posology on the sheet, and the truth says them too', () => {
    const html = sheetHtml(rx);
    const text = truthText(rx);
    for (const it of rx.items) {
      expect(html).toContain(it.written.replace(/&/g, '&amp;'));
      expect(text).toContain(it.written);
      expect(text).toContain(it.posology);
    }
  });

  it('builds a scene per photo variant around the sheet image', () => {
    for (const v of Object.values(VARIANTS)) {
      const html = sceneHtml('/rx03-scan.png', v, 1, 79);
      expect(html).toContain('src="/rx03-scan.png"');
      expect(html).toContain(`blur(${String(v.blur)}px)`);
    }
  });
});
