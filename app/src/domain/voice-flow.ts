// SPDX-License-Identifier: MIT
// The voice input of the search, as a state machine (spec section 8, plan
// Task 17): idle, the microphone opening, recording (elapsed seconds),
// transcribing, heard with candidates, heard without candidate, an error, the
// microphone refused, cancelled. The model only writes what it heard: the
// text goes to the search field and the resolver, and the candidates are
// confirmed exactly as typed ones. Nothing is added to the check from here.
// Pure, so every step is tested; the screen runs the recorder and the model.
import type { VoicePackErrorReason } from '@siapso/speech';
import type { MessageKey } from '../i18n/translate.js';

/**
 * Why voice input failed, for a plain message: the voice pack reasons of
 * @siapso/speech, and the microphone's own (none found, a browser that
 * cannot record, a recording that failed).
 */
export type VoiceFailure = VoicePackErrorReason | 'no-microphone' | 'unsupported' | 'record';

/** Every failure, each with its own message (failureMessage). */
export const VOICE_FAILURES: readonly VoiceFailure[] = [
  'unavailable',
  'invalid',
  'storage',
  'download',
  'load',
  'transcribe',
  'no-microphone',
  'unsupported',
  'record',
];

export type VoiceState =
  | { step: 'idle' }
  /** The microphone is opening (the permission question may be on screen). */
  | { step: 'starting' }
  | { step: 'recording'; seconds: number }
  | { step: 'transcribing' }
  /** Heard, and the search proposes candidates for it. */
  | { step: 'heard'; text: string }
  /** Heard, and no candidate matches; `text` is empty when no name was heard at all. */
  | { step: 'heard-none'; text: string }
  | { step: 'error'; failure: VoiceFailure }
  /** The microphone permission was refused. */
  | { step: 'denied' }
  | { step: 'cancelled' };

export type VoiceEvent =
  | { type: 'start' }
  | { type: 'started' }
  | { type: 'tick'; seconds: number }
  /** The recording ends: a second tap, or 8 seconds. */
  | { type: 'stop' }
  /** The transcription, and how many candidates the search proposes for it. */
  | { type: 'heard'; text: string; candidates: number }
  | { type: 'failed'; failure: VoiceFailure }
  | { type: 'denied' }
  | { type: 'cancel' }
  /** She typed, or left: back to idle. */
  | { type: 'reset' };

export const IDLE: VoiceState = { step: 'idle' };

/** While the microphone opens, records or the model transcribes. */
export function isBusy(state: VoiceState): boolean {
  return state.step === 'starting' || state.step === 'recording' || state.step === 'transcribing';
}

/**
 * The next state. An event that does not fit the step (a transcription that
 * comes back after a cancel, a second start while busy) leaves the state as
 * it is, the same object.
 */
export function voiceFlow(state: VoiceState, event: VoiceEvent): VoiceState {
  if (event.type === 'reset') return IDLE;
  switch (state.step) {
    case 'starting':
      if (event.type === 'started') return { step: 'recording', seconds: 0 };
      break;
    case 'recording':
      if (event.type === 'tick') return { step: 'recording', seconds: event.seconds };
      if (event.type === 'stop') return { step: 'transcribing' };
      break;
    case 'transcribing':
      if (event.type === 'heard') {
        return event.candidates > 0 && event.text !== ''
          ? { step: 'heard', text: event.text }
          : { step: 'heard-none', text: event.text };
      }
      break;
    default:
      // An end state, or idle: only a new start.
      return event.type === 'start' ? { step: 'starting' } : state;
  }
  // Busy: it may fail, be refused (while opening) or be cancelled at any time.
  if (event.type === 'failed') return { step: 'error', failure: event.failure };
  if (event.type === 'denied' && state.step === 'starting') return { step: 'denied' };
  if (event.type === 'cancel') return { step: 'cancelled' };
  return state;
}

/** Punctuation the model writes around a name, never part of it. */
const EDGE_PUNCTUATION = /^[\s.,;:!?…"'«»()[\]{}*-]+|[\s.,;:!?…"'«»()[\]{}*-]+$/gu;

/**
 * The transcription as it goes in the search field: without the punctuation
 * and spaces around it, its spaces collapsed, at most `maxLength` characters
 * (cut at a word when it can be).
 */
export function cleanTranscript(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).replace(EDGE_PUNCTUATION, '');
}

const PACK_REASONS: ReadonlySet<string> = new Set<VoicePackErrorReason>([
  'unavailable',
  'invalid',
  'storage',
  'download',
  'load',
  'transcribe',
]);

function nameOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

/**
 * What an error of the recorder or of the model means for the person:
 * `denied` for a refused microphone (its own screen state), else a failure.
 * A VoicePackError (read by name, so @siapso/speech stays out of the main
 * bundle) keeps its reason.
 */
export function failureOf(error: unknown, phase: 'record' | 'transcribe'): VoiceFailure | 'denied' {
  const name = nameOf(error);
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-microphone';
  if (error instanceof TypeError) return 'unsupported';
  if (name === 'VoicePackError' && typeof error === 'object' && error !== null) {
    const reason = 'reason' in error ? String(error.reason) : '';
    if (PACK_REASONS.has(reason)) return reason as VoicePackErrorReason;
  }
  return phase;
}

/** The plain message of a failure: what happened and what to do. */
export function failureMessage(failure: VoiceFailure): MessageKey {
  return `voice.error.${failure}`;
}

/**
 * Why an installation of the voice failed, as the voice screen says it:
 * - `unavailable`: nothing came (no Internet, or this server does not give
 *   the voice: a 404, the app page instead of the pack);
 * - `damaged`: what came does not match what the pack says (not a pack, a
 *   file of another size), and nothing of the voice is kept;
 * - `damagedKept`: a file came of another size and was dropped, while the
 *   files before it are kept, which "Reprendre l'installation" goes on from;
 * - `interrupted`: the download stopped with part of the voice kept, which
 *   "Reprendre l'installation" goes on from;
 * - `storage`: not enough space.
 */
export type InstallFailure = 'unavailable' | 'damaged' | 'damagedKept' | 'interrupted' | 'storage';

export const INSTALL_FAILURES: readonly InstallFailure[] = [
  'unavailable',
  'damaged',
  'damagedKept',
  'interrupted',
  'storage',
];

/**
 * What an installation failure means, from its reason and the bytes of the
 * pack kept on the phone: a download that failed with nothing kept is a voice
 * that did not come at all, never one to resume.
 */
export function installFailureOf(failure: VoiceFailure, storedBytes: number): InstallFailure {
  switch (failure) {
    case 'storage':
      return 'storage';
    case 'invalid':
      // Only the damaged file is dropped: what came before it stays, to resume.
      return storedBytes > 0 ? 'damagedKept' : 'damaged';
    case 'download':
      return storedBytes > 0 ? 'interrupted' : 'unavailable';
    default:
      return 'unavailable';
  }
}

/** The plain message of an installation failure: what happened and where to go from there. */
export function installFailureMessage(failure: InstallFailure): MessageKey {
  return `voicePack.error.${failure}`;
}
