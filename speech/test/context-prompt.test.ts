// SPDX-License-Identifier: MIT
// The words said before the speech that a Whisper decoder may be given (its
// "previous text"), here the names of the base (SCRUM-61): built before the
// language prompt, and never part of the text heard.
import { describe, expect, it } from 'vitest';
import {
  decoderInputWithContext,
  generatedTokens,
  MAX_CONTEXT_TOKENS,
} from '../src/context-prompt.js';

const START_OF_PREV = 50361;
const FRENCH = [50258, 50265, 50359, 50363];

describe('decoderInputWithContext', () => {
  it('puts the context after <|startofprev|>, before the language prompt', () => {
    expect(decoderInputWithContext(FRENCH, [11, 12, 13], START_OF_PREV)).toEqual([
      START_OF_PREV,
      11,
      12,
      13,
      ...FRENCH,
    ]);
  });

  it('keeps the last tokens of a context too long, as Whisper does', () => {
    const long = Array.from({ length: MAX_CONTEXT_TOKENS + 5 }, (_, at) => at);
    const input = decoderInputWithContext(FRENCH, long, START_OF_PREV);
    expect(input).toHaveLength(1 + MAX_CONTEXT_TOKENS + FRENCH.length);
    expect(input[1]).toBe(5);
  });

  it('is the language prompt alone without a context', () => {
    expect(decoderInputWithContext(FRENCH, [], START_OF_PREV)).toEqual(FRENCH);
  });
});

describe('generatedTokens', () => {
  it('drops the decoder input from the sequence generated, numbers or big integers', () => {
    expect(generatedTokens([1n, 2n, 3n, 40n, 41n], 3)).toEqual([40, 41]);
    expect(generatedTokens([1, 2], 2)).toEqual([]);
  });
});
