// SPDX-License-Identifier: MIT
// The reading of a prescription: text lines in (from the OCR of a photo, or
// the text layer of a PDF), the products of the base they name out, to be
// confirmed one by one in a list where nothing is ticked at the start. The
// engine that read the text does not matter here (PaddleOCR today, another
// engine later): only the lines do. Pure: the screen hands in the pack.
//
// Models propose, rules decide: a line is searched with the resolver exactly
// as a typed name, only strong and very strong candidates are kept (the
// classes of possible-matches.ts), one product per line. A strength read is
// proposed, never imposed; a posology never gives a dose: at most a number
// of units per day is offered for a product a daily-maximum rule watches.
// A line that looks like a product and names nothing of the base is kept to
// be added as typed, so an unknown product still reaches the result as grey.
// Rules and their reasons: docs/superpowers/specs/2026-11-05-prescription-scan-design.md
// (section 4.3), measured by `pnpm eval:prescription` (eval/prescription/).
import type { Pack } from '@siapso/engine';
import {
  damerauLevenshtein,
  formWords,
  namedSubstances,
  normalize,
  parseStrength,
  search,
  withoutStopWords,
  type Candidate,
} from '@siapso/resolver';
import { strengthOf } from './possible-matches.js';
import {
  ABBREVIATIONS,
  ALIASES,
  HEADER_PHRASES,
  HEADER_WORDS,
  PERSON_NAMES,
  PLACE_NAMES,
  QUALIFIER_SUBSTANCE_WORDS,
  QUALIFIER_WORDS,
} from './prescription-words.js';
import { needsUnitsPerDay, productFamilyOf, searchIndexOf } from './search-index.js';

/** A product or a remedy of the base read on a line of the prescription. */
export interface PrescriptionProduct {
  ref: { kind: 'product' | 'plant'; id: string };
  /** The resolver candidate: its family and variants feed the strength question. */
  candidate: Candidate;
  /** The line as read (two lines joined when a name was wrapped), quoted under "Lu sur l'ordonnance". */
  line: string;
  /** The position of the line among the lines given: the list keeps the order of the prescription. */
  lineIndex: number;
  /**
   * The name part of the line, as read, without its list mark and its
   * posology (after a colon, or after the name in a table row): the text
   * "Corriger" puts in the search, and the text of the line offered as
   * typed. The strength question reads `strengthQuery`.
   */
  query: string;
  /** How clearly the line names it: `strong` says to compare with the box. */
  match: 'strong' | 'very-strong';
  /**
   * The strength the line gives, in mg, proposed and never imposed;
   * undefined when none, in micrograms, or when it may be misread.
   */
  strengthMg: number | undefined;
  /**
   * What the strength question reads as if typed (`strengthChoiceOf`): the
   * form words of the line and the strength proposed, never the posology
   * or a strength in micrograms, so a count is never preselected as a
   * strength.
   */
  strengthQuery: string;
  /**
   * The posology read with the product (after a colon, on the lines under
   * it, or after the name in a table row). Shown, quoted, only with the units
   * field of a product a daily-maximum rule watches; never used for a dose.
   */
  posology: string | undefined;
  /**
   * The units per day the posology says plainly, offered ("Mettre 3 par
   * jour") only for a product a daily-maximum rule watches
   * (needsUnitsPerDay), after she ticks it; undefined otherwise.
   */
  unitsPerDayOffer: number | undefined;
  /**
   * Whether a daily-maximum rule watches the product (needsUnitsPerDay): the
   * list then asks how many per day once it is ticked, whether a count is
   * offered or not.
   */
  asksUnitsPerDay: boolean;
  /**
   * The substances the line names that the product lacks (substance ids,
   * sorted): a combination read in part ("SP" read as pyrimethamine alone,
   * "Paracétamol + Cod" as paracetamol). Named by their names, by the start
   * of a name or a slip, by an abbreviation ("AF", "codé"), or by a word
   * that resembles them. The item then says which ones, is never
   * pre-ticked, and the line is also offered as typed (`typed`, reason
   * `names-more`), so the result's safety net looks it up again and a level
   * is never lowered silently.
   */
  missingSubstances: string[];
  /**
   * The substances the product holds that a line naming its substances by
   * their names does not name (substance ids, sorted): "Ténofovir
   * Lamivudine" read as the combination with dolutegravir, the only one the
   * base has. Never computed for a brand, whose name says what the box
   * holds. The item is then never pre-ticked and the line is offered as
   * typed too (reason `holds-more`).
   */
  extraSubstances: string[];
  /**
   * Whether the line goes on, after a "+", a "/" or "et", with a part the
   * product does not explain, even one that names nothing of the base
   * ("Amoxicilline + acide clavulanique"): never pre-ticked, and the line is
   * offered as typed too (reason `names-more`).
   */
  namesMore: boolean;
}

/** A line offered to add as typed ("Ajouter tel quel"), unticked. */
export interface TypedLine {
  /** The text of the item added as unrecognised: the name part as read, without its list mark and posology. */
  text: string;
  /** The line as read, quoted. */
  line: string;
  lineIndex: number;
  /**
   * `not-recognised`: it looks like a product and names nothing of the base;
   * `names-more`: a product was read on it (`forProduct`, its index in
   * `products`), but the line names a substance that product lacks, or goes
   * on with a part the product does not explain; `holds-more`: the product
   * read holds a substance the line does not name.
   */
  reason: 'not-recognised' | 'names-more' | 'holds-more';
  forProduct?: number;
}

export interface PrescriptionReading {
  /** In the order of the prescription, at most one per line and one per family. */
  products: PrescriptionProduct[];
  /** In the order of the prescription. */
  typed: TypedLine[];
}

/**
 * Whether the screen may ever tick this item for her (a shortcut such as
 * "Tout cocher", should the live test call for one): never for a strong
 * match, nor for a product whose substances differ from those the line
 * names (missing or extra), nor for a line that names more than the
 * product. The list itself starts with nothing ticked, whatever this says.
 */
export function mayBePreTicked(product: PrescriptionProduct): boolean {
  return (
    product.match === 'very-strong' &&
    product.missingSubstances.length === 0 &&
    product.extraSubstances.length === 0 &&
    !product.namesMore
  );
}

/**
 * Lowercase, accents and marks gone, a hyphen between two letters a space
 * ("sage-femme"): one character for each character of a precomposed text.
 */
function folded(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/(?<=\p{L})-(?=\p{L})/gu, ' ');
}

