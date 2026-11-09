// SPDX-License-Identifier: MIT
// The page side of the reading worker. The photo or the PDF goes to the
// worker in memory and is never stored; the lines come back as text, which
// the app reads into products for her to confirm (models propose, rules
// decide). Nothing is read before the pack is installed, and nothing here
// ever downloads: the worker reads the pack from the Cache API only.
import { MAX_FILE_BYTES, checkFile } from './limits.js';
import { OcrPackError, isOcrPackInstalled, type OcrPackInfo } from './ocr-pack.js';
import type { OcrSource, WorkerRequest, WorkerResponse } from './protocol.js';

/**
 * How long a reading may take, the models' load included, before it is given
 * up and the worker ended and replaced. A page took 23 s on a laptop with the
 * CPU slowed 6 times, the stand-in for an entry-level phone, plus 1.7 s to
 * load the models (docs/ocr.md): 90 s leaves room for a slower phone and a
 * PDF of three scanned pages, until real phones are measured. She can cancel
 * at any time before that.
 */
export const DEFAULT_READ_TIMEOUT_MS = 90_000;

/**
 * The models are freed (the worker ended) this long after the last reading:
 * a pharmacist reads several prescriptions a few minutes apart, and a 2 GB
 * phone gets its memory back soon after. The app also frees them at once
 * when the page is hidden (`release`).
 */
export const OCR_IDLE_MS = 180_000;

/** The share of the progress the models' load stands for. */
const LOAD_SHARE = 0.2;

/** Bytes of a file read before it is sent, to tell what it is and its size in pixels. */
const HEAD_BYTES = 64 * 1024;

export interface OcrClientOptions {
  /** Time limit of a reading, in milliseconds (default 90 s). */
  timeoutMs?: number;
  /** How long the models stay loaded after a reading (default 3 minutes). */
  idleMs?: number;
}

export interface OcrReadOptions {
  /** Called with 0 to 1: the models' load, then the reading. */
  onProgress?: (progress: number) => void;
  /** Aborting it cancels the reading (as `cancel`). */
  signal?: AbortSignal;
}

export interface OcrReading {
  /** The lines of text, in reading order. Nothing else is kept of the file. */
  lines: string[];
  source: OcrSource;
  /** The pages read: 1 for a photo, up to 3 for a PDF. */
  pages: number;
  /** Time spent reading, in milliseconds (the models' load apart). */
  ms: number;
}

export interface OcrClient {
  /**
   * Reads a photo or a PDF (a Blob from the file chooser) or a camera frame
   * (an ImageBitmap, transferred: the page keeps no copy). One reading at a
   * time, in order. Rejects with OcrPackError: `unavailable` (pack not
   * installed; no worker is started and nothing is requested), `not-image`,
   * `too-large`, `pdf-password`, `pdf-damaged`, `pdf-unsupported`, `load`, `read`, `timeout`,
   * `cancelled`.
   */
  read(input: Blob | ImageBitmap, options?: OcrReadOptions): Promise<OcrReading>;
  /** Gives up the readings asked so far: the one under way stops with its worker. */
  cancel(): void;
  /** Frees the models now (the page is hidden, the app locks): the next reading loads them again. */
  release(): void;
  /** Ends the worker for good: every reading is refused afterwards. */
  dispose(): void;
}

interface Pending {
  id: number;
  resolve: (reading: OcrReading) => void;
  reject: (error: Error) => void;
  onProgress: ((progress: number) => void) | undefined;
}

function isBitmap(input: Blob | ImageBitmap): input is ImageBitmap {
  const Bitmap = (globalThis as { ImageBitmap?: abstract new () => ImageBitmap }).ImageBitmap;
  return Bitmap !== undefined && input instanceof Bitmap;
}

/** Refuses a file that is not a photo nor a PDF, or too large, before any worker starts. */
async function checkBlob(blob: Blob): Promise<void> {
  if (blob.size > MAX_FILE_BYTES) {
    throw new OcrPackError('too-large', 'The file is too large for this phone.');
  }
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  const check = checkFile(head, blob.size);
  if ('refused' in check) {
    throw new OcrPackError(
      check.refused,
      check.refused === 'too-large'
        ? 'The photo has too many pixels for this phone.'
        : 'The file is neither a photo nor a PDF.',
    );
  }
}

