// SPDX-License-Identifier: MIT
/**
 * Spelling variants applied to each word, in this order:
 * - `ph` becomes `f` (phenytoine, fenitoine);
 * - `y` becomes `i` (nebeday, nebedai);
 * - a doubled consonant becomes single (doliprann, dolipran); vowels and
 *   digits are kept as they are;
 * - a trailing `e` is dropped in words of more than 4 letters (ibuprofene,
 *   ibuprofen), so that a missing or added final `e` does not matter.
 * `kh` is NOT mapped to `x`: it would change the meaning of Wolof names.
 */
function simplifyWord(word: string): string {
  const spelled = word
    .replaceAll('ph', 'f')
    .replaceAll('y', 'i')
    .replace(/([b-df-hj-np-tv-z])\1+/g, '$1');
  return spelled.length > 4 && spelled.endsWith('e') ? spelled.slice(0, -1) : spelled;
}

/**
 * Lowercase, strip accents, turn apostrophes, hyphens and any other character
 * that is not a letter or a digit into spaces, collapse spaces and trim, then
 * apply the spelling variants to each word. Used on both sides of a match.
 */
export function normalize(text: string): string {
  const plain = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (plain === '') return '';
  return plain.split(' ').map(simplifyWord).join(' ');
}
