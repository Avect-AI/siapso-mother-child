// SPDX-License-Identifier: MIT
import { numberWordsToDigits } from './number-words.js';

export interface ParsedQuery {
  /** The query without its strength tokens, spaces collapsed. */
  text: string;
  /** The strength in mg, when the query gives one. */
  strengthMg?: number;
}

const STRENGTH =
  /(\d+(?:[.,]\d+)?)\s*(microgrammes?|milligrammes?|grammes?|mcg|µg|mg|g)?(?![\p{L}\d])/gu;
const FACTORS: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001, µg: 0.001 };

function factorOf(unit: string | undefined): number {
  if (unit === undefined) return 1;
  if (unit.startsWith('micro')) return 0.001;
  if (unit.startsWith('milli')) return 1;
  if (unit.startsWith('gramme')) return 1000;
  return FACTORS[unit] ?? 1;
}

/**
 * Words after a number without a unit that make it a count, a volume or a
 * number of times, never a strength: "100 comprimés", "100 ml", "3 fois",
 * "deux cuillères", "pendant 3 jours", "2 boîtes" (accents aside).
 */
const COUNT_AFTER: ReadonlySet<string> = new Set([
  'comprimes',
  'gelules',
  'sachets',
  'suppositoires',
  'ampoules',
  'flacons',
  'capsules',
  'pastilles',
  'ovules',
  'doses',
  'unites',
  'boite',
  'boites',
  'ml',
  'cl',
  'fois',
  'cuillere',
  'cuilleres',
  'cuilleree',
  'cuillerees',
  'goutte',
  'gouttes',
  'jour',
  'jours',
]);

/**
 * The same words in the singular: after 1 a count ("1 comprimé"); after any
 * other number the form of the box, which follows its strength as the boxes
 * write it ("Doliprane 1000 comprimé effervescent").
 */
const ONE_OF: ReadonlySet<string> = new Set([
  'comprime',
  'gelule',
  'sachet',
  'suppositoire',
  'ampoule',
  'flacon',
  'capsule',
  'pastille',
  'ovule',
  'dose',
  'unite',
]);

/** "boîte de", "fois" or "x" just before a number: a count ("boîte de 100", "2 fois 100", "x100"). */
const COUNT_BEFORE = /(?:^|[\s,;(])(?:bo[iî]tes?\s+de|fois|x)\s*$/u;

/** A word without its accents, as the counts above are written. */
function plain(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Whether the number `value`, followed by `after` (the text after it), is a count, a volume or a number of times. */
function countAfter(after: string, value: number): boolean {
  const word = plain(/^\s*([\p{L}\p{M}]+)/u.exec(after)?.[1] ?? '');
  return COUNT_AFTER.has(word) || (value === 1 && ONE_OF.has(word));
}

/**
 * Extracts the first strength of a query ("1 g", "1000", "1000 mg", "0,5 g",
 * "ibuprofene400", "1 gramme") and returns it in mg with the rest of the text.
 * A number glued to a letter is a strength only with a unit or at least 3
 * digits, so that names such as "B9" or "B12" are kept. A strength said or
 * typed in French words ("mille", "quatre cents", "un gramme") is read too
 * (number-words.ts). A count, a volume or a number of times is never a
 * strength, in digits or in words: a number after "boîte de", "fois" or "x",
 * or one without a unit followed by a count word ("100 comprimés", "cent
 * ml", "1 comprimé").
 */
export function parseStrength(query: string): ParsedQuery {
  const lower = numberWordsToDigits(query.toLowerCase());
  for (const found of lower.matchAll(STRENGTH)) {
    const [whole, number = '', unit] = found;
    const start = found.index;
    const before = start > 0 ? lower.charAt(start - 1) : ' ';
    const glued = /\p{L}/u.test(before);
    if (COUNT_BEFORE.test(lower.slice(0, start))) continue;
    if (glued && unit === undefined && number.replace(/\D/g, '').length < 3) continue;
    const amount = Number.parseFloat(number.replace(',', '.'));
    if (unit === undefined && countAfter(lower.slice(start + whole.length), amount)) continue;
    const value = amount * factorOf(unit);
    if (!Number.isFinite(value) || value <= 0) continue;
    const rest = lower.slice(0, start) + ' ' + lower.slice(start + whole.length);
    return { text: rest.replace(/\s+/g, ' ').trim(), strengthMg: Math.round(value * 1e6) / 1e6 };
  }
  return { text: query };
}
