// SPDX-License-Identifier: MIT
/**
 * The set of character trigrams of a text, padded with two spaces before and
 * one after so that the first and the last letters weigh in. Empty for an
 * empty text.
 */
export function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  if (text === '') return result;
  const padded = `  ${text} `;
  for (let start = 0; start + 3 <= padded.length; start += 1) {
    result.add(padded.slice(start, start + 3));
  }
  return result;
}

/** Jaccard similarity of two sets, 0 when both are empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const item of small) if (large.has(item)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}
