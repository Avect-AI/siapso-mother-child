// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';

/**
 * The interface language a new phone starts with (SCRUM-56, S1): English when
 * the first language the phone prefers is English, French otherwise (French,
 * Wolof or any other language, since the app ships in French and English and
 * French is the language of the health posts in Senegal). The welcome shows
 * the other language one tap away, and the settings change it at any time.
 */
export function phoneLanguage(languages: readonly string[]): Lang {
  const first = languages[0]?.toLowerCase() ?? '';
  return first === 'en' || first.startsWith('en-') ? 'en' : 'fr';
}

/** The language of this phone, as the browser says it. */
export function thisPhoneLanguage(): Lang {
  return phoneLanguage(typeof navigator === 'undefined' ? [] : navigator.languages);
}
