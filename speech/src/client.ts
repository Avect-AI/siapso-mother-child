// SPDX-License-Identifier: MIT
// The page side of the speech worker. The model only proposes text: the
// transcription goes to the resolver, the user confirms a candidate, and
// the engine alone decides the level.
import type { WorkerRequest, WorkerResponse } from './protocol.js';
import { VoicePackError, isVoicePackInstalled, type VoicePackInfo } from './voice-pack.js';

/**
 * How long the worker has to answer a load or a transcription before it is
 * given up, terminated and replaced by a new one. One utterance took 123 s
 * on one thread with the CPU slowed 6 times, the stand-in for an entry-level
 * phone (docs/voice.md, Timings): 180 s leaves about half as much again for
 * a slower phone, a longer sentence or a first load, while a worker that
 * hangs (out of memory, a stuck runtime) is still let go of in the end. The
 * person can cancel at any time before that.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

export interface SpeechClientOptions {
  /** Time limit for a load or a transcription, in milliseconds (default 180 s). */
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
  /**
   * Gives up the transcriptions asked so far: each rejects with a
   * VoicePackError `transcribe`. One that runs stops with its worker (it no
   * longer uses the battery for nobody), and the next call starts a new
   * worker, which loads the model again; one still waiting for the model is
   * dropped. The model load itself is never cancelled: it is shared, and the
   * next recording needs it.
   */
  cancel(): void;
  /**
   * The address of the worker script this client runs, as the worker says it
   * when it starts (the page keeps exactly this file offline). Rejects when
   * the worker cannot start.
   */
  scriptUrl(): Promise<string>;
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

/** One worker and what it was asked; replaced as a whole after a timeout or a cancel. */
interface Session {
  worker: Worker;
  pending: Map<number, Pending>;
  /** Why it stopped (a crash): the next call starts a new worker. */
  stopped: string | undefined;
  /** The address of its script, once it said it. */
  url: Promise<string>;
  said: (url: string) => void;
  failed: (error: Error) => void;
}

/** Spawns the speech worker for an installed voice pack. */
export function createSpeechClient(
  info: VoicePackInfo,
  options: SpeechClientOptions = {},
): SpeechClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let nextId = 1;
  let disposed: string | undefined;
  let loading: Promise<void> | undefined;
  let device: 'webgpu' | 'wasm' | undefined;
  let generation = 0;
  // A cancel drops the transcriptions asked before it, never the shared load.
  let cancels = 0;
  // Transcriptions run one at a time, in order.
  let queue: Promise<unknown> = Promise.resolve();

  function rejectAll(current: Session, message: string): void {
    for (const entry of current.pending.values()) {
      entry.reject(new VoicePackError(entry.kind, message));
    }
    current.pending.clear();
  }

  function spawn(): Session {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'siapso-speech',
    });
    let said: (url: string) => void = () => undefined;
    let failed: (error: Error) => void = () => undefined;
    const url = new Promise<string>((resolve, reject) => {
      said = resolve;
      failed = reject;
    });
    // Nobody may ask for it: a rejection without a listener is not an error.
    url.catch(() => undefined);
    const current: Session = { worker, pending: new Map(), stopped: undefined, url, said, failed };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'hello') {
        current.said(message.url);
        return;
      }
      const entry = current.pending.get(message.id);
      if (entry === undefined) return;
      if (message.type === 'progress') {
        entry.onProgress?.(message.progress);
        return;
      }
      current.pending.delete(message.id);
      if (message.type === 'error') entry.reject(new VoicePackError(message.code, message.message));
      else entry.resolve(message);
    };
    worker.onmessageerror = () => {
      rejectAll(current, 'A message from the speech worker could not be read.');
    };
    worker.onerror = (event: ErrorEvent) => {
      // A worker script that fails to load (offline, not cached) gives an event with no message.
      const reason = (event.message as string | undefined) ?? 'it could not be started.';
      current.stopped ??= `The speech worker stopped: ${reason}`;
      current.worker.terminate();
      current.failed(new VoicePackError('load', current.stopped));
      rejectAll(current, current.stopped);
    };
    return current;
  }

  let session = spawn();

  /**
   * Terminates the worker, rejects what it was asked with `message`, and puts
   * a new worker in its place: the next request loads the model again.
   */
  function restart(message: string): void {
    const old = session;
    old.worker.onmessage = null;
    old.worker.onmessageerror = null;
    old.worker.onerror = null;
    old.worker.terminate();
    old.failed(new VoicePackError('load', message));
    generation += 1;
    loading = undefined;
    device = undefined;
    session = spawn();
    rejectAll(old, message);
  }

  /** After a crash, the next call gets a new worker (it loads the model again). */
  function live(): void {
    if (disposed === undefined && session.stopped !== undefined) {
      restart('The speech worker was restarted after it stopped.');
    }
  }

  function refusal(): string | undefined {
    live();
    return disposed;
  }

  function request(
    kind: Kind,
    message: WorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: (progress: number) => void,
  ): Promise<WorkerResponse> {
    const refused = refusal();
    if (refused !== undefined) return Promise.reject(new VoicePackError(kind, refused));
    const current = session;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (session !== current || !current.pending.has(message.id)) return;
        current.pending.delete(message.id);
        reject(
          new VoicePackError(
            kind,
            `The speech worker did not answer within ${String(timeoutMs)} ms.`,
          ),
        );
        // A worker that does not answer may be stuck: it is replaced.
        restart('The speech worker was restarted after a request timed out.');
      }, timeoutMs);
      current.pending.set(message.id, {
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
      current.worker.postMessage(message, transfer);
    });
  }

  function load(onProgress?: (progress: number) => void): Promise<void> {
    const refused = refusal();
    if (refused !== undefined) return Promise.reject(new VoicePackError('load', refused));
    // Loads once: a load under way or done is shared.
    if (loading !== undefined) return loading;
    // A restart (timeout, cancel) starts a new generation: an older load no longer counts.
    const mine = generation;
    const attempt: Promise<void> = (async () => {
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
      if (answer.type === 'loaded' && mine === generation) device = answer.device;
    })().catch((error: unknown) => {
      if (mine === generation) loading = undefined;
      throw error;
    });
    loading = attempt;
    return attempt;
  }

  async function run(
    samples: Float32Array,
    prompt: number[],
    askedAt: number,
  ): Promise<Transcription> {
    await load();
    if (askedAt !== cancels) {
      throw new VoicePackError('transcribe', 'The speech request was cancelled.');
    }
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
      const askedAt = cancels;
      const next = queue.then(() => run(samples, prompt, askedAt));
      queue = next.catch(() => undefined);
      return next;
    },

    cancel() {
      if (disposed !== undefined) return;
      cancels += 1;
      // A transcription under way stops with its worker; a load under way goes on.
      const transcribing = [...session.pending.values()].some(
        (entry) => entry.kind === 'transcribe',
      );
      if (transcribing) restart('The speech request was cancelled.');
    },

    scriptUrl() {
      const refused = refusal();
      if (refused !== undefined) return Promise.reject(new VoicePackError('load', refused));
      return session.url;
    },

    dispose() {
      session.worker.terminate();
      session.failed(new VoicePackError('load', 'The speech worker stopped.'));
      disposed ??= 'The speech worker stopped.';
      rejectAll(session, disposed);
    },

    get device() {
      return device;
    },
  };
}
