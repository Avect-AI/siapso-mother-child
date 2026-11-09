// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countryOfLanguages,
  countryOfTimeZone,
  countryOfUse,
  isCountryChoice,
  phoneHints,
  regionOf,
  searchKey,
  type PhoneHints,
} from './country.js';

const NOWHERE: PhoneHints = { languages: [], timeZone: undefined };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the region of a language tag', () => {
  it('reads the region of a BCP 47 tag, written with a hyphen or an underscore', () => {
    expect(regionOf('fr-SN')).toBe('SN');
    expect(regionOf('en-gh')).toBe('GH');
    expect(regionOf('fr_CI')).toBe('CI');
    expect(regionOf('zh-Hant-TW')).toBe('TW');
    expect(regionOf('wo-Latn-SN')).toBe('SN');
  });

  it('gives no region for a tag without one, or a region that is not a country', () => {
    expect(regionOf('fr')).toBeUndefined();
    expect(regionOf('es-419')).toBeUndefined();
    expect(regionOf('')).toBeUndefined();
    expect(regionOf('not a tag')).toBeUndefined();
  });
});

describe('the country of the phone language', () => {
  it('is the first region of the languages that is a country of the file', () => {
    expect(countryOfLanguages(['fr-SN'])).toBe('SN');
    expect(countryOfLanguages(['fr', 'fr-ML'])).toBe('ML');
    expect(countryOfLanguages(['en-US', 'en-GH'])).toBe('GH');
  });

  it('is none for regions the file does not have, or no region at all', () => {
    expect(countryOfLanguages(['en-US'])).toBeNull();
    expect(countryOfLanguages(['fr-BE', 'fr'])).toBeNull();
    expect(countryOfLanguages([])).toBeNull();
  });

  it('never finds France: phones in Africa often use French (France)', () => {
    expect(countryOfLanguages(['fr-FR'])).toBeNull();
    expect(countryOfLanguages(['fr-FR', 'fr-SN'])).toBe('SN');
  });
});

describe('the country of the time zone', () => {
  it('is the one country whose zone it is', () => {
    expect(countryOfTimeZone('Africa/Dakar')).toBe('SN');
    expect(countryOfTimeZone('Africa/Bamako')).toBe('ML');
    expect(countryOfTimeZone('Africa/Accra')).toBe('GH');
    expect(countryOfTimeZone('Africa/Lubumbashi')).toBe('CD');
  });

  it('is none for a weak zone: the tz database makes it the canonical zone of other countries too', () => {
    // A phone in Senegal may report Africa/Abidjan, one in Benin Africa/Lagos.
    expect(countryOfTimeZone('Africa/Abidjan')).toBeNull();
    expect(countryOfTimeZone('Africa/Lagos')).toBeNull();
  });

  it('is none for a zone of no country of the file, of several countries, or no zone', () => {
    expect(countryOfTimeZone('UTC')).toBeNull();
    expect(countryOfTimeZone('Etc/GMT')).toBeNull();
    expect(countryOfTimeZone('Europe/Brussels')).toBeNull();
    // Western Sahara: not Morocco's zone in zone.tab.
    expect(countryOfTimeZone('Africa/El_Aaiun')).toBeNull();
    expect(countryOfTimeZone(undefined)).toBeNull();
  });

  it('never finds France', () => {
    expect(countryOfTimeZone('Europe/Paris')).toBeNull();
  });
});

