// SPDX-License-Identifier: MIT
// How the worker configures Transformers.js: local files only, from the
// voice pack folder, read from the Cache API and never from the network (a
// file that is not installed answers 404, so nothing is ever downloaded
// without the user's consent); ONNX Runtime binaries from the pack; every
// request outside the pack refused. Pure, so it is unit-tested.
import type { WorkerErrorCode } from './protocol.js';
import { RUNTIME_FILES, VOICE_CACHE } from './voice-pack.js';

export interface RuntimeEnvSettings {
  allowRemoteModels: false;
  allowLocalModels: true;
  localModelPath: string;
  useBrowserCache: true;
  useWasmCache: true;
  useFSCache: false;
  useCustomCache: false;
  /** The Cache API cache that installVoicePack fills. */
  cacheKey: string;
}

export interface RuntimeSettings {
  env: RuntimeEnvSettings;
  /** Folder name of the pack; Transformers.js loads `<localModelPath><modelId>/<file>`. */
  modelId: string;
  wasmPaths: { mjs: string; wasm: string };
  device: 'webgpu' | 'wasm';
  dtype: 'q8';
  /** ONNX Runtime WebAssembly threads (threadCount). */
  threads: number;
}

/**
 * A file of the pack is not in the voice cache: the pack must be installed
 * again (never downloaded behind the user).
 */
export class MissingPackFileError extends Error {
  constructor(file: string) {
    super(`The voice pack file ${file} is not installed.`);
    this.name = 'MissingPackFileError';
  }
}

/**
 * How many threads ONNX Runtime may use. Threads need shared memory, which
 * the browser gives only to a cross-origin isolated page (the app's service
 * worker sends the COOP and COEP headers): one thread otherwise. Isolated,
 * half the cores and at most four, as ONNX Runtime Web chooses by default
 * (measured: 6.7 s instead of 13 s per 3.3 s utterance on a laptop,
 * docs/voice.md). On a phone with 2 GB of memory or less
 * (`navigator.deviceMemory`), at most two: each thread is a worker with its
 * own copy of the runtime's JavaScript and stack, next to a model of several
 * hundred megabytes, and two keep most of the speed-up (to measure on a
 * 2 GB phone, docs/voice.md).
 */
export function threadCount(
  isolated: boolean,
  cores: number | undefined,
  deviceMemory?: number,
): number {
  if (!isolated || cores === undefined || !Number.isFinite(cores) || cores < 1) return 1;
  const most = deviceMemory !== undefined && deviceMemory <= 2 ? 2 : 4;
  return Math.max(1, Math.min(most, Math.ceil(cores / 2)));
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** The fields of the Transformers.js `env` object that the worker sets. */
export interface TransformersEnv {
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  localModelPath: string;
  useBrowserCache: boolean;
  useWasmCache: boolean;
  useFSCache: boolean;
  useCustomCache: boolean;
  cacheKey: string;
  fetch: Fetch;
  backends: { onnx: { wasm?: { wasmPaths?: unknown; numThreads?: number } } };
}

function packFolder(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`The voice pack must be served over HTTP(S): ${baseUrl}`);
  }
  if (!url.pathname.endsWith('/') || url.pathname === '/') {
    throw new Error(`The voice pack URL must be a folder ending with a slash: ${baseUrl}`);
  }
  return url;
}

export function runtimeSettings(baseUrl: string, webgpu: boolean, threads = 1): RuntimeSettings {
  const folder = packFolder(baseUrl);
  const segments = folder.pathname.split('/').filter((part) => part !== '');
  const modelId = segments.at(-1) ?? '';
  return {
    env: {
      allowRemoteModels: false,
      allowLocalModels: true,
      localModelPath: new URL('../', folder).href,
      useBrowserCache: true,
      useWasmCache: true,
      useFSCache: false,
      useCustomCache: false,
      cacheKey: VOICE_CACHE,
    },
    modelId,
    wasmPaths: {
      mjs: new URL(RUNTIME_FILES.mjs, folder).href,
      wasm: new URL(RUNTIME_FILES.wasm, folder).href,
    },
    device: webgpu ? 'webgpu' : 'wasm',
    dtype: 'q8',
    threads,
  };
}

