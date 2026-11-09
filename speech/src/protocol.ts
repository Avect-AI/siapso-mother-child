// SPDX-License-Identifier: MIT
// Messages between the page (client.ts) and the speech worker (worker.ts).

export type WorkerRequest =
  | {
      type: 'load';
      id: number;
      /** Absolute URL of the voice pack folder. */
      baseUrl: string;
      /** Files of the pack: the worker may fetch nothing else; the sizes give the loading progress. */
      files: { path: string; bytes: number }[];
    }
  | {
      type: 'transcribe';
      id: number;
      /** 16 kHz mono samples, transferred (the page keeps no copy). */
      samples: Float32Array;
      /** Whisper decoder prompt (token ids) of the language to transcribe. */
      prompt: number[];
      /** Words given to the decoder as said before the speech (TranscribeOptions.context). */
      context?: string;
    };

/** Why the worker failed: the pack is not installed, the model did not start, a transcription failed, storage. */
export type WorkerErrorCode = 'unavailable' | 'load' | 'transcribe' | 'storage';

export type WorkerResponse =
  /** Sent once at start: the address of the worker script, for the page to keep it offline. */
  | { type: 'hello'; id: 0; url: string }
  | { type: 'progress'; id: number; progress: number }
  | { type: 'loaded'; id: number; device: 'webgpu' | 'wasm' }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; id: number; code: WorkerErrorCode; message: string };
