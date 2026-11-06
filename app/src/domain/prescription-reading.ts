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
  namedSubstances,
  normalize,
  parseStrength,
  search,
  withoutStopWords,
  type Candidate,
} from '@siapso/resolver';
import { strengthOf } from './possible-matches.js';
import { needsUnitsPerDay, searchIndexOf } from './search-index.js';

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
   * posology: the text the confirm screen reads as if typed (strength
   * question, missing substances), and the one "Corriger" puts in the search.
   */
  query: string;
  /** How clearly the line names it: `strong` says to compare with the box. */
  match: 'strong' | 'very-strong';
  /** The strength the line gives, in mg, proposed and never imposed; undefined when none (or in micrograms). */
  strengthMg: number | undefined;
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
   * The substances the line names that the product lacks (substance ids,
   * sorted): a combination read in part ("SP" read as pyrimethamine alone).
   * The item then says which ones, is never pre-ticked, and the line is also
   * offered as typed (`typed`, reason `names-more`), so the result's safety
   * net looks it up again and a level is never lowered silently.
   */
  missingSubstances: string[];
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
   * `names-more`: a product was read on it, but the line names a substance
   * that product lacks (`forProduct`, its index in `products`).
   */
  reason: 'not-recognised' | 'names-more';
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
 * match, nor for a line that names a substance the product lacks. The list
 * itself starts with nothing ticked, whatever this says.
 */
export function mayBePreTicked(product: PrescriptionProduct): boolean {
  return product.match === 'very-strong' && product.missingSubstances.length === 0;
}

/** Lowercase, accents and marks gone, spaces collapsed: what the line rules read. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[|_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words of the header, the patient line, the prescriber and the stamp: a line
 * with one of them is never a product line, unless it starts with a list
 * number (the OCR may join the stamp to the last product).
 */
const NOT_PRODUCT =
  /\b(republique|senegal|peuple|ministere|region|district|poste de sante|centre de sante|service|maternite|cabinet|clinique|medecine|docteur|dr|sage femme|icp|tel|rue|ordonnance|nom|prenom|age|terme|date|signature|cachet|patiente?|mme|ans|medicament|posologie)\b/;

/** A posology line: it starts with a count and a unit, or with a posology word. */
const POSOLOGY_START =
  /^(\d+([.,]\d+)?|une?|deux|trois|1\/2)\s*(cp|cps|comprimes?|gel|gelules?|sachets?|c|cuilleres?|cuill|lyoc|ovules?|gouttes?|amp|ampoules?|suppo|injections?|bouffees?)\b|^(pendant|matin|midi|soir|si|qsp|jusqu|a prendre|prendre|dormir|au coucher|x\s*\d|renouveler|\d+\s*(fois|x)\b)/;

/** A count and a unit inside a line: where the posology of a table row starts. */
const POSOLOGY_INSIDE =
  /(?<![\p{L}\d.,/])(\d+|une?|deux|trois|1\/2)\s*(cp|cps|comprimes?|gel|gelules?|sachets?|c\.|cuilleres?|lyoc|ovules?|gouttes?|ampoules?)(?![\p{L}])/u;

/** The words of a posology: a line made mostly of them is a posology line. */
const POSOLOGY_WORDS: ReadonlySet<string> = new Set(
  'une un deux trois quatre prise prises unique fois par jour jours j semaine semaines mois matin midi soir coucher repas apres avant pendant au aux le la les de du des et ou si en dans verre eau douleur douleurs fievre forte qsp jusqu accouchement renouveler a prendre cp cps gel gelule gelules sachet sachets cuillere soupe cafe lyoc ovule ovules goutte gouttes x max maximum regles jeun milieu tpi agent devant prophylaxie arreter ne pas dormir sous moustiquaire effervescent'.split(
    ' ',
  ),
);

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
/** A strength in micrograms (or as the OCR reads µ): never a strength in mg here. */
const MICROGRAMS = /\d\s*(µg|μg|ug|mcg|pg|microgrammes?)(?![\p{L}])/iu;

