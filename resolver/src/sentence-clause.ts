// SPDX-License-Identifier: MIT
// The clause of a product named inside a sentence (review of #68): a product
// said with a negation ("mais pas de cytotec", "duma naan cytotec"), by or
// for another person ("mon mari prend du coartem", "sama jëkkër dafay naan"),
// or as a past use ("avant je prenais de la nivaquine", "bàyyi naa") is maybe
// not taken by the speaker now. It is offered unticked with that clause,
// never dropped: she may still take it. Rules on closed word lists
// (sentence-words.ts), no language model.
import { normalize } from './normalize.js';
import {
  AGO_TIME_WORDS,
  CLAUSE_JOIN_WORDS,
  CLAUSE_RESET_WORDS,
  HEALTH_WORKER_WORDS,
  IMPERSONAL_AFTER_IL,
  LAST_WORDS,
  PAST_STATE_WORDS,
  PAST_TIME_WORDS,
  PAST_WOLOF_WORDS,
  PREVIOUS_WORDS,
  SPEAKER_OBJECT_WORDS,
  TELLING_WORDS,
  THIRD_PERSON_WORDS,
  NEGATION_PARTICLES,
  NEGATION_WORDS,
  NEXT_NAME_NEGATION_WORDS,
  OTHER_PERSON_WORDS,
  PAST_WORDS,
  PERSON_ADJECTIVES,
  PERSON_WORDS,
  POSSESSIVE_WORDS,
  SPEAKER_WORDS,
  SUBJECT_WORDS,
  VERB_WORDS,
  WOLOF_DU_NEXT,
  WOLOF_NEGATIVE_ENDINGS,
} from './sentence-words.js';

/** Why a product is maybe not taken by the speaker now. */
export type ClauseReason = 'negation' | 'other-person' | 'past' | 'advice';

/** A word of the sentence: normalised, and whether punctuation stands before it. */
export interface ClauseWord {
  norm: string;
  boundary: boolean;
}

/** The words of a product found, from the first to the last (its strength included). */
export interface NamedWords {
  first: number;
  last: number;
}

/** The reason, and the words of the sentence that say it (first to last). */
export interface ClauseMark {
  reason: ClauseReason;
  first: number;
  last: number;
}

const setOf = (words: readonly string[]): ReadonlySet<string> => new Set(words.map(normalize));
const NEGATIONS = setOf(NEGATION_WORDS);
const DU_NEXT = setOf(WOLOF_DU_NEXT);
const NEXT_NAME_NEGATIONS = setOf(NEXT_NAME_NEGATION_WORDS);
const PARTICLES = setOf(NEGATION_PARTICLES);
const NEGATIVE_ENDINGS = WOLOF_NEGATIVE_ENDINGS.map(normalize);
const PAST = setOf(PAST_WORDS);
const POSSESSIVES = setOf(POSSESSIVE_WORDS);
const ADJECTIVES = setOf(PERSON_ADJECTIVES);
const PEOPLE = setOf(PERSON_WORDS);
const OTHER_PEOPLE = setOf(OTHER_PERSON_WORDS);
const SPEAKER = setOf(SPEAKER_WORDS);
const SUBJECTS = setOf(SUBJECT_WORDS);
const VERBS = setOf(VERB_WORDS);
const RESETS = setOf(CLAUSE_RESET_WORDS);
const JOINS = setOf(CLAUSE_JOIN_WORDS);
const QUE = setOf(['que', 'qu']);
const OTHER = setOf(['autre', 'autres']);
const PLUS = normalize('plus');
const PART = normalize('part');
const A = normalize('à');
const DU = normalize('du');
const ARTICLES = setOf(['le', 'la', 'les', 'l', 'un', 'une', 'de', 'd', 'du', 'des']);
const LAST = setOf(LAST_WORDS);
const PAST_TIMES = setOf(PAST_TIME_WORDS);
const AGO_TIMES = setOf(AGO_TIME_WORDS);
const PREVIOUS = setOf(PREVIOUS_WORDS);
const PAST_STATES = setOf(PAST_STATE_WORDS);
const PAST_WOLOF = setOf(PAST_WOLOF_WORDS);
const PREGNANCY = setOf(['grossesse', 'grossesses']);
const PREGNANT = normalize('enceinte');
const THIRD_PERSON = setOf(THIRD_PERSON_WORDS);
const IMPERSONAL = setOf(IMPERSONAL_AFTER_IL);
const IL = normalize('il');
const Y = normalize('y');
const TELLING = setOf(TELLING_WORDS);
const SPEAKER_OBJECT = setOf(SPEAKER_OBJECT_WORDS);
const HEALTH_WORKERS = setOf(HEALTH_WORKER_WORDS);
/** "il y a" and a time within this many words after it ("il y a trois mois"). */
const AGO_WITHIN = 3;
/** The reasons, the first one shown when a clause says several. */
const REASONS: readonly ClauseReason[] = ['past', 'negation', 'other-person', 'advice'];

