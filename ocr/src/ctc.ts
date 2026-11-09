// SPDX-License-Identifier: MIT
// The recognition model's output to text: greedy CTC decoding (PaddleOCR's
// CTCLabelDecode), the best class at each step, blanks and repeats dropped.
// Pure.

/**
 * The classes of the recognition model: blank, then the characters of its
 * dictionary (`character_dict` of inference.yml, 836 for the Latin model),
 * then a space (PaddleOCR's `use_space_char`).
 */
export function recognitionAlphabet(characters: readonly string[]): string[] {
  return ['', ...characters, ' '];
}

export interface Recognised {
  text: string;
  /** The mean probability of the characters kept, 0 for none. */
  confidence: number;
}

/**
 * Decodes `steps` x `classes` probabilities (row by row, from `offset`):
 * the best class at each step, a blank (class 0) or a repeat of the class
 * before dropped. The text is trimmed.
 */
export function ctcGreedyDecode(
  data: Float32Array,
  steps: number,
  classes: number,
  alphabet: readonly string[],
  offset = 0,
): Recognised {
  let text = '';
  let last = 0;
  let sum = 0;
  let kept = 0;
  for (let t = 0; t < steps; t++) {
    const row = offset + t * classes;
    let best = 0;
    let value = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = data[row + c] ?? -Infinity;
      if (v > value) {
        value = v;
        best = c;
      }
    }
    if (best !== 0 && best !== last) {
      text += alphabet[best] ?? '';
      sum += value;
      kept += 1;
    }
    last = best;
  }
  return { text: text.trim(), confidence: kept === 0 ? 0 : sum / kept };
}
