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

/**
 * Words of pharmaceutical forms, packaging and age groups: they say nothing
 * about which medicine it is ("comprimé blanc" named every tablet). Accents
 * and case do not matter: they are compared after normalize.
 */
export const STOP_WORDS: readonly string[] = [
  // French forms and packaging.
  'comprimé',
  'comprimés',
  'pelliculé',
  'pelliculés',
  'pelliculée',
  'pelliculées',
  'enrobé',
  'enrobés',
  'sécable',
  'sécables',
  'effervescent',
  'effervescents',
  'effervescente',
  'effervescentes',
  'orodispersible',
  'orodispersibles',
  'dispersible',
  'dispersibles',
  'gélule',
  'gélules',
  'capsule',
  'capsules',
  'sirop',
  'sirops',
  'solution',
  'solutions',
  'suspension',
  'suspensions',
  'buvable',
  'buvables',
  'poudre',
  'poudres',
  'sachet',
  'sachets',
  'granulé',
  'granulés',
  'crème',
  'crèmes',
  'pommade',
  'pommades',
  'gel',
  'gels',
  'collyre',
  'collyres',
  'suppositoire',
  'suppositoires',
  'injectable',
  'injectables',
  'ampoule',
  'ampoules',
  'flacon',
  'flacons',
  // French age groups.
  'adulte',
  'adultes',
  'enfant',
  'enfants',
  'nourrisson',
  'nourrissons',
  // English forms, packaging and age groups.
  'tablet',
  'tablets',
  'coated',
  'syrup',
  'syrups',
  'cream',
  'creams',
  'ointment',
  'ointments',
  'powder',
  'powders',
  'granules',
  'suppository',
  'suppositories',
  'injection',
  'vial',
  'vials',
  'bottle',
  'bottles',
  'adult',
  'adults',
  'child',
  'children',
  'infant',
  'infants',
];

const STOP_SET: ReadonlySet<string> = new Set(STOP_WORDS.map(normalize));

/** A normalised text without its stop-words (an empty string when it has only stop-words). */
export function withoutStopWords(normalized: string): string {
  if (normalized === '') return '';
  return normalized
    .split(' ')
    .filter((word) => !STOP_SET.has(word))
    .join(' ');
}
