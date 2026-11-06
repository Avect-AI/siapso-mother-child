// SPDX-License-Identifier: MIT
// The country where the phone is used, whose emergency numbers who to call
// shows (config/emergency.ts). Found offline, with no network lookup and no
// location permission, in this order:
//   1. the deployment file public/config/referral.json ("country");
//   2. the country chosen on the phone (Settings or who to call; kept in the
//      settings, it says nothing about a profile), "other" meaning a country
//      the list does not have;
//   3. the region of the phone's language (navigator.languages, "fr-SN");
//   4. the phone's time zone (Intl, "Africa/Dakar"), for a zone of one
//      country only, never a weak zone (Africa/Abidjan, Africa/Lagos: the tz
//      database makes them the canonical zones of other countries too);
//   5. else unknown: who to call then asks for the country and never shows a
//      guessed number.
// When the language and the time zone name two countries of the file, the
// phone is not trusted with either: who to call asks which (`ask`).
// A country of the file marked detect false (France, for testing) is never
// found from the phone (3 and 4): many phones in West and Central Africa use
// French (France) as their language.
import {
  COUNTRIES,
  isCountryCode,
  WEAK_TIME_ZONES,
  type CountryCode,
} from '../config/emergency.js';

/** What a person can choose: a country of the file, or another country (not in the list). */
export type CountryChoice = CountryCode | 'other';

/** Where the country of use comes from. */
export type CountrySource = 'deployment' | 'chosen' | 'language' | 'time-zone';

/** What the phone says of where it is, read offline (phoneHints). */
export interface PhoneHints {
  /** The phone's languages, most preferred first ("fr-SN"). */
  languages: readonly string[];
  /** The phone's IANA time zone ("Africa/Dakar"). */
  timeZone: string | undefined;
}

export interface CountryOfUse {
  /** Null: unknown, or another country than those of the file. */
  country: CountryCode | null;
  /** Null: nothing gave a country. */
  source: CountrySource | null;
  /** The language and the time zone name these two countries: the person says which. */
  ask?: [CountryCode, CountryCode];
}

export function isCountryChoice(value: unknown): value is CountryChoice {
  return value === 'other' || isCountryCode(value);
}

/** The countries the phone may point to, with the zones that name each of them. */
const DETECTED = COUNTRIES.filter((country) => country.detect);
const BY_ZONE = new Map(
  DETECTED.flatMap((country) =>
    country.timeZones
      .filter((zone) => !WEAK_TIME_ZONES.has(zone))
      .map((zone) => [zone, country.code] as const),
  ),
);

/**
 * The region of a BCP 47 language tag, upper case ("fr-SN": "SN"; "fr_SN",
 * as some systems write it, too); undefined for a tag without a country
 * region ("fr", "es-419").
 */
export function regionOf(tag: string): string | undefined {
  const match = /^[a-z]{2,3}(?:[-_][a-z]{4})?[-_]([a-z]{2})(?:[-_]|$)/i.exec(tag.trim());
  return match?.[1]?.toUpperCase();
}

/** The first region of the phone's languages that is a country the phone may point to. */
export function countryOfLanguages(languages: readonly string[]): CountryCode | null {
  for (const tag of languages) {
    const region = regionOf(tag);
    const country = DETECTED.find(({ code }) => code === region);
    if (country !== undefined) return country.code;
  }
  return null;
}

/** The country of a time zone of one country of the file (zone.tab), never a weak zone; none otherwise. */
export function countryOfTimeZone(zone: string | undefined): CountryCode | null {
  return zone === undefined ? null : (BY_ZONE.get(zone) ?? null);
}

/**
 * The country of use, in the order above. `deployment` and `chosen` are read
 * as given (a value that is not a country of the file is ignored); `chosen`
 * "other" stops there: the person said her country is not in the list. A
 * language and a time zone that name two countries give no country, and
 * both to ask about.
 */
export function countryOfUse({
  deployment,
  chosen,
  phone,
}: {
  deployment?: unknown;
  chosen?: unknown;
  phone: PhoneHints;
}): CountryOfUse {
  if (isCountryCode(deployment)) return { country: deployment, source: 'deployment' };
  if (chosen === 'other') return { country: null, source: 'chosen' };
  if (isCountryCode(chosen)) return { country: chosen, source: 'chosen' };
  const spoken = countryOfLanguages(phone.languages);
  const zoned = countryOfTimeZone(phone.timeZone);
  if (spoken !== null && zoned !== null && spoken !== zoned) {
    return { country: null, source: null, ask: [spoken, zoned] };
  }
  if (spoken !== null) return { country: spoken, source: 'language' };
  if (zoned !== null) return { country: zoned, source: 'time-zone' };
  return { country: null, source: null };
}

/** A country name as the search compares it: no case, accents, hyphens, apostrophes or extra spaces. */
export function searchKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[-'’\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * What the phone says, read on the phone only: its languages and its time
 * zone. Never throws (a browser that blocks either gives nothing of it), and
 * never asks for the location.
 */
export function phoneHints(): PhoneHints {
  return { languages: phoneLanguages(), timeZone: phoneTimeZone() };
}

function phoneLanguages(): readonly string[] {
  try {
    if (navigator.languages.length > 0) return [...navigator.languages];
  } catch {
    // Blocked or missing: the one language, below.
  }
  try {
    return navigator.language ? [navigator.language] : [];
  } catch {
    return [];
  }
}

function phoneTimeZone(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
