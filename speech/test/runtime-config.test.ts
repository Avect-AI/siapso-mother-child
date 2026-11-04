// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRuntimeSettings,
  cacheOnlyFetch,
  failureCode,
  guardedFetch,
  runtimeSettings,
} from '../src/runtime-config.js';
import { VOICE_CACHE } from '../src/voice-pack.js';
import { FakeCacheStorage } from './fakes.js';

let storage: FakeCacheStorage;
let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = new FakeCacheStorage();
  vi.stubGlobal('caches', storage);
  network = vi.fn(() => Promise.reject(new Error('the network must not be used')));
  vi.stubGlobal('fetch', network);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE = 'https://app.test/voice/whisper-small-wolof-q8/';
const FILES = [
  'config.json',
  'onnx/encoder_model_quantized.onnx',
  'runtime/ort-wasm-simd-threaded.asyncify.mjs',
  'runtime/ort-wasm-simd-threaded.asyncify.wasm',
];

describe('runtimeSettings', () => {
  it('loads local files only, from the pack folder, through the browser cache', () => {
    const settings = runtimeSettings(BASE, false);
    expect(settings.env).toEqual({
      allowRemoteModels: false,
      allowLocalModels: true,
      localModelPath: 'https://app.test/voice/',
      useBrowserCache: true,
      useWasmCache: true,
      useFSCache: false,
      useCustomCache: false,
      // The cache installVoicePack fills, named explicitly.
      cacheKey: VOICE_CACHE,
    });
    // Transformers.js joins localModelPath and the model id to find the files.
    expect(`${settings.env.localModelPath}${settings.modelId}/`).toBe(BASE);
    expect(settings.dtype).toBe('q8');
  });

  it('takes the ONNX Runtime binaries from the pack, never from a CDN', () => {
    expect(runtimeSettings(BASE, false).wasmPaths).toEqual({
      mjs: `${BASE}runtime/ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${BASE}runtime/ort-wasm-simd-threaded.asyncify.wasm`,
    });
  });

  it('uses WebGPU when the browser has it, WebAssembly otherwise', () => {
    expect(runtimeSettings(BASE, true).device).toBe('webgpu');
    expect(runtimeSettings(BASE, false).device).toBe('wasm');
  });

  it.each([
    'voice/whisper-small-wolof-q8/',
    'https://app.test/voice/whisper-small-wolof-q8',
    'file:///voice/x/',
  ])('refuses the base URL %s', (base) => {
    expect(() => runtimeSettings(base, false)).toThrow();
  });
});

