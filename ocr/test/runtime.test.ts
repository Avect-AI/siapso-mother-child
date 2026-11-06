// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OCR_CACHE } from '../src/ocr-pack.js';
import {
  cacheOnlyFetch,
  closeNetwork,
  guardedFetch,
  readInstalledFile,
  threadCount,
  withModuleUrl,
} from '../src/runtime.js';
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
  const guarded = guardedFetch(BASE, ['models/det.onnx'], inner);

  it('lets only the files of the pack through', async () => {
    expect(await (await guarded(`${BASE}models/det.onnx`)).text()).toBe('ok');
  });

  it('refuses a blob address too: the worker revokes its own once loaded', async () => {
    inner.mockClear();
    await expect(guarded(new URL('blob:https://app.test/1'))).rejects.toThrow(/refused/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('hands the address resolved in the pack folder on, never the relative one it was given', async () => {
    // A relative address would be read against the worker script, not the pack.
    const reader = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response('ok')),
    );
    const relative = guardedFetch(BASE, ['models/det.onnx'], reader);
    await relative('models/det.onnx');
    await relative(new Request(`${BASE}models/det.onnx`));
    expect(reader.mock.calls.map(([input]) => input)).toEqual([
      `${BASE}models/det.onnx`,
      `${BASE}models/det.onnx`,
    ]);
  });

  it('reads a relative address of the pack from the cache, as the absolute one', async () => {
    const relative = guardedFetch(BASE, ['models/det.onnx'], cacheOnlyFetch(OCR_CACHE));
    expect(await (await relative('models/det.onnx')).text()).toBe('det');
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

describe('closeNetwork', () => {
  class Open {
    opened = true;
  }

  function scope(): Record<string, unknown> {
    return {
      fetch: vi.fn(() => Promise.resolve(new Response('from the network'))),
      XMLHttpRequest: Open,
      WebSocket: Open,
      EventSource: Open,
      WebTransport: Open,
      importScripts: vi.fn(),
    };
  }

  it('closes XMLHttpRequest, WebSocket, EventSource and WebTransport: each throws when made', () => {
    const worker = scope();
    closeNetwork(worker);
    for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport']) {
      const Api = worker[name] as new (url: string) => unknown;
      expect(() => new Api('https://example.org/'), name).toThrow(/closed in the reading worker/);
    }
  });

  it('closes importScripts and refuses every fetch until the pack guard replaces it', async () => {
    const worker = scope();
    const network = worker['fetch'];
    closeNetwork(worker);
    expect(() => {
      (worker['importScripts'] as (url: string) => void)('https://example.org/x.js');
    }).toThrow(/closed in the reading worker/);
    await expect((worker['fetch'] as typeof fetch)(`${BASE}models/det.onnx`)).rejects.toThrow(
      /refused/,
    );
    expect(network).not.toHaveBeenCalled();
  });

  it('leaves alone what the scope does not have', () => {
    const worker: Record<string, unknown> = { fetch: vi.fn() };
    closeNetwork(worker);
    expect(Object.keys(worker).sort()).toEqual(['fetch']);
  });
});

describe('withModuleUrl', () => {
  it('hands an installed file over as a blob address, revoked once it is used', async () => {
    const made: Blob[] = [];
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      made.push(blob as Blob);
      return 'blob:https://app.test/loader';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      const seen = await withModuleUrl(`${BASE}models/det.onnx`, (address) => {
        expect(revoke).not.toHaveBeenCalled();
        return Promise.resolve(address);
      });
      expect(seen).toBe('blob:https://app.test/loader');
      expect(await made[0]?.text()).toBe('det');
      expect(made[0]?.type).toBe('text/javascript');
      expect(revoke).toHaveBeenCalledWith('blob:https://app.test/loader');
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
  });

  it('revokes the address when its use fails, and makes none for a file not installed', async () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:https://app.test/parser');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      await expect(
        withModuleUrl(`${BASE}models/det.onnx`, () => Promise.reject(new Error('import failed'))),
      ).rejects.toThrow('import failed');
      expect(revoke).toHaveBeenCalledWith('blob:https://app.test/parser');
      create.mockClear();
      await expect(
        withModuleUrl(`${BASE}pdf/missing.mjs`, () => Promise.resolve()),
      ).rejects.toMatchObject({ reason: 'unavailable' });
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
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