/** Lowercase, accents and marks gone, spaces collapsed: what the line rules read. */
function plain(text: string): string {
  return folded(text).replace(/[|_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Words of the header, the patient line, the prescriber and the stamp (see HEADER_WORDS). */
const NOT_PRODUCT = new RegExp(`\\b(${[...HEADER_WORDS, ...HEADER_PHRASES].join('|')})\\b`);
const HEADER_WORD_SET: ReadonlySet<string> = new Set(HEADER_WORDS);
/** Header words long enough to be known with one slip ("sachet" is no "cachet"). */
const LONG_HEADER_WORDS = HEADER_WORDS.filter((word) => word.length >= 7);
const PLACES = new RegExp(
  `(?<![\\p{L}])(${PLACE_NAMES.map((place) => folded(place).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}])`,
  'u',
);
/** The letters the OCR reads as digits in a header word ("SENEGA1", "REPUBL1QUE"). */
const HEADER_LETTERS: Readonly<Record<string, string>> = { '0': 'o', '3': 'e', '5': 's', '8': 'b' };

/**
 * What says a line is of a person, a date or an address, never of a product:
 * such a line is never offered as typed (the patient's name must never
 * reach an output). On the folded line.
 */
const HEADER_DATA: readonly RegExp[] = [
  // A date: "06/11/2026", "6.11.26".
  /(?<!\d)\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*(?:\d{4}|\d{2})(?!\d)/,
  // A month: "06 novembre 2026", "3 nov.".
  /\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/,
  /\b\d{1,2}\s+(janv|fevr|avr|juil|sept|oct|nov|dec)\b/,
  // An address.
  /\b(rue|avenue|boulevard|bd|bp|villa|cite|immeuble|lotissement)\b/,
  // An age.
  /\b\d{1,3}\s*ans\b/,
  // A title before a name.
  /(?<![\p{L}])(mme|mlle|mlles|madame|mademoiselle|monsieur|dr|docteur|pr|professeur)(?![\p{L}])/u,
];
/** "6 mois" is an age when the line says no posology ("pendant 3 mois" is one). */
const AGE_IN_MONTHS = /\b\d{1,2}\s*mois\b/;
const SAYS_POSOLOGY = /\b(pendant|qsp|durant|pour|par|jusqu|cp|gel|sachets?)\b|\/\s*j|x\s*\d/;
/** "M. Ndao": a title, in capitals as written. */
const MISTER = /(?<![\p{L}])M[.,]?\s+\p{Lu}\p{Ll}|(?<![\p{L}])M\.\s*\p{Lu}/u;
/** The names of PERSON_NAMES, folded, by their length: one or two letters count only in capitals. */
const NAMES: ReadonlySet<string> = new Set(PERSON_NAMES.map(folded));

/** Whether a word of a folded line is a header word, as written or as the OCR misreads it. */
function isHeaderWord(word: string): boolean {
  if (HEADER_WORD_SET.has(word)) return true;
  if (!/\p{L}/u.test(word)) return false;
  for (const letter of ['l', 'i']) {
    const mapped = word.replace(/[0358]/g, (d) => HEADER_LETTERS[d] ?? d).replaceAll('1', letter);
    if (HEADER_WORD_SET.has(mapped)) return true;
    if (
      mapped.length >= 7 &&
      LONG_HEADER_WORDS.some(
        (header) =>
          Math.abs(header.length - mapped.length) <= 1 && damerauLevenshtein(mapped, header) <= 1,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Where the header part of a line starts (a header word, a place, a person,
 * a date or an address), as a position in the line; and whether the line
 * holds a person, a date or an address anywhere (`data`). The line is read
 * only up to that position: the product the OCR joined the stamp or the
 * prescriber to ("Fluconazole 150 mg gél CLINIQUE DE") is still read.
 */
function headerOf(line: string): { start: number | undefined; data: boolean } {
  const text = folded(line);
  // Positions hold only when folding kept one character for each.
  const exact = text.length === line.length;
  const starts: number[] = [];
  let data = false;
  const found = (at: number | undefined, isData: boolean) => {
    if (at === undefined || at < 0) return;
    starts.push(exact ? at : 0);
    if (isData) data = true;
  };
  for (const pattern of HEADER_DATA) found(pattern.exec(text)?.index, true);
  if (!SAYS_POSOLOGY.test(text)) found(AGE_IN_MONTHS.exec(text)?.index, true);
  found(MISTER.exec(line)?.index, true);
  found(NOT_PRODUCT.exec(text)?.index, false);
  found(PLACES.exec(text)?.index, false);
  for (const word of text.matchAll(/[\p{L}\d]+/gu)) {
    if (isHeaderWord(word[0])) found(word.index, false);
    // A name read from the paper: the line is read up to it.
    const capital = /^\p{Lu}/u.test(line.slice(word.index, word.index + 1));
    if (NAMES.has(word[0]) && (word[0].length > 2 || (exact && capital))) found(word.index, false);
  }
  return { start: starts.length === 0 ? undefined : Math.min(...starts), data };
}

const QUALIFIERS: ReadonlySet<string> = new Set(QUALIFIER_WORDS.map(normalize));

/** Whether a query is made only of qualifier words ("Pédiatre", "Pharmacie centrale", "Forte"). */
function onlyQualifiers(query: string): boolean {
  const words = withoutStopWords(normalize(query))
    .split(' ')
    .filter((word) => word !== '' && !/^\d/.test(word));
  return words.length > 0 && words.every((word) => QUALIFIERS.has(word));
}

/** A posology line: it starts with a count and a unit, or with a posology word. */
const POSOLOGY_START =
  /^(\d+([.,]\d+)?|une?|deux|trois|1\/2)\s*(cp|cps|comprimes?|gel|gelules?|sachets?|c|cuilleres?|cuill|lyoc|ovules?|gouttes?|amp|ampoules?|suppo|injections?|bouffees?)\b|^(pendant|matin|midi|soir|si|qsp|jusqu|a prendre|prendre|dormir|au coucher|x\s*\d|renouveler|\d+\s*(fois|x)\b)/;

/**
 * A count and a unit inside a line: where the posology of a table row
 * starts ("2 cp x 3/j", "1 gél", "2 cpx3/j"). A count is from 1 to 6:
 * "Doliprane 1000 cp" is the strength of the box and its form, and
 * "Efferalgan 1 9 Cp eff" a strength the OCR garbled ("1 g").
 */
const POSOLOGY_INSIDE =
  /(?<![\p{L}\d.,/])([1-6]|une?|deux|trois|1\/2)\s*(cp|cps|comprimes?|gel|gelules?|sachets?|c\.|cuilleres?|lyoc|ovules?|gouttes?|ampoules?)(?=$|[^\p{L}]|x\s*\d)/u;

/** Where a posology starts in a name part: a count and a unit, a count times ("3 x 1 g"), or "x 3/j". */
const POSOLOGY_CUT = new RegExp(
  [
    POSOLOGY_INSIDE.source,
    String.raw`(?<![\p{L}\d.,/])\d{1,2}\s*[x*]\s*(?=\d)`,
    String.raw`(?<![\p{L}])[x*]\s*\d+\s*(?:\/|par)\s*j`,
  ].join('|'),
  'u',
);

/** The words of a posology: a line made mostly of them is a posology line. */
const POSOLOGY_WORDS: ReadonlySet<string> = new Set(
  'une un deux trois quatre prise prises unique fois par jour jours j semaine semaines mois matin midi soir coucher repas apres avant pendant au aux le la les de du des et ou si en dans verre eau douleur douleurs fievre forte qsp jusqu accouchement renouveler a prendre cp cps gel gelule gelules sachet sachets cuillere soupe cafe lyoc ovule ovules goutte gouttes x max maximum regles jeun milieu tpi agent devant prophylaxie arreter ne pas dormir sous moustiquaire effervescent'.split(
    ' ',
  ),
);

/** The posology words as the resolver reads words (as they sound): "price" is "prise". */
const POSOLOGY_SOUNDS: ReadonlySet<string> = new Set([...POSOLOGY_WORDS].map(normalize));

/** Whether a word is a posology word, as written or as it sounds. */
function isPosologyWord(word: string): boolean {
  const letters = plain(word).replace(/[^a-z]/g, '');
  return POSOLOGY_WORDS.has(letters) || POSOLOGY_SOUNDS.has(normalize(letters));
}

function isPosology(plainLine: string): boolean {
  if (POSOLOGY_START.test(plainLine)) return true;
  // The part before an inline posology ("Doliprane 1000 mg : 1 cp x 3/j").
  const words = namePartOf(plainLine)
    .split(/[^a-z]+/)
    .filter((w) => w.length > 0);
  const first = words[0];
  if (first === undefined) return true;
  if (!POSOLOGY_WORDS.has(first)) return false;
  const known = words.filter((w) => POSOLOGY_WORDS.has(w)).length;
  return known / words.length >= 0.6;
}

/** A strength, a form word or a list mark: a line that looks like a product. */
const PRODUCT_HINT =
  /\d+\s*(mg|g|ml|µg|ug|mcg|ui)\b|\b(cp|gel|gelules?|sirop|sachets?|suspension|ovules?|lyoc|comprimes?|creme|pommade|ampoules?|injectable|suppo)\b/;
const LIST_MARK = /^\s*(\(?\d{1,2}\s*[.)/,-]|[-*•°>]|[a-z]\))\s*/i;
/** A line that starts with a list number or a bullet, then a letter. */
const MARKED = /^\s*(\(?\d{1,2}\s*[.),]?\s*\p{L}|[-*•]\s*\p{L})/u;
/**
 * A unit of micrograms after a number, as written or as the OCR reads it:
 * "µg", "μg", "µ g", "ug", "yg", "mcg", "microg", "microgrammes" (and "pg").
 */
const MICROGRAM_UNIT =
  /(?<=\d)\s*(?:(?:µ|μ|u|y|mc|micro)\s*g(?:r(?:ammes?)?)?|pg|microgrammes?)(?![\p{L}])/giu;
/** A strength in micrograms: never a strength in mg here, so nothing is preselected. */
const MICROGRAMS = new RegExp(MICROGRAM_UNIT.source, 'iu');

/**
 * A strength that may be misread, so none is proposed (she is asked): a
 * number glued to a few stray letters before its unit ("z50 mg" was 250
 * mg), or a number then a group of three digits that may be a thousand or
 * a count and a strength ("1 500 mg").
 */
const UNSURE_STRENGTH =
  /(?<![\p{L}])\p{L}{1,4}\d+(?:[.,]\d+)?\s*(?:mg|g|ml)(?![\p{L}])|(?<![\d.,])\d{1,3}[ \u00a0\u202f]\d{3}(?!\d)/u;

/** Two numbers of a combination ("500/30", "20/120"): one strength, not two numbers. */
const NUMBER_PAIR = /\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?/g;
/** A number on its own, not glued to a letter before it ("B9" is a name). */
const STANDALONE_NUMBER = /(?<![\p{L}\d.,])\d+(?:[.,]\d+)?/gu;

/**
 * Whether the strength of a name part may be misread, so none is proposed:
 * in micrograms, glued to stray letters, a thousand that may be a count,
 * a number with a sign glued to it ("96°", "2,4 %"), a number after a
 * slash with none before ("/50"), or two numbers ("Clamoxyl 1 9", where "1
 * g" was).
 */
function unsureStrength(name: string): boolean {
  if (MICROGRAMS.test(name) || UNSURE_STRENGTH.test(name)) return true;
  if (/\d\s?[°£$©®¤§%]|(?<!\d\s*)\/\s*\d/u.test(name)) return true;
  return (name.replace(NUMBER_PAIR, ' ').match(STANDALONE_NUMBER) ?? []).length > 1;
}

/** The part of a line before an inline posology (a colon). */
function namePartOf(line: string): string {
  return line.split(/\s:\s|:\s|\s:(?=\S)/)[0] ?? line;
}

/** A round thousand written with a space ("1 000 mg") as one number. */
function thousandsJoined(text: string): string {
  return text.replace(/(?<![\d.,])(\d{1,3})[ \u00a0\u202f](000)(?!\d)/g, '$1$2');
}

/**
 * The name of a product line: the part before a colon, without the
 * posology a table row puts after the name ("Doliprane 1 cp x 3/j" is
 * "Doliprane"), a round thousand as one number. What the search, the
 * strength and the query read.
 */
function nameOf(line: string): string {
  const name = namePartOf(line);
  const text = folded(name);
  const cut = POSOLOGY_CUT.exec(text);
  // Positions hold only when folding kept one character for each.
  const kept = cut === null || text.length !== name.length ? name : name.slice(0, cut.index);
  return thousandsJoined(kept).trim();
}

/** Whether a line leaves a name open for the next one: an unclosed bracket, or a final "+", "," or "et". */
function leavesOpen(line: string): boolean {
  return line.split('(').length > line.split(')').length || /[+,]$|\bet$/.test(line);
}

/** Whether a line leaves a bracket open. */
function leavesBracketOpen(line: string): boolean {
  return line.split('(').length > line.split(')').length;
}

/** A line that starts with a list number ("2.", "3)"): never the end of the name above. */
const NUMBERED = /^\s*\(?\d{1,2}\s*[.),]/;

/**
 * The lines, a name wrapped over two lines joined again (a table cell "SP
 * (Sulfadoxine" / "Pyriméthamine)", a line ending with "+"), each with the
 * index of its first line. A bracket left open may close after one
 * posology line, which then stays under the joined name (a table row whose
 * posology cell is beside the first line of the name: "SP (Sulfadoxine" /
 * "3 cp en une prise" / "Pyriméthamine)").
 */
function joinedLines(lines: readonly string[]): { text: string; index: number }[] {
  const given = lines
    .flatMap((text) => text.split(/\r?\n/))
    .map((part, index) => ({ text: part.trim(), index }))
    .filter((line) => line.text !== '');
  const out: { text: string; index: number }[] = [];
  for (let at = 0; at < given.length; at += 1) {
    const line = given[at] as { text: string; index: number };
    const previous = out.at(-1);
    const closes =
      line.text.includes(')') || (previous !== undefined && /[+,]$|\bet$/.test(previous.text));
    if (
      previous !== undefined &&
      leavesOpen(previous.text) &&
      !NUMBERED.test(line.text) &&
      closes
    ) {
      previous.text = `${previous.text} ${line.text}`;
      continue;
    }
    const after = given[at + 1];
    if (
      previous !== undefined &&
      after !== undefined &&
      leavesBracketOpen(previous.text) &&
      isPosology(plain(line.text)) &&
      after.text.includes(')') &&
      !NUMBERED.test(after.text) &&
      !isPosology(plain(after.text))
    ) {
      previous.text = `${previous.text} ${after.text}`;
      out.push({ ...line });
      at += 1;
      continue;
    }
    out.push({ ...line });
  }
  return out;
}

interface Vocabulary {
  /**
   * The words of 7 letters or more (normalised) of the substance and brand
   * names of the pack, each with the word as written, accents aside.
   */
  words: Map<string, string>;
  /**
   * Normalised words of 5 letters or more that the names of one substance
   * only have ("sulfadoxin", "folik", "fereux"), with that substance.
   */
  substanceWords: Map<string, string>;
  /** The normalised words of 5 letters or more of each substance's names. */
  wordsOfSubstance: Map<string, string[]>;
  /** The substances of each product. */
  substancesOfProduct: Map<string, Set<string>>;
  /**
   * The words of 7 letters or more of brand names that only combinations
   * have ("codolipran"), with the substances of those combinations: a word
   * misread near one of them and snapped to a name of fewer substances
   * ("Coliprane" to DOLIPRANE) says the line may name the combination.
   */
  combinationWords: Map<string, Set<string>>;
  /** The substances each word of `words` names at the fewest: of the substance, or of the product of its brand with the fewest. */
  leastOf: Map<string, Set<string>>;
  /** The strongest strength of a component of the base, in mg: a strength read above it is a misread. */
  largestMg: number;
}

const vocabularies = new WeakMap<Pack, Vocabulary>();

/** A substance word shorter than this is never one ("acid", "fer": too common or too short). */
const SUBSTANCE_WORD = 5;
/** A word read shorter than this names a substance only when it is the word itself. */
const RESEMBLING_WORD = 6;

function vocabularyOf(pack: Pack): Vocabulary {
  let vocabulary = vocabularies.get(pack);
  if (vocabulary === undefined) {
    const names = [
      ...pack.substances.flatMap((s) => [s.names.fr, s.names.en]),
      ...pack.products.flatMap((p) => p.brands),
    ];
    // Each normalised word with the word as written (the first name that has it).
    const words = new Map<string, string>();
    for (const name of names) {
      for (const written of plain(name).split(/[^\p{L}\p{N}]+/u)) {
        const word = normalize(written);
        if (word.length >= 7 && !word.includes(' ') && !words.has(word)) words.set(word, written);
      }
    }
    // The words that name a substance: long enough, and not a qualifier
    // ("vitamine" names no substance by itself).
    const namingWords = (text: string) =>
      normalize(text)
        .split(' ')
        .filter((word) => word.length >= SUBSTANCE_WORD && !QUALIFIER_SUBSTANCE_WORDS.has(word));
    const owners = new Map<string, Set<string>>();
    for (const substance of pack.substances) {
      for (const word of namingWords(`${substance.names.fr} ${substance.names.en}`)) {
        const set = owners.get(word) ?? new Set<string>();
        set.add(substance.id);
        owners.set(word, set);
      }
    }
    const substanceWords = new Map(
      [...owners].flatMap(([word, ids]) => (ids.size === 1 ? [[word, [...ids][0] ?? '']] : [])),
    );
    const wordsOfSubstance = new Map(
      pack.substances.map((s) => [s.id, namingWords(`${s.names.fr} ${s.names.en}`)]),
    );
    const substancesOfProduct = new Map(
      pack.products.map((p) => [p.id, new Set(p.components.map((c) => c.substance))]),
    );
    // Each long word with the substances it names at the fewest, and the
    // substances of the combinations a brand word names.
    const leastOf = new Map<string, Set<string>>();
    const fewer = (word: string, held: Set<string>) => {
      const known = leastOf.get(word);
      if (known === undefined || held.size < known.size) leastOf.set(word, held);
    };
    for (const substance of pack.substances) {
      for (const word of normalize(`${substance.names.fr} ${substance.names.en}`).split(' ')) {
        if (word.length >= 7) fewer(word, new Set([substance.id]));
      }
    }
    const combined = new Map<string, Set<string>>();
    for (const product of pack.products) {
      const held = substancesOfProduct.get(product.id) ?? new Set<string>();
      for (const word of new Set(normalize(product.brands.join(' ')).split(' '))) {
        if (word.length < 7) continue;
        fewer(word, held);
        if (held.size < 2) continue;
        const set = combined.get(word) ?? new Set<string>();
        for (const s of held) set.add(s);
        combined.set(word, set);
      }
    }
    const combinationWords = new Map(
      [...combined].filter(([word]) => (leastOf.get(word)?.size ?? 0) >= 2),
    );
    vocabulary = {
      words,
      substanceWords,
      wordsOfSubstance,
      substancesOfProduct,
      combinationWords,
      leastOf,
      largestMg: Math.max(
        0,
        ...pack.products.flatMap((p) => p.components.map((c) => c.strengthMg ?? 0)),
      ),
    };
    vocabularies.set(pack, vocabulary);
  }
  return vocabulary;
}

/**
 * The letters two words have in common in the same order (the longest
 * common subsequence), over the length of the longer one: 1 for the same
 * word, 0 for nothing alike.
 */
function sharedInOrder(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const letter of a) {
    const row = [0];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] =
        letter === b[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, row[j - 1] ?? 0);
    }
    previous = row;
  }
  return (previous[b.length] ?? 0) / Math.max(a.length, b.length);
}

/**
 * Half the letters in order: a word garbled past a spelling slip that still
 * resembles a substance name ("ulfaderne", "ubfaderine" for "sulfadoxine";
 * "Cartécunote", "canésunsie" for "artésunate").
 */
const RESEMBLANCE = 0.5;

/**
 * The substances a combination of the pack would add to the product read
 * (those of every product holding all of its substances and more): what a
 * combination read in part lacks.
 */
function completingSubstances(vocabulary: Vocabulary, held: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  if (held.size === 0) return found;
  for (const substances of vocabulary.substancesOfProduct.values()) {
    if (substances.size <= held.size || ![...held].every((s) => substances.has(s))) continue;
    for (const s of substances) if (!held.has(s)) found.add(s);
  }
  return found;
}

/** The names of a product of the pack, and the name the resolver matched. */
function ownNames(pack: Pack, candidate: Candidate): string[] {
  const product =
    candidate.kind === 'product' ? pack.products.find((p) => p.id === candidate.id) : undefined;
  return product === undefined
    ? [candidate.matched]
    : [
        candidate.matched,
        product.names.fr,
        product.names.en,
        ...product.brands,
        ...product.localNames.map((l) => l.text),
      ];
}

/**
 * The words of a name part that the product read does not explain: not a
 * word of its names or of the name matched, not a form or salt word, not a
 * posology or header word, not a number; 3 letters or more. What is left may
 * be a part of the name the OCR garbled or a prescriber shortened.
 */
function unexplainedWords(pack: Pack, namePart: string, candidate: Candidate): string[] {
  const own = new Set(normalize(ownNames(pack, candidate).join(' ')).split(' '));
  return withoutStopWords(normalize(namePart))
    .split(' ')
    .filter(
      (word) =>
        word.length >= 3 &&
        !/\d/.test(word) &&
        !own.has(word) &&
        !isPosologyWord(word) &&
        !NOT_PRODUCT.test(word),
    );
}

/** The substances a name part names: surely, or by a guess that is to be checked. */
interface Naming {
  /** By a whole substance name, or by a word only that substance's names have ("folique"). */
  certain: Set<string>;
  /** By the start of a name, a slip, an abbreviation or a resemblance. */
  guessed: Set<string>;
}

/**
 * The substances a name part names: by their names, as the confirm screen
 * reads them (namedSubstances), and by a word that only one substance has
 * ("folique" of "acide folique"), both sure; or a word of 6 letters or more
 * the OCR read in part or with a slip: the start of that word ("Sulfadox"),
 * or the word within one edit (two from 9 letters), a guess.
 */
function substancesNamed(pack: Pack, namePart: string): Naming {
  const certain = new Set(namedSubstances(searchIndexOf(pack), namePart));
  const guessed = new Set<string>();
  const { substanceWords } = vocabularyOf(pack);
  for (const word of normalize(namePart).split(' ')) {
    if (word.length < SUBSTANCE_WORD || /\d/.test(word)) continue;
    for (const [known, id] of substanceWords) {
      if (known === word) {
        certain.add(id);
      } else if (
        word.length >= RESEMBLING_WORD &&
        (known.startsWith(word) ||
          (Math.abs(known.length - word.length) <= 2 &&
            damerauLevenshtein(word, known) <= (known.length >= 9 ? 2 : 1)))
      ) {
        guessed.add(id);
      }
    }
  }
  for (const id of certain) guessed.delete(id);
  return { certain, guessed };
}

/** The words of a text, accents aside, case kept: what the abbreviations read. */
function tokensOf(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '');
}

/**
 * The substances an abbreviation of a name part stands for ("AF", "codé",
 * "3TC"), and those of a short name of a combination in capitals ("FAF").
 */
function abbreviated(namePart: string): Set<string> {
  const found = new Set<string>();
  for (const token of tokensOf(namePart)) {
    for (const id of ALIASES[token] ?? []) found.add(id);
    const abbreviation = ABBREVIATIONS[token.toLowerCase()];
    if (abbreviation === undefined) continue;
    if (abbreviation.upper === true && token !== token.toUpperCase()) continue;
    for (const id of abbreviation.substances) found.add(id);
  }
  return found;
}

/**
 * Where a name part goes on after a "+", a "/" between two words
 * ("Paracétamol/Codéine", "TDF/3TC", never "500/30" or "3/j") or "et": its
 * parts, each to be explained by the product read.
 */
function partsOf(namePart: string): string[] {
  return namePart
    .split(/\s*\+\s*|(?<=\p{L})\s*\/\s*(?=\p{L}|\d+\p{L})|\s+et\s+/iu)
    .filter((part) => part.trim() !== '');
}

/** A word of a part that says nothing of which product: a number, a unit, a form, a posology word. */
function neutralWord(word: string): boolean {
  return (
    word.length < 2 ||
    (/^\d/.test(word) && ABBREVIATIONS[word] === undefined) ||
    /^(mg|g|ml|cl|l|ug|µg|μg|mcg|ui)$/.test(word) ||
    withoutStopWords(word) === '' ||
    isPosologyWord(word)
  );
}

/**
 * Whether the product explains every part of a name part joined by "+", "/"
 * or "et": each word of each part is a number, a unit, a form or a posology
 * word, a word of the product's names (or the start of one, two letters or
 * more: "Ac." of "acide"), a word of the name of a substance it holds (or
 * the start of one, three letters or more), or an abbreviation of one.
 */
function explainsEveryPart(
  pack: Pack,
  vocabulary: Vocabulary,
  namePart: string,
  candidate: Candidate,
  held: ReadonlySet<string>,
): boolean {
  const parts = partsOf(namePart);
  if (parts.length < 2) return true;
  const heldNames = pack.substances
    .filter((s) => held.has(s.id))
    .map((s) => `${s.names.fr} ${s.names.en}`);
  const own = normalize([...ownNames(pack, candidate), ...heldNames].join(' '))
    .split(' ')
    .filter((word) => word.length >= 2);
  const heldWords = [...held].flatMap((id) => vocabulary.wordsOfSubstance.get(id) ?? []);
  const explained = (word: string) =>
    neutralWord(word) ||
    own.some((name) => name === word || name.startsWith(word)) ||
    (word.length >= 3 && heldWords.some((name) => name.startsWith(word))) ||
    (ABBREVIATIONS[word]?.substances.some((id) => held.has(id)) ?? false);
  return parts.every((part) => normalize(part).split(' ').every(explained));
}

/**
 * The products of the pack whose substances are exactly these, a generic
 * first ("Codéine (générique)", "TLE (ténofovir, lamivudine, éfavirenz)"):
 * the product a line naming these substances by their names names.
 */
function genericOf(pack: Pack, vocabulary: Vocabulary, substances: ReadonlySet<string>) {
  const same = (held: ReadonlySet<string> | undefined) =>
    held !== undefined &&
    held.size === substances.size &&
    [...held].every((s) => substances.has(s));
  return pack.products.find(
    (p) =>
      same(vocabulary.substancesOfProduct.get(p.id)) &&
      (productFamilyOf(pack, p.id) ?? '').startsWith('substances:'),
  );
}

/** The resolver candidate of a product of the pack, as a search of its name gives it. */
function candidateFor(pack: Pack, productId: string, name: string): Candidate | undefined {
  return search(searchIndexOf(pack), name, { limit: 5 }).find((c) => c.id === productId);
}

/** A line with its long misread words snapped, and the combinations a word was read near. */
interface Snapped {
  text: string;
  /** The substances of the combination names a word was near but not snapped to. */
  near: Set<string>;
}

/**
 * A long word misread by the OCR snapped to the substance or brand name it is
 * within one edit of (two from 9 letters): "Gsulfadofine" to "sulfadoxine",
 * "Efferalany" to "efferalgan", so that a combination is read whole. Words of
 * 7 letters or more only; the closest name wins. When the name of a
 * combination that holds the substances of that name and more is at most
 * one slip further, the combination is noted: "Coliprane" snapped to
 * DOLIPRANE says the line may name CODOLIPRANE, which also holds codeine.
 */
function snapped(line: string, vocabulary: Vocabulary): Snapped {
  const near = new Set<string>();
  const text = line.replace(/\p{L}{7,}/gu, (word) => {
    const w = normalize(word);
    // The slips allowed go by the length of the word as read, whatever the
    // resolver folds when it reads words as they sound.
    const allowed = word.length >= 9 ? 2 : 1;
    let best: string | undefined;
    let bestDistance = allowed + 1;
    for (const [v, written] of vocabulary.words) {
      if (Math.abs(v.length - w.length) > 2) continue;
      const distance = damerauLevenshtein(w, v);
      if (distance === 0) return word;
      if (distance < bestDistance) {
        best = written;
        bestDistance = distance;
      }
    }
    if (best === undefined) return word;
    const least = vocabulary.leastOf.get(normalize(best)) ?? new Set<string>();
    for (const [c, substances] of vocabulary.combinationWords) {
      if (Math.abs(c.length - w.length) > allowed + 1 || substances.size <= least.size) continue;
      if (![...least].every((s) => substances.has(s))) continue;
      if (damerauLevenshtein(w, c) > allowed + 1) continue;
      for (const s of substances) near.add(s);
    }
    // The name word as written, so the resolver reads it as it would read it typed.
    return best;
  });
  return { text, near };
}

/** The letters the OCR reads as digits or signs inside a word ("fol1que", "Amox1cilline", "cod€ine"). */
const LETTER_OF_DIGIT: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '5': 's',
  '8': 'b',
  '€': 'e',
};

/**
 * A digit (or a euro sign) between two letters read as the letter it stands
 * for; "B9", "B12" and a strength glued to a name ("Doliprane1g") stay as
 * they are.
 */
function digitsInWords(line: string): string {
  return line.replace(
    /(?<=\p{L})[0158€](?=\p{L})(?!(?:mg|g|ml|µg|ug|mcg)(?![\p{L}\d]))/giu,
    (digit) => LETTER_OF_DIGIT[digit] ?? digit,
  );
}

/** A strength glued to a long word split from it: "Spéciafoldine5 my", "Ibuprofene400mg". */
function gluedStrengthSplit(line: string): string {
  return line.replace(
    /(\p{L}{5,})(\d+)(?=$|[^\p{L}\d]|(?:mg|g|ml|µg|ug|mcg)(?![\p{L}\d]))/giu,
    '$1 $2',
  );
}

/**
 * What makes a posology unclear, so no count is offered (she types it): a
 * range ("2 à 3", "1-2", "1 ou 2"), a change ("puis"), a fraction ("1/2",
 * "½", "0,5 cp", "demi"), or a maximum.
 */
const UNCLEAR_POSOLOGY =
  /\d\s*(?:a|-|–|ou)\s*\d|\bpuis\b|\bmax(?:imum)?\b|\bdemie?\b|½|\d\s*\/\s*\d|\d[.,]\d\s*(?:cp|gel|sachet|c\b|lyoc|ovule|comprime)/;

/**
 * Whether a posology holds a number that is no count of units, no
 * frequency and no duration: one the OCR misread ("1 cp matin, 72304
 * pendant 3 jours", where "midi et soir" was), so no count is offered.
 */
function strayNumber(t: string): boolean {
  for (const number of t.matchAll(/(?<![\p{L}\d.,])\d+(?![\d.,])/gu)) {
    const before = t.slice(0, number.index).trimEnd();
    const after = t.slice(number.index + number[0].length).trimStart();
    const counted =
      /^(cps?|gel|gelules?|sachets?|c\b|cuilleres?|lyoc|ovules?|gouttes?|comprimes?|fois|x\b|\/|par\b|j\b|jours?\b|mois\b|semaines?\b|h\b|heures?\b|e\b)/.test(
        after,
      ) || /(?:\bx|\btpi|\bqsp|\bpendant|\bdurant)$/.test(before);
    if (!counted) return true;
  }
  return false;
}

/** A count of units in a posology ("2 cp", "1 sachet"). */
const COUNT =
  /(\d+)\s*(?:cps?|gel|gelules?|sachets?|c\b|cuilleres?|lyoc|ovules?|gouttes?|comprimes?)/g;

/**
 * Units per day from a posology, when it says them plainly ("2 cp x 3/j" is
 * 6, "2 cp * 3 / j" too); undefined otherwise, and for a range, a change, a
 * fraction, a maximum or two different counts ("1 cp matin et 2 cp le
 * soir"): she then says how many, as for a typed name.
 */
export function unitsPerDayOf(text: string): number | undefined {
  const t = plain(text)
    .replace(/\*/g, ' x ')
    .replace(/(\d)\s*x\s*(\d)/g, '$1 x $2');
  if (/semaine|mois\b.*\bfois|tous les \d+ jours/.test(t) && !/par jour|\/j/.test(t)) {
    return undefined;
  }
  if (UNCLEAR_POSOLOGY.test(t) || strayNumber(t)) return undefined;
  if (new Set([...t.matchAll(COUNT)].map((count) => count[1])).size > 1) return undefined;
  let m =
    /(\d+)\s*(cp|gel|gelules?|sachets?|c|lyoc|ovules?|comprimes?)?\.?\s*(a soupe|a cafe)?\s*x\s*(\d+)\s*(\/|par)\s*j/.exec(
      t,
    );
  if (m) return Number(m[1]) * Number(m[4]);
  m =
    /(\d+)\s*(cp|gel|gelules?|sachets?|c|lyoc|ovules?|comprimes?)?\.?\s*(a soupe|a cafe)?\s*(\/|par)\s*j(our)?\b/.exec(
      t,
    );
  if (m) return Number(m[1]);
  m =
    /(\d+)\s*(cp|gel|gelules?|sachets?|lyoc|ovules?|comprimes?)\b([^0-9]*?)\b(matin|midi|soir)\b(.*)/.exec(
      t,
    );
  if (m) {
    // Only posology words before the first time of day: "1 cp mat in, midi
    // et soir" is a time the OCR broke, never two times.
    const before = (m[3] ?? '').split(/[^a-z]+/).filter((word) => word !== '');
    if (!before.every((word) => POSOLOGY_WORDS.has(word))) return undefined;
    const times = new Set([m[4], ...(m[5]?.match(/\b(matin|midi|soir)\b/g) ?? [])]);
    if (/le (matin|soir|midi)/.test(t) && times.size === 1) return Number(m[1]);
    return Number(m[1]) * times.size;
  }
  m =
    /(\d+)\s*(cp|gel|gelules?|sachets?|lyoc|ovules?|comprimes?)\b.*(prise unique|en une prise)/.exec(
      t,
    );
  if (m) return Number(m[1]);
  return undefined;
}

interface Chosen {
  candidate: Candidate;
  match: 'strong' | 'very-strong';
  length: number;
}

/** Very strong first, then the longest window, then the score. */
function better(a: Chosen, b: Chosen | undefined): boolean {
  if (b === undefined) return true;
  const rank = (x: Chosen) => [x.match === 'very-strong' ? 1 : 0, x.length, x.candidate.score];
  const [a0 = 0, a1 = 0, a2 = 0] = rank(a);
  const [b0 = 0, b1 = 0, b2 = 0] = rank(b);
  return a0 !== b0 ? a0 > b0 : a1 !== b1 ? a1 > b1 : a2 > b2;
}

/** How many words a window may start from, from the start of the name part. */
const WINDOW_STARTS = 2;

/**
 * The best candidate of a name part: the whole of it, then windows of 3, 2
 * and 1 words from its first two words, never a posology word alone; strong
 * and very strong candidates only.
 */
function bestOf(pack: Pack, namePart: string): Chosen | undefined {
  const index = searchIndexOf(pack);
  const words = namePart.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w) && !isPosologyWord(w));
  const queries = [namePart];
  for (let start = 0; start < Math.min(WINDOW_STARTS, words.length); start += 1) {
    for (let n = 3; n >= 1; n -= 1) {
      if (start + n <= words.length) queries.push(words.slice(start, start + n).join(' '));
    }
  }
  let chosen: Chosen | undefined;
  for (const query of new Set(queries)) {
    if (!query.includes(' ') && isPosologyWord(query)) continue;
    // A laboratory or a qualifier alone names no medicine.
    if (onlyQualifiers(query)) continue;
    for (const candidate of search(index, query, { limit: 1 })) {
      const match = strengthOf(candidate);
      if (match === 'weak') continue;
      const mine: Chosen = { candidate, match, length: normalize(query).length };
      if (better(mine, chosen)) chosen = mine;
    }
  }
  return chosen;
}

