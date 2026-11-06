// SPDX-License-Identifier: MIT
// The products named inside a sentence (SCRUM-61): a voice transcript or a
// typed text that says more than the name ("dama naan doliprane ak
// nivaquine", "j'ai pris de l'advil et du coartem"). Rules on the closed list
// of names of the base, through search: no language model, the same answer
// for the same text, each product found to be confirmed by the user.
import { damerauLevenshtein } from './distance.js';
import { compiledOf } from './index-build.js';
import { matchStrength, type MatchStrength } from './match-strength.js';
import { normalize, plainText } from './normalize.js';
import { search } from './search.js';
import { clauseMarks, type ClauseReason } from './sentence-clause.js';
import {
  AMBIGUOUS_NAME_WORDS,
  CLAUSE_START_WORDS,
  FILLER_WORDS,
  FOOD_NAME_WORDS,
  JOINING_WORDS,
  LINKING_WORDS,
  NUMBER_WORDS,
  UNIT_WORDS,
  WEAK_ALONE_WORDS,
} from './sentence-words.js';
import { parseStrength } from './strength.js';
import type { Candidate, MatchKind, ResolverIndex } from './types.js';

/** A product or remedy named inside a sentence. */
export interface SentenceProduct {
  /** The best candidate for the words that name it (with the strength said, when one was). */
  candidate: Candidate;
  /** How clearly the words name it: never weak. */
  strength: Exclude<MatchStrength, 'weak'>;
  /** Ticked at first; a name that is also a common word ("goro") or a food ("ail") is not. */
  checked: boolean;
  /** The name is also a food or a spice ("ail", "gingembre"): offered unticked. */
  alsoFood?: boolean;
  /** The words of the sentence that name it, as written, with the strength said after them. */
  text: string;
  /** The strength said with it, in mg. */
  strengthMg?: number;
  /** The spelling read in place of a word spelt as a Wolof speaker writes it ("ibiprofen" for "ibiporofen"). */
  readAs?: string;
  /**
   * The words the voice heard, when they were read joined, sound for sound, as
   * this name ("King Kyliba" for kinkéliba): offered unticked, to be checked.
   */
  heardAs?: string;
  /**
   * Another name the words heard (`heardAs`) may be, offered with the name
   * heard: a longer name starting with the same sounds ("quinine qu'il y va"
   * may be kinkéliba). Offered unticked: "Ou peut-être".
   */
  alternative?: boolean;
  /**
   * The clause that says it is maybe not taken by the speaker now, with a
   * negation ("pas de cytotec"), by or for another person ("mon mari prend du
   * coartem") or as a past use ("avant je prenais de la nivaquine"): offered
   * unticked with these words, never dropped.
   */
  clause?: { reason: ClauseReason; text: string };
}

