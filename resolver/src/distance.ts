// SPDX-License-Identifier: MIT
/**
 * Damerau-Levenshtein distance, optimal string alignment variant: insertion,
 * deletion, substitution and transposition of two adjacent characters each
 * cost 1, and no substring is edited twice.
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const width = b.length + 1;
  // Row-major matrix of (a.length + 1) x (b.length + 1) cells.
  const cells = new Array<number>(width * (a.length + 1)).fill(0);
  const cell = (row: number, column: number): number => cells[row * width + column] ?? 0;
  for (let i = 0; i <= a.length; i += 1) cells[i * width] = i;
  for (let j = 0; j <= b.length; j += 1) cells[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(cell(i - 1, j) + 1, cell(i, j - 1) + 1, cell(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, cell(i - 2, j - 2) + 1);
      }
      cells[i * width + j] = best;
    }
  }
  return cell(a.length, b.length);
}
