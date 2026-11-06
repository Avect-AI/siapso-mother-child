// SPDX-License-Identifier: MIT
/**
 * Spelling variants applied to each word, in this order, so that a name
 * written as it sounds is read as the name it writes ("sitotek" is Cytotec,
 * "huile de rissin" is castor oil, "kodeyin" is codeine):
 * - `ph` becomes `f` (phenytoine, fenitoine);
 * - `ck` and `qu` become `k` (cytoteck; quinquéliba, kinkéliba);
 * - `c` before `e`, `i` or `y` becomes `s` (ricin, risin; Cytotec, sitotek),
 *   any other `c` becomes `k` (codéine, kodéine; a final `c`, cytotek), except
 *   in `ch`, a sound of its own (chloroquine);
 * - a silent `h` is dropped: at the start of a word (huile, uile) and after a
 *   consonant other than `c`, `s`, `p` and `k` (thé, té): `ch`, `sh`, `ph`
 *   and `kh` are sounds of their own (`kh` writes a Wolof sound, dakhar);
 * - `y` becomes `i` (nebeday, nebedai; kodeyin, kodeiin);
 * - `ou` becomes `u`, the Wolof spelling of the sound (Nourofen, Nurofen);
 * - a doubled letter becomes single, vowels included (doliprann, dolipran;
 *   rissin, risin; nebedaay, kodeiin, kodein); digits are kept as they are;
 * - a trailing `e` is dropped in words of more than 4 letters (ibuprofene,
 *   ibuprofen), so that a missing or added final `e` does not matter, and a
 *   final `-que` reads as the final `-c` or `-k` (méfénamique, mefenamik).
 * `kh` is NOT mapped to `x`: it would change the meaning of Wolof names. A
 * word of one letter is kept as it is ("vitamine C").
 */
function simplifyWord(word: string): string {
  // A letter alone is a name ("vitamine C", "vitamine K"), not a sound.
  if (word.length < 2) return word;
  const spelled = word
    .replaceAll('ph', 'f')
    .replaceAll('ck', 'k')
    .replaceAll('qu', 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c(?!h)/g, 'k')
    .replace(/^h/, '')
    .replace(/([bdfgjlmnqrtvwxz])h/g, '$1')
    .replaceAll('y', 'i')
    .replaceAll('ou', 'u')
    .replace(/([a-z])\1+/g, '$1');
  return spelled.length > 4 && spelled.endsWith('e') ? spelled.slice(0, -1) : spelled;
}

/**
 * Lowercase, read the Wolof letters ñ as "ny" and ŋ as "ng" (the sounds French
 * spelling writes "gn" and "ng": "dañu", "danyu") and the French œ and æ as
 * "oe" and "ae" ("sœur", "soeur"), strip accents (ë and é are
 * e), turn apostrophes, hyphens and any other character that is not a letter
 * or a digit into spaces, collapse spaces and trim. The text as written, every
 * spelling kept: the order of names and their first letter are read on it
 * ("Cytotec" under C, "comprimé" before "gélule").
 */
export function plainText(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFC')
      .replaceAll('ñ', 'ny')
      .replaceAll('ŋ', 'ng')
      // The joined letters of French ("sœur", "cæcum"), which no decomposition splits.
      .replaceAll('œ', 'oe')
      .replaceAll('æ', 'ae')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  );
}

/**
 * The plain text (plainText) with the spelling variants applied to each word,
 * so that a name is read as it sounds. Used on both sides of a match.
 */
export function normalize(text: string): string {
  const plain = plainText(text);
  if (plain === '') return '';
  return plain.split(' ').map(simplifyWord).join(' ');
}

/**
 * A word with the spelling variants that change no sound only: `ph`, `qu`,
 * `y`, a doubled consonant, a trailing `e` (as normalize read words before
 * the live test round 2). A short word close to a name only once read as it
 * sounds ("raisin", "risin" for "ricin") is not that name (lightCleaned).
 */
function lightWord(word: string): string {
  const spelled = word
    .replaceAll('ph', 'f')
    .replaceAll('qu', 'k')
    .replaceAll('y', 'i')
    .replace(/([b-df-hj-np-tv-z])\1+/g, '$1');
  return spelled.length > 4 && spelled.endsWith('e') ? spelled.slice(0, -1) : spelled;
}

