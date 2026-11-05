// SPDX-License-Identifier: MIT
// The products named inside a sentence (SCRUM-61): a voice transcript or a
// typed text that says more than the name ("dama naan doliprane ak
// nivaquine", "j'ai pris de l'advil et du coartem"). Rules on the closed list
// of names of the base, through search: no language model, the same answer
// for the same text, each product found to be confirmed by the user.
import { damerauLevenshtein } from './distance.js';
import { compiledOf } from './index-build.js';
import { matchStrength, type MatchStrength } from './match-strength.js';
import { normalize } from './normalize.js';
import { search } from './search.js';
import {
  AMBIGUOUS_NAME_WORDS,
  FILLER_WORDS,
  JOINING_WORDS,
  LINKING_WORDS,
  NUMBER_WORDS,
  UNIT_WORDS,
  WEAK_ALONE_WORDS,
} from './sentence-words.js';
import { parseStrength } from './strength.js';
import type { Candidate, ResolverIndex } from './types.js';

/** A product or remedy named inside a sentence. */
export interface SentenceProduct {
  /** The best candidate for the words that name it (with the strength said, when one was). */
  candidate: Candidate;
  /** How clearly the words name it: never weak. */
  strength: Exclude<MatchStrength, 'weak'>;
  /** Ticked at first; a name that is also a common word ("goro") is not. */
  checked: boolean;
  /** The words of the sentence that name it, as written, with the strength said after them. */
  text: string;
  /** The strength said with it, in mg. */
  strengthMg?: number;
  /** The spelling read in place of a word spelt as a Wolof speaker writes it ("ibiprofen" for "ibiporofen"). */
  readAs?: string;
}

/** At most this many words of a name (linking and joining words aside). */
const MAX_NAME_WORDS = 4;
/** A word this long or longer may be read with a Wolof spelling undone. */
const MIN_RESPELLED_LENGTH = 6;
/** A whole name of this many letters or more, spelt within one edit, is a near match (search.ts). */
const NEAR_NAME_LENGTH = 6;
/** A strength said without a unit is read from this many mg (a smaller number is a count). */
const MIN_STRENGTH_WITHOUT_UNIT = 50;
/** At most this many words of a strength after the name ("cinq cent milligrammes"). */
const MAX_STRENGTH_WORDS = 5;
/** The score of a name of one or two letters matched whole ("SP"). */
const SHORT_NAME_SCORE = 0.6;

const setOf = (words: readonly string[]): ReadonlySet<string> => new Set(words.map(normalize));
const FILLERS = setOf(FILLER_WORDS);
const LINKS = setOf(LINKING_WORDS);
const JOINS = setOf(JOINING_WORDS);
const WEAK_ALONE = setOf(WEAK_ALONE_WORDS);
const AMBIGUOUS = setOf(AMBIGUOUS_NAME_WORDS);
const NUMBERS = setOf(NUMBER_WORDS);
const UNITS = setOf(UNIT_WORDS);

/** A word of the sentence, where it is, and what it is. */
interface Token {
  /** As written. */
  text: string;
  /** As searched: the letters of "S.P." together ("SP"), otherwise the text. */
  said: string;
  start: number;
  end: number;
  /** Normalised (normalize). */
  norm: string;
  /** Punctuation stands between this word and the one before ("doliprane, nivaquine"). */
  boundary: boolean;
}

