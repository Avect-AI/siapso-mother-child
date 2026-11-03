// SPDX-License-Identifier: MIT
// Forbidden wording (design spec section 2, "Forbidden words test"): words
// that would imply safety, verification or an instruction to change a
// treatment. Matching is whole-word, case-insensitive and accent-aware.
import type { Lang } from './types.js';

interface Entry {
  /** Canonical form, lowercase, as returned. */
  expression: string;
  /** Unaccented spellings also match (all French words except sûr). */
  accentsOptional?: boolean;
  /** Feminine and plural forms (-e, -es, -s) also match. */
  inflected?: boolean;
  /** Other spellings (verb inflections) that match and are reported as the expression. */
  forms?: string[];
  /** Fixed sentences inside which the expression is allowed. */
  allowedIn?: string[];
}

const FRENCH: Entry[] = [
  // Accent required: "sur" (the preposition) is allowed, "sûr" (the adjective) is not.
  { expression: 'sûr', inflected: true },
  { expression: 'sans danger' },
  {
    expression: 'sans risque',
    allowedIn: [
      "ne veut pas dire que c'est sans risque",
      "ne veut pas dire qu'il est sans risque",
      "ne veut pas dire qu'elle est sans risque",
    ],
  },
  { expression: 'vérifié', accentsOptional: true, inflected: true },
  { expression: 'vérifiez', accentsOptional: true },
  { expression: 'arrêtez', accentsOptional: true },
  { expression: 'ne prenez pas' },
  { expression: 'ne le prenez pas' },
  { expression: 'ne la prenez pas' },
  { expression: 'ne les prenez pas' },
  { expression: 'remplacez' },
  { expression: 'diminuez' },
  { expression: 'prenez plutôt', accentsOptional: true },
  { expression: 'autorisé', accentsOptional: true, inflected: true },
  { expression: 'compatible', inflected: true },
];

const ENGLISH: Entry[] = [
  { expression: 'safe' },
  { expression: 'harmless' },
  { expression: 'verified' },
  { expression: 'verify' },
  { expression: 'stop', forms: ['stops', 'stopping', 'stopped'] },
  { expression: 'do not take' },
  { expression: "don't take" },
  { expression: 'dont take' },
  { expression: 'replace', forms: ['replaces', 'replacing', 'replaced'] },
  { expression: 'reduce', forms: ['reduces', 'reducing', 'reduced'] },
  { expression: 'take instead' },
  { expression: 'authorised' },
  { expression: 'authorized' },
  { expression: 'compatible' },
  { expression: 'no risk' },
  { expression: 'no-risk' },
  { expression: 'risk-free', allowedIn: ['does not mean it is risk-free'] },
];

const UNACCENTED: Readonly<Record<string, string>> = {
  é: '[eé]',
  è: '[eè]',
  ê: '[eê]',
  ô: '[oô]',
  û: '[uû]',
};
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]';
const APOSTROPHES = "['’]";
/** Spaces, apostrophes, accented letters and regular expression syntax characters. */
const SPECIAL = /\s+|'|[éèêôû]|[\\^$.*+?()[\]{}|/]/gu;

/** Regular expression source matching `text` literally, with flexible spaces and apostrophes. */
function patternSource(text: string, accentsOptional: boolean): string {
  return text.normalize('NFC').replace(SPECIAL, (ch) => {
    if (/^\s+$/u.test(ch)) return '\\s+';
    if (ch === "'") return APOSTROPHES;
    const accented = UNACCENTED[ch];
    if (accented !== undefined) return accentsOptional ? accented : ch;
    return `\\${ch}`;
  });
}

function wholeWords(source: string): RegExp {
  return new RegExp(`(?<!${WORD_CHAR})${source}(?!${WORD_CHAR})`, 'gu');
}

interface Compiled {
  expression: string;
  pattern: RegExp;
  allowed: RegExp[];
}

function compile(entries: Entry[]): Compiled[] {
  return entries.map((entry) => {
    const accentsOptional = entry.accentsOptional === true;
    const suffix = entry.inflected === true ? '(?:e|es|s)?' : '';
    const spellings = [entry.expression, ...(entry.forms ?? [])].map(
      (text) => patternSource(text, accentsOptional) + suffix,
    );
    return {
      expression: entry.expression,
      pattern: wholeWords(`(?:${spellings.join('|')})`),
      allowed: (entry.allowedIn ?? []).map((text) => wholeWords(patternSource(text, false))),
    };
  });
}

const COMPILED: Readonly<Record<Lang, Compiled[]>> = { fr: compile(FRENCH), en: compile(ENGLISH) };

/**
 * The forbidden expressions found in a text, in lowercase as listed, in order
 * of first appearance, without duplicates. Empty when the text is acceptable.
 */
export function findForbiddenWording(text: string, lang: Lang): string[] {
  const normalised = text.toLowerCase().normalize('NFC');
  const found: { expression: string; index: number; order: number }[] = [];
  COMPILED[lang].forEach((entry, order) => {
    const allowedSpans = entry.allowed.flatMap((pattern) =>
      [...normalised.matchAll(pattern)].map((m) => ({
        start: m.index,
        end: m.index + m[0].length,
      })),
    );
    for (const match of normalised.matchAll(entry.pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!allowedSpans.some((span) => span.start <= start && end <= span.end)) {
        found.push({ expression: entry.expression, index: start, order });
        break;
      }
    }
  });
  return found.sort((a, b) => a.index - b.index || a.order - b.order).map((f) => f.expression);
}
