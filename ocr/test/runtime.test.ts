// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OCR_CACHE } from '../src/ocr-pack.js';
import { cacheOnlyFetch, guardedFetch, readInstalledFile, threadCount } from '../src/runtime.js';
import { FakeCacheStorage } from './fakes.js';

const BASE = 'https://app.test/ocr/ppocrv5-mobile-latin/';

let storage: FakeCacheStorage;

beforeEach(async () => {
  storage = new FakeCacheStorage();
  vi.stubGlobal('caches', storage);
  const cache = await storage.open(OCR_CACHE);
  await cache.put(`${BASE}models/det.onnx`, new Response('det'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cacheOnlyFetch', () => {
  it('answers an installed file from the cache, anything else 404, never the network', async () => {
    const network = vi.fn(() => Promise.resolve(new Response('from the network')));
    vi.stubGlobal('fetch', network);
    const fetchFromCache = cacheOnlyFetch(OCR_CACHE);
    expect(await (await fetchFromCache(`${BASE}models/det.onnx`)).text()).toBe('det');
    expect((await fetchFromCache(`${BASE}models/rec-latin.onnx`)).status).toBe(404);
    expect(network).not.toHaveBeenCalled();
  });

  it('answers 404 without the Cache API', async () => {
    vi.stubGlobal('caches', undefined);
    expect((await cacheOnlyFetch(OCR_CACHE)(`${BASE}models/det.onnx`)).status).toBe(404);
  });
});

describe('guardedFetch', () => {
  const inner = vi.fn(() => Promise.resolve(new Response('ok')));
  const guarded = guardedFetch(BASE, ['models/det.onnx'], inner, ['blob:https://app.test/1']);

  it('lets only the files of the pack through, and the worker own blob addresses', async () => {
    expect(await (await guarded(`${BASE}models/det.onnx`)).text()).toBe('ok');
    expect(await (await guarded(new URL('blob:https://app.test/1'))).text()).toBe('ok');
  });

  it('answers 404 for a path of the pack folder the manifest does not list', async () => {
    expect((await guarded(`${BASE}index.html`)).status).toBe(404);
  });

  it('refuses every other address: a CDN, the Hugging Face hub, the app itself', async () => {
    inner.mockClear();
    for (const url of [
      'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
      'https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx',
      'https://app.test/pack/manifest.json',
      new Request('https://app.test/ocr/other/models/det.onnx'),
    ]) {
      await expect(guarded(url)).rejects.toThrow(/refused/);
    }
    expect(inner).not.toHaveBeenCalled();
  });

  it('needs a pack folder over HTTP(S), ending with a slash', () => {
    expect(() => guardedFetch('file:///c:/ocr/', [], inner)).toThrow();
    expect(() => guardedFetch('https://app.test/ocr/x', [], inner)).toThrow();
  });
});

describe('readInstalledFile', () => {
  it('reads a file of the pack from the cache', async () => {
    const bytes = await readInstalledFile(`${BASE}models/det.onnx`);
    expect(new TextDecoder().decode(bytes)).toBe('det');
  });

  it('says unavailable when the file is not installed: never a download', async () => {
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    await expect(readInstalledFile(`${BASE}models/rec-latin.onnx`)).rejects.toMatchObject({
      reason: 'unavailable',
    });
    expect(network).not.toHaveBeenCalled();
  });
});

describe('threadCount', () => {
  it('runs on one thread unless the page is cross-origin isolated', () => {
    expect(threadCount(false, 8)).toBe(1);
    expect(threadCount(true, 8)).toBe(4);
    expect(threadCount(true, 2)).toBe(1);
    expect(threadCount(true, 8, 2)).toBe(2);
    expect(threadCount(true, undefined)).toBe(1);
  });
});
