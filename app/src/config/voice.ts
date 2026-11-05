// SPDX-License-Identifier: MIT
// The voice packs the app offers (docs/voice.md), with their served size, so
// the voice screen says how much there is to download before anything is
// downloaded. The folders are VOICE_PACKS of @siapso/speech (checked in
// voice.test.ts), repeated here so the main bundle does not load the speech
// package: it is loaded only when the voice is used. No language is chosen
// for her: the voice screen asks it (live test round 2).

export type VoiceLang = 'wo' | 'fr';

export interface VoicePackOption {
  /** The language the pack transcribes. */
  lang: VoiceLang;
  /** The pack folder, relative to the app. */
  url: string;
  /** Model, ONNX Runtime and notices, as served (docs/voice.md, Packs). */
  bytes: number;
}

/** Wolof first: the language most people speak, offered in plain sight. */
export const VOICE_PACK_OPTIONS: readonly VoicePackOption[] = [
  { lang: 'wo', url: 'voice/whisper-small-wolof-q8/', bytes: 325_620_637 },
  { lang: 'fr', url: 'voice/whisper-base-fr-q8/', bytes: 137_164_324 },
];

/** A recording ends by itself after this many seconds (MAX_RECORDING_MS of @siapso/speech). */
export const MAX_RECORDING_SECONDS = 8;

/** A size in whole megabytes (10^6 bytes), as a phone shows it; at least 1 for any data. */
export function megabytes(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.max(1, Math.round(bytes / 1_000_000));
}
