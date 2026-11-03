// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { WINDOWS, windowsCovered } from '../src/index.js';

describe('WINDOWS', () => {
  it('lists the four windows of amenorrhoea weeks, upper bound exclusive', () => {
    expect(WINDOWS).toEqual([
      { id: 'lt12', from: 0, to: 12 },
      { id: '12-19', from: 12, to: 20 },
      { id: '20-29', from: 20, to: 30 },
      { id: '30-plus', from: 30, to: Infinity },
    ]);
  });

  it('cannot be modified', () => {
    expect(Object.isFrozen(WINDOWS)).toBe(true);
    for (const window of WINDOWS) expect(Object.isFrozen(window)).toBe(true);
  });
});

describe('windowsCovered', () => {
  it('returns every window intersecting the range', () => {
    expect(windowsCovered(30, 30)).toEqual(['30-plus']);
    expect(windowsCovered(10, 10)).toEqual(['lt12']);
    expect(windowsCovered(0, 42)).toEqual(['lt12', '12-19', '20-29', '30-plus']);
    expect(windowsCovered(19, 24)).toEqual(['12-19', '20-29']);
  });

  it('puts each boundary week in the window that starts there', () => {
    expect(windowsCovered(11, 11)).toEqual(['lt12']);
    expect(windowsCovered(12, 12)).toEqual(['12-19']);
    expect(windowsCovered(19, 19)).toEqual(['12-19']);
    expect(windowsCovered(20, 20)).toEqual(['20-29']);
    expect(windowsCovered(29, 29)).toEqual(['20-29']);
    expect(windowsCovered(11.5, 12)).toEqual(['lt12', '12-19']);
    expect(windowsCovered(29.5, 29.9)).toEqual(['20-29']);
  });

  it('refuses a range that is empty, negative or not a number', () => {
    expect(() => windowsCovered(24, 19)).toThrow(RangeError);
    expect(() => windowsCovered(-1, 4)).toThrow(RangeError);
    expect(() => windowsCovered(Number.NaN, 4)).toThrow(RangeError);
    expect(() => windowsCovered(0, Number.NaN)).toThrow(RangeError);
    expect(() => windowsCovered(0, Infinity)).toThrow(RangeError);
  });
});
