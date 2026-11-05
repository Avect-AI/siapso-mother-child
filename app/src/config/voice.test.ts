// SPDX-License-Identifier: MIT
import { MAX_RECORDING_MS, VOICE_PACKS } from '@siapso/speech';
import { describe, expect, it } from 'vitest';
import { MAX_RECORDING_SECONDS, VOICE_PACK_OPTIONS, defaultVoiceLang, megabytes } from './voice.js';

describe('voice packs offered', () => {
  it('are the packs of @siapso/speech, Wolof first, each with its served size (docs/voice.md)', () => {
    expect(VOICE_PACK_OPTIONS).toEqual([
      { lang: 'wo', url: VOICE_PACKS.wo, bytes: 325_620_637 },
      { lang: 'fr', url: VOICE_PACKS.fr, bytes: 137_164_324 },
    ]);
  });

  it('default to the interface language, French when no pack has it', () => {
    expect(defaultVoiceLang('fr')).toBe('fr');
    // No English pack: French, the language of the boxes.
    expect(defaultVoiceLang('en')).toBe('fr');
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
