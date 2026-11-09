// SPDX-License-Identifier: MIT
import type { Candidate } from './types.js';

/**
 * How clearly a text names a candidate: `very-strong` (the whole name, a
 * whole word of it, its name inside a longer text, or a score of 0.9 or
 * more), `strong` (a score of 0.8 or more, or the whole name of 6 letters or
 * more spelt within one edit: "misopristol"), `weak` otherwise. A prefix of
 * fewer than 6 letters ("Anta", a first name), a spelling close to one word
 * of a longer name ("vitamines") and a whole word that names none of its
 * products alone (one the names of several families share, a laboratory,
 * "biogaran"; one that starts none of its names, a qualifier or a word of a
 * description, "chrono", "cutanée") are never more than weak. The safety net
 * of the result (a name kept as typed) and the reading of a sentence
 * (productsInSentence) weigh a candidate by it.
 */
export type MatchStrength = 'weak' | 'strong' | 'very-strong';

/** A prefix shorter than this (letters, spaces aside) is a weak resemblance. */
const SHORT_PREFIX = 6;
const STRONG_SCORE = 0.8;
const VERY_STRONG_SCORE = 0.9;

/** How clearly the text names the candidate (see MatchStrength). */
export function matchStrength(candidate: Candidate): MatchStrength {
  if (candidate.match === 'fuzzy-word') return 'weak';
  // One word that names none of the products alone: a laboratory many have
  // ("biogaran"), a qualifier after the brand or a word of a description
  // ("chrono", "cutanée"). A brand after a substance ("acnetrait") is not one.
  if (candidate.weakWord !== undefined) return 'weak';
  if (candidate.match === 'prefix' && candidate.queryLength < SHORT_PREFIX) return 'weak';
  if (candidate.match === 'contained' || candidate.score >= VERY_STRONG_SCORE) {
    return 'very-strong';
  }
  // The whole name of 6 letters or more spelt within one edit ("misopristol"): it says which name.
  if (candidate.match === 'near') return 'strong';
  return candidate.score >= STRONG_SCORE ? 'strong' : 'weak';
}
