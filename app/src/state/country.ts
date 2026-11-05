// SPDX-License-Identifier: MIT
// The country of use on a screen: the deployment's, else the one chosen and
// kept in the settings, else what the phone says (domain/country.ts).
import type { CountryCode } from '../config/emergency.js';
import { countryOfUse, type CountryOfUse } from '../domain/country.js';
import { useApp } from './app-state.js';

/**
 * The country of use now. `deployment` is the deployment file's country once
 * read (undefined before, or without one). Before the settings are read, the
 * phone says it: who to call never waits for storage.
 */
export function useCountryOfUse(deployment?: CountryCode): CountryOfUse {
  const { settings, phone } = useApp();
  return countryOfUse({ deployment, chosen: settings.country, phone });
}