/**
 * Words of pharmaceutical forms and packaging, French and English: they say
 * nothing about which medicine it is ("comprimé blanc" named every tablet),
 * but they tell the forms of one product apart ("sirop", "effervescent").
 */
const FORM_WORDS: readonly string[] = [
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
  // English forms and packaging.
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
];

/**
 * Generic words for the thing itself, or for the part of a plant used: they
 * name no medicine and no remedy ("racine" must not reach "Huile de ricin").
 */
const GENERIC_WORDS: readonly string[] = [
  'médicament',
  'médicaments',
  'médicamenteux',
  'médicamenteuse',
  'médicamenteuses',
  'medicament',
  'medicaments',
  'medicamenteux',
  'emplatre',
  'emplatres',
  'emplâtre',
  'emplâtres',
  'remède',
  'remèdes',
  'plante',
  'plantes',
  'racine',
  'racines',
  'écorce',
  'écorces',
  'graine',
  'graines',
  'tisane',
  'tisanes',
  'générique',
  'génériques',
  'generique',
  'generiques',
  'generic',
  'generics',
  // Carrier words: what holds the remedy, not the remedy ("huile de nim" is
  // neem, "huile de coco" names nothing of the base).
  'huile',
  'huiles',
  'feuille',
  'feuilles',
  'mousse',
  'mousses',
  'infusion',
  'infusions',
  'décoction',
  'décoctions',
  'jus',
];

/**
 * Abbreviations of forms written on boxes and in pharmacies, and the form
 * words they stand for ("cpr eff" is "comprimé effervescent", "gél" is a gel
 * or a "gélule").
 */
const FORM_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  cp: ['comprimé'],
  cpr: ['comprimé'],
  cpe: ['comprimé'],
  cps: ['comprimé'],
  comp: ['comprimé'],
  eff: ['effervescent'],
  effer: ['effervescent'],
  efferv: ['effervescent'],
  pell: ['pelliculé'],
  pellic: ['pelliculé'],
  séc: ['sécable'],
  sécab: ['sécable'],
  gél: ['gel', 'gélule'],
  gélu: ['gélule'],
  sach: ['sachet'],
  susp: ['suspension'],
  sol: ['solution'],
  buv: ['buvable'],
  pdre: ['poudre'],
  supp: ['suppositoire'],
  suppo: ['suppositoire'],
  amp: ['ampoule'],
  inj: ['injectable'],
  orodisp: ['orodispersible'],
  lp: ['lp'],
};

/**
 * Words of pharmaceutical forms, packaging and generic words: they say
 * nothing about which medicine it is. Accents and case do not matter: they
 * are compared after normalize.
 */
export const STOP_WORDS: readonly string[] = [
  ...FORM_WORDS,
  ...GENERIC_WORDS,
  ...Object.keys(FORM_ABBREVIATIONS),
];

const FORM_SET: ReadonlySet<string> = new Set(FORM_WORDS.map(normalize));
const ABBREVIATION_OF: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries(FORM_ABBREVIATIONS).map(([short, forms]) => [
    normalize(short),
    forms.map(normalize),
  ]),
);

/** Whether a normalised word is a form or packaging word, or an abbreviation of one. */
export function isFormWord(word: string): boolean {
  return FORM_SET.has(word) || ABBREVIATION_OF.has(word);
}

/**
 * The form and packaging words of a text, normalised, each once, in their
 * order, an abbreviation read as the forms it stands for: "Doliprane 1000
 * comprimé effervescent" and "Doliprane 1g cpr eff" both have "comprim" and
 * "efervescent". They choose between the forms of one product.
 */
export function formWords(text: string): string[] {
  const words = normalize(text).split(' ');
  return [
    ...new Set(
      words.flatMap((word) => ABBREVIATION_OF.get(word) ?? (FORM_SET.has(word) ? [word] : [])),
    ),
  ];
}

/**
 * Age words, French and English, in the three groups a product name uses.
 * They are not stop-words: a query word that matches the age word of a product
 * prefers that product's variant ("doliprane enfant"). They carry no match
 * weight: they are removed from names and from queries before scoring, and a
 * query made only of them gets no candidate.
 */
const AGE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  adult: ['adulte', 'adultes', 'adult', 'adults'],
  child: ['enfant', 'enfants', 'child', 'children'],
  infant: ['nourrisson', 'nourrissons', 'infant', 'infants'],
};

