// SPDX-License-Identifier: MIT
// Bench page: the app has no prescription screen yet (SCRUM-57 phase 3), so
// the bench drives @siapso/ocr here, built by Vite as the app will build it,
// with the pack served from /ocr/. Two ways to read:
//  - worker: the production path (createOcrClient and its Web Worker);
//  - page: the same engine on the page thread, because Chrome DevTools CPU
//    throttling slows the page thread and does not reach workers.
// On a phone, call siapsoBench from the remote DevTools console (docs/ocr.md).
import { loadEngine, readInput, type LoadedEngine } from '../src/engine.js';
import {
  OCR_CACHE,
  OCR_PACK_URL,
  OcrPackError,
  createOcrClient,
  installOcrPack,
  installedOcrPackInfo,
  ocrPackInfo,
  type OcrClient,
  type OcrPackInfo,
} from '../src/index.js';

let info: OcrPackInfo | undefined;
let client: OcrClient | undefined;
let inPage: LoadedEngine | undefined;

function blobOf(base64: string, type: string): Blob {
  return new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type });
}

function pack(): OcrPackInfo {
  if (info === undefined) throw new Error('install() first');
  return info;
}

function reader(): OcrClient {
  client ??= createOcrClient(pack());
  return client;
}

const bench = {
  /** Whether the pack is installed, read from the Cache API only: no request. */
  async installed(url: string = OCR_PACK_URL) {
    return (await installedOcrPackInfo(url)) !== null;
  },

  /**
   * The install screen reads the manifest, then a reading is asked before the
   * installation: it must fail as `unavailable`, start no worker and fetch
   * no model, runtime or pdf.js file.
   */
  async readBeforeInstall(base64: string, type: string, url: string = OCR_PACK_URL) {
    info = await ocrPackInfo(url);
    try {
      await reader().read(blobOf(base64, type));
      return 'read';
    } catch (error) {
      return error instanceof OcrPackError ? error.reason : String(error);
    }
  },

  async install(url: string = OCR_PACK_URL) {
    info ??= await ocrPackInfo(url);
    const started = performance.now();
    await installOcrPack(info, () => undefined);
    return {
      id: info.id,
      totalBytes: info.totalBytes,
      ms: Math.round(performance.now() - started),
    };
  },

  /** A photo or a PDF read by the worker; `wallMs` includes the models' load on a first reading. */
  async read(base64: string, type: string) {
    const started = performance.now();
    const reading = await reader().read(blobOf(base64, type));
    return { ...reading, wallMs: Math.round(performance.now() - started) };
  },

  /** A camera frame (an ImageBitmap, transferred to the worker). */
  async readFrame(base64: string, type: string) {
    const frame = await createImageBitmap(blobOf(base64, type));
    const started = performance.now();
    const reading = await reader().read(frame);
    return { ...reading, wallMs: Math.round(performance.now() - started) };
  },

  /** Frees the models, as the app does when the page is hidden. */
  release() {
    client?.release();
  },

  /** The same engine on the page thread, one thread (DevTools throttling applies here). */
  async loadPage() {
    const started = performance.now();
    inPage = await loadEngine(pack().baseUrl, 1);
    return Math.round(performance.now() - started);
  },

  async readPage(base64: string, type: string) {
    if (inPage === undefined) throw new Error('loadPage() first');
    const started = performance.now();
    const reading = await readInput(blobOf(base64, type), inPage);
    return { ...reading, ms: Math.round(performance.now() - started) };
  },

  async cacheState() {
    const cache = await caches.open(OCR_CACHE);
    const estimate = await navigator.storage.estimate();
    return {
      entries: (await cache.keys()).length,
      usage: estimate.usage,
      quota: estimate.quota,
      persisted: await navigator.storage.persisted(),
    };
  },

  environment() {
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory,
      crossOriginIsolated: globalThis.crossOriginIsolated,
    };
  },
};

(globalThis as unknown as { siapsoBench: typeof bench }).siapsoBench = bench;
