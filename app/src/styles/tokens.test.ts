// SPDX-License-Identifier: MIT
// @vitest-environment node
// (reads files with node:fs; the jsdom URL class is not a file URL Node accepts)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, contrastRatio } from './contrast.js';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries(
  [...css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  ),
);

/** The hex value of a colour token; a missing token fails the test that asks for it. */
function token(name: string): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`Missing colour token ${name} in tokens.css`);
  return value;
}

/** Hue in degrees (0 to 360) and HSL saturation (0 to 1) of a 6-digit hex colour. */
function hue(hex: string): { h: number; s: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s };
}

describe('design tokens', () => {
  it.each(CONTRAST_PAIRS)('$fg on $bg meets $min:1', ({ fg, bg, min }) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });
  it('never uses green', () => {
    for (const [name, hex] of Object.entries(tokens)) {
      const { h, s } = hue(hex);
      expect({ name, green: s > 0.2 && h >= 75 && h <= 165 }).toEqual({ name, green: false });
    }
  });
  it('defines all four levels', () => {
    for (const level of ['danger', 'before-next-dose', 'next-contact', 'unknown']) {
      for (const part of ['bg', 'fg', 'border'])
        expect(tokens[`--level-${level}-${part}`]).toBeDefined();
    }
  });
  it('reads every colour token, so the checks above are not vacuous', () => {
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(20);
    for (const required of [
      '--color-bg',
      '--color-surface',
      '--color-text',
      '--color-text-muted',
      '--color-border',
      '--color-focus',
      '--color-primary',
      '--color-primary-text',
    ]) {
      expect(tokens[required]).toBeDefined();
    }
  });
  it('defines the touch target, type, spacing and radius scales', () => {
    expect(css).toMatch(/--touch-target:\s*48px;/);
    for (const [scale, steps] of [
      ['--font-size-', 4],
      ['--space-', 7],
      ['--radius-', 2],
    ] as const) {
      expect(css.split(scale).length - 1).toBeGreaterThanOrEqual(steps);
    }
  });
});

describe('contrast helpers', () => {
  it('computes the WCAG ratio, in either order', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#336699', '#336699')).toBe(1);
  });
  it('the green check catches green and only green', () => {
    expect(hue('#00FF00')).toEqual({ h: 120, s: 1 });
    expect(hue('#2E7D32').h).toBeGreaterThan(75);
    expect(hue('#FFD23A').h).toBeLessThan(75);
    expect(hue('#808080').s).toBe(0);
  });
  it('names only custom properties and states a minimum for each pair', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(20);
    const keys = CONTRAST_PAIRS.map(({ fg, bg }) => `${fg} ${bg}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { fg, bg, min } of CONTRAST_PAIRS) {
      expect(fg).toMatch(/^--[a-z0-9-]+$/);
      expect(bg).toMatch(/^--[a-z0-9-]+$/);
      expect(min).toBeGreaterThanOrEqual(3);
    }
  });
  it('holds the danger banner action text at the reading minimum, at rest and on hover', () => {
    const minFor = (bg: string) =>
      CONTRAST_PAIRS.find((p) => p.fg === '--level-danger-border' && p.bg === bg)?.min;
    expect(minFor('--color-surface')).toBe(7);
    expect(minFor('--color-bg')).toBe(7);
  });
});

describe('base styles', () => {
  const base = readFileSync(new URL('./base.css', import.meta.url), 'utf8');

  it('use only tokens for colour', () => {
    expect(base.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(base.match(/\b(rgb|rgba|hsl|hsla|oklch)\(/g) ?? []).toEqual([]);
  });
  it('honour reduced motion', () => {
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
  it('load the self-hosted font with font-display swap', () => {
    expect(base).toMatch(/@font-face\s*\{[^}]*font-display:\s*swap/);
  });
});

describe('self-hosted font', () => {
  const dir = new URL('../../public/fonts/', import.meta.url);
  const files = readdirSync(dir);

  it('ships its open font licence next to it', () => {
    expect(files).toContain('OFL.txt');
    expect(readFileSync(new URL('OFL.txt', dir), 'utf8')).toMatch(/SIL Open Font License/);
  });
  it('stays within 150 KB in total', () => {
    const fonts = files.filter((f) => f.endsWith('.woff2'));
    expect(fonts.length).toBeGreaterThan(0);
    const total = fonts.reduce((sum, f) => sum + statSync(new URL(f, dir)).size, 0);
    expect(total).toBeLessThanOrEqual(150 * 1024);
  });
});
