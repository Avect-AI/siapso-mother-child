// SPDX-License-Identifier: MIT
export { damerauLevenshtein } from './distance.js';
export { entriesFromPack } from './from-pack.js';
export type { PackNames } from './from-pack.js';
export { buildIndex } from './index-build.js';
export { normalize } from './normalize.js';
export { parseStrength } from './strength.js';
export type { ParsedQuery } from './strength.js';
export { DEFAULT_LIMIT, DEFAULT_MIN_SCORE, search } from './search.js';
export { trigrams } from './trigrams.js';
export type {
  Candidate,
  EntryKind,
  IndexEntry,
  NameLang,
  ResolverIndex,
  SearchOptions,
} from './types.js';