export interface SentenceOptions {
  /**
   * The sentence is what the voice heard: 2 or 3 words that name nothing are
   * also read joined, as the voice may split a name it does not know.
   */
  heard?: boolean;
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
const FOODS = setOf(FOOD_NAME_WORDS);
const NUMBERS = setOf(NUMBER_WORDS);
const CLAUSE_STARTS = setOf(CLAUSE_START_WORDS);
/** At most this many words after a name are shown with it when they start another clause. */
const CLAUSE_WORDS_SHOWN = 4;

/**
 * The end of the words heard with a name when the next word starts another
 * clause ("quinine qu'il y va"), up to 4 words and never across punctuation;
 * undefined when the sentence goes on from the name as usual.
 */
function clauseAfter(tokens: readonly Token[], last: number): number | undefined {
  const next = tokens[last + 1];
  if (next === undefined || next.boundary || !CLAUSE_STARTS.has(next.norm)) return undefined;
  // "il y a" goes on from the name as usual ("le coartem il y a deux jours"):
  // round 3 of the review of #68.
  if (next.norm === 'il' && tokens[last + 2]?.norm === 'y') return undefined;
  let end = next.end;
  for (let at = last + 2; at <= last + CLAUSE_WORDS_SHOWN; at += 1) {
    const token = tokens[at];
    if (token === undefined || token.boundary) break;
    end = token.end;
  }
  return end;
}
const UNITS = setOf(UNIT_WORDS);

/** A word of the sentence, where it is, and what it is. */
interface Token {
  /** As written. */
  text: string;
  /** As searched: the letters of "S.P." together ("SP"), otherwise the text. */
  said: string;
  start: number;
  end: number;
  /** As written, accents and case aside (plainText): "ci" is not "si". */
  plain: string;
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
      plain: plainText(said),
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

const DEVOICED: Readonly<Record<string, string>> = { b: 'p', d: 't', g: 'k', v: 'f', z: 's' };

/**
 * A normalised word as it sounds, the letters a voice confuses read alike:
 * "ai" and "ei" as e, "au" as o, "eu" as e, each voiced consonant as its
 * voiceless one (b p, d t, g k, v f, z s), then a doubled letter as one
 * ("kingkiliba" and "kinkeliba" are one letter apart; "libuprofain" and
 * "ibuprofen" too).
 */
export function phoneticKey(word: string): string {
  return word
    .replace(/[ae]i/g, 'e')
    .replaceAll('au', 'o')
    .replaceAll('eu', 'e')
    .replace(/[bdgvz]/g, (letter) => DEVOICED[letter] ?? letter)
    .replace(/(.)\1+/g, '$1');
}

/** A whole name joined from words this long or longer may be one letter off. */
const MERGED_NEAR_LENGTH = 6;
/** The shortest whole name read from joined words. */
const MERGED_MIN_LENGTH = 5;
/** At most this many words joined. */
const MERGED_MAX_WORDS = 3;

/** The whole names of an index (as matched, spaces taken out) by the length of their phonetic key; made once. */
const keysByLength = new WeakMap<ResolverIndex, Map<number, { key: string; name: string }[]>>();

function nameKeys(index: ResolverIndex): Map<number, { key: string; name: string }[]> {
  let byLength = keysByLength.get(index);
  if (byLength === undefined) {
    byLength = new Map();
    const seen = new Set<string>();
    for (const { compact } of compiledOf(index).names) {
      if (compact.length < MERGED_MIN_LENGTH || seen.has(compact)) continue;
      seen.add(compact);
      const key = phoneticKey(compact);
      byLength.set(key.length, [...(byLength.get(key.length) ?? []), { key, name: compact }]);
    }
    keysByLength.set(index, byLength);
  }
  return byLength;
}

/**
 * The whole name whose phonetic key is this one, or one letter off when both
 * have 6 letters or more ("inver" is not INOFER).
 */
function nameSoundingLike(index: ResolverIndex, key: string): string | undefined {
  const byLength = nameKeys(index);
  const same = byLength.get(key.length)?.find((name) => name.key === key);
  if (same !== undefined) return same.name;
  if (key.length < MERGED_NEAR_LENGTH) return undefined;
  for (const length of [key.length - 1, key.length, key.length + 1]) {
    if (length < MERGED_NEAR_LENGTH) continue;
    const near = byLength.get(length)?.find((name) => damerauLevenshtein(key, name.key) <= 1);
    if (near !== undefined) return near.name;
  }
  return undefined;
}

/** The first sounds a longer name must share with a name heard before another clause. */
const ALTERNATIVE_PREFIX = 3;
/** The shortest longer name offered so. */
const ALTERNATIVE_MIN_LENGTH = 6;

/**
 * Whether the rest of a longer name, after the sounds it shares with the name
 * heard, sounds like the next word said, letter for letter at one place at
 * least ("kin|kélipa" and "k" of "qu'il"; not "fer|tifol" and "il").
 */
function restSoundsLike(key: string, nameKey: string, nextKey: string): boolean {
  let shared = 0;
  while (shared < key.length && key[shared] === nameKey[shared]) shared += 1;
  const rest = key.slice(shared);
  for (let at = 0; at < Math.min(rest.length, nextKey.length); at += 1) {
    if (rest[at] === nextKey[at]) return true;
  }
  return false;
}

/**
 * The longer whole name the words heard may be, when a name was heard right
 * before another clause ("quinine qu'il y va" for kinkéliba): a name whose
 * sounds start as the name heard does, with at most half its sounds apart
 * from the words heard joined, and whose rest sounds like the next word said
 * (round 2 of the review of #68: "fer il y a un" is not FERTIFOL); the
 * closest one, or undefined.
 */
function longerNameSoundingLike(
  index: ResolverIndex,
  nameKey: string,
  heardKey: string,
  nextKey: string,
): string | undefined {
  const start = nameKey.slice(0, ALTERNATIVE_PREFIX);
  let closest: { name: string; distance: number } | undefined;
  for (const names of nameKeys(index).values()) {
    for (const { key, name } of names) {
      if (key.length < ALTERNATIVE_MIN_LENGTH || key.length <= nameKey.length) continue;
      if (!key.startsWith(start) || !restSoundsLike(key, nameKey, nextKey)) continue;
      const distance = damerauLevenshtein(heardKey, key);
      if (distance > Math.floor(key.length / 2)) continue;
      if (closest === undefined || distance < closest.distance) closest = { name, distance };
    }
  }
  return closest?.name;
}

/**
 * What an article the voice may have moved gives the name after it, or
 * undefined: "d" and "l" elided before the next word ("d'Oli-Pran": d), and
 * "la" and "le", whose vowel may be the name's first letter ("la moxiceline"
 * for "l'amoxicilline": a).
 */
function articleGlue(sentence: string, token: Token): string | undefined {
  if ((token.norm === 'd' || token.norm === 'l') && /^['’]/u.test(sentence.slice(token.end))) {
    return token.norm;
  }
  if (token.norm === 'la') return 'a';
  if (token.norm === 'le') return 'e';
  return undefined;
}

/**
 * The spellings to compare of words joined: as heard, and without a first
 * l or d before a vowel, an article the voice glued to the name ("Libu
 * Profaine" for "l'ibuprofène").
 */
function joinedSpellings(joined: string): string[] {
  return /^[ld][aeiou]/u.test(joined) ? [joined, joined.slice(1)] : [joined];
}

/**
 * The names read from 2 or 3 words heard one after the other, joined and
 * compared sound for sound (phoneticKey) with the whole names of the base,
 * outside the words of a name found clearly: "King Kyliba" is kinkéliba,
 * "Libu Profaine" ibuprofen, "d'Oli-Pran" Doliprane, "la moxiceline"
 * amoxicillin (an article may start the words). Each is strong at most and
 * offered unticked.
 */
function mergedReadings(
  index: ResolverIndex,
  best: Best,
  sentence: string,
  tokens: readonly Token[],
  covered: ReadonlySet<number>,
): { at: number; last: number; product: SentenceProduct }[] {
  const found: { at: number; last: number; product: SentenceProduct }[] = [];
  let first = 0;
  while (first < tokens.length) {
    let taken = 0;
    for (let words = MERGED_MAX_WORDS; words >= 2 && taken === 0; words -= 1) {
      const run = tokens.slice(first, first + words);
      const head = run[0];
      if (run.length < words || head === undefined) continue;
      const glue = articleGlue(sentence, head);
      const usable = run.every(
        (token, at) =>
          !covered.has(first + at) &&
          (at === 0 ? isNameWord(token) || glue !== undefined : isNameWord(token)) &&
          (at === 0 || !token.boundary) &&
          /^\p{L}+$/u.test(token.norm),
      );
      if (!usable) continue;
      const joined = run
        .map((token, at) => (at === 0 && glue !== undefined ? glue : token.norm))
        .join('');
      const name = joinedSpellings(joined)
        .map((spelling) => nameSoundingLike(index, phoneticKey(spelling)))
        .find((sounding) => sounding !== undefined);
      const candidate = name === undefined ? undefined : best(name);
      if (candidate === undefined || matchStrength(candidate) === 'weak') continue;
      const last = run.at(-1) ?? head;
      const heardAs = sentence.slice(head.start, last.end);
      found.push({
        at: first,
        last: first + words - 1,
        product: { candidate, strength: 'strong', checked: false, text: heardAs, heardAs },
      });
      taken = words;
    }
    first += Math.max(taken, 1);
  }
  return found;
}

/** The kinds of match that name a product clearly: the voice's words joined never take their place. */
const CLEAR_KINDS: ReadonlySet<MatchKind> = new Set(['exact', 'word', 'contained', 'substances']);

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
 * is read with it. For a sentence the voice heard (`heard`), 2 or 3 words
 * outside the names found are also read joined, sound for sound
 * (mergedReadings): such a name is offered unticked, with the words heard
 * (`heardAs`). Never a level: each product is confirmed by the user.
 */
export function productsInSentence(
  index: ResolverIndex,
  sentence: string,
  options: SentenceOptions = {},
): SentenceProduct[] {
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
  let taken = chosen(readings);
  // For what the voice heard, 2 or 3 words joined that sound like a whole name
  // take the place of a single word read only as the start or a near spelling
  // of another name ("Libu profène" is ibuprofen, not the start of PROFENID).
  const merged: ReturnType<typeof mergedReadings> = [];
  if (options.heard === true) {
    const clear = (reading: Reading) =>
      reading.span.words > 1 ||
      (reading.readAs === undefined && CLEAR_KINDS.has(reading.candidate.match));
    const covered = new Set<number>();
    for (const reading of taken.filter(clear)) {
      for (let at = reading.span.first; at <= reading.span.last; at += 1) covered.add(at);
    }
    const overlap = (reading: Reading, joined: (typeof merged)[number]) =>
      reading.span.first <= joined.last && joined.at <= reading.span.last;
    // Words joined that name the product already read in one of them add nothing.
    merged.push(
      ...mergedReadings(index, best, sentence, tokens, covered).filter(
        (joined) =>
          !taken.some(
            (reading) =>
              overlap(reading, joined) &&
              reading.candidate.family === joined.product.candidate.family,
          ),
      ),
    );
    taken = taken.filter(
      (reading) => clear(reading) || !merged.some((joined) => overlap(reading, joined)),
    );
  }
  const products: { at: number; last: number; product: SentenceProduct }[] = [];
  for (const reading of taken) {
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
    // A remedy that is also a food ("ail", "tisane de gingembre"): maybe eaten as food only.
    const food =
      candidate.kind === 'plant' &&
      tokens
        .slice(reading.span.first, reading.span.last + 1)
        .some((token) => FOODS.has(token.norm));
    // Heard right before the start of another clause: the voice may have made
    // the name out of a longer one ("quinine qu'il y va" for kinkéliba).
    const clauseEnd =
      options.heard === true && strength === undefined
        ? clauseAfter(tokens, reading.span.last)
        : undefined;
    // The last word of the name, or of the strength said after it.
    let lastWord = reading.span.last;
    while (strength !== undefined && (tokens[lastWord + 1]?.end ?? Infinity) <= strength.end) {
      lastWord += 1;
    }
    products.push({
      at: reading.span.first,
      last: lastWord,
      product: {
        candidate,
        strength: reading.strength,
        checked: !ambiguous && !food && clauseEnd === undefined,
        text,
        ...(food ? { alsoFood: true } : {}),
        ...(strength === undefined ? {} : { strengthMg: strength.mg }),
        ...(reading.readAs === undefined ? {} : { readAs: reading.readAs }),
        ...(clauseEnd === undefined ? {} : { heardAs: sentence.slice(first.start, clauseEnd) }),
      },
    });
    if (clauseEnd === undefined) continue;
    // The longer name the words heard may be ("quinine qu'il y va": kinkéliba),
    // offered too, unticked (review of #68).
    let heardLast = reading.span.last;
    while ((tokens[heardLast + 1]?.end ?? Infinity) <= clauseEnd) heardLast += 1;
    // Joined, "y" said alone is the sound i, as normalize reads it in a word.
    const heardKey = phoneticKey(
      tokens
        .slice(reading.span.last, heardLast + 1)
        .map((token) => token.norm)
        .join('')
        .replaceAll('y', 'i'),
    );
    const nextKey = phoneticKey((tokens[reading.span.last + 1]?.norm ?? '').replaceAll('y', 'i'));
    const longer = longerNameSoundingLike(index, phoneticKey(last.norm), heardKey, nextKey);
    const alternative = longer === undefined ? undefined : best(longer);
    if (alternative === undefined || alternative.family === candidate.family) continue;
    const heardAs = sentence.slice(first.start, clauseEnd);
    products.push({
      at: reading.span.first,
      last: heardLast,
      product: {
        candidate: alternative,
        strength: 'strong',
        checked: false,
        text: heardAs,
        heardAs,
        alternative: true,
      },
    });
  }
  for (const { at, last, product } of merged) products.push({ at, last, product });
  // Said with a negation, by another person, as a past use: offered unticked, never dropped.
  const marks = clauseMarks(
    tokens,
    products.map(({ at, last }) => ({ first: at, last })),
  );
  products.forEach((found, position) => {
    const mark = marks[position];
    const from = mark === undefined ? undefined : tokens[mark.first];
    const to = mark === undefined ? undefined : tokens[mark.last];
    if (mark === undefined || from === undefined || to === undefined) return;
    found.product = {
      ...found.product,
      checked: false,
      clause: { reason: mark.reason, text: sentence.slice(from.start, to.end) },
    };
  });
  // Each family once: the first found, unless it is named as not taken and
  // the same product is named again, ticked ("mon mari prend du doliprane et
  // moi aussi je prends du doliprane").
  const kept = new Map<string, (typeof products)[number]>();
  for (const found of products) {
    const family = found.product.candidate.family;
    const before = kept.get(family);
    const taken =
      before !== undefined &&
      before.product.clause !== undefined &&
      found.product.clause === undefined &&
      found.product.checked;
    if (before === undefined || taken) kept.set(family, found);
  }
  return [...kept.values()].sort((a, b) => a.at - b.at).map(({ product }) => product);
}
