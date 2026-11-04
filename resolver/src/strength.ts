// SPDX-License-Identifier: MIT
export interface ParsedQuery {
  /** The query without its strength tokens, spaces collapsed. */
  text: string;
  /** The strength in mg, when the query gives one. */
  strengthMg?: number;
}

const STRENGTH = /(\d+(?:[.,]\d+)?)\s*(microgrammes?|mcg|µg|mg|g)?(?![\p{L}\d])/gu;
const FACTORS: Record<string, number> = { g: 1000, mg: 1, mcg: 0.001, µg: 0.001 };

function factorOf(unit: string | undefined): number {
  if (unit === undefined) return 1;
  return unit.startsWith('micro') ? 0.001 : (FACTORS[unit] ?? 1);
}

/**
 * Extracts the first strength of a query ("1 g", "1000", "1000 mg", "0,5 g",
 * "ibuprofene400") and returns it in mg with the rest of the text. A number
 * glued to a letter is a strength only with a unit or at least 3 digits, so
 * that names such as "B9" or "B12" are kept.
 */
export function parseStrength(query: string): ParsedQuery {
  const lower = query.toLowerCase();
  for (const found of lower.matchAll(STRENGTH)) {
    const [whole, number = '', unit] = found;
    const start = found.index;
    const before = start > 0 ? lower.charAt(start - 1) : ' ';
    const glued = /\p{L}/u.test(before);
    if (glued && unit === undefined && number.replace(/\D/g, '').length < 3) continue;
    const value = Number.parseFloat(number.replace(',', '.')) * factorOf(unit);
    if (!Number.isFinite(value) || value <= 0) continue;
    const rest = lower.slice(0, start) + ' ' + lower.slice(start + whole.length);
    return { text: rest.replace(/\s+/g, ' ').trim(), strengthMg: Math.round(value * 1e6) / 1e6 };
  }
  return { text: query };
}
