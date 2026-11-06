// SPDX-License-Identifier: MIT
// A fake @siapso/speech for the app's tests: voice packs in a pretend Cache
// API, an installation with progress, a microphone and a speech client whose
// answers the test controls. Nothing is recorded and no model runs.
import type { VoicePackErrorReason, VoicePackInfo } from '@siapso/speech';
import { vi } from 'vitest';
import { VOICE_PACK_OPTIONS, type VoiceLang } from '../config/voice.js';
import type { SpeechPort } from '../voice/voice-service.js';

/** The address the fake speech worker says it runs from. */
export const SPEECH_WORKER_SCRIPT = 'https://app.test/assets/worker-Test1.js';

/** An error as @siapso/speech gives it. */
export function voicePackError(reason: VoicePackErrorReason, message: string = reason): Error {
  return Object.assign(new Error(message), { name: 'VoicePackError', reason });
}

/** The manifest of a pack as installedVoicePackInfo or voicePackInfo read it. */
export function packInfo(lang: VoiceLang, url: string): VoicePackInfo {
  const option = VOICE_PACK_OPTIONS.find((candidate) => candidate.lang === lang);
  return {
    id: lang === 'wo' ? 'whisper-small-wolof-q8' : 'whisper-base-fr-q8',
    baseUrl: url,
    files: [{ path: 'config.json', bytes: option?.bytes ?? 0 }],
    totalBytes: option?.bytes ?? 0,
    licence: 'MIT',
    languages: [lang],
    prompts: { [lang]: [50258] },
    runtime: '1.31.0-dev.20260914-8d85527a0',
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export interface FakeSpeechOptions {
  /** Whether the browser can record and run the model (default true). */
  supported?: boolean;
  /** The packs complete on the phone. */
  installed?: VoiceLang[];
  /** Bytes already stored per pack folder (an installation cut short). */
  stored?: Record<string, number>;
  /** The installation waits after half the pack until it is cancelled. */
  installHangs?: boolean;
  /** The installation fails with this reason after half the pack. */
  installFails?: VoicePackErrorReason;
  /** What opening the microphone throws (a refused permission, no microphone). */
  startError?: Error;
  /** What the model hears (default "nebeday"), unless the test holds the transcription. */
  transcript?: string;
  /** The transcription waits for finishTranscription or failTranscription. */
  holdTranscription?: boolean;
  /** What loading the model throws. */
  loadError?: Error;
  /** The speech package cannot be loaded (its chunk is gone after an update elsewhere). */
  packageFails?: boolean;
  /** What the microphone recorded (default: one second of a tone as loud as speech). */
  samples?: Float32Array;
}

/**
 * A recording of a word: a third of a second of silence, then a 440 Hz tone
 * of this amplitude, at 16 kHz (one second in all by default).
 */
export function toneSamples(amplitude: number, seconds = 1): Float32Array {
  const silence = Math.round(16000 / 3);
  return Float32Array.from({ length: Math.round(seconds * 16000) }, (_, at) =>
    at < silence ? 0 : amplitude * Math.sin((2 * Math.PI * 440 * at) / 16000),
  );
}

export function fakeSpeech(options: FakeSpeechOptions = {}) {
  const installed = new Map<string, VoicePackInfo>();
  const stored = new Map<string, number>();
  for (const option of VOICE_PACK_OPTIONS) {
    if (options.installed?.includes(option.lang)) {
      installed.set(option.url, packInfo(option.lang, option.url));
      stored.set(option.url, option.bytes);
    }
  }
  for (const [url, bytes] of Object.entries(options.stored ?? {})) stored.set(url, bytes);

  let pending: Deferred<{ text: string; ms: number }> | undefined;
  const client = {
    load: vi.fn(() =>
      options.loadError === undefined ? Promise.resolve() : Promise.reject(options.loadError),
    ),
    transcribe: vi.fn(() => {
      if (options.holdTranscription === true) {
        pending = deferred();
        return pending.promise;
      }
      return Promise.resolve({ text: options.transcript ?? 'nebeday', ms: 1200 });
    }),
    cancel: vi.fn(() => {
      pending?.reject(voicePackError('transcribe', 'The speech request was cancelled.'));
      pending = undefined;
    }),
    dispose: vi.fn(),
    scriptUrl: vi.fn(() => Promise.resolve(SPEECH_WORKER_SCRIPT)),
    device: 'wasm' as const,
  };

  const recorders: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    level: () => number;
    onAutoStop: () => void;
  }[] = [];

  const module = {
    installedVoicePackInfo: vi.fn((url: string) => Promise.resolve(installed.get(url) ?? null)),
    storedVoicePackBytes: vi.fn((url: string) => Promise.resolve(stored.get(url) ?? 0)),
    voicePackInfo: vi.fn((url: string) => {
      const option = VOICE_PACK_OPTIONS.find((candidate) => candidate.url === url);
      return Promise.resolve(packInfo(option?.lang ?? 'wo', url));
    }),
    installVoicePack: vi.fn(
      async (
        info: VoicePackInfo,
        onProgress: (loaded: number, total: number) => void,
        signal?: AbortSignal,
      ) => {
        onProgress(0, info.totalBytes);
        await Promise.resolve();
        onProgress(Math.round(info.totalBytes / 2), info.totalBytes);
        stored.set(info.baseUrl, Math.round(info.totalBytes / 2));
        if (options.installFails !== undefined) throw voicePackError(options.installFails);
        if (options.installHangs === true) {
          await new Promise<void>((resolve) => {
            if (signal?.aborted === true) resolve();
            signal?.addEventListener('abort', () => {
              resolve();
            });
          });
          throw new DOMException('The installation was cancelled.', 'AbortError');
        }
        onProgress(info.totalBytes, info.totalBytes);
        installed.set(info.baseUrl, info);
        stored.set(info.baseUrl, info.totalBytes);
      },
    ),
    removeVoicePackFiles: vi.fn((url: string) => {
      installed.delete(url);
      stored.delete(url);
      return Promise.resolve();
    }),
    createSpeechClient: vi.fn(() => client),
    createRecorder: vi.fn((recorderOptions: { onAutoStop?: () => void } = {}) => {
      const recorder = {
        start: vi.fn(() =>
          options.startError === undefined ? Promise.resolve() : Promise.reject(options.startError),
        ),
        stop: vi.fn(() => Promise.resolve(options.samples ?? toneSamples(0.2))),
        cancel: vi.fn(),
        level: () => 0,
        onAutoStop: () => recorderOptions.onAutoStop?.(),
      };
      recorders.push(recorder);
      return recorder;
    }),
  };

  const port = {
    supported: () => options.supported ?? true,
    load: vi.fn(() =>
      options.packageFails === true
        ? Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
        : Promise.resolve(module),
    ),
    // The service worker that keeps the speech worker's script (pwa/sw-setup.ts).
    voiceWorker: {
      cache: vi.fn(() => Promise.resolve(true)),
      drop: vi.fn(() => Promise.resolve(true)),
    },
  };

  return {
    port: port as typeof port & SpeechPort,
    module,
    client,
    recorders,
    /** The recorder made last. */
    recorder() {
      const last = recorders.at(-1);
      if (last === undefined) throw new Error('no recorder yet');
      return last;
    },
    /** Answers the transcription held by holdTranscription. */
    finishTranscription(text: string) {
      pending?.resolve({ text, ms: 1200 });
      pending = undefined;
    },
    failTranscription(error: unknown) {
      pending?.reject(error);
      pending = undefined;
    },
  };
}
