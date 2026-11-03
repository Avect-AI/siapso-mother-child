// SPDX-License-Identifier: MIT
/**
 * Lowercase, strip accents, turn apostrophes, hyphens and any other character
 * that is not a letter or a digit into spaces, collapse spaces and trim.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
