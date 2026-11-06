// SPDX-License-Identifier: MIT
import { MAX_RECORDING_MS, VOICE_PACKS } from '@siapso/speech';
import { describe, expect, it } from 'vitest';
import {
  MAX_RECORDING_SECONDS,
  VOICE_NAMES_PROMPT,
  VOICE_NAMES_PROMPT_ON,
  VOICE_PACK_OPTIONS,
  megabytes,
  voiceContextFor,
} from './voice.js';

describe('voice packs offered', () => {
  it('are the packs of @siapso/speech, Wolof first, each with its served size (docs/voice.md)', () => {
    expect(VOICE_PACK_OPTIONS).toEqual([
      { lang: 'wo', url: VOICE_PACKS.wo, bytes: 325_620_637 },
      { lang: 'fr', url: VOICE_PACKS.fr, bytes: 137_164_324 },
    ]);
  });

  it('say their size in whole megabytes, as people see it on a phone', () => {
    expect(megabytes(325_620_637)).toBe(326);
    expect(megabytes(137_164_324)).toBe(137);
    expect(megabytes(400_000)).toBe(1);
    expect(megabytes(0)).toBe(0);
  });

  it('record for at most 8 seconds, as the recorder does', () => {
    expect(MAX_RECORDING_SECONDS * 1000).toBe(MAX_RECORDING_MS);
  });
});

// SCRUM-61: the names of the base given to the French decoder, measured and
// kept off (docs/voice.md): with it on, "kinkéliba" was heard as "quinine".
describe('the names given to the decoder', () => {
  it('are off, so no voice is given them', () => {
    expect(VOICE_NAMES_PROMPT_ON).toBe(false);
    expect(voiceContextFor('fr')).toBeUndefined();
    expect(voiceContextFor('wo')).toBeUndefined();
  });

  it('would be given to the French voice only, and keep to the size measured', () => {
    expect(voiceContextFor('fr', true)).toBe(VOICE_NAMES_PROMPT);
    // The Wolof model was trained with no prompt at all.
    expect(voiceContextFor('wo', true)).toBeUndefined();
    expect(voiceContextFor(undefined, true)).toBeUndefined();
    // 87 tokens when measured; Whisper reads at most 448 with the speech.
    expect(VOICE_NAMES_PROMPT.length).toBeLessThanOrEqual(220);
  });
});