/** The reading client for an installed pack. Starts no worker until the first reading. */
export function createOcrClient(info: OcrPackInfo, options: OcrClientOptions = {}): OcrClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const idleMs = options.idleMs ?? OCR_IDLE_MS;
  let worker: Worker | undefined;
  let pending: Pending | undefined;
  let nextId = 1;
  let disposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  // Cancels drop the readings asked before them, waiting or under way.
  let cancels = 0;
  let queue: Promise<unknown> = Promise.resolve();

  function stopWorker(): void {
    if (worker === undefined) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = undefined;
  }

  function fail(reason: 'cancelled' | 'timeout' | 'load', message: string): void {
    const current = pending;
    pending = undefined;
    stopWorker();
    current?.reject(new OcrPackError(reason, message));
  }

  function spawn(): Worker {
    // Built as assets/ocr-worker-<hash>.js, a name of its own: the app's
    // service worker precaches it with the app shell, so a new worker starts
    // offline, while the speech worker's script (assets/worker-<hash>.js) is
    // kept apart until a voice is installed (app/src/pwa/worker-scripts.test.ts).
    const created = new Worker(new URL('./ocr-worker.ts', import.meta.url), {
      type: 'module',
      name: 'siapso-ocr',
    });
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const current = pending;
      if (message.type === 'hello' || current === undefined || message.id !== current.id) return;
      if (message.type === 'progress') {
        const share = message.stage === 'load' ? 0 : LOAD_SHARE;
        const width = message.stage === 'load' ? LOAD_SHARE : 1 - LOAD_SHARE;
        current.onProgress?.(share + width * message.progress);
        return;
      }
      pending = undefined;
      if (message.type === 'error') {
        current.reject(new OcrPackError(message.reason, message.message));
      } else {
        const { lines, source, pages, ms } = message;
        current.resolve({ lines, source, pages, ms });
      }
    };
    created.onerror = (event: ErrorEvent) => {
      // A worker that cannot start (offline, not cached) or that crashed (memory).
      const where = event.filename ? ` (${event.filename}:${String(event.lineno)})` : '';
      fail(
        'load',
        `The reading worker stopped: ${(event.message as string | undefined) ?? 'it could not be started'}${where}`,
      );
    };
    created.onmessageerror = () => {
      fail('load', 'A message from the reading worker could not be read.');
    };
    return created;
  }

  function scheduleRelease(): void {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (pending === undefined) stopWorker();
    }, idleMs);
  }

  async function run(
    input: Blob | ImageBitmap,
    readOptions: OcrReadOptions,
    askedAt: number,
  ): Promise<OcrReading> {
    // Cancelled, disposed or aborted since it was asked: checked again after each wait.
    const stopIfStale = () => {
      if (disposed || askedAt !== cancels || readOptions.signal?.aborted === true) {
        throw new OcrPackError('cancelled', 'The reading was cancelled.');
      }
    };
    stopIfStale();
    if (!(await isOcrPackInstalled(info))) {
      throw new OcrPackError('unavailable', `The reading pack ${info.id} is not installed.`);
    }
    if (!isBitmap(input)) await checkBlob(input);
    stopIfStale();
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    worker ??= spawn();
    const target = worker;
    const id = nextId++;
    try {
      return await new Promise<OcrReading>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending?.id === id) {
            fail('timeout', `The reading took longer than ${String(timeoutMs)} ms.`);
          }
        }, timeoutMs);
        const onAbort = () => {
          if (pending?.id === id) fail('cancelled', 'The reading was cancelled.');
        };
        readOptions.signal?.addEventListener('abort', onAbort, { once: true });
        const done = () => {
          clearTimeout(timer);
          readOptions.signal?.removeEventListener('abort', onAbort);
        };
        pending = {
          id,
          resolve: (reading) => {
            done();
            resolve(reading);
          },
          reject: (error) => {
            done();
            reject(error);
          },
          onProgress: readOptions.onProgress,
        };
        const request: WorkerRequest = {
          type: 'read',
          id,
          baseUrl: info.baseUrl,
          files: info.files.map((file) => file.path),
          input,
        };
        target.postMessage(request, isBitmap(input) ? [input] : []);
      });
    } finally {
      if (!disposed) scheduleRelease();
    }
  }

  return {
    read(input, readOptions = {}) {
      const askedAt = cancels;
      const next = queue.then(() => run(input, readOptions, askedAt));
      queue = next.catch(() => undefined);
      return next;
    },

    cancel() {
      cancels += 1;
      if (pending !== undefined) fail('cancelled', 'The reading was cancelled.');
    },

    release() {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      if (pending !== undefined) fail('cancelled', 'The reading was stopped to free the memory.');
      stopWorker();
    },

    dispose() {
      disposed = true;
      cancels += 1;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (pending !== undefined) fail('cancelled', 'The reading worker was stopped.');
      stopWorker();
    },
  };
}
