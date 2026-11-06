// SPDX-License-Identifier: MIT
// The clause of a product named inside a sentence (review of #68): a product
// said with a negation ("mais pas de cytotec", "duma naan cytotec"), by or
// for another person ("mon mari prend du coartem", "sama jëkkër dafay naan"),
// or as a past use ("avant je prenais de la nivaquine", "bàyyi naa") is maybe
// not taken by the speaker now. It is offered unticked with that clause,
// never dropped: she may still take it. Rules on closed word lists
// (sentence-words.ts), no language model.
import { normalize, plainText } from './normalize.js';
import {
  AGO_TIME_WORDS,
  AUXILIARY_WORDS,
  CLAUSE_JOIN_WORDS,
  CLAUSE_REASON_WORDS,
  CLAUSE_RESET_WORDS,
  OBJECT_PRONOUN_WORDS,
  ONGOING_WORDS,
  OTHER_VERB_WORDS,
  STOP_VERB_WORDS,
  TAKING_VERB_WORDS,
  WOLOF_VERB_WORDS,
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

/** A word of the sentence: as written (plainText), normalised, and whether punctuation stands before it. */
export interface ClauseWord {
  plain: string;
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
// Compared as written: normalised, Wolof "ci" (in) would read as French "si".
const REASON_STARTS: ReadonlySet<string> = new Set(CLAUSE_REASON_WORDS.map(plainText));
const POUR = plainText('pour');
const TAKING = setOf(TAKING_VERB_WORDS);
const OTHER_VERBS = setOf(OTHER_VERB_WORDS);
const STOPS = setOf(STOP_VERB_WORDS);
const AUXILIARIES = setOf(AUXILIARY_WORDS);
const OBJECT_PRONOUNS = setOf(OBJECT_PRONOUN_WORDS);
const ONGOING = setOf(ONGOING_WORDS);
const WOLOF_VERBS = setOf(WOLOF_VERB_WORDS);
const AVANT = normalize('avant');
/** The French words of a negation; the other NEGATION_WORDS are Wolof ("duma", "amul"). */
const FRENCH_NEGATIONS = setOf(['pas', 'jamais', 'rien', 'aucun', 'aucune']);
const WOLOF_NEGATIONS = new Set([...NEGATIONS].filter((word) => !FRENCH_NEGATIONS.has(word)));
/** The words that close "ne ...": "ne prends pas", "n'ai jamais", "ne prends plus". */
const NEG_ADVERBS = setOf(['pas', 'jamais', 'plus', 'rien', 'point', 'aucun', 'aucune']);
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

/**
 * The verb of a Wolof verb said in the negative, a verb of VERB_WORDS with a
 * negative ending ("naanuma": naan, "jëlul": jël, "xamuma": xam), or undefined.
 */
function wolofNegativeStem(word: string): string | undefined {
  for (const ending of NEGATIVE_ENDINGS) {
    if (!word.endsWith(ending) || word.length <= ending.length) continue;
    const stem = word.slice(0, -ending.length);
    if (VERBS.has(stem)) return stem;
    // "jëfandikoowuma": a glide may join the stem and the ending.
    if (stem.endsWith('w') && VERBS.has(stem.slice(0, -1))) return stem.slice(0, -1);
  }
  return undefined;
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
    REASON_STARTS.has(word.plain) ||
    (word.norm === PART && before === A) ||
    (QUE.has(word.norm) && OTHER.has(before))
  ) {
    return 'reset';
  }
  if (word.boundary || JOINS.has(word.norm)) return 'join';
  return undefined;
}

/**
 * Whether a subject and its verb start at word `at` ("je prends", "j'ai
 * pris", "dama naan"), object pronouns and "ne" aside: for voice, a clause
 * that already names a product and has its verb ends there, even with no
 * punctuation (round 3 of the review of #68).
 */
function subjectAndVerbAt(words: readonly ClauseWord[], at: number): boolean {
  if (!SUBJECTS.has(words[at]?.norm ?? '')) return false;
  let next = at + 1;
  while (PARTICLES.has(words[next]?.norm ?? '') || OBJECT_PRONOUNS.has(words[next]?.norm ?? '')) {
    next += 1;
  }
  return VERBS.has(words[next]?.norm ?? '');
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
  /** The last word shown, when a clause after it says whose it is ("pour mon fils"). */
  shownLast?: number;
}

/**
 * The negations of one clause (round 3 of the review of #68): a negation
 * counts unless the verb it negates is not one of taking ("le coartem ne
 * marche pas", "xamuma"), and a verb that stops a use, negated, says the use
 * goes on ("je n'arrête pas", "je n'ai pas fini"). "ne ... que" is "only".
 */
function negationsOf(
  words: readonly ClauseWord[],
  inName: readonly boolean[],
  first: number,
  last: number,
): { counts: boolean; plus: boolean; stopsNegated: Set<number> } {
  const word = (at: number): string =>
    at >= first && at <= last && inName[at] !== true ? (words[at]?.norm ?? '') : '';
  const stopsNegated = new Set<number>();
  let counts = false;
  let plus = false;
  /** The verb a negation at `at` applies to, from word `from` on, pronouns aside; -1 for none. */
  const verbFrom = (from: number): number => {
    let at = from;
    while (OBJECT_PRONOUNS.has(word(at))) at += 1;
    return word(at) === '' ? -1 : at;
  };
  /** After an auxiliary, the past participle negated ("n'ai pas pris"); else the auxiliary. */
  const participleAfter = (aux: number): number => {
    for (let at = aux + 1; at <= aux + 2; at += 1) {
      if (!NEG_ADVERBS.has(word(at))) continue;
      const next = at + 1;
      const verb = word(next);
      return VERBS.has(verb) || OTHER_VERBS.has(verb) || STOPS.has(verb) || TAKING.has(verb)
        ? next
        : aux;
    }
    return aux;
  };
  /** Whether a negation of the verb at `verb` says the product is not taken. */
  const judge = (verb: number) => {
    const norm = verb < 0 ? '' : word(verb);
    if (STOPS.has(norm)) {
      stopsNegated.add(verb);
      return;
    }
    if (OTHER_VERBS.has(norm)) return;
    counts = true;
  };
  const particles: number[] = [];
  for (let at = first; at <= last; at += 1) if (PARTICLES.has(word(at))) particles.push(at);
  for (const at of particles) {
    // "je ne prends que du fer": "only", unless a negation word says otherwise.
    let adverb = false;
    let que = false;
    for (let after = at + 1; after <= last; after += 1) {
      if (NEG_ADVERBS.has(word(after))) adverb = true;
      if (QUE.has(word(after))) que = true;
      if (word(after) === PLUS) plus = true;
    }
    if (que && !adverb) continue;
    let verb = verbFrom(at + 1);
    // "ne pas prendre": the infinitive after the negation word.
    if (verb >= 0 && NEG_ADVERBS.has(word(verb))) verb = verbFrom(verb + 1);
    else if (verb >= 0 && AUXILIARIES.has(word(verb))) verb = participleAfter(verb);
    judge(verb);
  }
  for (let at = first; at <= last; at += 1) {
    const here = word(at);
    const next = words[at + 1]?.norm ?? '';
    if (particles.length === 0 && FRENCH_NEGATIONS.has(here)) {
      // Spoken without "ne": "j'ai pas pris", "ça marche pas", "pas de cytotec".
      const before = word(at - 1);
      if (AUXILIARIES.has(before)) judge(participleAfter(at - 1));
      else if (VERBS.has(before) || OTHER_VERBS.has(before) || STOPS.has(before)) judge(at - 1);
      else judge(-1);
    } else if (WOLOF_NEGATIONS.has(here)) {
      judge(verbFrom(at + 1));
    } else if (here === DU && (DU_NEXT.has(next) || WOLOF_VERBS.has(next))) {
      // Round 3: never before a French verb ("j'ai dû prendre").
      judge(verbFrom(at + 1));
    } else {
      // "naanuma", "jëlul"; not "xamuma" (I do not know): the stem is the verb.
      const stem = wolofNegativeStem(here);
      if (stem !== undefined && !OTHER_VERBS.has(stem)) counts = true;
    }
  }
  return { counts, plus: plus && counts, stopsNegated };
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
  let otherPerson = false;
  let speaker = false;
  let pronoun = false;
  let telling = false;
  let toSpeaker = false;
  let healthWorker = false;
  let ongoing = false;
  let timePast = false;
  const word = (at: number): string =>
    at >= first && at <= last && inName[at] !== true ? (words[at]?.norm ?? '') : '';
  const negation = negationsOf(words, inName, first, last);
  for (let at = first; at <= last; at += 1) {
    const here = word(at);
    if (here === '') continue;
    const next = words[at + 1]?.norm ?? '';
    if (SUBJECTS.has(here) || VERBS.has(here)) own = true;
    if (ONGOING.has(here)) ongoing = true;
    if (pastTimeAt(words, at)) timePast = true;
    if (THIRD_PERSON.has(here) && !(here === IL && IMPERSONAL.has(next))) pronoun = true;
    if (TELLING.has(here)) telling = true;
    if (HEALTH_WORKERS.has(here)) healthWorker = true;
    if (SPEAKER_OBJECT.has(here) && !personAfter(words, at)) toSpeaker = true;
    // Round 3: "avant" is a past only before a subject ("avant je prenais"),
    // not "avant le repas", "avant de manger"; a stop negated is no past.
    const past =
      PAST.has(here) && !negation.stopsNegated.has(at) && (here !== AVANT || SUBJECTS.has(next));
    if (past || (negation.counts && negation.plus)) reasons.add('past');
    if ((POSSESSIVES.has(here) && personAfter(words, at)) || OTHER_PEOPLE.has(here)) {
      otherPerson = true;
    } else if (SPEAKER.has(here)) {
      speaker = true;
    }
  }
  // A time said with "depuis" or "commencé" is when the use began.
  if (timePast && !ongoing) reasons.add('past');
  if (negation.counts) reasons.add('negation');
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
  // A word of a reason or a time stays shown: "pour ma mère", "quand j'étais enceinte".
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
    // Round 3: "pour" and another person says the product before is that
    // person's ("je prends du doliprane pour mon fils").
    if (
      words[first]?.plain === POUR &&
      clause.reasons.has('other-person') &&
      before !== undefined &&
      !before.reasons.has('other-person')
    ) {
      before.reasons.add('other-person');
      before.shownLast = last;
    }
    clauses.push(clause);
  };
  let first = 0;
  let start: 'reset' | 'join' = 'reset';
  // Whether the clause so far names a product and has a verb of its own.
  let hasName = false;
  let hasVerb = false;
  for (let at = 1; at < words.length; at += 1) {
    if (inName[at - 1] === true) hasName = true;
    else if (VERBS.has(words[at - 1]?.norm ?? '')) hasVerb = true;
    let kind = clauseStart(words, inName, at);
    if (kind === undefined && hasName && hasVerb && subjectAndVerbAt(words, at)) kind = 'join';
    if (kind === undefined) continue;
    close(first, at - 1, start);
    first = at;
    start = kind;
    hasName = false;
    hasVerb = false;
  }
  if (words.length > 0) close(first, words.length - 1, start);

  return named.map((name) => {
    const clause = clauses.find((each) => each.first <= name.first && name.first <= each.last);
    if (clause === undefined) return undefined;
    const reason = REASONS.find((each) => clause.reasons.has(each));
    if (reason !== undefined) {
      return { reason, first: clause.from, last: clause.shownLast ?? clause.last };
    }
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