/**
 * The combination a short name stands for ("1. SP", "S.P", "FAF 1 cp/j"),
 * when the resolver finds nothing strong: in capitals, a whole word, the
 * only word of the name part but numbers, units, forms and posology words;
 * the generic product of exactly its substances, as a strong match (never
 * pre-ticked). Undefined otherwise.
 */
function aliasOf(pack: Pack, vocabulary: Vocabulary, namePart: string): Chosen | undefined {
  // A line the OCR garbled ("§ AL. § ;: 3 en") never gives a short name.
  if (/[^\p{L}\p{N}\s.,/:()'+%µ-]/u.test(namePart)) return undefined;
  // "S.P" and "S/P" are "SP".
  const tokens = tokensOf(
    namePart.replace(/(?<![\p{L}])(\p{Lu})[./](?=\p{Lu}(?![\p{L}]))/gu, '$1'),
  );
  const substances = new Set<string>();
  let names = 0;
  for (const token of tokens) {
    // A short name of a combination, or the abbreviations of its substances
    // in capitals ("TDF/3TC/DTG", "SMX + TMP").
    const capitals = token === token.toUpperCase() && /\p{Lu}/u.test(token);
    const stands =
      ALIASES[token] ?? (capitals ? ABBREVIATIONS[token.toLowerCase()]?.substances : undefined);
    if (stands !== undefined) {
      for (const id of stands) substances.add(id);
      names += 1;
    } else if (!normalize(token).split(' ').every(neutralWord)) {
      return undefined;
    }
  }
  if (names === 0) return undefined;
  const generic = genericOf(pack, vocabulary, substances);
  const candidate = generic && candidateFor(pack, generic.id, generic.names.fr);
  return candidate === undefined ? undefined : { candidate, match: 'strong', length: names };
}

/** Whether a label before a colon names when to take, never what ("TPI", "Si douleur"). */
function onlyPosologyWords(text: string): boolean {
  const words = plain(text)
    .split(/[^a-z]+/)
    .filter((word) => word !== '');
  return words.length > 0 && words.every((word) => POSOLOGY_WORDS.has(word));
}

/** The substances of a product of the pack (none for a plant). */
function substancesOfRef(pack: Pack, ref: PrescriptionProduct['ref']): Set<string> {
  if (ref.kind !== 'product') return new Set();
  return new Set(
    pack.products.find((p) => p.id === ref.id)?.components.map((c) => c.substance) ?? [],
  );
}

/** The posology of a product line: after its colon, else the posology lines under it, else after the name in a row. */
function posologyOf(line: string, next: readonly { text: string }[]): string | undefined {
  const colon = /\s:\s|:\s|\s:(?=\S)/.exec(line);
  if (colon !== null) {
    const after = line.slice(colon.index + colon[0].length).trim();
    if (after !== '') return after;
  }
  const below: string[] = [];
  for (const { text } of next) {
    if (!isPosology(plain(text.replace(LIST_MARK, '')))) break;
    below.push(text.trim());
  }
  if (below.length > 0) return below.join(' ');
  // A table row: the posology after the name, from its first count and unit.
  const text = folded(line);
  const inside = POSOLOGY_INSIDE.exec(text);
  if (inside === null) return undefined;
  // The same position in the line as read when folding kept one character for
  // each (a precomposed text, as the OCR gives), else the whole row.
  return text.length === line.length ? line.slice(inside.index).trim() : line.trim();
}

/**
 * Reads the products of a prescription from its text lines (one string per
 * line, or texts of several lines). Lines of the header, the patient, the
 * prescriber and the stamp, and posology lines, are never searched. Each
 * other line, without its list mark, is searched whole and by windows;
 * only strong and very strong candidates count, one product per line and
 * one per family. A line that looks like a product and names nothing of the
 * base is kept as a typed line.
 */
export function readPrescription(pack: Pack, lines: readonly string[]): PrescriptionReading {
  const vocabulary = vocabularyOf(pack);
  const joined = joinedLines(lines);
  const products: PrescriptionProduct[] = [];
  const typed: TypedLine[] = [];
  const families = new Map<string, number>();

  joined.forEach(({ text: raw, index: lineIndex }, at) => {
    // A list number whose dot the OCR lost ("2 Acide folique") is a list mark
    // too; a strength glued to a long word ("Spéciafoldine5") is split from it.
    // OCR marks before the list number ("| 1.", "4 4.") go first.
    const lead = raw
      .normalize('NFC')
      .replace(/^[\s|!:;'"_~]+/u, '')
      .replace(/^\d{1,2}\s+(?=\d{1,2}\s*[.),]\s*\p{L})/u, '');
    const marked = MARKED.test(lead);
    let whole = lead.replace(LIST_MARK, '');
    // A label before a colon says when, the product comes after it ("TPI :
    // SP", "Si douleur : Doliprane 1 g").
    const label = /^([^:]*\p{L}[^:]*?)\s*:\s*(\S.*)$/u.exec(whole);
    if (label?.[1] !== undefined && label[2] !== undefined && onlyPosologyWords(label[1])) {
      whole = label[2];
    }
    // A posology starts with its count ("1 c. à soupe"), read before the
    // count is taken for a list number.
    if (isPosology(plain(whole))) return;
    // The line is read up to its header part: a header word, a place, a
    // person, a date or an address. The OCR may join the stamp or the
    // prescriber to the last product ("Fluconazole 150 mg gél CLINIQUE DE"):
    // what comes before is still read; a header line leaves nothing.
    const header = headerOf(whole);
    const counted = whole.slice(0, header.start).trim();
    // The line quoted under what it gives ("Lu sur l'ordonnance"), without
    // its header part: no name read from the paper is ever quoted.
    const shown =
      header.start === undefined
        ? raw
        : `${LIST_MARK.exec(raw.normalize('NFC'))?.[0] ?? ''}${counted}`.trim();
    const unmarked = gluedStrengthSplit(counted.replace(/^\d{1,2}\s+(?=\p{L})/u, ''));
    const { text: line, near } = snapped(digitsInWords(unmarked), vocabulary);
    const p = plain(line);
    const letters = (text: string) => text.replace(/[^\p{L}]/gu, '').length;
    if (letters(p) < 2) return;
    // An unnumbered line with a header part is read only when what is left
    // looks like a product (a strength, a form word).
    if (header.start !== undefined && !marked && !PRODUCT_HINT.test(p)) return;
    if (isPosology(plain(counted)) || isPosology(p)) return;
    // The name without its posology; micrograms written as the resolver reads
    // them ("400 microg" is "400 µg"), so it prefers a box of that strength.
    const namePart = nameOf(line).replace(MICROGRAM_UNIT, ' µg');
    const query = nameOf(unmarked);
    const chosen = bestOf(pack, namePart) ?? aliasOf(pack, vocabulary, namePart);
    if (chosen === undefined) {
      // A numbered line of two letters or more, or a line that looks like a
      // product; never a line of a person, a date or an address (spec, 7.6
      // and 7.11).
      const kept =
        (marked && letters(namePart) >= 2) ||
        (PRODUCT_HINT.test(p) && normalize(namePart).length >= 4);
      if (kept && !header.data) {
        typed.push({ text: query, line: shown, lineIndex, reason: 'not-recognised' });
      }
      return;
    }
    let { candidate, match } = chosen;
    let held = substancesOfRef(pack, { kind: candidate.kind, id: candidate.id });
    const { certain, guessed } = substancesNamed(pack, namePart);
    // What a combination of the pack would add to what the line holds or
    // names surely: where an abbreviation, the start of a name or a garbled
    // word may name a substance ("Paracétamol + Cod", "Fer + AF").
    const context = new Set([
      ...completingSubstances(vocabulary, held),
      ...completingSubstances(vocabulary, certain),
    ]);
    for (const id of abbreviated(namePart)) if (context.has(id)) guessed.add(id);
    for (const word of context.size > 0 ? unexplainedWords(pack, namePart, candidate) : []) {
      for (const id of context) {
        const words = vocabulary.wordsOfSubstance.get(id) ?? [];
        const resembles = (name: string) =>
          name.startsWith(word) ||
          (word.length >= SUBSTANCE_WORD && sharedInOrder(word, name) >= RESEMBLANCE);
        if (words.some(resembles)) guessed.add(id);
      }
    }
    // A word left as read near the name of a combination.
    for (const id of near) guessed.add(id);
    const named = new Set([...certain, ...guessed]);
    // A product found by the name of a substance holds what the line does not
    // name ("Codéine" read as ANTARENE CODEINE, with ibuprofen): the product of
    // exactly the substances named takes its place when the base has one.
    const bySubstance = candidate.matchedLang === 'inn' || candidate.match === 'substances';
    const extraOf = (substances: ReadonlySet<string>) =>
      bySubstance && certain.size > 0 ? [...substances].filter((id) => !named.has(id)) : [];
    if (candidate.kind === 'product' && extraOf(held).length > 0) {
      const generic = genericOf(pack, vocabulary, named);
      const exact = generic && candidateFor(pack, generic.id, generic.names.fr);
      if (exact !== undefined && exact.id !== candidate.id) {
        // Named surely, or partly by a guess ("Efav"): then it is to be checked.
        const surely = [...guessed].every((id) => certain.has(id));
        candidate = exact;
        match = match === 'very-strong' && surely ? 'very-strong' : 'strong';
        held = substancesOfRef(pack, { kind: exact.kind, id: exact.id });
      }
    }
    const ref = { kind: candidate.kind, id: candidate.id };
    // One product per family: the line that names it best.
    const known = families.get(candidate.family);
    if (known !== undefined && (products[known]?.candidate.score ?? 0) >= candidate.score) return;
    const missingSubstances = [...named].filter((id) => !held.has(id)).sort();
    const posology = posologyOf(line, joined.slice(at + 1));
    const units = posology === undefined ? undefined : unitsPerDayOf(posology);
    const asksUnitsPerDay = needsUnitsPerDay(pack, ref);
    // No strength in micrograms, none that may be misread, and none above the
    // strongest box of the base ("11g" for "1 g"): she is asked.
    const read = unsureStrength(namePart) ? undefined : parseStrength(namePart).strengthMg;
    // A number without its unit ("Brufen 400", "19 CP" for "1 g") is a
    // strength only when a box of the family has it, or the family gives none.
    const family = [candidate.id, ...candidate.variants].flatMap(
      (id) => pack.products.find((p) => p.id === id)?.components.map((c) => c.strengthMg) ?? [],
    );
    const boxes = family.filter((mg): mg is number => mg !== undefined);
    const bare = !/\d\s*(?:mg|g|grammes?|milligrammes?)(?![\p{L}])/iu.test(namePart);
    const plausible =
      read !== undefined &&
      read <= vocabulary.largestMg &&
      (!bare || boxes.length === 0 || boxes.some((mg) => Math.abs(mg - read) < 1e-6));
    const strengthMg = plausible ? read : undefined;
    const product: PrescriptionProduct = {
      ref,
      candidate,
      line: shown,
      lineIndex,
      query,
      match,
      strengthMg,
      strengthQuery: [
        ...formWords(namePart),
        ...(strengthMg === undefined ? [] : [`${String(strengthMg)} mg`]),
      ].join(' '),
      posology,
      unitsPerDayOffer: asksUnitsPerDay ? units : undefined,
      asksUnitsPerDay,
      missingSubstances,
      extraSubstances: candidate.kind === 'product' ? extraOf(held).sort() : [],
      namesMore: !explainsEveryPart(pack, vocabulary, namePart, candidate, held),
    };
    if (known !== undefined) {
      products[known] = product;
    } else {
      families.set(candidate.family, products.length);
      products.push(product);
    }
  });

  // A later line may have taken the place of an earlier one of its family.
  products.sort((a, b) => a.lineIndex - b.lineIndex);
  // The lines read in part, or read as a product that holds more than they
  // name, are offered as typed too, after the products are settled.
  products.forEach((product, forProduct) => {
    const namesMore = product.missingSubstances.length > 0 || product.namesMore;
    if (!namesMore && product.extraSubstances.length === 0) return;
    typed.push({
      text: product.query,
      line: product.line,
      lineIndex: product.lineIndex,
      reason: namesMore ? 'names-more' : 'holds-more',
      forProduct,
    });
  });
  typed.sort((a, b) => a.lineIndex - b.lineIndex);
  return { products, typed };
}
