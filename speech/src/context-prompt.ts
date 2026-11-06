// SPDX-License-Identifier: MIT
// The words said before the speech that a Whisper decoder can be given, its
// "previous text" (<|startofprev|> then the words, before the language
// prompt): here the names of the base, so that the model writes a name it
// hears as the name (SCRUM-61). Transformers.js 4.3.1 has no `prompt_ids`
// option and its ASR pipeline would write these words in the text heard, so
// the worker builds the decoder input itself and keeps only the tokens
// generated after it.

/**
 * At most this many tokens of context: Whisper reads at most 448 tokens, of
 * which the language prompt and 96 new ones; the context keeps well within.
 */
export const MAX_CONTEXT_TOKENS = 100;

/**
 * The decoder input: <|startofprev|>, the context (its last tokens when it is
 * too long, as Whisper keeps the most recent words), then the language prompt;
 * the language prompt alone without a context.
 */
export function decoderInputWithContext(
  prompt: readonly number[],
  context: readonly number[],
  startOfPrev: number,
): number[] {
  if (context.length === 0) return [...prompt];
  return [startOfPrev, ...context.slice(-MAX_CONTEXT_TOKENS), ...prompt];
}

/** The tokens the model generated, without the decoder input it was given. */
export function generatedTokens(
  sequence: readonly (number | bigint)[],
  inputLength: number,
): number[] {
  return sequence.slice(inputLength).map(Number);
}
