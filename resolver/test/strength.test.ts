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

  it('reads the gram and milligram units written out', () => {
    expect(parseStrength('doliprane 1 gramme')).toEqual({ text: 'doliprane', strengthMg: 1000 });
    expect(parseStrength('advil 400 milligrammes')).toEqual({ text: 'advil', strengthMg: 400 });
  });

  it('reads a strength said or typed in French words', () => {
    expect(parseStrength('Doliprane mille')).toEqual({ text: 'doliprane', strengthMg: 1000 });
    expect(parseStrength('doliprane cinq cents')).toEqual({ text: 'doliprane', strengthMg: 500 });
    expect(parseStrength('Advil quatre cents milligrammes, boîte de vingt')).toEqual({
      text: 'advil , boîte de vingt',
      strengthMg: 400,
    });
    expect(parseStrength('advil quatre-cents')).toEqual({ text: 'advil', strengthMg: 400 });
    expect(parseStrength('amoxicilline deux cent cinquante')).toEqual({
      text: 'amoxicilline',
      strengthMg: 250,
    });
    expect(parseStrength('doliprane un gramme')).toEqual({ text: 'doliprane', strengthMg: 1000 });
    expect(parseStrength('doliprane cent')).toEqual({ text: 'doliprane', strengthMg: 100 });
    expect(parseStrength('quatre-vingt-dix mg aspirine')).toEqual({
      text: 'aspirine',
      strengthMg: 90,
    });
  });

  it('keeps number words that are no strength', () => {
    // A small number with no unit is a count, not a strength.
    expect(parseStrength('doliprane un comprimé')).toEqual({ text: 'doliprane un comprimé' });
    expect(parseStrength('boîte de vingt')).toEqual({ text: 'boîte de vingt' });
    // Part of a word or of a name.
    expect(parseStrength('achillée mille-feuille')).toEqual({ text: 'achillée mille-feuille' });
    expect(parseStrength('millepertuis')).toEqual({ text: 'millepertuis' });
    // "pour cent" is a percentage, never a hundred.
    expect(parseStrength('DOLIPRANE 2,4 POUR CENT')).toEqual({
      text: 'doliprane pour cent',
      strengthMg: 2.4,
    });
    expect(parseStrength('rifadine pour cent')).toEqual({ text: 'rifadine pour cent' });
  });

  it('never reads a count or a volume as a strength, in words or in digits (review of #58)', () => {
    for (const query of [
      // A count word after the number.
      'aspirine cent comprimés',
      'aspirine 100 comprimés',
      'doliprane 20 gélules',
      'doliprane 1 comprimé',
      'smecta 30 sachets',
      // A volume or a number of times after it.
      'sirop cent ml',
      'sirop 100 ml',
      'sirop 5 ml',
      'paracetamol deux cuillères',
      'aspirine 3 fois',
      // "boîte de", "fois" or "x" before it.
      'aspirine boîte de cent',
      'aspirine boîte de 100',
      'aspirine boite de 100',
      'deux fois cent',
      '2 fois 100',
      'aspirine x 100',
      'aspirine x100',
    ]) {
      expect(parseStrength(query), query).toEqual({ text: query });
    }
  });

  it('still reads the strength next to a count, and the strength followed by its form', () => {
    expect(parseStrength('advil 400 mg, 20 comprimés')).toMatchObject({ strengthMg: 400 });
    expect(parseStrength('doliprane 1000 x 8')).toMatchObject({ strengthMg: 1000 });
    expect(parseStrength('aspirine boîte de 30, 500')).toMatchObject({ strengthMg: 500 });
    // A strength then the form of the box, as the boxes write it.
    expect(parseStrength('Doliprane 1000 comprimé effervescent')).toMatchObject({
      strengthMg: 1000,
    });
    expect(parseStrength('doliprane 1000 gélule')).toMatchObject({ strengthMg: 1000 });
  });
});
