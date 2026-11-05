// SPDX-License-Identifier: MIT
// A source of the knowledge base as a screen says it: its name, licence and
// version in the language of the screen (the pack gives them in English, and
// in French), and the language of its documents when it is another one, so
// that a French screen never shows an English label as its own words.
import type { Lang, Source } from '@siapso/engine';
import { formatDate, isIsoDate } from './dates.js';

export interface SourceShown {
  name: string;
  licence: string;
  version?: string;
  /** The language of its documents, only when it is not the language of the screen. */
  documents?: Lang;
}

/**
 * The words of `source` for a screen in `lang`: the French ones on a French
 * screen, the entry's own otherwise (a pack without French words falls back to
 * them). A version that is an access date is written as the language writes dates.
 */
export function sourceWords(source: Source, lang: Lang): SourceShown {
  const words = lang === 'fr' && source.fr !== undefined ? source.fr : source;
  const shown: SourceShown = { name: words.name, licence: words.licence };
  const version = words.version ?? source.version;
  if (version !== undefined) {
    shown.version = isIsoDate(version) ? formatDate(version, lang) : version;
  }
  if (source.documents !== undefined && source.documents !== lang) {
    shown.documents = source.documents;
  }
  return shown;
}
