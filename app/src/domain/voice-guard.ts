// SPDX-License-Identifier: MIT
// The names given to the French decoder (config/voice.ts) may come back on
// their own when nobody speaks: Whisper writes its previous text again over
// silence or noise (review of #68). A recording too quiet is not transcribed
// (nothing heard), a faint or steady one is transcribed without the names, and
// a transcript that repeats the names in their order is read as nothing heard.
import { normalize } from '@siapso/resolver';

/** The sample rate of a recording (SPEECH_SAMPLE_RATE of @siapso/speech). */
const SAMPLE_RATE = 16_000;
/** Loudness is read on windows of this many seconds: a short word counts whole. */
const WINDOW_SECONDS = 0.1;

/**
 * Below this loudness (RMS of the loudest tenth of a second, -60 dBFS) a
 * recording holds no speech: nothing is heard, and it is not transcribed.
 * Measured on 2026-11-06 (docs/voice.md): the 80 synthetic clips of the audio
 * check are at 0.11 or more (-19 dBFS), the 100 French FLEURS recordings (real
 * voices) at 0.0021 or more, white noise of -60 dBFS at 0.001. To measure
 * again with real voices and phones (SCRUM-32).
 */
export const VOICE_SILENT_RMS = 0.001;

/**
 * Below this loudness (-40 dBFS) the decoder is not given the names: 3 of the
 * 100 FLEURS recordings are, transcribed as before.
 */
export const VOICE_CONTEXT_MIN_RMS = 0.01;

/**
 * Under this ratio of the loudest window to the quietest tenth of the windows
 * a recording is a steady sound, with no word that starts or ends in it: it
 * is transcribed without the names. Measured on 2026-11-06 (docs/voice.md):
 * white and pink noise at 1.04 to 1.73 (heard as "Cytotec," with the names
 * given), the 100 FLEURS recordings at 15.7 or more, the 80 synthetic clips
 * over white or pink noise of -30 dBFS at 3.8 or more, over white noise of
 * -20 dBFS at 1.5 to 2.1 (then transcribed without the names).
 */
export const VOICE_STEADY_RATIO = 2;

/** The RMS of each window of a tenth of a second, windows overlapping by half (the whole recording when shorter). */
function windowRms(samples: Float32Array, sampleRate: number): number[] {
  if (samples.length === 0) return [];
  const size = Math.max(1, Math.round(sampleRate * WINDOW_SECONDS));
  if (samples.length <= size) {
    return [Math.sqrt(sumOfSquares(samples, 0, samples.length) / samples.length)];
  }
  const step = Math.max(1, Math.round(size / 2));
  const values: number[] = [];
  for (let start = 0; start + size <= samples.length; start += step) {
    values.push(Math.sqrt(sumOfSquares(samples, start, start + size) / size));
  }
  return values;
}

/** The RMS of the loudest window of a tenth of a second (of the whole recording when shorter). */
export function loudestRms(samples: Float32Array, sampleRate: number = SAMPLE_RATE): number {
  return Math.max(0, ...windowRms(samples, sampleRate));
}

function sumOfSquares(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let at = from; at < to; at += 1) {
    const value = samples[at] ?? 0;
    sum += value * value;
  }
  return sum;
}

/**
 * What a recording holds, by its loudness: no speech (`silent`: not
 * transcribed), faint speech or a steady sound (`plain`: transcribed without
 * the names), or speech.
 */
export function voiceGate(samples: Float32Array): 'silent' | 'plain' | 'speech' {
  const windows = windowRms(samples, SAMPLE_RATE);
  const loudness = Math.max(0, ...windows);
  if (loudness < VOICE_SILENT_RMS) return 'silent';
  if (loudness < VOICE_CONTEXT_MIN_RMS) return 'plain';
  const quiet = [...windows].sort((a, b) => a - b)[Math.floor(windows.length / 10)] ?? 0;
  return loudness < VOICE_STEADY_RATIO * quiet ? 'plain' : 'speech';
}

/** Three names of the prompt said one after the other as in the prompt: its echo. */
const ECHO_NAMES = 3;
/** Four words of the prompt one after the other as in the prompt: its echo. */
const ECHO_WORDS = 4;

const wordsOf = (text: string): string[] => normalize(text).split(' ').filter(Boolean);

/**
 * Whether a transcript repeats the names given to the decoder (`prompt`, names
 * separated by commas): words of the prompt only that end with a comma, as
 * its list goes on ("Cytotec,"), or a run of the prompt said in its order
 * with no other word between, of 3 names or more ("Doliprane, paracétamol,
 * Efferalgan") or of 4 words or more. Names said as a sentence says them
 * ("du coartem, de l'advil"), or a name said alone ("Cytotec."), are not.
 * Round 2 of the review of #68: nor is a run that is, whole names only, some
 * names of one of `clusters`, names said together in a clinic ("fer, acide
 * folique, SP"); a longer run, or one that holds other names of the prompt,
 * still is ("fer, acide folique, SP, Fansidar").
 */
export function isPromptEcho(
  transcript: string,
  prompt: string,
  clusters: readonly (readonly string[])[] = [],
): boolean {
  const heard = wordsOf(transcript);
  if (heard.length === 0) return false;
  const promptWords = wordsOf(prompt);
  // The list of the prompt going on: words of it only, ending with a comma
  // ("Cytotec,", heard so over noise); a name said alone ends otherwise.
  const ofPrompt = new Set(promptWords);
  if (/,\s*$/u.test(transcript) && heard.every((word) => ofPrompt.has(word))) return true;
  // The names of the prompt, and which name each word of it belongs to.
  const names = prompt
    .split(/[,.]/u)
    .map((name) => wordsOf(name).join(' '))
    .filter((name) => name !== '');
  const nameOfWord: number[] = [];
  const nameStarts = new Set<number>();
  names.forEach((name, index) => {
    nameStarts.add(nameOfWord.length);
    for (let word = 0; word < name.split(' ').length; word += 1) nameOfWord.push(index);
  });
  nameStarts.add(nameOfWord.length);
  const groups = clusters.map((cluster) => new Set(cluster.map((name) => wordsOf(name).join(' '))));
  // Each run of words of the prompt, in its order, as long as it goes.
  for (let start = 0; start < heard.length; start += 1) {
    for (let from = 0; from < promptWords.length; from += 1) {
      if (start > 0 && from > 0 && heard[start - 1] === promptWords[from - 1]) continue;
      let length = 0;
      while (
        start + length < heard.length &&
        from + length < promptWords.length &&
        heard[start + length] === promptWords[from + length]
      ) {
        length += 1;
      }
      if (length === 0) continue;
      const whole = nameStarts.has(from) && nameStarts.has(from + length);
      const said = new Set(nameOfWord.slice(from, from + length).map((index) => names[index]));
      if (length < ECHO_WORDS && !(whole && said.size >= ECHO_NAMES)) continue;
      const cluster =
        whole && groups.some((group) => [...said].every((name) => group.has(name ?? '')));
      if (!cluster) return true;
    }
  }
  return false;
}