/** The part of a line before an inline posology (a colon). */
function namePartOf(line: string): string {
  return line.split(/\s:\s|:\s|\s:(?=\S)/)[0] ?? line;
}

/** Whether a line leaves a name open for the next one: an unclosed bracket, or a final "+", "," or "et". */
function leavesOpen(line: string): boolean {
  return line.split('(').length > line.split(')').length || /[+,]$|\bet$/.test(line);
}

/**
 * The lines, a name wrapped over two lines joined again (a table cell "SP
 * (Sulfadoxine" / "Pyriméthamine)", a line ending with "+"), each with the
 * index of its first line.
 */
function joinedLines(lines: readonly string[]): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  let index = 0;
  for (const given of lines) {
    for (const part of given.split(/\r?\n/)) {
      const line = part.trim();
      const at = index;
      index += 1;
      if (line === '') continue;
      const previous = out.at(-1);
      const closes =
        line.includes(')') || (previous !== undefined && /[+,]$|\bet$/.test(previous.text));
      if (
        previous !== undefined &&
        leavesOpen(previous.text) &&
        !/^\s*\(?\d{1,2}\s*[.),]/.test(line) &&
        closes
      ) {
        previous.text = `${previous.text} ${line}`;
      } else {
        out.push({ text: line, index: at });
      }
    }
  }
  return out;
}

interface Vocabulary {
  /** Normalised words of 7 letters or more of the substance and brand names of the pack. */
  words: string[];
  /**
   * Normalised words of 5 letters or more that the names of one substance
   * only have ("sulfadoxin", "folik", "fereux"), with that substance.
   */
  substanceWords: Map<string, string>;
  /** The normalised words of 5 letters or more of each substance's names. */
  wordsOfSubstance: Map<string, string[]>;
  /** The substances of each product. */
  substancesOfProduct: Map<string, Set<string>>;
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
    const words = new Set(
      names.flatMap((name) => normalize(name).split(' ')).filter((word) => word.length >= 7),
    );
    const owners = new Map<string, Set<string>>();
    for (const substance of pack.substances) {
      for (const word of normalize(`${substance.names.fr} ${substance.names.en}`).split(' ')) {
        if (word.length < SUBSTANCE_WORD) continue;
        const set = owners.get(word) ?? new Set<string>();
        set.add(substance.id);
        owners.set(word, set);
      }
    }
    const substanceWords = new Map(
      [...owners].flatMap(([word, ids]) => (ids.size === 1 ? [[word, [...ids][0] ?? '']] : [])),
    );
    const wordsOfSubstance = new Map(
      pack.substances.map((s) => [
        s.id,
        normalize(`${s.names.fr} ${s.names.en}`)
          .split(' ')
          .filter((word) => word.length >= SUBSTANCE_WORD),
      ]),
    );
    const substancesOfProduct = new Map(
      pack.products.map((p) => [p.id, new Set(p.components.map((c) => c.substance))]),
    );
    vocabulary = { words: [...words], substanceWords, wordsOfSubstance, substancesOfProduct };
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

/**
 * The words of a name part that the product read does not explain: not a
 * word of its names or of the name matched, not a form or salt word, not a
 * posology or header word, not a number. What is left may be a part of the
 * name the OCR garbled.
 */
function unexplainedWords(pack: Pack, namePart: string, candidate: Candidate): string[] {
  const product =
    candidate.kind === 'product' ? pack.products.find((p) => p.id === candidate.id) : undefined;
  const names =
    product === undefined
      ? []
      : [
          product.names.fr,
          product.names.en,
          ...product.brands,
          ...product.localNames.map((l) => l.text),
        ];
  const own = new Set(normalize([candidate.matched, ...names].join(' ')).split(' '));
  return withoutStopWords(normalize(namePart))
    .split(' ')
    .filter(
      (word) =>
        word.length >= SUBSTANCE_WORD &&
        !/\d/.test(word) &&
        !own.has(word) &&
        !POSOLOGY_WORDS.has(word) &&
        !NOT_PRODUCT.test(word),
    );
}

/**
 * The substances a name part names: by their names, as the confirm screen
 * reads them (namedSubstances), and by a word that only one substance has
 * ("folique" of "acide folique"), or a word of 6 letters or more the OCR
 * read in part or with a slip: the start of that word ("Sulfadox"), or the
 * word within one edit (two from 9 letters).
 */
function substancesNamed(pack: Pack, namePart: string): Set<string> {
  const named = new Set(namedSubstances(searchIndexOf(pack), namePart));
  const { substanceWords } = vocabularyOf(pack);
  for (const word of normalize(namePart).split(' ')) {
    if (word.length < SUBSTANCE_WORD || /\d/.test(word)) continue;
    for (const [known, id] of substanceWords) {
      const close =
        known === word ||
        (word.length >= RESEMBLING_WORD &&
          (known.startsWith(word) ||
            (Math.abs(known.length - word.length) <= 2 &&
              damerauLevenshtein(word, known) <= (known.length >= 9 ? 2 : 1))));
      if (close) named.add(id);
    }
  }
  return named;
}

/**
 * A long word misread by the OCR snapped to the substance or brand name it is
 * within one edit of (two from 9 letters): "Gsulfadofine" to "sulfadoxine",
 * "Efferalany" to "efferalgan", so that a combination is read whole. Words of
 * 7 letters or more only; the closest name wins.
 */
function snapped(line: string, vocabulary: Vocabulary): string {
  return line.replace(/\p{L}{7,}/gu, (word) => {
    const w = normalize(word);
    let best: string | undefined;
    let bestDistance = 3;
    for (const v of vocabulary.words) {
      if (Math.abs(v.length - w.length) > 2) continue;
      const distance = damerauLevenshtein(w, v);
      if (distance < bestDistance && distance <= (w.length >= 9 ? 2 : 1)) {
        best = v;
        bestDistance = distance;
      }
    }
    return best ?? word;
  });
}

/** The letters the OCR reads as digits inside a word ("fol1que", "Amox1cilline"). */
const LETTER_OF_DIGIT: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '5': 's',
  '8': 'b',
};

