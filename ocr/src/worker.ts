// SPDX-License-Identifier: MIT
/*! SIAPSO reading worker. Bundles the JavaScript of ONNX Runtime Web
 * (Copyright Microsoft Corporation, MIT License,
 * https://github.com/microsoft/onnxruntime). The PaddleOCR PP-OCRv5 models
 * (Apache License 2.0), the ONNX Runtime WebAssembly files and pdf.js
 * (Apache License 2.0) come with the reading pack, with their licence texts
 * (licenses/ and NOTICE.md in the pack, docs/ocr.md). */
// The reading worker: PaddleOCR PP-OCRv5 mobile with ONNX Runtime Web, and
// pdf.js for PDFs, all read from the installed pack in the Cache API. The
// fetch it leaves to ONNX Runtime and pdf.js answers the pack's files from
// the cache and refuses every other address: no request outside the pack,
// and a file that is not installed is an error, never a download. The photo
// or the PDF stays in this worker's memory and is dropped once read; only
// the lines of text go back to the page.
import { loadEngine, readInput, type LoadedEngine } from './engine.js';
import { OcrPackError, type OcrErrorReason } from './ocr-pack.js';
import type { WorkerReadRequest, WorkerResponse } from './protocol.js';
import { cacheOnlyFetch, guardedFetch, threadCount } from './runtime.js';

const scope = globalThis as unknown as {
  postMessage(message: WorkerResponse): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerReadRequest>) => void,
  ): void;
  fetch: typeof fetch;
  location: { href: string };
  crossOriginIsolated?: boolean;
  navigator: { hardwareConcurrency?: number; deviceMemory?: number };
};

let loaded: LoadedEngine | undefined;
// Readings run one at a time, in the order they arrive.
let queue: Promise<unknown> = Promise.resolve();

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

async function load(request: WorkerReadRequest): Promise<LoadedEngine> {
  if (loaded !== undefined) {
    if (loaded.baseUrl === request.baseUrl) return loaded;
    throw new OcrPackError('load', 'This reading worker already runs another pack.');
  }
  // Refused before anything loads: only the pack's files, from the cache.
  scope.fetch = guardedFetch(request.baseUrl, request.files, cacheOnlyFetch());
  const threads = threadCount(
    scope.crossOriginIsolated === true,
    scope.navigator.hardwareConcurrency,
    scope.navigator.deviceMemory,
  );
  const engine = await loadEngine(request.baseUrl, threads, (progress) => {
    post({ type: 'progress', id: request.id, stage: 'load', progress });
  });
  // The runtime's loader, a blob address of this worker, is allowed too.
  scope.fetch = guardedFetch(request.baseUrl, request.files, cacheOnlyFetch(), engine.blobs);
  loaded = engine;
  return engine;
}

async function read(request: WorkerReadRequest): Promise<void> {
  const loadStarted = performance.now();
  const wasLoaded = loaded !== undefined;
  const engine = await load(request);
  const loadMs = wasLoaded ? 0 : Math.round(performance.now() - loadStarted);
  const started = performance.now();
  const reading = await readInput(request.input, engine, (progress) => {
    post({ type: 'progress', id: request.id, stage: 'read', progress });
  });
  post({
    type: 'result',
    id: request.id,
    ...reading,
    ms: Math.round(performance.now() - started),
    loadMs,
  });
}

function reasonOf(error: unknown, stage: 'load' | 'read'): OcrErrorReason {
  if (error instanceof OcrPackError) return error.reason;
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'storage';
  return stage;
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  const next = queue.then(() => read(request));
  queue = next.catch((error: unknown) => {
    post({
      type: 'error',
      id: request.id,
      reason: reasonOf(error, loaded === undefined ? 'load' : 'read'),
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

// An error outside a reading (the runtime aborting, out of memory) ends the
// worker: the page then says the reading did not succeed. Said in the
// console for remote DevTools on a phone; never any text read.
(
  globalThis as unknown as {
    addEventListener(type: string, listener: (event: unknown) => void): void;
  }
).addEventListener('error', (event) => {
  const { message, filename, lineno } = event as ErrorEvent;
  console.error(`siapso-ocr worker error: ${message} (${filename}:${String(lineno)})`);
});

// The address of this script, as the page loaded it: the app's service worker
// can keep exactly this file once the pack is installed (phase 3).
post({ type: 'hello', id: 0, url: scope.location.href });
