// SPDX-License-Identifier: MIT
// Word error rate for the voice evaluation: normalisation, then the edit
// distance between the reference and the hypothesis split into substitutions,
// deletions and insertions.

export interface ErrorCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
}

/**
 * Lowercase, accents kept (French and Wolof letters are letters), punctuation
 * removed; an apostrophe breaks a word, as in `speech/convert/quick_check.py`
 * so the figures stay comparable.
 */
export function normalise(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]|_/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word !== '');
}

/** Errors between two texts (normalised here), by the minimum edit distance. */
export function wordErrors(reference: string, hypothesis: string): ErrorCounts {
  const ref = normalise(reference);
  const hyp = normalise(hypothesis);
  // cost[i][j]: distance between the first i reference words and the first j hypothesis words.
  const cost: number[][] = Array.from({ length: ref.length + 1 }, (_, i) =>
    Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number): number => cost[i]?.[j] ?? 0;
  for (let i = 1; i <= ref.length; i += 1) {
    for (let j = 1; j <= hyp.length; j += 1) {
      const same = ref[i - 1] === hyp[j - 1];
      const row = cost[i];
      if (row !== undefined) {
        row[j] = Math.min(at(i - 1, j - 1) + (same ? 0 : 1), at(i - 1, j) + 1, at(i, j - 1) + 1);
      }
    }
  }
  const counts: ErrorCounts = {
    substitutions: 0,
    deletions: 0,
    insertions: 0,
    referenceWords: ref.length,
  };
  let i = ref.length;
  let j = hyp.length;
  while (i > 0 || j > 0) {
    const here = at(i, j);
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && here === at(i - 1, j - 1)) {
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && here === at(i - 1, j - 1) + 1) {
      counts.substitutions += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && here === at(i - 1, j) + 1) {
      counts.deletions += 1;
      i -= 1;
    } else {
      counts.insertions += 1;
      j -= 1;
    }
  }
  return counts;
}

/** (S + D + I) / N, or null when the reference has no word (the rate is undefined). */
export function errorRate(counts: ErrorCounts): number | null {
  if (counts.referenceWords === 0) return null;
  return (counts.substitutions + counts.deletions + counts.insertions) / counts.referenceWords;
}

/** Corpus totals: the rate of a set weighs every reference word equally. */
export function addCounts(all: readonly ErrorCounts[]): ErrorCounts {
  return all.reduce<ErrorCounts>(
    (sum, counts) => ({
      substitutions: sum.substitutions + counts.substitutions,
      deletions: sum.deletions + counts.deletions,
      insertions: sum.insertions + counts.insertions,
      referenceWords: sum.referenceWords + counts.referenceWords,
    }),
    { substitutions: 0, deletions: 0, insertions: 0, referenceWords: 0 },
  );
}
