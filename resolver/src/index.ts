// SPDX-License-Identifier: MIT
export { damerauLevenshtein } from './distance.js';
export { entriesFromPack, productFamily } from './from-pack.js';
export type { PackNames } from './from-pack.js';
export { buildIndex } from './index-build.js';
export {
  AGE_WORDS,
  formWords,
  normalize,
  plainText,
  SALT_WORDS,
  splitAgeWords,
  STOP_WORDS,
  withoutStopWords,
} from './normalize.js';
export { parseStrength } from './strength.js';
export type { ParsedQuery } from './strength.js';
export {
  DEFAULT_LIMIT,
  DEFAULT_MIN_SCORE,
  DEFAULT_RELATIVE_CUTOFF,
  namedSubstances,
  queryMentions,
  search,
} from './search.js';
export { trigrams } from './trigrams.js';
export type {
  Candidate,
  EntryKind,
  IndexEntry,
  MatchKind,
  Mention,
  NameLang,
  ResolverIndex,
  SearchOptions,
  WeakWord,
} from './types.js';