/** Punctuation that ends a name: a name is never read across it. */
const BOUNDARY = /[.,;:!?…()[\]{}«»"“”]/u;
/** Letters written one by one with dots ("S.P.", "T.L.D."), or a word. */
const WORD = /\p{L}(?:\.\p{L})+\.?|[\p{L}\p{M}\p{N}]+/gu;
const DIGITS = /^\d+$/u;
const DIGITS_WITH_UNIT = /^\d+(?:mg|g|mcg)$/u;

function tokensOf(sentence: string): Token[] {
  const tokens: Token[] = [];
  for (const found of sentence.matchAll(WORD)) {
    const text = found[0];
    const start = found.index;
    const said = /^\p{L}\./u.test(text) ? text.replaceAll('.', '') : text;
    const before = tokens.at(-1);
    const between = before === undefined ? '' : sentence.slice(before.end, start);
    // "0,5 g": a comma between two digits is a decimal comma.
    const decimal = before !== undefined && DIGITS.test(before.text) && /^\d/u.test(text);
    tokens.push({
      text,
      said,
      start,
      end: start + text.length,
      norm: normalize(said),
      boundary: BOUNDARY.test(between) && !(decimal && /^[.,]$/u.test(between)),
    });
  }
  return tokens;
}

/** The words from `first` to `last` as searched, with what stands between them. */
function saidText(sentence: string, tokens: readonly Token[], first: number, last: number): string {
  let text = '';
  for (let at = first; at <= last; at += 1) {
    const token = tokens[at];
    const before = tokens[at - 1];
    if (token === undefined) continue;
    if (at > first && before !== undefined) text += sentence.slice(before.end, token.start);
    text += token.said;
  }
  return text;
}

/** A word of a strength said after a name: a number, a number word, a unit. */
function isNumber(token: Token): boolean {
  return DIGITS.test(token.norm) || NUMBERS.has(token.norm);
}

function isUnit(token: Token): boolean {
  return UNITS.has(token.norm) || DIGITS_WITH_UNIT.test(token.norm);
}

/** A word that may name a product: no filler, joining word, number, unit or letter alone. */
function isNameWord(token: Token): boolean {
  return (
    token.norm.length >= 2 &&
    !FILLERS.has(token.norm) &&
    !JOINS.has(token.norm) &&
    !isNumber(token) &&
    !isUnit(token)
  );
}

/** Words of the sentence that may name one product, from `first` to `last`. */
interface Span {
  first: number;
  last: number;
  /** How many name words it holds. */
  words: number;
  /** A joining word stands inside it: it must be a whole name. */
  joined: boolean;
  /** It ends with a letter alone ("vitamine c"): it must be a whole name. */
  letterEnd: boolean;
}

/** A letter alone, which may end a name ("Efferalgan vitamine C"), never start one. */
function isLetter(token: Token): boolean {
  return /^\p{L}$/u.test(token.norm);
}

/**
 * Every run of 1 to 4 name words, read across linking words ("huile de
 * ricin") and joining words ("fer et acide folique"), never across another
 * filler or punctuation; a run may end with a letter alone ("efferalgan
 * vitamine c").
 */
function spansOf(tokens: readonly Token[]): Span[] {
  const spans: Span[] = [];
  tokens.forEach((token, first) => {
    if (!isNameWord(token)) return;
    spans.push({ first, last: first, words: 1, joined: false, letterEnd: false });
    let words = 1;
    let joined = false;
    for (let last = first + 1; last < tokens.length; last += 1) {
      const next = tokens[last];
      if (next === undefined || next.boundary) break;
      if (isLetter(next)) {
        spans.push({ first, last, words, joined, letterEnd: true });
        break;
      }
      if (isNameWord(next)) {
        words += 1;
        if (words > MAX_NAME_WORDS) break;
        spans.push({ first, last, words, joined, letterEnd: false });
      } else if (JOINS.has(next.norm)) {
        joined = true;
      } else if (!LINKS.has(next.norm)) {
        break;
      }
    }
  });
  return spans;
}

const VOWELS = 'aeiou';
const SWAPS: Readonly<Record<string, string>> = { r: 'l', l: 'r', b: 'p', p: 'b' };
/** The consonant clusters of French a Wolof speaker breaks with a vowel: pr, br, tr, ..., pl, bl, ... */
const BEFORE_R = 'bdfgkptv';
const BEFORE_L = 'bfgkp';

/** The word with the letters from `at` to `at + length` replaced by `by`. */
function spliced(word: string, at: number, length: number, by: string): string {
  return word.slice(0, at) + by + word.slice(at + length);
}

/**
 * The spellings a Wolof speaker's French word may stand for, one change each
 * (normalised words): a vowel put inside a French cluster undone
 * ("doliparan", "dolipran"; "ibiporofen", "ibiprofen"), a final vowel added
 * after a consonant taken off ("nivakinu", "nivakin"), r read as l and l as r
 * ("palasetamol"), b read as p and p as b ("dolibran"); and the French
 * spellings of sounds the Wolof orthography writes otherwise: ks for x
 * ("amoksisilin"; x writes the sound French spells kh), j for a g before e or
 * i ("kardejik"), s for a z between vowels ("metronidasol").
 */
export function respellingsOf(word: string): string[] {
  const found = new Set<string>();
  const vowel = (at: number) => VOWELS.includes(word.charAt(at)) && word.charAt(at) !== '';
  for (let at = 1; at < word.length - 1; at += 1) {
    const before = word.charAt(at - 1);
    const after = word.charAt(at + 1);
    const cluster =
      (after === 'r' && BEFORE_R.includes(before)) || (after === 'l' && BEFORE_L.includes(before));
    if (vowel(at) && cluster) found.add(spliced(word, at, 1, ''));
  }
  if (word.length > 1 && vowel(word.length - 1) && !vowel(word.length - 2)) {
    found.add(word.slice(0, -1));
  }
  for (let at = 0; at < word.length; at += 1) {
    const letter = word.charAt(at);
    const swap = SWAPS[letter];
    if (swap !== undefined) found.add(spliced(word, at, 1, swap));
    if (word.startsWith('ks', at)) found.add(spliced(word, at, 2, 'x'));
    if (letter === 'j' && 'ei'.includes(word.charAt(at + 1)) && at + 1 < word.length) {
      found.add(spliced(word, at, 1, 'g'));
    }
    if (letter === 's' && at > 0 && vowel(at - 1) && vowel(at + 1))
      found.add(spliced(word, at, 1, 'z'));
  }
  found.delete(word);
  return [...found];
}

/** A span read as a product, before the spans are chosen. */
interface Reading {
  span: Span;
  candidate: Candidate;
  strength: Exclude<MatchStrength, 'weak'>;
  /** The order of the readings: score, a named combination first. */
  rank: number;
  readAs?: string;
}

/**
 * The first candidate of a text, both lists searched; when it is a weak match,
 * a clear match at the same score after it ("metronidasol": a word of a
 * laboratory's box at 0.77, and the generic's whole name within one edit).
 */
function bestOf(index: ResolverIndex, text: string): Candidate | undefined {
  const [first, ...others] = search(index, text);
  if (first === undefined || matchStrength(first) !== 'weak') return first;
  return (
    others.find((other) => other.score === first.score && matchStrength(other) !== 'weak') ?? first
  );
}

/** The whole names of one word of an index (normalised, as matched), by length; made once. */
const namesByLength = new WeakMap<ResolverIndex, Map<number, string[]>>();

function oneWordNames(index: ResolverIndex): Map<number, string[]> {
  let byLength = namesByLength.get(index);
  if (byLength === undefined) {
    byLength = new Map();
    const words = new Set(
      compiledOf(index)
        .names.map((name) => name.norm)
        .filter((norm) => norm !== '' && !norm.includes(' ')),
    );
    for (const word of words) {
      byLength.set(word.length, [...(byLength.get(word.length) ?? []), word]);
    }
    namesByLength.set(index, byLength);
  }
  return byLength;
}

/**
 * Whether a spelling may be a whole name (equal, or 6 letters or more within
 * one edit), before it is searched: most words of a long sentence are none.
 */
function mayBeName(index: ResolverIndex, spelling: string): boolean {
  const byLength = oneWordNames(index);
  if (byLength.get(spelling.length)?.includes(spelling) === true) return true;
  if (spelling.length < NEAR_NAME_LENGTH - 1) return false;
  for (const length of [spelling.length - 1, spelling.length, spelling.length + 1]) {
    if (length < NEAR_NAME_LENGTH) continue;
    for (const name of byLength.get(length) ?? []) {
      if (damerauLevenshtein(spelling, name) <= 1) return true;
    }
  }
  return false;
}

/** A word of one or two letters that is a whole word leading a name ("SP"): strong. */
function shortName(token: Token, candidate: Candidate): boolean {
  return (
    token.norm.length <= 2 &&
    /^\p{L}+$/u.test(token.norm) &&
    candidate.score === SHORT_NAME_SCORE &&
    (candidate.match === 'exact' || candidate.match === 'word') &&
    candidate.weakWord === undefined
  );
}

/** The first candidate of a text (bestOf), searched once per sentence. */
type Best = (text: string) => Candidate | undefined;

/**
 * The word read with a Wolof spelling undone, when that spelling is a whole
 * name, or a name of 6 letters or more within one edit ("ibiprofen").
 */
function respelled(
  index: ResolverIndex,
  best: Best,
  token: Token,
): { candidate: Candidate; readAs: string } | undefined {
  if (token.norm.length < MIN_RESPELLED_LENGTH || !/^\p{L}+$/u.test(token.norm)) return undefined;
  for (const readAs of respellingsOf(token.norm)) {
    if (!mayBeName(index, readAs)) continue;
    const candidate = best(readAs);
    if (candidate === undefined || matchStrength(candidate) === 'weak') continue;
    if (candidate.match === 'exact' || candidate.match === 'near') return { candidate, readAs };
  }
  return undefined;
}

/** How a span reads, or undefined when it names no product clearly. */
function readingOf(
  index: ResolverIndex,
  best: Best,
  sentence: string,
  tokens: readonly Token[],
  span: Span,
): Reading | undefined {
  const first = tokens[span.first];
  const last = tokens[span.last];
  if (first === undefined || last === undefined) return undefined;
  const alone = span.words === 1 && !span.letterEnd ? first : undefined;
  if (alone !== undefined && WEAK_ALONE.has(alone.norm)) return undefined;
  // Words of which none, alone, looks like any name are no name together.
  if (
    alone === undefined &&
    !tokens
      .slice(span.first, span.last + 1)
      .some((token) => isNameWord(token) && best(token.said) !== undefined)
  ) {
    return undefined;
  }
  const candidate = best(saidText(sentence, tokens, span.first, span.last));
  if (candidate !== undefined) {
    // Joined names are two products, unless the words said are a whole name;
    // a letter alone ends a name only when the words are a whole name.
    const kept =
      !((span.joined || span.letterEnd) && candidate.match !== 'exact') &&
      // A name inside the words is read on its own words, not on these.
      !(alone === undefined && candidate.match === 'contained');
    const strength = matchStrength(candidate);
    if (kept && strength !== 'weak') {
      const combination = span.words > 1 && candidate.match === 'substances';
      return { span, candidate, strength, rank: combination ? 1 : candidate.score };
    }
    if (kept && alone !== undefined && shortName(alone, candidate)) {
      return { span, candidate, strength: 'strong', rank: candidate.score };
    }
  }
  if (alone === undefined) return undefined;
  const spelling = respelled(index, best, alone);
  if (spelling === undefined) return undefined;
  // Below a name said as it is written.
  return { span, ...spelling, strength: 'strong', rank: spelling.candidate.score * 0.9 };
}

/** The non-overlapping readings, best first, then the longest, then the first said. */
function chosen(readings: Reading[]): Reading[] {
  const sorted = [...readings].sort(
    (a, b) => b.rank - a.rank || b.span.words - a.span.words || a.span.first - b.span.first,
  );
  const taken: Reading[] = [];
  for (const reading of sorted) {
    const overlaps = taken.some(
      ({ span }) => reading.span.first <= span.last && span.first <= reading.span.last,
    );
    if (!overlaps) taken.push(reading);
  }
  return taken.sort((a, b) => a.span.first - b.span.first);
}

/**
 * The strength said right after a name ("doliprane 1000 mg", "doliprane
 * mille", "efferalgan un gramme"): its words and the strength in mg. A number
 * without a unit under 50 is a count, never a strength ("doliprane 2 fois").
 */
function strengthAfter(
  sentence: string,
  tokens: readonly Token[],
  reading: Reading,
): { end: number; mg: number } | undefined {
  const first = tokens[reading.span.first];
  const last = tokens[reading.span.last];
  if (first === undefined || last === undefined) return undefined;
  // The name's own words first: a strength written in them ("doliprane1000").
  let end = last.end;
  let unit = false;
  for (let at = reading.span.last + 1; at <= reading.span.last + MAX_STRENGTH_WORDS; at += 1) {
    const token = tokens[at];
    if (token === undefined || token.boundary || !(isNumber(token) || isUnit(token))) break;
    end = token.end;
    if (isUnit(token)) {
      unit = true;
      break;
    }
  }
  const mg = parseStrength(sentence.slice(first.start, end)).strengthMg;
  if (mg === undefined || (!unit && mg < MIN_STRENGTH_WITHOUT_UNIT)) return undefined;
  return { end, mg };
}

/**
 * The products and remedies a sentence names, in the order they are said,
 * each family once. The sentence is read word by word, as normalize reads a
 * name, without its filler words (French and Wolof function words, verbs of
 * taking, words of the context: FILLER_WORDS); every run of 1 to 4 words left
 * is searched in both lists, and kept when its first candidate is a strong
 * match (matchStrength: a whole name, a name inside it, a near spelling, a
 * high score). The runs kept are then chosen best first, the longest at an
 * equal score, without overlap: "huile de ricin" is one remedy, "doliprane ak
 * nivaquine" two products, "doliprane codéine" the product that bears both
 * names (two names joined by "et", "ak" or "avec" are two products, unless the
 * words said are a whole name: "fer et acide folique"). A word of 6 letters
 * or more that names nothing clearly is read once more with a Wolof spelling
 * undone (respellingsOf): then strong at most. A strength said after the name
 * is read with it. Never a level: each product is confirmed by the user.
 */
export function productsInSentence(index: ResolverIndex, sentence: string): SentenceProduct[] {
  const tokens = tokensOf(sentence);
  const searched = new Map<string, Candidate | undefined>();
  const best: Best = (text) => {
    if (!searched.has(text)) searched.set(text, bestOf(index, text));
    return searched.get(text);
  };
  const readings = spansOf(tokens).flatMap((span) => {
    const reading = readingOf(index, best, sentence, tokens, span);
    return reading === undefined ? [] : [reading];
  });
  const families = new Set<string>();
  const products: SentenceProduct[] = [];
  for (const reading of chosen(readings)) {
    if (families.has(reading.candidate.family)) continue;
    families.add(reading.candidate.family);
    const first = tokens[reading.span.first];
    const last = tokens[reading.span.last];
    if (first === undefined || last === undefined) continue;
    const strength = strengthAfter(sentence, tokens, reading);
    const text = sentence.slice(first.start, strength?.end ?? last.end);
    let candidate = reading.candidate;
    if (strength !== undefined) {
      // The product of that strength, within the family found ("kardejik 75"
      // is searched as "kardegik 75").
      const name =
        reading.readAs ?? saidText(sentence, tokens, reading.span.first, reading.span.last);
      const withStrength = search(index, `${name}${sentence.slice(last.end, strength.end)}`).find(
        (found) => found.family === reading.candidate.family,
      );
      if (withStrength !== undefined) candidate = withStrength;
    }
    const ambiguous = reading.span.words === 1 && AMBIGUOUS.has(first.norm);
    products.push({
      candidate,
      strength: reading.strength,
      checked: !ambiguous,
      text,
      ...(strength === undefined ? {} : { strengthMg: strength.mg }),
      ...(reading.readAs === undefined ? {} : { readAs: reading.readAs }),
    });
  }
  return products;
}