/** The age words (not normalised; compared after normalize). */
export const AGE_WORDS: readonly string[] = Object.values(AGE_GROUPS).flat();

const AGE_GROUP_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(AGE_GROUPS).flatMap(([group, words]) =>
    words.map((word) => [normalize(word), group] as const),
  ),
);

const NEWBORN_FIRST: ReadonlySet<string> = new Set(['nouveau', 'nouveaux']);
const NEWBORN_SECOND: ReadonlySet<string> = new Set(['ne', 'nes', 'nee', 'nees']);
const CHILD_MARKERS: ReadonlySet<string> = new Set(
  ['pédiatrique', 'pédiatriques', 'pediatric', 'paediatric'].map(normalize),
);
const INFANT_MARKERS: ReadonlySet<string> = new Set(['newborn', 'newborns'].map(normalize));

/**
 * The age groups a normalised product name says it is for without an age
 * word: "NOUVEAU-NE" (infant), "PEDIATRIQUE" (child). These words stay in the
 * name (they are matched as any other word); they only rank the product after
 * the others when the query names no age.
 */
export function ageMarkersOf(normalized: string): string[] {
  const words = normalized === '' ? [] : normalized.split(' ');
  const groups = new Set<string>();
  words.forEach((word, index) => {
    if (CHILD_MARKERS.has(word)) groups.add('child');
    if (INFANT_MARKERS.has(word)) groups.add('infant');
    if (NEWBORN_FIRST.has(word) && NEWBORN_SECOND.has(words[index + 1] ?? '')) {
      groups.add('infant');
    }
  });
  return [...groups].sort();
}

/**
 * Words of the salt or hydrate that a box or a composition names next to the
 * substance ("valproate de sodium", "chlorhydrate de tramadol", "phosphate de
 * codéine hémihydraté"): they say nothing about which substance it is. Accents
 * and case do not matter: they are compared after normalize.
 */
export const SALT_WORDS: readonly string[] = [
  'sodium',
  'sodique',
  'semisodium',
  'potassium',
  'potassique',
  'calcium',
  'calcique',
  'chlorhydrate',
  'hydrochloride',
  'hyclate',
  'phosphate',
  'sulfate',
  'fumarate',
  'maléate',
  'maleate',
  'succinate',
  'gluconate',
  'propionate',
  'magnésium',
  'magnesium',
  'camphosulfonate',
  'tosilate',
  'erbumine',
  'arginine',
  'disoproxil',
  'lysinate',
  'hémihydraté',
  'hemihydrate',
  'monohydraté',
  'monohydrate',
  'dihydraté',
  'dihydrate',
  'trihydraté',
  'trihydrate',
  'heptahydraté',
  'heptahydrate',
  'anhydre',
  'desséché',
];

/** The words that link a salt to its substance ("de sodium", "d'énalapril"), normalised. */
const SALT_LINKS: ReadonlySet<string> = new Set(['de', 'd', 'du']);
/** The words left alone at either end once the words around them are gone ("huile de ricin": "ricin"). */
const EDGE_LINKS: ReadonlySet<string> = new Set(['de', 'd', 'du', 'des']);

const STOP_SET: ReadonlySet<string> = new Set(STOP_WORDS.map(normalize));
const SALT_SET: ReadonlySet<string> = new Set(SALT_WORDS.map(normalize));
const NO_WORDS: ReadonlySet<string> = new Set();

/** Whether a normalised word is a salt word (a substance of its own may still keep it: withoutStopWords). */
export function isSaltWord(word: string): boolean {
  return SALT_SET.has(word);
}

/**
 * Words of how a medicine is taken, and of the description of a form, that a
 * product name may hold ("(UNE PRISE QUOTIDIENNE)", "SANS SUCRE", "L.P."):
 * they name no product alone, whatever the folding (review of SCRUM-51:
 * "prise", and "price" misread for it, reached MONOCRIXO L.P.). They stay in
 * the name as a whole; the index adds to them the words of the description of
 * every product name (descriptionWords). Compared after normalize.
 */
