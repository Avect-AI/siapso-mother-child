// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { parseStrength } from '../src/index.js';

describe('parseStrength', () => {
  it('reads a strength with a unit and normalises it to mg', () => {
    expect(parseStrength('doliprane 1 g')).toEqual({ text: 'doliprane', strengthMg: 1000 });
    expect(parseStrength('doliprane 1000 mg')).toEqual({ text: 'doliprane', strengthMg: 1000 });
    expect(parseStrength('doliprane 0,5 g')).toEqual({ text: 'doliprane', strengthMg: 500 });
    expect(parseStrength('doliprane 0.5g')).toEqual({ text: 'doliprane', strengthMg: 500 });
    expect(parseStrength('angusta 25 microgrammes')).toEqual({
      text: 'angusta',
      strengthMg: 0.025,
    });
  });

  it('reads a bare number as mg', () => {
    expect(parseStrength('doliprane 1000')).toEqual({ text: 'doliprane', strengthMg: 1000 });
    expect(parseStrength('500 paracetamol')).toEqual({ text: 'paracetamol', strengthMg: 500 });
  });

  it('reads a strength glued to the name when it has 3 digits or a unit', () => {
    expect(parseStrength('ibuprofene400')).toEqual({ text: 'ibuprofene', strengthMg: 400 });
    expect(parseStrength('ibuprofene4g')).toEqual({ text: 'ibuprofene', strengthMg: 4000 });
  });

  it('keeps digits that belong to a name', () => {
    expect(parseStrength('tardyferon b9')).toEqual({ text: 'tardyferon b9' });
    expect(parseStrength('vitamine b12')).toEqual({ text: 'vitamine b12' });
  });

  it('does not take the start of a word for a unit', () => {
    expect(parseStrength('dafalgan 500 gelule')).toEqual({
      text: 'dafalgan gelule',
      strengthMg: 500,
    });
  });

  it('returns the text untouched when there is no strength', () => {
    expect(parseStrength('nebeday')).toEqual({ text: 'nebeday' });
  });
});
