// SPDX-License-Identifier: MIT
// The names given to the French decoder (config/voice.ts) may come back on
// their own when nobody speaks: Whisper writes its previous text again over
// silence or noise (review of #68). A recording too quiet is not transcribed
// (nothing heard), a faint one is transcribed without the names, and a
// transcript that repeats the names in their order is read as nothing heard.
import { normalize } from '@siapso/resolver';

/** The sample rate of a recording (SPEECH_SAMPLE_RATE of @siapso/speech). */
const SAMPLE_RATE = 16_000;
/** Loudness is read on windows of this many seconds: a short word counts whole. */
const WINDOW_SECONDS = 0.1;

/**
 * Below this loudness (RMS of the loudest tenth of a second, about -50 dBFS)
 * a recording holds no speech: nothing is heard, and it is not transcribed.
 * Measured on 2026-11-06 (docs/voice.md): the 80 synthetic clips of the audio
 * check are at 0.11 or more (-19 dBFS), white noise of -60 dBFS at 0.001. To
 * measure again with real voices and phones (SCRUM-32).
 */
export const VOICE_SILENT_RMS = 0.003;

/** Below this loudness (about -40 dBFS) the decoder is not given the names. */
export const VOICE_CONTEXT_MIN_RMS = 0.01;

/** The RMS of the loudest window of a tenth of a second (of the whole recording when shorter). */
export function loudestRms(samples: Float32Array, sampleRate: number = SAMPLE_RATE): number {
  if (samples.length === 0) return 0;
  const size = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  if (samples.length <= size)
    return Math.sqrt(sumOfSquares(samples, 0, samples.length) / samples.length);
  const step = Math.max(1, Math.round(size / 2));
  let loudest = 0;
  for (let start = 0; start + size <= samples.length; start += step) {
    loudest = Math.max(loudest, sumOfSquares(samples, start, start + size));
  }
  return Math.sqrt(loudest / size);
}

function sumOfSquares(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let at = from; at < to; at += 1) {
    const value = samples[at] ?? 0;
    sum += value * value;
  }
  return sum;
}

/** What a recording holds, by its loudness: no speech, faint speech, or speech. */
export function voiceGate(samples: Float32Array): 'silent' | 'faint' | 'speech' {
  const loudness = loudestRms(samples);
  if (loudness < VOICE_SILENT_RMS) return 'silent';
  return loudness < VOICE_CONTEXT_MIN_RMS ? 'faint' : 'speech';
}

/** Three names of the prompt said one after the other as in the prompt: its echo. */
const ECHO_NAMES = 3;
/** Four words of the prompt one after the other as in the prompt: its echo. */
const ECHO_WORDS = 4;

const wordsOf = (text: string): string[] => normalize(text).split(' ').filter(Boolean);

/**
 * Whether a transcript repeats the names given to the decoder (`prompt`, names
 * separated by commas): 3 names or more that follow each other in the prompt,
 * said one after the other with no other word between ("Doliprane,
 * paracétamol, Efferalgan"), or 4 words or more of the prompt in its order.
 * Names said as a sentence says them ("du coartem, de l'advil") are not.
 */
export function isPromptEcho(transcript: string, prompt: string): boolean {
  const heard = wordsOf(transcript);
  if (heard.length === 0) return false;
  const promptWords = wordsOf(prompt);
  // A run of words of the prompt, in its order.
  for (let start = 0; start < heard.length; start += 1) {
    for (let from = 0; from < promptWords.length; from += 1) {
      let length = 0;
      while (
        start + length < heard.length &&
        from + length < promptWords.length &&
        heard[start + length] === promptWords[from + length]
      ) {
        length += 1;
      }
      if (length >= ECHO_WORDS) return true;
    }
  }
  // Names that follow each other in the prompt, one after the other.
  const names = prompt
    .split(/[,.]/u)
    .map(wordsOf)
    .filter((words) => words.length > 0);
  const nameAt = (at: number, index: number): number | undefined => {
    const words = names[index];
    if (words === undefined) return undefined;
    return words.every((word, offset) => heard[at + offset] === word)
      ? at + words.length
      : undefined;
  };
  for (let start = 0; start < heard.length; start += 1) {
    for (let first = 0; first < names.length; first += 1) {
      let at = start;
      let count = 0;
      for (let next = nameAt(at, first); next !== undefined; next = nameAt(at, first + count)) {
        count += 1;
        at = next;
      }
      if (count >= ECHO_NAMES) return true;
    }
  }
  return false;
}
