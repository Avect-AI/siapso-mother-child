// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  COUNTRY_CODES,
  EMERGENCY_FILE,
  EMERGENCY_SERVICES,
  emergencyNumbersOf,
  isCountryCode,
  isMedical,
  NUMBER_CAVEATS,
  SOURCE_KINDS,
  type EmergencyService,
  type SourceKind,
} from './emergency.js';

/** The countries the team asked for first (2026-11-05), France for testing. */
const ASKED = [
  'SN',
  'ML',
  'MR',
  'GM',
  'GN',
  'GW',
  'CV',
  'CI',
  'BF',
  'NE',
  'TG',
  'BJ',
  'GH',
  'NG',
  'CM',
  'TD',
  'CF',
  'GA',
  'CG',
  'CD',
  'MG',
  'MA',
  'DZ',
  'TN',
  'FR',
];

const MEDICAL: readonly EmergencyService[] = ['samu', 'ambulance', 'emergency'];
const FIRE: readonly EmergencyService[] = ['firefighters', 'civil-protection'];

/** The rank of a service in a country's list: medical, then fire, then the police. */
function rank(service: EmergencyService): number {
  if (MEDICAL.includes(service)) return 0;
  if (FIRE.includes(service)) return 1;
  return 2;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('the emergency numbers file', () => {
  it('has each country asked for, once, by its ISO 3166-1 code', () => {
    const codes = EMERGENCY_FILE.countries.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
    expect([...codes].sort()).toEqual([...ASKED].sort());
  });

  it('holds the same codes, in the same order, as the list the app is typed with', () => {
    expect(EMERGENCY_FILE.countries.map((country) => country.code)).toEqual([...COUNTRY_CODES]);
  });

  it('says the team must confirm every number before a pilot', () => {
    expect(EMERGENCY_FILE.teamCheck).toMatch(/^TEAM CHECK: /);
    expect(EMERGENCY_FILE.teamCheck).toMatch(/before a pilot/);
  });

  it('gives each number at least two sources of two publishers, each with its kind and the day it was fetched', () => {
    for (const country of EMERGENCY_FILE.countries) {
      for (const number of country.numbers) {
        const where = `${country.code} ${number.phone}`;
        for (const source of number.sources) {
          expect(new URL(source.url).protocol, where).toBe('https:');
          expect(source.publisher.trim(), where).not.toBe('');
          expect(SOURCE_KINDS, where).toContain(source.kind);
          expect(source.checkedOn, where).toMatch(DATE);
          expect(Number.isNaN(Date.parse(source.checkedOn)), where).toBe(false);
          if (source.pageUpdated !== undefined) expect(source.pageUpdated, where).toMatch(DATE);
          expect(source.says.trim(), where).not.toBe('');
        }
        const publishers = new Set(number.sources.map((source) => source.publisher));
        expect(publishers.size, where).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('gives each medical number at least one national source: the regulator, a ministry or the service itself', () => {
    const national: readonly SourceKind[] = ['regulator', 'ministry', 'service'];
    for (const country of EMERGENCY_FILE.countries) {
      for (const number of country.numbers.filter(({ service }) => isMedical(service))) {
        const kinds = number.sources.map((source) => source.kind);
        expect(
          kinds.some((kind) => national.includes(kind)),
          `${country.code} ${number.phone}`,
        ).toBe(true);
      }
    }
  });

  it('knows the medical services: the only ones that may be the first call of the screen', () => {
    expect(EMERGENCY_SERVICES.filter(isMedical)).toEqual(MEDICAL);
  });

  it('holds short public service numbers only, each once in its country, never a personal number', () => {
    for (const country of EMERGENCY_FILE.countries) {
      const phones = country.numbers.map((number) => number.phone);
      expect(new Set(phones).size, country.code).toBe(phones.length);
      for (const phone of phones) expect(phone, country.code).toMatch(/^\d{2,4}$/);
      for (const number of country.numbers) {
        expect(EMERGENCY_SERVICES, country.code).toContain(number.service);
      }
    }
  });

  it('puts the medical numbers first, then the fire brigade or civil protection, then the police', () => {
    for (const country of EMERGENCY_FILE.countries) {
      const ranks = country.numbers.map((number) => rank(number.service));
      expect(ranks, country.code).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('marks a number that may not work from every network', () => {
    for (const country of EMERGENCY_FILE.countries) {
      for (const number of country.numbers) {
        if (number.caveat !== undefined)
          expect(NUMBER_CAVEATS, country.code).toContain(number.caveat);
      }
    }
    expect(emergencyNumbersOf('GM')[0]).toEqual({
      service: 'ambulance',
      phone: '116',
      caveat: 'not-all-networks',
    });
  });

  it('says why each number is left out', () => {
    for (const country of EMERGENCY_FILE.countries) {
      for (const left of country.leftOut) {
        expect(EMERGENCY_SERVICES, country.code).toContain(left.service);
        expect(left.why.trim(), country.code).not.toBe('');
      }
    }
  });

  it('names real time zones, each of one country only', () => {
    const seen = new Map<string, string>();
    for (const country of EMERGENCY_FILE.countries) {
      expect(country.timeZones.length, country.code).toBeGreaterThan(0);
      for (const zone of country.timeZones) {
        expect(() => new Intl.DateTimeFormat('en', { timeZone: zone }), zone).not.toThrow();
        expect(seen.get(zone), zone).toBeUndefined();
        seen.set(zone, country.code);
      }
    }
  });

  it('names the weak time zones, which other countries may report as theirs: never enough alone', () => {
    const zones = EMERGENCY_FILE.countries.flatMap((country) => country.timeZones);
    expect(EMERGENCY_FILE.weakTimeZones).toEqual(['Africa/Abidjan', 'Africa/Lagos']);
    for (const zone of EMERGENCY_FILE.weakTimeZones) expect(zones).toContain(zone);
  });

  it('keeps France to a choice by hand: never found from the phone', () => {
    expect(COUNTRIES.find((country) => country.code === 'FR')?.detect).toBe(false);
    expect(COUNTRIES.filter((country) => !country.detect).map((country) => country.code)).toEqual([
      'FR',
    ]);
    expect(JSON.stringify(EMERGENCY_FILE)).not.toMatch(/for testing/i);
  });
});

describe('emergency numbers by country', () => {
  it('keeps the numbers of Senegal: the SAMU, then the fire brigade', () => {
    expect(emergencyNumbersOf('SN')).toEqual([
      { service: 'samu', phone: '1515' },
      { service: 'firefighters', phone: '18' },
    ]);
  });

  it('gives the numbers of each country in the order of the file', () => {
    expect(emergencyNumbersOf('ML')).toEqual([
      { service: 'ambulance', phone: '15' },
      { service: 'firefighters', phone: '18' },
    ]);
    expect(emergencyNumbersOf('CI')).toEqual([
      { service: 'samu', phone: '185' },
      { service: 'firefighters', phone: '180' },
    ]);
    // 999 is marked not operational in the numbering plan of the regulator.
    expect(emergencyNumbersOf('GH')).toEqual([
      { service: 'emergency', phone: '112' },
      { service: 'ambulance', phone: '193' },
      { service: 'firefighters', phone: '192' },
    ]);
    expect(emergencyNumbersOf('BF')).toEqual([
      { service: 'samu', phone: '15' },
      { service: 'firefighters', phone: '18' },
    ]);
    expect(emergencyNumbersOf('CM')).toEqual([
      { service: 'samu', phone: '119' },
      { service: 'firefighters', phone: '118' },
      { service: 'police', phone: '117' },
    ]);
  });

  it('gives no medical number where none has a national source: the fire brigade and the police only', () => {
    expect(emergencyNumbersOf('MG')).toEqual([
      { service: 'firefighters', phone: '118' },
      { service: 'police', phone: '117' },
    ]);
    expect(emergencyNumbersOf('TD')).toEqual([{ service: 'police', phone: '117' }]);
    expect(emergencyNumbersOf('NE')).toEqual([
      { service: 'firefighters', phone: '18' },
      { service: 'police', phone: '17' },
    ]);
  });

  it('gives no number for an unknown country, or a country whose numbers are all left out', () => {
    expect(emergencyNumbersOf(null)).toEqual([]);
    expect(emergencyNumbersOf('MR')).toEqual([]);
    expect(emergencyNumbersOf('CD')).toEqual([]);
  });

  it('knows the codes of the file only', () => {
    expect(isCountryCode('SN')).toBe(true);
    expect(isCountryCode('FR')).toBe(true);
    expect(isCountryCode('sn')).toBe(false);
    expect(isCountryCode('US')).toBe(false);
    expect(isCountryCode('other')).toBe(false);
    expect(isCountryCode(undefined)).toBe(false);
    expect(isCountryCode(12)).toBe(false);
  });
});
