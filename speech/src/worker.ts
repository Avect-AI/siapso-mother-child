// SPDX-License-Identifier: MIT
/*! SIAPSO speech worker. Bundles Transformers.js (Copyright Hugging Face,
 * Apache License 2.0, https://github.com/huggingface/transformers.js) and
 * ONNX Runtime Web (Copyright Microsoft Corporation, MIT License,
 * https://github.com/microsoft/onnxruntime). Licence texts: licenses/ in
 * each voice pack (docs/voice.md). */
// The speech worker: Transformers.js runs the 8-bit Whisper model on the
// installed voice pack, reading the Cache API only: no request outside the
// pack (never the Hugging Face hub, never a CDN), and a file that is not
// installed is an error, never a download. The audio stays in this
// worker's memory and is dropped once transcribed. The model only proposes
// text.
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import type { WorkerRequest, WorkerResponse } from './protocol.js';
import {
  applyRuntimeSettings,
  checkRuntimeInstalled,
  failureCode,
  runtimeSettings,
  threadCount,
  type TransformersEnv,
} from './runtime-config.js';

/** A product or remedy name is short: this bounds the time spent on noise or a long sentence. */
const MAX_NEW_TOKENS = 96;

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
};

let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
/** The pack the transcriber was loaded from, and the device it runs on. */
let loadedPack: { baseUrl: string; device: 'webgpu' | 'wasm' } | undefined;
// Requests run one at a time, in the order they arrive.
let queue: Promise<unknown> = Promise.resolve();

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function load(request: Extract<WorkerRequest, { type: 'load' }>): Promise<void> {
  // Idempotent: the model of this pack is already loaded, it is not loaded twice.
  if (transcriber !== undefined && loadedPack?.baseUrl === request.baseUrl) {
    post({ type: 'loaded', id: request.id, device: loadedPack.device });
    return;
  }
  if (transcriber !== undefined) {
    // Another pack: the model in memory goes first.
    const previous = transcriber;
    transcriber = undefined;
    loadedPack = undefined;
    await previous.dispose();
  }
  // Threads only in a cross-origin isolated page (shared memory): one otherwise.
  const isolated = (self as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  const settings = runtimeSettings(
    request.baseUrl,
    await hasWebGpu(),
    threadCount(
      isolated,
      navigator.hardwareConcurrency,
      (navigator as { deviceMemory?: number }).deviceMemory,
    ),
  );
  applyRuntimeSettings(
    env as unknown as TransformersEnv,
    settings,
    request.files.map((file) => file.path),
  );
  // ONNX Runtime would fetch a missing runtime file from its URL: refuse first.
  await checkRuntimeInstalled(settings);

  // Progress over the model files (the ONNX Runtime binaries load apart).
  const sizes = new Map(
    request.files
      .filter((file) => !file.path.startsWith('runtime/'))
      .map((file) => [file.path, file.bytes]),
  );
  const total = [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0);
  const loaded = new Map<string, number>();
  const progress_callback = (info: ProgressInfo) => {
    if (info.status !== 'progress' || !sizes.has(info.file)) return;
    loaded.set(info.file, Math.min(info.loaded, sizes.get(info.file) ?? 0));
    const sum = [...loaded.values()].reduce((acc, bytes) => acc + bytes, 0);
    post({ type: 'progress', id: request.id, progress: total > 0 ? sum / total : 1 });
  };

  const create = (device: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', settings.modelId, {
      dtype: settings.dtype,
      device,
      local_files_only: true,
      progress_callback,
    });
  let device = settings.device;
  try {
    transcriber = await create(device);
  } catch (error) {
    // A WebGPU adapter can exist and still fail to run the model: WebAssembly always works.
    if (device !== 'webgpu' || failureCode('load', error) !== 'load') throw error;
    device = 'wasm';
    transcriber = await create(device);
  }
  loadedPack = { baseUrl: request.baseUrl, device };
  post({ type: 'loaded', id: request.id, device });
}

async function transcribe(request: Extract<WorkerRequest, { type: 'transcribe' }>): Promise<void> {
  if (transcriber === undefined) throw new Error('The speech model is not loaded.');
  const started = performance.now();
  const output: unknown = await transcriber(request.samples, {
    // The prompt of the language: for Wolof, <|startoftranscript|> alone, as in training.
    decoder_input_ids: request.prompt,
    max_new_tokens: MAX_NEW_TOKENS,
  });
  const ms = Math.round(performance.now() - started);
  post({ type: 'result', id: request.id, text: textOf(output), ms });
}

function textOf(output: unknown): string {
  const first: unknown = Array.isArray(output) ? output[0] : output;
  if (
    typeof first === 'object' &&
    first !== null &&
    'text' in first &&
    typeof first.text === 'string'
  ) {
    return first.text.trim();
  }
  throw new Error('The speech model returned no text.');
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  const kind = request.type === 'load' ? 'load' : 'transcribe';
  const next = queue.then(() => (request.type === 'load' ? load(request) : transcribe(request)));
  queue = next.catch((error: unknown) => {
    post({
      type: 'error',
      id: request.id,
      code: failureCode(kind, error),
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

// A message that cannot be read has no id to answer: the page times the request out.
scope.addEventListener('messageerror', () => undefined);

// The address of this script, as the page loaded it: the page asks the service
// worker to keep exactly this file once a voice is installed.
post({
  type: 'hello',
  id: 0,
  url: (self as unknown as { location: { href: string } }).location.href,
});