describe('the country of use', () => {
  const senegal: PhoneHints = { languages: ['fr-SN'], timeZone: 'Africa/Dakar' };

  it('is the country of the deployment file first, whatever was chosen or the phone says', () => {
    expect(countryOfUse({ deployment: 'ML', chosen: 'CI', phone: senegal })).toEqual({
      country: 'ML',
      source: 'deployment',
    });
  });

  it('then the country chosen on the phone', () => {
    expect(countryOfUse({ chosen: 'CI', phone: senegal })).toEqual({
      country: 'CI',
      source: 'chosen',
    });
    // Chosen by hand, France too.
    expect(countryOfUse({ chosen: 'FR', phone: senegal })).toEqual({
      country: 'FR',
      source: 'chosen',
    });
  });

  it('then the region of the phone language, when the time zone agrees or says nothing', () => {
    expect(countryOfUse({ phone: { languages: ['fr-ML'], timeZone: 'Africa/Bamako' } })).toEqual({
      country: 'ML',
      source: 'language',
    });
    expect(countryOfUse({ phone: { languages: ['fr-ML'], timeZone: undefined } })).toEqual({
      country: 'ML',
      source: 'language',
    });
    expect(countryOfUse({ phone: { languages: ['fr-ML'], timeZone: 'UTC' } })).toEqual({
      country: 'ML',
      source: 'language',
    });
  });

  it('asks when the language and the time zone name two countries: never one picked for her', () => {
    expect(countryOfUse({ phone: { languages: ['fr-SN'], timeZone: 'Africa/Bamako' } })).toEqual({
      country: null,
      source: null,
      ask: ['SN', 'ML'],
    });
    // The country chosen answers the question.
    expect(
      countryOfUse({ chosen: 'ML', phone: { languages: ['fr-SN'], timeZone: 'Africa/Bamako' } }),
    ).toEqual({ country: 'ML', source: 'chosen' });
  });

  it('never decides on a weak zone, alone or against the language', () => {
    expect(countryOfUse({ phone: { languages: ['fr'], timeZone: 'Africa/Abidjan' } })).toEqual({
      country: null,
      source: null,
    });
    expect(countryOfUse({ phone: { languages: ['fr-CI'], timeZone: 'Africa/Abidjan' } })).toEqual({
      country: 'CI',
      source: 'language',
    });
    expect(countryOfUse({ phone: { languages: ['fr-SN'], timeZone: 'Africa/Abidjan' } })).toEqual({
      country: 'SN',
      source: 'language',
    });
    expect(countryOfUse({ phone: { languages: ['en'], timeZone: 'Africa/Lagos' } })).toEqual({
      country: null,
      source: null,
    });
  });

  it('then the time zone of the phone', () => {
    expect(countryOfUse({ phone: { languages: ['fr-FR'], timeZone: 'Africa/Dakar' } })).toEqual({
      country: 'SN',
      source: 'time-zone',
    });
    expect(countryOfUse({ phone: { languages: ['en'], timeZone: 'Africa/Accra' } })).toEqual({
      country: 'GH',
      source: 'time-zone',
    });
  });

  it('else unknown: never a guessed country', () => {
    expect(countryOfUse({ phone: NOWHERE })).toEqual({ country: null, source: null });
    expect(countryOfUse({ phone: { languages: ['fr-BE'], timeZone: 'Europe/Brussels' } })).toEqual({
      country: null,
      source: null,
    });
  });

  it('is unknown when the person said her country is not in the list, whatever the phone says', () => {
    expect(countryOfUse({ chosen: 'other', phone: senegal })).toEqual({
      country: null,
      source: 'chosen',
    });
  });

  it('ignores a stored or deployed value that is not a country of the file', () => {
    expect(countryOfUse({ deployment: 'XX', chosen: 'sn', phone: NOWHERE })).toEqual({
      country: null,
      source: null,
    });
    expect(countryOfUse({ deployment: 12, chosen: { code: 'SN' }, phone: senegal })).toEqual({
      country: 'SN',
      source: 'language',
    });
  });

  it('knows the choices a person can store: a country of the file, or another country', () => {
    expect(isCountryChoice('SN')).toBe(true);
    expect(isCountryChoice('other')).toBe(true);
    expect(isCountryChoice('US')).toBe(false);
    expect(isCountryChoice(null)).toBe(false);
  });
});

describe('a country name searched', () => {
  it('is compared without case, accents, hyphens, apostrophes or extra spaces', () => {
    expect(searchKey('Sénégal')).toBe('senegal');
    expect(searchKey('  GUINÉE-Bissau ')).toBe('guinee bissau');
    expect(searchKey("Côte d'Ivoire")).toBe('cote d ivoire');
    expect(searchKey('cote  d’ivoire')).toBe('cote d ivoire');
  });
});

describe('what the phone says', () => {
  it('reads the languages and the time zone of the phone, offline, with no permission', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const where = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: where, watchPosition: where },
    });
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-SN', 'fr']);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: 'Africa/Dakar',
    });

    const hints = phoneHints();
    expect(hints).toEqual({ languages: ['fr-SN', 'fr'], timeZone: 'Africa/Dakar' });
    expect(countryOfUse({ phone: hints }).country).toBe('SN');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(where).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'geolocation');
  });

  it('falls back to the one language when the list is empty', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue([]);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GH');
    expect(phoneHints().languages).toEqual(['en-GH']);
  });

  it('says nothing, never throws, when the phone gives nothing', () => {
    vi.spyOn(navigator, 'languages', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(navigator, 'language', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => {
      throw new RangeError('no time zone');
    });
    expect(phoneHints()).toEqual(NOWHERE);
  });
});
