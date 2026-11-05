// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  COUNTRIES,
  COUNTRY_CODES,
  EMERGENCY_FILE,
  EMERGENCY_SERVICES,
  emergencyNumbersOf,
  isCountryCode,
  type EmergencyService,
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

/** Where a page comes from: two pages of one publisher are one source. */
function publisher(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const labels = host.split('.');
  const lastTwo = labels.slice(-2).join('.');
  // Public suffixes of the sources: the publisher is the label before them.
  const suffixes = ['gov.uk', 'gouv.fr', 'gc.ca', 'gov.gh', 'gov.ng', 'gov.gm', 'admin.ch'];
  return suffixes.includes(lastTwo) && labels.length > 2 ? labels.slice(-3).join('.') : lastTwo;
}

const MEDICAL: readonly EmergencyService[] = ['samu', 'ambulance', 'emergency'];
const FIRE: readonly EmergencyService[] = ['firefighters', 'civil-protection'];

/** The rank of a service in a country's list: medical, then fire, then the police. */
function rank(service: EmergencyService): number {
  if (MEDICAL.includes(service)) return 0;
  if (FIRE.includes(service)) return 1;
  return 2;
}

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

  it('gives each number at least two sources of two publishers, fetched on a known date', () => {
    for (const country of EMERGENCY_FILE.countries) {
      for (const number of country.numbers) {
        const where = `${country.code} ${number.phone}`;
        expect(number.checkedOn, where).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(number.checkedOn)), where).toBe(false);
        for (const source of number.sources) {
          expect(new URL(source.url).protocol, where).toBe('https:');
          expect(source.says.trim(), where).not.toBe('');
        }
        const publishers = new Set(number.sources.map((source) => publisher(source.url)));
        expect(publishers.size, where).toBeGreaterThanOrEqual(2);
      }
    }
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

  it('puts the medical number first, then the fire brigade, and the police only with no medical number', () => {
    for (const country of EMERGENCY_FILE.countries) {
      const ranks = country.numbers.map((number) => rank(number.service));
      expect(ranks, country.code).toEqual([...ranks].sort((a, b) => a - b));
      if (ranks.includes(0)) expect(ranks, country.code).not.toContain(2);
    }
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

  it('keeps France for testing, never found from the phone', () => {
    expect(COUNTRIES.find((country) => country.code === 'FR')?.detect).toBe(false);
    expect(COUNTRIES.filter((country) => !country.detect).map((country) => country.code)).toEqual([
      'FR',
    ]);
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
    expect(emergencyNumbersOf('GH')).toEqual([
      { service: 'emergency', phone: '112' },
      { service: 'emergency', phone: '999' },
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
