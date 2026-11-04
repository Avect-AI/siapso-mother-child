// SPDX-License-Identifier: MIT
// Units per day, as the confirm screen asks for them: a whole number from 1
// to 24, or blank for "not known". The engine throws a RangeError on a count
// that is not finite or not positive; the app never hands it one.

export const MIN_UNITS_PER_DAY = 1;
export const MAX_UNITS_PER_DAY = 24;

/** A unit count the check accepts: a whole number from 1 to 24. */
export function isUnitsPerDay(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_UNITS_PER_DAY &&
    value <= MAX_UNITS_PER_DAY
  );
}

export type ParsedUnits = { ok: true; units: number | undefined } | { ok: false };

/** What was typed: blank is "not known"; digits only, from 1 to 24. */
export function parseUnits(text: string): ParsedUnits {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, units: undefined };
  if (!/^\d{1,3}$/.test(trimmed)) return { ok: false };
  const units = Number(trimmed);
  return isUnitsPerDay(units) ? { ok: true, units } : { ok: false };
}

/**
 * One step up or down from what is typed. Down from 1 is blank ("not known"),
 * up from blank is 1; a value out of range or not a number starts again from
 * the nearest valid count.
 */
export function stepUnits(text: string, step: 1 | -1): string {
  const trimmed = text.trim();
  const typed = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  if (typed !== undefined && typed > MAX_UNITS_PER_DAY) return String(MAX_UNITS_PER_DAY);
  const current = typed === undefined || typed < MIN_UNITS_PER_DAY ? 0 : typed;
  const next = Math.min(MAX_UNITS_PER_DAY, current + step);
  return next < MIN_UNITS_PER_DAY ? '' : String(next);
}