export const POSOLOGY_WORDS: readonly string[] = [
  'prise',
  'prises',
  'quotidien',
  'quotidienne',
  'quotidiens',
  'quotidiennes',
  'unique',
  'uniques',
  'jour',
  'jours',
  'journalier',
  'journalière',
  'journaliers',
  'journalières',
  'matin',
  'matins',
  'midi',
  'soir',
  'soirs',
  'nuit',
  'nuits',
  'fois',
  'par',
  'semaine',
  'semaines',
  'heure',
  'heures',
  'sans',
  'sucre',
  'sucres',
  'libération',
  'prolongée',
  'prolongé',
  'modifiée',
  'modifié',
  'immédiate',
  'retard',
  'lm',
  'daily',
  'day',
  'days',
  'once',
  'twice',
  'morning',
  'evening',
  'night',
  'sugar',
  'free',
  'release',
  'prolonged',
  'extended',
  'modified',
];

const POSOLOGY_SET: ReadonlySet<string> = new Set(POSOLOGY_WORDS.map(normalize));

/** Whether a normalised word is a word of how a medicine is taken (POSOLOGY_WORDS). */
export function isPosologyWord(word: string): boolean {
  return POSOLOGY_SET.has(word);
}

/** The indexes of the words kept, without the linking words left at either end. */
function trimmed(words: readonly string[], kept: readonly boolean[]): number[] {
  const left = words.flatMap((_, index) => (kept[index] === true ? [index] : []));
  let start = 0;
  let end = left.length;
  while (start < end && EDGE_LINKS.has(words[left[start] ?? -1] ?? '')) start += 1;
  while (end > start && EDGE_LINKS.has(words[left[end - 1] ?? -1] ?? '')) end -= 1;
  return left.slice(start, end);
}

/** The indexes of the normalised words withoutStopWords keeps. */
function keptIndexes(words: readonly string[], keep: ReadonlySet<string>): number[] {
  const salt = (word: string) => SALT_SET.has(word) && !keep.has(word);
  const kept = words.map((word) => !STOP_SET.has(word) && !salt(word));
  words.forEach((word, index) => {
    if (!salt(word)) return;
    for (const near of [index - 1, index + 1]) {
      if (SALT_LINKS.has(words[near] ?? '')) kept[near] = false;
    }
  });
  const indexes = trimmed(words, kept);
  if (indexes.length > 0 || !words.some(salt)) return indexes;
  // Only salt words (and stop-words) were there: the salt words are the name.
  return trimmed(
    words,
    words.map((word) => !STOP_SET.has(word)),
  );
}

/**
 * A normalised text without its stop-words and its salt words, each salt word
 * with the "de" that links it to its substance ("valproate de sodium" is
 * "valproate"), and without a linking word left alone at either end ("huile
 * de nim" is "nim"); an empty string when nothing else is left. A salt word is
 * kept when it is a substance of its own (`keep`: "calcium" in a registry
 * that has calcium), and when nothing else would be left ("sodium" alone).
 */
export function withoutStopWords(normalized: string, keep: ReadonlySet<string> = NO_WORDS): string {
  if (normalized === '') return '';
  const words = normalized.split(' ');
  return keptIndexes(words, keep)
    .map((index) => words[index])
    .join(' ');
}

/**
 * The words of a text that matching keeps (withoutStopWords, without age
 * words), each with the spelling variants that change no sound only
 * (lightWord): "huile de raisin" is "raisin" and "Huile de ricin" "ricin",
 * where normalize reads "raisin" and "risin", one letter apart. It tells a
 * short word close to a name as written from one close to it only as it
 * sounds.
 */
export function lightCleaned(text: string, keep: ReadonlySet<string> = NO_WORDS): string {
  const plain = plainText(text);
  if (plain === '') return '';
  const words = plain.split(' ');
  const folded = words.map(simplifyWord);
  return keptIndexes(folded, keep)
    .filter((index) => !AGE_GROUP_OF.has(folded[index] ?? ''))
    .map((index) => lightWord(words[index] ?? ''))
    .join(' ');
}

/**
 * A normalised text split into its name words and the age groups its age words
 * name (sorted, without repetition).
 */
export function splitAgeWords(normalized: string): { text: string; ages: string[] } {
  if (normalized === '') return { text: '', ages: [] };
  const ages = new Set<string>();
  const words: string[] = [];
  for (const word of normalized.split(' ')) {
    const group = AGE_GROUP_OF.get(word);
    if (group === undefined) words.push(word);
    else ages.add(group);
  }
  return { text: words.join(' '), ages: [...ages].sort() };
}
