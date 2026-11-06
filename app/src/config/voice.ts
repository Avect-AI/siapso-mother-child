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

/**
 * The names of the base given to the French decoder as said before the speech
 * (Whisper's previous text, SCRUM-61): the most common names of the sentence
 * evaluation and the common brands of the registry, 87 tokens. Measured on
 * 2026-11-06 (docs/voice.md) on synthetic voices and affirmative sentences
 * only: far more names written right (75 of 88 products ticked instead of 50,
 * clips exactly right 67 of 80 instead of 43; the 80 clips are 22 sentences
 * said by three Windows voices, and 14 more), none ticked wrongly, the FLEURS word
 * error rate unchanged (30.0 % against 30.3 %), 6 to 13 % more time. Known
 * limit: "kinkéliba" may be heard as "quinine qu'il y va", which the clause
 * guard of the resolver offers only to confirm, never ticked; a prompt adding
 * the remedies that sound like medicines did not remove it. On for French by
 * decision of 2026-11-06; to measure again with real voices (SCRUM-32).
 */
export const VOICE_NAMES_PROMPT_ON = true;

export const VOICE_NAMES_PROMPT =
  'Doliprane, paracétamol, Efferalgan, Dafalgan, Nivaquine, quinine, Coartem, Advil, ibuprofène, Cytotec, amoxicilline, Bactrim, codéine, fer, acide folique, SP, Fansidar, kinkéliba, moringa, bissap, huile de ricin.';

/**
 * The words the decoder is given for a language, or undefined: the names, for
 * French only (the Wolof model was trained with no prompt), when `on`.
 */
export function voiceContextFor(
  language: string | undefined,
  on: boolean = VOICE_NAMES_PROMPT_ON,
): string | undefined {
  return on && language === 'fr' ? VOICE_NAMES_PROMPT : undefined;
}

/** A size in whole megabytes (10^6 bytes), as a phone shows it; at least 1 for any data. */
export function megabytes(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.max(1, Math.round(bytes / 1_000_000));
}