/**
 * A past said by a time at word `at`: "dernier" next to a time ("l'an
 * dernier", "la dernière fois"), "il y a" and a time ("il y a trois mois"),
 * "première" next to "grossesse", "étais" before "enceinte", Wolof "weesu"
 * or "daaw".
 */
function pastTimeAt(words: readonly ClauseWord[], at: number): boolean {
  const word = words[at]?.norm ?? '';
  const before = words[at - 1]?.norm ?? '';
  const next = words[at + 1]?.norm ?? '';
  if (PAST_WOLOF.has(word)) return true;
  if (LAST.has(word) && (PAST_TIMES.has(before) || PAST_TIMES.has(next))) return true;
  if (PREVIOUS.has(word) && (PREGNANCY.has(before) || PREGNANCY.has(next))) return true;
  if (PAST_STATES.has(word) && next === PREGNANT) return true;
  if (word === IL && next === Y && words[at + 2]?.norm === A) {
    for (let ahead = at + 3; ahead < at + 3 + AGO_WITHIN; ahead += 1) {
      if (AGO_TIMES.has(words[ahead]?.norm ?? '')) return true;
    }
  }
  return false;
}

/** A Wolof verb said in the negative: a verb of VERB_WORDS with a negative ending ("naanuma", "jëlul"). */
function wolofNegative(word: string): boolean {
  return NEGATIVE_ENDINGS.some((ending) => {
    if (!word.endsWith(ending) || word.length <= ending.length) return false;
    const stem = word.slice(0, -ending.length);
    // "jëfandikoowuma": a glide may join the stem and the ending.
    return VERBS.has(stem) || (stem.endsWith('w') && VERBS.has(stem.slice(0, -1)));
  });
}

/** How word `at` starts a clause: stopping what the one before said, going on from it, or not at all. */
function clauseStart(
  words: readonly ClauseWord[],
  inName: readonly boolean[],
  at: number,
): 'reset' | 'join' | undefined {
  const word = words[at];
  if (word === undefined) return undefined;
  if (inName[at] === true) return word.boundary ? 'join' : undefined;
  const before = words[at - 1]?.norm ?? '';
  if (
    RESETS.has(word.norm) ||
    (word.norm === PART && before === A) ||
    (QUE.has(word.norm) && OTHER.has(before))
  ) {
    return 'reset';
  }
  if (word.boundary || JOINS.has(word.norm)) return 'join';
  return undefined;
}

/** A person after a possessive, an adjective aside ("mon mari", "ma petite soeur", "sama doom"). */
function personAfter(words: readonly ClauseWord[], at: number): boolean {
  const next = words[at + 1]?.norm;
  if (next === undefined) return false;
  if (PEOPLE.has(next)) return true;
  return ADJECTIVES.has(next) && PEOPLE.has(words[at + 2]?.norm ?? '');
}

interface Clause {
  first: number;
  last: number;
  reasons: Set<ClauseReason>;
  /** A subject or a verb of its own. */
  own: boolean;
  /** Another person is named in it ("ma mère", "sama doom"). */
  person: boolean;
  /** A third-person pronoun ("elle", "lui", "dafay") without the speaker named. */
  pronoun: boolean;
  /** The first word shown with a product of this clause. */
  from: number;
}

/** What the words first to last of one clause say, words of a name aside. */
function reasonsOf(
  words: readonly ClauseWord[],
  inName: readonly boolean[],
  first: number,
  last: number,
): { reasons: Set<ClauseReason>; own: boolean; person: boolean; pronoun: boolean } {
  const reasons = new Set<ClauseReason>();
  let own = false;
  let particle = false;
  let restrictive = false;
  let negated = false;
  let otherPerson = false;
  let speaker = false;
  let pronoun = false;
  let telling = false;
  let toSpeaker = false;
  let healthWorker = false;
  for (let at = first; at <= last; at += 1) {
    const word = words[at]?.norm;
    if (word === undefined || inName[at] === true) continue;
    const next = words[at + 1]?.norm ?? '';
    if (SUBJECTS.has(word) || VERBS.has(word)) own = true;
    if (pastTimeAt(words, at)) reasons.add('past');
    if (THIRD_PERSON.has(word) && !(word === IL && IMPERSONAL.has(next))) pronoun = true;
    if (TELLING.has(word)) telling = true;
    if (HEALTH_WORKERS.has(word)) healthWorker = true;
    if (SPEAKER_OBJECT.has(word) && !personAfter(words, at)) toSpeaker = true;
    if (
      NEGATIONS.has(word) ||
      wolofNegative(word) ||
      (word === DU && (DU_NEXT.has(next) || VERBS.has(next)))
    ) {
      negated = true;
    }
    if (PARTICLES.has(word)) particle = true;
    else if (particle && QUE.has(word)) restrictive = true;
    if (PAST.has(word) || (particle && word === PLUS)) reasons.add('past');
    if ((POSSESSIVES.has(word) && personAfter(words, at)) || OTHER_PEOPLE.has(word)) {
      otherPerson = true;
    } else if (SPEAKER.has(word)) {
      speaker = true;
    }
  }
  // "je ne prends que du fer" is "only", not a negation.
  if (negated || (particle && !restrictive)) reasons.add('negation');
  if (otherPerson && !speaker) reasons.add('other-person');
  // Someone told her of it ("ma voisine m'a parlé du cytotec"), not a health worker.
  if (telling && toSpeaker && !healthWorker) reasons.add('advice');
  return { reasons, own, person: otherPerson, pronoun: pronoun && !speaker };
}