/**
 * Checks that the ONNX Runtime files of the pack are in the voice cache.
 * Transformers.js reads them from the cache when it can, but when one is
 * missing it leaves ONNX Runtime to import and fetch it from its URL, over
 * the network: the worker calls this before creating the pipeline, so a
 * missing file is an error (`unavailable`), never a download.
 */
export async function checkRuntimeInstalled(settings: RuntimeSettings): Promise<void> {
  const storage = (globalThis as { caches?: CacheStorage }).caches;
  let cache: Cache | undefined;
  try {
    cache = await storage?.open(settings.env.cacheKey);
  } catch {
    cache = undefined;
  }
  for (const url of [settings.wasmPaths.mjs, settings.wasmPaths.wasm]) {
    if (cache === undefined || (await cache.match(url)) === undefined) {
      throw new MissingPackFileError(url);
    }
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function notInstalled(): Response {
  return new Response(null, { status: 404, statusText: 'Not in the installed voice pack' });
}

/**
 * A fetch that only reads the Cache API cache `cacheName`: an installed file
 * comes back from it, anything else answers 404. It never uses the network.
 */
export function cacheOnlyFetch(cacheName: string): Fetch {
  return async (input) => {
    const storage = (globalThis as { caches?: CacheStorage }).caches;
    if (storage === undefined) return notInstalled();
    try {
      const cache = await storage.open(cacheName);
      return (await cache.match(urlOf(input))) ?? notInstalled();
    } catch {
      return notInstalled();
    }
  };
}

/**
 * A fetch limited to the files of the pack: any other URL is refused, and a
 * path of the pack folder that the manifest does not list answers 404 (a
 * static host could otherwise answer with the app page).
 */
export function guardedFetch(baseUrl: string, paths: readonly string[], fetchImpl: Fetch): Fetch {
  const folder = packFolder(baseUrl).href;
  const allowed = new Set(paths.map((path) => new URL(path, folder).href));
  return (input, init) => {
    const url = new URL(urlOf(input), folder).href;
    if (!url.startsWith(folder)) {
      return Promise.reject(new Error(`Request outside the voice pack refused: ${url}`));
    }
    if (!allowed.has(url)) return Promise.resolve(new Response(null, { status: 404 }));
    return fetchImpl(input, init);
  };
}

/**
 * The error code the worker reports: a missing pack file while loading is
 * `unavailable` (the pack must be installed again), a full storage is
 * `storage`, anything else keeps the kind of request (`load`, `transcribe`).
 */
export function failureCode(kind: 'load' | 'transcribe', error: unknown): WorkerErrorCode {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof MissingPackFileError) return 'unavailable';
  if (name === 'QuotaExceededError') return 'storage';
  if (
    kind === 'load' &&
    (name === 'ModelFileNotFoundError' || /not found locally|Failed to fetch|404/.test(message))
  ) {
    return 'unavailable';
  }
  return kind;
}

/**
 * Configures Transformers.js for an installed pack. Its fetch is the guarded
 * fetch over the voice cache: a missing file is an error, never a download.
 */
export function applyRuntimeSettings(
  env: TransformersEnv,
  settings: RuntimeSettings,
  paths: readonly string[],
): void {
  Object.assign(env, settings.env);
  const baseUrl = `${settings.env.localModelPath}${settings.modelId}/`;
  env.fetch = guardedFetch(baseUrl, paths, cacheOnlyFetch(settings.env.cacheKey));
  const wasm = env.backends.onnx.wasm;
  if (wasm === undefined) throw new Error('ONNX Runtime Web is not loaded');
  wasm.wasmPaths = { ...settings.wasmPaths };
  wasm.numThreads = settings.threads;
}
