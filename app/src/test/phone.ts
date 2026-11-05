// SPDX-License-Identifier: MIT
// The languages the phone of a test says it uses (navigator.languages): the
// welcome takes the app's language from them (i18n/phone-language.ts).
// setup.ts sets a French phone back before every test.

/** The test phone says it uses `languages`, first the one it prefers. */
export function phoneSetTo(languages: readonly string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    value: Object.freeze([...languages]),
    configurable: true,
  });
}

/** A phone set to French, as most phones of the app's users. */
export const FRENCH_PHONE = ['fr-FR', 'fr'] as const;
