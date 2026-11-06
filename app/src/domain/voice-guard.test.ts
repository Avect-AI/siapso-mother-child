// SPDX-License-Identifier: MIT
// Review of #68: the names given to the French decoder may come back on their
// own when nobody speaks. A recording too quiet is not transcribed, a faint
// one is transcribed without the names, and a transcript that repeats them is
// read as nothing heard.
import { describe, expect, it } from 'vitest';
import { VOICE_NAMES_PROMPT } from '../config/voice.js';
import {
  isPromptEcho,
  loudestRms,
  VOICE_CONTEXT_MIN_RMS,
  VOICE_SILENT_RMS,
  VOICE_STEADY_RATIO,
  voiceGate,
} from './voice-guard.js';

/** A tone of this amplitude, from `start` for `seconds`, inside `total` seconds of silence. */
function tone(amplitude: number, total = 1, start = 0, seconds = total): Float32Array {
  const samples = new Float32Array(Math.round(total * 16000));
  const from = Math.round(start * 16000);
  const to = Math.min(samples.length, from + Math.round(seconds * 16000));
  for (let at = from; at < to; at += 1)
    samples[at] = amplitude * Math.sin((2 * Math.PI * 440 * at) / 16000);
  return samples;
}

describe('loudestRms', () => {
  it('is the RMS of the loudest tenth of a second', () => {
    expect(loudestRms(new Float32Array(16000))).toBe(0);
    expect(loudestRms(tone(0.1))).toBeCloseTo(0.1 / Math.SQRT2, 3);
    // A word inside silence counts whole, however long the silence.
    expect(loudestRms(tone(0.1, 8, 3, 0.3))).toBeCloseTo(0.1 / Math.SQRT2, 2);
    // Shorter than a tenth of a second: the whole recording.
    expect(loudestRms(tone(0.1, 0.05))).toBeCloseTo(0.1 / Math.SQRT2, 2);
    expect(loudestRms(new Float32Array(0))).toBe(0);
  });
});

describe('voiceGate', () => {
  it('skips a recording too quiet, and gives the names only to one loud enough', () => {
    // Measured on 2026-11-06 (docs/voice.md): the 80 synthetic clips are at
    // 0.11 or more, the quietest FLEURS recording (a real voice) at 0.0021,
    // white noise of -60 dBFS at 0.001, of -45 dBFS at 0.006.
    expect(VOICE_SILENT_RMS).toBeLessThan(VOICE_CONTEXT_MIN_RMS);
    expect(voiceGate(new Float32Array(16000))).toBe('silent');
    expect(voiceGate(tone(0.001))).toBe('silent');
    // The quietest real voice measured is transcribed, without the names.
    expect(voiceGate(tone(0.0021 * Math.SQRT2, 1, 0.5, 0.3))).toBe('plain');
    expect(voiceGate(tone(0.006, 1, 0.5, 0.3))).toBe('plain');
    expect(voiceGate(tone(0.1, 1, 0.5, 0.3))).toBe('speech');
  });

  // Measured on 2026-11-06 with the names given: steady noise of -30 dBFS was
  // heard as "Cytotec,". Steady noise is transcribed without them.
  it('gives no names to a steady sound, however loud', () => {
    expect(VOICE_STEADY_RATIO).toBeGreaterThan(1.73);
    // A tone or a noise as loud all along: no word starts or ends in it.
    expect(voiceGate(tone(0.1))).toBe('plain');
    const noise = Float32Array.from({ length: 16000 }, (_, at) => 0.05 * Math.sin(at * 12.9898));
    expect(voiceGate(noise)).toBe('plain');
    // A word over that noise stands out of it.
    const loud = tone(0.2);
    const word = noise.map((value, at) =>
      at > 6000 && at < 10000 ? value + (loud[at] ?? 0) : value,
    );
    expect(voiceGate(word)).toBe('speech');
  });
});

describe('isPromptEcho', () => {
  it('reads as an echo the names given, three in a row or four words of them in a row', () => {
    expect(isPromptEcho(VOICE_NAMES_PROMPT, VOICE_NAMES_PROMPT)).toBe(true);
    expect(isPromptEcho('Doliprane, paracétamol, Efferalgan.', VOICE_NAMES_PROMPT)).toBe(true);
    expect(isPromptEcho('kinkéliba, moringa, bissap, huile de ricin', VOICE_NAMES_PROMPT)).toBe(
      true,
    );
    expect(isPromptEcho('Merci. Codéine, fer, acide folique.', VOICE_NAMES_PROMPT)).toBe(true);
  });

  // Measured on 2026-11-06: noise was heard as "Cytotec,", the list of the
  // prompt going on. A name said alone ends otherwise ("Cytotec.").
  it('reads as an echo names of the prompt alone that end with a comma, as the list goes on', () => {
    expect(isPromptEcho('Cytotec,', VOICE_NAMES_PROMPT)).toBe(true);
    expect(isPromptEcho(' Advil, Cytotec, ', VOICE_NAMES_PROMPT)).toBe(true);
    expect(isPromptEcho('Cytotec.', VOICE_NAMES_PROMPT)).toBe(false);
    expect(isPromptEcho('Cytotec', VOICE_NAMES_PROMPT)).toBe(false);
    expect(isPromptEcho("C'est le cas,", VOICE_NAMES_PROMPT)).toBe(false);
  });

  it('never reads so a sentence that names products of the list as said', () => {
    for (const sentence of [
      'je prends du doliprane et du paracétamol',
      'doliprane, efferalgan et dafalgan',
      "je prends du coartem, de l'advil et de l'ibuprofène",
      'dama naan nivaquine ak quinine',
      'huile de ricin',
      '',
    ]) {
      expect(isPromptEcho(sentence, VOICE_NAMES_PROMPT), sentence).toBe(false);
    }
  });
});