/**
 * A digit between two letters read as the letter it stands for; "B9", "B12"
 * and a strength glued to a name ("Doliprane1g") stay as they are.
 */
function digitsInWords(line: string): string {
  return line.replace(
    /(?<=\p{L})[0158](?=\p{L})(?!(?:mg|g|ml|µg|ug|mcg)(?![\p{L}\d]))/giu,
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

/** Units per day from a posology, when it says them plainly ("2 cp x 3/j" is 6); undefined otherwise. */
export function unitsPerDayOf(text: string): number | undefined {
  const t = plain(text).replace(/(\d)\s*[x*]\s*(\d)/g, '$1 x $2');
  if (/semaine|mois\b.*\bfois|tous les \d+ jours/.test(t) && !/par jour|\/j/.test(t)) {
    return undefined;
  }
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
    /(\d+)\s*(cp|gel|gelules?|sachets?|lyoc|ovules?|comprimes?)\b[^0-9]*?\b(matin|midi|soir)\b(.*)/.exec(
      t,
    );
  if (m) {
    const times = new Set([m[3], ...(m[4]?.match(/\b(matin|midi|soir)\b/g) ?? [])]);
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
  const words = namePart
    .split(/\s+/)
    .filter((w) => /\p{L}{2,}/u.test(w) && !POSOLOGY_WORDS.has(plain(w).replace(/[^a-z]/g, '')));
  const queries = [namePart];
  for (let start = 0; start < Math.min(WINDOW_STARTS, words.length); start += 1) {
    for (let n = 3; n >= 1; n -= 1) {
      if (start + n <= words.length) queries.push(words.slice(start, start + n).join(' '));
    }
  }
  let chosen: Chosen | undefined;
  for (const query of new Set(queries)) {
    if (POSOLOGY_WORDS.has(plain(query))) continue;
    for (const candidate of search(index, query, { limit: 1 })) {
      const match = strengthOf(candidate);
      if (match === 'weak') continue;
      const mine: Chosen = { candidate, match, length: normalize(query).length };
      if (better(mine, chosen)) chosen = mine;
    }
  }
  return chosen;
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
  const folded = line.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const inside = POSOLOGY_INSIDE.exec(folded);
  if (inside === null) return undefined;
  // The same position in the line as read when folding kept one character for
  // each (a precomposed text, as the OCR gives), else the whole row.
  return folded.length === line.length ? line.slice(inside.index).trim() : line.trim();
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
    const marked = MARKED.test(raw);
    const counted = raw.replace(LIST_MARK, '');
    const unmarked = gluedStrengthSplit(counted.replace(/^\d{1,2}\s+(?=\p{L})/u, ''));
    const line = snapped(digitsInWords(unmarked), vocabulary);
    const p = plain(line);
    // A header word ends a numbered product line when the OCR joins the stamp
    // to it ("Fluconazole 150 mg gél CLINIQUE DE"): the line is still read.
    // A posology starts with its count ("1 c. à soupe"), read before the
    // count is taken for a list number.
    if (p.length < 3 || (!marked && NOT_PRODUCT.test(p))) return;
    if (isPosology(plain(counted)) || isPosology(p)) return;
    const namePart = namePartOf(line).trim();
    const query = namePartOf(unmarked).trim();
    const chosen = bestOf(pack, namePart);
    if (chosen === undefined) {
      if ((PRODUCT_HINT.test(p) || marked) && normalize(namePart).length >= 4) {
        typed.push({ text: query, line: raw, lineIndex, reason: 'not-recognised' });
      }
      return;
    }
    const { candidate } = chosen;
    const ref = { kind: candidate.kind, id: candidate.id };
    // One product per family: the line that names it best.
    const known = families.get(candidate.family);
    if (known !== undefined && (products[known]?.candidate.score ?? 0) >= candidate.score) return;
    const held = substancesOfRef(pack, ref);
    const named = substancesNamed(pack, namePart);
    // A word garbled past a slip that resembles what a combination would add.
    const completing = completingSubstances(vocabulary, held);
    for (const word of completing.size > 0 ? unexplainedWords(pack, namePart, candidate) : []) {
      for (const id of completing) {
        const words = vocabulary.wordsOfSubstance.get(id) ?? [];
        if (words.some((known) => sharedInOrder(word, known) >= RESEMBLANCE)) named.add(id);
      }
    }
    const missingSubstances = [...named].filter((id) => !held.has(id)).sort();
    const posology = posologyOf(line, joined.slice(at + 1));
    const units = posology === undefined ? undefined : unitsPerDayOf(posology);
    const product: PrescriptionProduct = {
      ref,
      candidate,
      line: raw,
      lineIndex,
      query,
      match: chosen.match,
      strengthMg: MICROGRAMS.test(namePart) ? undefined : parseStrength(namePart).strengthMg,
      posology,
      unitsPerDayOffer: needsUnitsPerDay(pack, ref) ? units : undefined,
      missingSubstances,
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
  // The lines read in part are offered as typed too, after the products are settled.
  products.forEach((product, forProduct) => {
    if (product.missingSubstances.length === 0) return;
    typed.push({
      text: product.query,
      line: product.line,
      lineIndex: product.lineIndex,
      reason: 'names-more',
      forProduct,
    });
  });
  typed.sort((a, b) => a.lineIndex - b.lineIndex);
  return { products, typed };
}