/** The first word of a clause shown: without the word that starts it ("mais", "et"). */
function shownFrom(
  words: readonly ClauseWord[],
  inName: readonly boolean[],
  clause: Clause,
): number {
  const word = words[clause.first];
  if (word === undefined || inName[clause.first] === true || clause.first === clause.last) {
    return clause.first;
  }
  const starts =
    RESETS.has(word.norm) || JOINS.has(word.norm) || word.norm === PART || QUE.has(word.norm);
  return starts ? clause.first + 1 : clause.first;
}

/**
 * For each product found (`named`, in any order), the clause that says it is
 * maybe not taken by the speaker now, or undefined. The sentence is cut into
 * clauses at punctuation and at "mais", "waaye", "et", "ak", "puis",
 * "maintenant", "léegi", "sauf" (CLAUSE_RESET_WORDS, CLAUSE_JOIN_WORDS); a
 * clause says a product is not taken with a negation (NEGATION_WORDS, "ne"
 * unless "que" follows, a Wolof verb in the negative), another person after a
 * possessive (PERSON_WORDS) unless the speaker is named too ("m'a donné",
 * "et moi"), or a past use (PAST_WORDS, "ne ... plus"). A clause started by
 * "et", "ak" or punctuation, with no subject or verb of its own, goes on from
 * the clause before ("mon mari prend du coartem et du fer"). "sans" and "ni"
 * negate only the name right after them ("sans paracétamol"). The words of a
 * name are never read as such words ("LAROSCORBINE SANS SUCRE").
 */
export function clauseMarks(
  words: readonly ClauseWord[],
  named: readonly NamedWords[],
): (ClauseMark | undefined)[] {
  const inName = words.map(() => false);
  for (const { first, last } of named) {
    for (let at = first; at <= last; at += 1) inName[at] = true;
  }
  const clauses: Clause[] = [];
  // Where the last other person was named ("c'est pour ma mère"), shown from there.
  let personFrom: number | undefined;
  const close = (first: number, last: number, start: 'reset' | 'join') => {
    const { reasons, own, person, pronoun } = reasonsOf(words, inName, first, last);
    const clause: Clause = { first, last, reasons, own, person, pronoun, from: first };
    clause.from = shownFrom(words, inName, clause);
    const before = clauses.at(-1);
    // Words with no subject or verb of their own go on from the clause before.
    if (start === 'join' && !own && before !== undefined && before.reasons.size > 0) {
      // Shown from the clause that says it when this one says nothing itself.
      if (reasons.size === 0) clause.from = before.from;
      for (const reason of before.reasons) clause.reasons.add(reason);
    }
    // Round 2 of the review of #68: a pronoun for the person named before
    // ("..., elle prend", "..., je lui donne", "..., dafay naan").
    if (!person && pronoun && personFrom !== undefined && !clause.reasons.has('other-person')) {
      if (clause.reasons.size === 0) clause.from = personFrom;
      clause.reasons.add('other-person');
    }
    if (person) personFrom = clause.from;
    clauses.push(clause);
  };
  let first = 0;
  let start: 'reset' | 'join' = 'reset';
  for (let at = 1; at < words.length; at += 1) {
    const kind = clauseStart(words, inName, at);
    if (kind === undefined) continue;
    close(first, at - 1, start);
    first = at;
    start = kind;
  }
  if (words.length > 0) close(first, words.length - 1, start);

  return named.map((name) => {
    const clause = clauses.find((each) => each.first <= name.first && name.first <= each.last);
    if (clause === undefined) return undefined;
    const reason = REASONS.find((each) => clause.reasons.has(each));
    if (reason !== undefined) return { reason, first: clause.from, last: clause.last };
    // "sans paracétamol", "ni de l'ibuprofène": the name right after, articles aside.
    let at = name.first - 1;
    while (at > clause.first && ARTICLES.has(words[at]?.norm ?? '') && inName[at] !== true) {
      at -= 1;
    }
    const before = words[at];
    if (at >= clause.first && before !== undefined && NEXT_NAME_NEGATIONS.has(before.norm)) {
      return { reason: 'negation', first: at, last: name.last };
    }
    return undefined;
  });
}
