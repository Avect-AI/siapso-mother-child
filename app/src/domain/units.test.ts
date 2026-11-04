// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { isUnitsPerDay, MAX_UNITS_PER_DAY, parseUnits, stepUnits } from './units.js';

describe('isUnitsPerDay', () => {
  it('accepts whole numbers from 1 to 24 only', () => {
    expect(MAX_UNITS_PER_DAY).toBe(24);
    for (const units of [1, 2, 12, 24]) expect(isUnitsPerDay(units)).toBe(true);
    for (const units of [0, -1, 25, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2', undefined]) {
      expect(isUnitsPerDay(units)).toBe(false);
    }
  });
});

describe('parseUnits', () => {
  it('reads blank as not known', () => {
    expect(parseUnits('')).toEqual({ ok: true, units: undefined });
    expect(parseUnits('   ')).toEqual({ ok: true, units: undefined });
  });

  it('reads a whole number from 1 to 24', () => {
    expect(parseUnits('3')).toEqual({ ok: true, units: 3 });
    expect(parseUnits(' 24 ')).toEqual({ ok: true, units: 24 });
    expect(parseUnits('03')).toEqual({ ok: true, units: 3 });
  });

  it('refuses anything else, never handing the engine a count it would refuse', () => {
    for (const text of ['0', '25', '1.5', '1,5', '-2', 'deux', '2a', '1e1']) {
      expect(parseUnits(text), text).toEqual({ ok: false });
    }
  });
});

describe('stepUnits', () => {
  it('goes from blank to 1, then up to 24 and no further', () => {
    expect(stepUnits('', 1)).toBe('1');
    expect(stepUnits('3', 1)).toBe('4');
    expect(stepUnits('24', 1)).toBe('24');
  });

  it('goes down to 1, then to blank (not known)', () => {
    expect(stepUnits('3', -1)).toBe('2');
    expect(stepUnits('1', -1)).toBe('');
    expect(stepUnits('', -1)).toBe('');
  });

  it('starts again from the nearest valid count after a typo', () => {
    expect(stepUnits('40', -1)).toBe('24');
    expect(stepUnits('40', 1)).toBe('24');
    expect(stepUnits('abc', 1)).toBe('1');
    expect(stepUnits('abc', -1)).toBe('');
  });
});
