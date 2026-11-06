// SPDX-License-Identifier: MIT
import { numberWordsToDigits } from './number-words.js';

export interface ParsedQuery {
  /** The query without its strength tokens, spaces collapsed. */
  text: string;
  /** The strength in mg, when the query gives one. */
  strengthMg?: number;
  /** The unit written with the strength, when one is ("75 mg", "1 g", "25 µg"). */
  unit?: StrengthUnit;
}

/** A unit of strength as written, whatever its spelling ("mg", "milligrammes"). */
export type StrengthUnit = 'mg' | 'g' | 'µg';

const STRENGTH =
  /(\d+(?:[.,]\d+)?)\s*(microgrammes?|milligrammes?|grammes?|mcg|µg|mg|g)?(?![\p{L}\d])/gu;
const FACTORS: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001, µg: 0.001 };

function unitOf(unit: string): StrengthUnit {
  if (unit.startsWith('micro') || unit === 'mcg' || unit === 'µg') return 'µg';
  if (unit.startsWith('milli') || unit === 'mg') return 'mg';
  return 'g';
}

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
  'cp',
  'cps',
  'cpr',
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

/**
 * "boîte de", "fois" or "x" just before a number without a unit: a count
 * ("boîte de 100", "2 fois 100", "x100"); with a unit, its strength ("2 fois
 * 100 mg").
 */
const COUNT_BEFORE = /(?:^|[\s,;(])(?:bo[iî]tes?\s+de|fois|x)\s*$/u;

/**
 * A number without a unit then "x" and another number ("2 x 500 mg", "2 × 500"):
 * the first is a count when the second has a unit or is larger; otherwise the
 * second is ("doliprane 1000 x 8").
 */
const TIMES_NUMBER =
  /^\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(microgrammes?|milligrammes?|grammes?|mcg|µg|mg|g)?(?![\p{L}\d])/u;

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
 * ml", "1 comprimé"), and the count before "x" ("2 x 500 mg" reads 500 mg).
 * The unit written, if any, is said with it.
 */
export function parseStrength(query: string): ParsedQuery {
  const lower = numberWordsToDigits(query.toLowerCase());
  // The number after a count and "x" is the strength, even with no unit ("2 x 500").
  let afterCount = -1;
  for (const found of lower.matchAll(STRENGTH)) {
    const [whole, number = '', unit] = found;
    const start = found.index;
    const before = start > 0 ? lower.charAt(start - 1) : ' ';
    const glued = /\p{L}/u.test(before);
    if (unit === undefined && start !== afterCount && COUNT_BEFORE.test(lower.slice(0, start))) {
      continue;
    }
    if (glued && unit === undefined && number.replace(/\D/g, '').length < 3) continue;
    const amount = Number.parseFloat(number.replace(',', '.'));
    const after = lower.slice(start + whole.length);
    if (unit === undefined && countAfter(after, amount)) continue;
    const times = unit === undefined ? TIMES_NUMBER.exec(after) : null;
    if (times !== null) {
      const [, next = '', nextUnit] = times;
      if (nextUnit !== undefined || Number.parseFloat(next.replace(',', '.')) > amount) {
        afterCount = start + whole.length + times[0].indexOf(next);
        continue;
      }
    }
    const value = amount * factorOf(unit);
    if (!Number.isFinite(value) || value <= 0) continue;
    const rest = lower.slice(0, start) + ' ' + after;
    return {
      text: rest.replace(/\s+/g, ' ').trim(),
      strengthMg: Math.round(value * 1e6) / 1e6,
      ...(unit === undefined ? {} : { unit: unitOf(unit) }),
    };
  }
  return { text: query };
}
