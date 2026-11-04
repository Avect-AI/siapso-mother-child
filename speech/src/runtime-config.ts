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
  backends: { onnx: { wasm?: { wasmPaths?: unknown } } };
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

export function runtimeSettings(baseUrl: string, webgpu: boolean): RuntimeSettings {
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
  };
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
}
