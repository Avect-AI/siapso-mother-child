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

// SCRUM-61: the names of the base given to the French decoder (docs/voice.md):
// measured on synthetic voices, affirmative sentences (80 clips: 22 sentences
// by 3 Windows voices, and 14 more), 75 of 88 products ticked instead of 50,
// none ticked wrongly.
describe('the names given to the decoder', () => {
  it('are on for the French voice, and never given to the Wolof one', () => {
    expect(VOICE_NAMES_PROMPT_ON).toBe(true);
    expect(voiceContextFor('fr')).toBe(VOICE_NAMES_PROMPT);
    // The Wolof model was trained with no prompt at all.
    expect(voiceContextFor('wo')).toBeUndefined();
    expect(voiceContextFor(undefined)).toBeUndefined();
  });

  it('are given to no voice when turned off', () => {
    expect(voiceContextFor('fr', false)).toBeUndefined();
    expect(voiceContextFor('wo', false)).toBeUndefined();
  });

  it('keep to the prompt measured (variant A, 87 tokens)', () => {
    expect(VOICE_NAMES_PROMPT).toBe(
      'Doliprane, paracétamol, Efferalgan, Dafalgan, Nivaquine, quinine, Coartem, Advil, ibuprofène, Cytotec, amoxicilline, Bactrim, codéine, fer, acide folique, SP, Fansidar, kinkéliba, moringa, bissap, huile de ricin.',
    );
  });
});