describe('guardedFetch', () => {
  it('passes the files of the pack to fetch', async () => {
    const inner = vi.fn(() => Promise.resolve(new Response('ok')));
    const fetch = guardedFetch(BASE, FILES, inner);
    const response = await fetch(`${BASE}config.json`);
    expect(await response.text()).toBe('ok');
    expect(inner).toHaveBeenCalledWith(`${BASE}config.json`, undefined);
  });

  it.each([
    'https://huggingface.co/whisper-small-wolof-q8/resolve/main/config.json',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
    'https://app.test/voice/other-pack/config.json',
    'https://app.test/api/upload',
  ])('never lets a request leave the pack: %s', async (url) => {
    const inner = vi.fn(() => Promise.resolve(new Response('ok')));
    await expect(guardedFetch(BASE, FILES, inner)(url)).rejects.toThrow(/outside the voice pack/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('answers 404 for a file the pack does not list, without a request', async () => {
    const inner = vi.fn(() => Promise.resolve(new Response('index.html')));
    const response = await guardedFetch(BASE, FILES, inner)(`${BASE}processor_config.json`);
    expect(response.status).toBe(404);
    expect(inner).not.toHaveBeenCalled();
  });

  it('accepts URL objects and requests', async () => {
    const inner = vi.fn(() => Promise.resolve(new Response('ok')));
    const fetch = guardedFetch(BASE, FILES, inner);
    await fetch(new URL(`${BASE}config.json`));
    await fetch(new Request(`${BASE}onnx/encoder_model_quantized.onnx`));
    expect(inner).toHaveBeenCalledTimes(2);
  });
});

describe('cacheOnlyFetch', () => {
  it('answers from the voice cache, never from the network', async () => {
    const cache = await storage.open(VOICE_CACHE);
    await cache.put(`${BASE}config.json`, new Response('{"model_type":"whisper"}'));
    const fetch = cacheOnlyFetch(VOICE_CACHE);
    expect(await (await fetch(`${BASE}config.json`)).text()).toBe('{"model_type":"whisper"}');
    // A range request (Transformers.js asks for metadata this way) is answered from the cache too.
    const range = await fetch(`${BASE}config.json`, { headers: { Range: 'bytes=0-0' } });
    expect(range.status).toBe(200);
    expect(network).not.toHaveBeenCalled();
  });

  it('answers 404 for a file that is not installed, so nothing is downloaded behind the user', async () => {
    const response = await cacheOnlyFetch(VOICE_CACHE)(`${BASE}onnx/encoder_model_quantized.onnx`);
    expect(response.status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });

  it('answers 404 when the Cache API is not available', async () => {
    vi.stubGlobal('caches', undefined);
    expect((await cacheOnlyFetch(VOICE_CACHE)(`${BASE}config.json`)).status).toBe(404);
  });
});

describe('failureCode', () => {
  function named(name: string, message = 'x'): Error {
    const error = new Error(message);
    error.name = name;
    return error;
  }

  it('says unavailable when a pack file is missing while loading', () => {
    expect(failureCode('load', named('ModelFileNotFoundError'))).toBe('unavailable');
    expect(
      failureCode('load', new Error('Failed to fetch ort-wasm-simd-threaded.asyncify.wasm: 404')),
    ).toBe('unavailable');
  });

  it('says storage when the storage is full', () => {
    expect(failureCode('load', new DOMException('quota', 'QuotaExceededError'))).toBe('storage');
    expect(failureCode('transcribe', new DOMException('quota', 'QuotaExceededError'))).toBe(
      'storage',
    );
  });

  it('otherwise keeps the kind of request', () => {
    expect(failureCode('load', new Error('no backend'))).toBe('load');
    expect(failureCode('transcribe', new Error('out of memory'))).toBe('transcribe');
    expect(failureCode('transcribe', 'not an error')).toBe('transcribe');
  });
});

describe('applyRuntimeSettings', () => {
  function transformersEnv() {
    return {
      allowRemoteModels: true,
      allowLocalModels: false,
      localModelPath: '/models/',
      useBrowserCache: true,
      useWasmCache: true,
      useFSCache: false,
      useCustomCache: false,
      cacheKey: 'other-cache',
      fetch: globalThis.fetch,
      backends: { onnx: { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/x/' as unknown } } },
    };
  }

  it('configures the Transformers.js environment and the ONNX Runtime paths', async () => {
    const env = transformersEnv();
    const settings = runtimeSettings(BASE, false);
    applyRuntimeSettings(env, settings, FILES);
    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.localModelPath).toBe('https://app.test/voice/');
    expect(env.cacheKey).toBe(VOICE_CACHE);
    expect(env.backends.onnx.wasm.wasmPaths).toEqual(settings.wasmPaths);
    await expect(env.fetch('https://huggingface.co/x')).rejects.toThrow(/outside the voice pack/);
  });

  it('gives Transformers.js a fetch that reads the installed pack and never downloads', async () => {
    const env = transformersEnv();
    applyRuntimeSettings(env, runtimeSettings(BASE, false), FILES);
    const cache = await storage.open(VOICE_CACHE);
    await cache.put(`${BASE}config.json`, new Response('{}'));
    expect((await env.fetch(`${BASE}config.json`)).status).toBe(200);
    expect((await env.fetch(`${BASE}onnx/encoder_model_quantized.onnx`)).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });
});
