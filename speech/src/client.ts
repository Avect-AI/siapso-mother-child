// SPDX-License-Identifier: MIT
// The page side of the speech worker. The model only proposes text: the
// transcription goes to the resolver, the user confirms a candidate, and
// the engine alone decides the level.
import type { WorkerRequest, WorkerResponse } from './protocol.js';
import { VoicePackError, isVoicePackInstalled, type VoicePackInfo } from './voice-pack.js';

/** How long the worker has to answer a request before it is given up. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface SpeechClientOptions {
  /** Time limit for a load or a transcription, in milliseconds (default 60 s). */
  timeoutMs?: number;
}

export interface TranscribeOptions {
  /** One of the pack languages (`info.languages`); the first one when absent. */
  language?: string;
}

export interface Transcription {
  text: string;
  /** Time spent in the model, in milliseconds. */
  ms: number;
}

export interface SpeechClient {
  /**
   * Loads the model from the installed pack; `onProgress` receives 0 to 1.
   * Loads once. Rejects with VoicePackError `unavailable` when the pack is not
   * installed: nothing is ever downloaded here.
   */
  load(onProgress?: (progress: number) => void): Promise<void>;
  /**
   * Transcribes 16 kHz mono samples, one transcription at a time. The samples
   * are transferred to the worker, so the array is emptied. Rejects with a
   * VoicePackError (`unavailable`, `load`, `storage` or `transcribe`).
   */
  transcribe(samples: Float32Array, options?: TranscribeOptions): Promise<Transcription>;
  /** Stops the worker and frees the model. */
  dispose(): void;
  /** The device the model runs on, once loaded. */
  readonly device: 'webgpu' | 'wasm' | undefined;
}

type Kind = 'load' | 'transcribe';

interface Pending {
  kind: Kind;
  resolve: (message: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: ((progress: number) => void) | undefined;
}

/** Spawns the speech worker for an installed voice pack. */
export function createSpeechClient(
  info: VoicePackInfo,
  options: SpeechClientOptions = {},
): SpeechClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
    name: 'siapso-speech',
  });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let stopped: string | undefined;
  let loading: Promise<void> | undefined;
  let device: 'webgpu' | 'wasm' | undefined;
  // Transcriptions run one at a time, in order.
  let queue: Promise<unknown> = Promise.resolve();

  function rejectAll(message: string): void {
    for (const entry of pending.values()) entry.reject(new VoicePackError(entry.kind, message));
    pending.clear();
  }

  function stop(message: string): void {
    stopped ??= message;
    rejectAll(message);
  }

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    if (message.type === 'progress') {
      entry.onProgress?.(message.progress);
      return;
    }
    pending.delete(message.id);
    if (message.type === 'error') entry.reject(new VoicePackError(message.code, message.message));
    else entry.resolve(message);
  };
  worker.onmessageerror = () => {
    rejectAll('A message from the speech worker could not be read.');
  };
  worker.onerror = (event: ErrorEvent) => {
    // A worker script that fails to load (offline, not cached) gives an event with no message.
    const reason = (event.message as string | undefined) ?? 'it could not be started.';
    stop(`The speech worker stopped: ${reason}`);
  };

  function request(
    kind: Kind,
    message: WorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: (progress: number) => void,
  ): Promise<WorkerResponse> {
    if (stopped !== undefined) return Promise.reject(new VoicePackError(kind, stopped));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.id);
        reject(
          new VoicePackError(
            kind,
            `The speech worker did not answer within ${String(timeoutMs)} ms.`,
          ),
        );
      }, timeoutMs);
      pending.set(message.id, {
        kind,
        resolve: (answer) => {
          clearTimeout(timer);
          resolve(answer);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        onProgress,
      });
      worker.postMessage(message, transfer);
    });
  }

  function load(onProgress?: (progress: number) => void): Promise<void> {
    if (stopped !== undefined) return Promise.reject(new VoicePackError('load', stopped));
    loading ??= (async () => {
      if (!(await isVoicePackInstalled(info))) {
        throw new VoicePackError('unavailable', `The voice pack ${info.id} is not installed.`);
      }
      const answer = await request(
        'load',
        {
          type: 'load',
          id: nextId++,
          baseUrl: info.baseUrl,
          files: info.files.map(({ path, bytes }) => ({ path, bytes })),
        },
        [],
        onProgress,
      );
      if (answer.type === 'loaded') device = answer.device;
    })().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  }

  async function run(samples: Float32Array, prompt: number[]): Promise<Transcription> {
    await load();
    const answer = await request(
      'transcribe',
      { type: 'transcribe', id: nextId++, samples, prompt: [...prompt] },
      [samples.buffer],
    );
    if (answer.type !== 'result') {
      throw new VoicePackError(
        'transcribe',
        `Unexpected answer from the speech worker: ${answer.type}`,
      );
    }
    return { text: answer.text, ms: answer.ms };
  }

  return {
    load,

    transcribe(samples, transcribeOptions = {}) {
      const language = transcribeOptions.language ?? info.languages[0] ?? '';
      const prompt = info.prompts[language];
      if (prompt === undefined) {
        return Promise.reject(
          new VoicePackError('transcribe', `The voice pack does not transcribe "${language}".`),
        );
      }
      const next = queue.then(() => run(samples, prompt));
      queue = next.catch(() => undefined);
      return next;
    },

    dispose() {
      worker.terminate();
      stop('The speech worker stopped.');
    },

    get device() {
      return device;
    },
  };
}
