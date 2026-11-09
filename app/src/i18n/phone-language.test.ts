// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { phoneLanguage } from './phone-language.js';

describe('the language of the phone', () => {
  it('is English when the first language of the phone is English', () => {
    expect(phoneLanguage(['en-US', 'fr-FR'])).toBe('en');
    expect(phoneLanguage(['en'])).toBe('en');
    expect(phoneLanguage(['EN-gb'])).toBe('en');
  });

  it('is French otherwise: French, Wolof, another language or none', () => {
    expect(phoneLanguage(['fr-SN', 'en-US'])).toBe('fr');
    expect(phoneLanguage(['wo-SN', 'en-US'])).toBe('fr');
    expect(phoneLanguage(['ar'])).toBe('fr');
    expect(phoneLanguage([])).toBe('fr');
    // A tag that only starts with the letters "en" is not English.
    expect(phoneLanguage(['enx'])).toBe('fr');
  });
});
