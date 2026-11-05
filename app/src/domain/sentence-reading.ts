// SPDX-License-Identifier: MIT
// When the search screen reads the products named inside a sentence
// (SCRUM-61, team feedback of 2026-11-05: "si l'utilisatrice dit une phrase
// contenant le nom du médicament, il n'y a pas de suggestion"). The resolver
// finds them (productsInSentence); this says when the screen offers them, as
// a list to tick, in place of the candidates of the whole text. Nothing is
// added from here: each product ticked is confirmed on its confirm screen.
import {
  plainText,
  productsInSentence,
  search,
  type EntryKind,
  type ResolverIndex,
  type SentenceProduct,
} from '@siapso/resolver';

/** A typed text is read as a sentence from this many words. */
export const SENTENCE_TYPED_WORDS = 3;

/**
 * The products a sentence names, when the search offers them instead of the
 * candidates of the whole text, or null: what the voice heard, when the whole
 * text has no candidate in the list searched or the sentence names several
 * products; a typed text the same way from 3 words (a name of one or two
 * words stays the search's). Null when the sentence names no product clearly.
 */
export function sentenceReadingOf(
  index: ResolverIndex,
  text: string,
  kind: EntryKind,
  source: 'voice' | 'typed',
): SentenceProduct[] | null {
  const words = plainText(text).split(' ').filter(Boolean).length;
  if (words === 0 || (source === 'typed' && words < SENTENCE_TYPED_WORDS)) return null;
  const products = productsInSentence(index, text);
  if (products.length === 0) return null;
  if (products.length > 1) return products;
  return search(index, text, { kinds: [kind] }).length === 0 ? products : null;
}
