// SPDX-License-Identifier: MIT
// The built-in emergency circuit of "Qui appeler": the public national
// emergency numbers of the country where the phone is used, shown as call
// links on every who to call screen (locked or not, in both modes, with or
// without saved contacts), with the line "Allez au poste de santé ou au
// centre de santé le plus proche.". A danger sign thus always leads to a
// number to call or a place to go, even on a phone with no contact and no
// deployment file. Only a medical number (isMedical) is ever the first call
// of the screen; the fire brigade and the police are said as such.
//
// The numbers are in emergency-numbers.json (CC BY 4.0, REUSE.toml), each
// with its sources (publisher, kind, the day the page gives, the day it was
// fetched); every medical number has a national source. A number whose
// sources disagree, or that has too few sources, is left out there with why.
// The country of use is found offline (domain/country.ts).
//
// A deployment replaces the numbers through its file
// public/config/referral.json ("emergencyNumbers") and may fix the country
// ("country"); the line always stays, and the file's "nationalCircuit" is
// shown under it (see README.md, "Referral contacts of a deployment").
//
// Only public emergency service numbers belong here, never a personal number.
//
// TEAM CHECK: the team must confirm the numbers of a pilot country with the
// health authorities of the pilot district before a pilot (that they answer
// there, from every operator, free of charge): see the file's teamCheck.
//
// The words are in the translation files: call.services.<service> names the
// service in a sentence, countries.<code> names the country.
import file from './emergency-numbers.json' with { type: 'json' };

/** A public emergency service: medical first, then fire and rescue, then the police. */
export type EmergencyService =
  'samu' | 'ambulance' | 'emergency' | 'firefighters' | 'civil-protection' | 'police';

export const EMERGENCY_SERVICES: readonly EmergencyService[] = [
  'samu',
  'ambulance',
  'emergency',
  'firefighters',
  'civil-protection',
  'police',
];

/** The services that send medical help: the only ones the first call of a screen may be. */
const MEDICAL_SERVICES: readonly EmergencyService[] = ['samu', 'ambulance', 'emergency'];

export function isMedical(service: EmergencyService): boolean {
  return MEDICAL_SERVICES.includes(service);
}

/** What the person is told of a number: "not-all-networks", it may not work from every network. */
export type NumberCaveat = 'not-all-networks';

export const NUMBER_CAVEATS: readonly NumberCaveat[] = ['not-all-networks'];

export interface BuiltInEmergencyNumber {
  service: EmergencyService;
  /** The number the phone dials, digits only. */
  phone: string;
  caveat?: NumberCaveat;
}

/**
 * Who publishes a source: the telecom regulator, a ministry or government
 * office of the country, the emergency service itself (the three national
 * kinds), another country's foreign ministry, a mobile operator, the press,
 * or a compilation.
 */
export type SourceKind =
  'regulator' | 'ministry' | 'service' | 'foreign-ministry' | 'operator' | 'press' | 'compilation';

export const SOURCE_KINDS: readonly SourceKind[] = [
  'regulator',
  'ministry',
  'service',
  'foreign-ministry',
  'operator',
  'press',
  'compilation',
];

/** A source of a number: the page fetched, who publishes it, and what it says. */
export interface NumberSource {
  url: string;
  publisher: string;
  kind: SourceKind;
  /** The day the page gives itself (updated or published), when it gives one. */
  pageUpdated?: string;
  /** The day the page was fetched. */
  checkedOn: string;
  says: string;
}

/**
 * The countries of the file by ISO 3166-1 alpha-2 code, in its order: a test
 * holds this list and the file equal, so a code is a type, and each one has
 * its name in the translation files.
 */
export const COUNTRY_CODES = [
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
] as const;

/** The code of a country of the file ("SN"). */
export type CountryCode = (typeof COUNTRY_CODES)[number];

/** The file emergency-numbers.json, as written. */
export interface EmergencyFile {
  about: string;
  teamCheck: string;
  attribution: string[];
  /** Zones other countries may report as theirs (canonical links in the tz database): never enough alone. */
  weakTimeZones: string[];
  countries: {
    code: string;
    timeZones: string[];
    /** False: never found from the phone, only chosen by hand (France, for testing). */
    detect?: boolean;
    numbers: (BuiltInEmergencyNumber & { sources: NumberSource[] })[];
    leftOut: { service: EmergencyService; phone?: string; why: string }[];
    notes: string[];
  }[];
}

export const EMERGENCY_FILE = file as EmergencyFile;

/** A country of the file, as the app reads it. */
export interface Country {
  code: CountryCode;
  /** The IANA time zones of the country (zone.tab), one country each. */
  timeZones: readonly string[];
  /** Found from the phone's language region or time zone; false: chosen by hand only. */
  detect: boolean;
  /** In the order they are shown: the first is the screen's primary action when no contact is listed. */
  numbers: readonly BuiltInEmergencyNumber[];
}

/** The countries of the file, in its order. */
export const COUNTRIES: readonly Country[] = EMERGENCY_FILE.countries.map((country) => ({
  // The file's codes are COUNTRY_CODES (tested).
  code: country.code as CountryCode,
  timeZones: country.timeZones,
  detect: country.detect !== false,
  numbers: country.numbers.map(({ service, phone, caveat }) =>
    caveat === undefined ? { service, phone } : { service, phone, caveat },
  ),
}));

/** Zones other countries may report as theirs: a phone in them says no country alone. */
export const WEAK_TIME_ZONES: ReadonlySet<string> = new Set(EMERGENCY_FILE.weakTimeZones);

const BY_CODE = new Map<string, Country>(COUNTRIES.map((country) => [country.code, country]));

/** A code of a country of the file ("SN"; never "sn" or a country the file does not have). */
export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === 'string' && (COUNTRY_CODES as readonly string[]).includes(value);
}

/** The country of the file with this code. */
export function countryOf(code: CountryCode): Country {
  const country = BY_CODE.get(code);
  if (country === undefined) throw new RangeError(`Not a country of the file: ${code}`);
  return country;
}

/** The numbers of a country, in the order shown; none for an unknown country. */
export function emergencyNumbersOf(code: string | null): readonly BuiltInEmergencyNumber[] {
  if (!isCountryCode(code)) return [];
  return countryOf(code).numbers;
}
