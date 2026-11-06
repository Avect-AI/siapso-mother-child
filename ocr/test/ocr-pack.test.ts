// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MANIFEST_FILE,
  MODEL_FILES,
  OCR_CACHE,
  OCR_PACK_URL,
  ORT_WEB_VERSION,
  OcrPackError,
  PDFJS_VERSION,
  PDF_FILES,
  RUNTIME_FILES,
  installOcrPack,
  installedOcrPackInfo,
  isOcrPackInstalled,
  ocrPackInfo,
  removeOcrPack,
  storedOcrPackBytes,
  type OcrPackInfo,
} from '../src/ocr-pack.js';
import { FakeCacheStorage, bytes, fakeFetch, type FakeFile } from './fakes.js';

const BASE = 'https://app.test/ocr/ppocrv5-mobile-latin/';

const FILES: Record<string, Uint8Array> = {
  [MODEL_FILES.detection]: bytes(5000, 2),
  [MODEL_FILES.recognition]: bytes(8000, 3),
  [MODEL_FILES.dictionary]: new TextEncoder().encode(JSON.stringify(['a', 'b'])),
  [RUNTIME_FILES.mjs]: bytes(700, 4),
  [RUNTIME_FILES.wasm]: bytes(3000, 5),
  [PDF_FILES.api]: bytes(400, 6),
  [PDF_FILES.worker]: bytes(900, 7),
  [PDF_FILES.jbig2]: bytes(100, 8),
  [PDF_FILES.openjpeg]: bytes(240, 9),
  'NOTICE.md': new TextEncoder().encode('# Notices'),
};

const sha256 = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');

function manifest(overrides: Record<string, unknown> = {}) {
  const files = Object.entries(FILES).map(([path, body]) => ({
    path,
    bytes: body.length,
    sha256: sha256(body),
  }));
  return {
    id: 'ppocrv5-mobile-latin',
    licence: 'Apache-2.0 AND MIT',
    models: {
      detection: {
        repo: 'PaddlePaddle/PP-OCRv5_mobile_det_onnx',
        revision: 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d',
        licence: 'Apache-2.0',
      },
      recognition: {
        repo: 'PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx',
        revision: '89d3a50e2c27e2e7cceeab0e944c25c807d5db4f',
        licence: 'Apache-2.0',
      },
    },
    runtime: { 'onnxruntime-web': ORT_WEB_VERSION, 'pdfjs-dist': PDFJS_VERSION },
    files,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    ...overrides,
  };
}

function served(extra: Record<string, FakeFile | string> = {}, json: unknown = manifest()) {
  const files: Record<string, FakeFile | string> = {
    [`${BASE}${MANIFEST_FILE}`]: JSON.stringify(json),
  };
  for (const [path, body] of Object.entries(FILES)) files[BASE + path] = { body };
  return { ...files, ...extra };
}

let storage: FakeCacheStorage;

beforeEach(() => {
  storage = new FakeCacheStorage();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('location', { href: 'https://app.test/#/check' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function info(): Promise<OcrPackInfo> {
  vi.stubGlobal('fetch', fakeFetch(served()).fetch);
  return ocrPackInfo(BASE);
}

describe('the pack layout', () => {
  it('lives at ocr/<id>/ next to the app, with its runtime and pdf.js under their versions', () => {
    expect(OCR_PACK_URL).toBe('ocr/ppocrv5-mobile-latin/');
    expect(RUNTIME_FILES).toEqual({
      mjs: `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.mjs`,
      wasm: `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.wasm`,
    });
    // With the WebAssembly decoders of scanned images: JBIG2 and CCITT, JPEG 2000.
    expect(PDF_FILES).toEqual({
      api: `pdf/${PDFJS_VERSION}/pdf.min.mjs`,
      worker: `pdf/${PDFJS_VERSION}/pdf.worker.min.mjs`,
      jbig2: `pdf/${PDFJS_VERSION}/wasm/jbig2.wasm`,
      openjpeg: `pdf/${PDFJS_VERSION}/wasm/openjpeg.wasm`,
    });
    expect(MODEL_FILES).toEqual({
      detection: 'models/det.onnx',
      recognition: 'models/rec-latin.onnx',
      dictionary: 'models/dict-latin.json',
    });
  });
});

describe('ocrPackInfo', () => {
  it('reads ocr-pack.json under the base URL, resolved against the page', async () => {
    const { fetch, requests } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    const pack = await ocrPackInfo('ocr/ppocrv5-mobile-latin');
    expect(requests).toEqual([`${BASE}ocr-pack.json`]);
    expect(pack.baseUrl).toBe(BASE);
    expect(pack.id).toBe('ppocrv5-mobile-latin');
    expect(pack.files).toHaveLength(Object.keys(FILES).length);
    expect(pack.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pack.models.detection.revision).toBe('e6f4fa85f00e168c862bc462aebca69eef9b3d3d');
    expect(pack.runtime).toEqual({ onnxruntime: ORT_WEB_VERSION, pdfjs: PDFJS_VERSION });
  });

  it('refuses a manifest whose files leave the pack folder, lack a hash or do not add up', async () => {
    const cases: [string, Record<string, unknown>][] = [
      ['leaves', { files: [{ path: '../app.js', bytes: 1, sha256: 'a'.repeat(64) }] }],
      ['no hash', { files: manifest().files.map((f) => ({ ...f, sha256: 'x' })) }],
      ['sum', { totalBytes: 1 }],
      ['no id', { id: '' }],
      ['no licence', { licence: undefined }],
      ['no models', { models: undefined }],
    ];
    for (const [label, overrides] of cases) {
      vi.stubGlobal('fetch', fakeFetch(served({}, manifest(overrides))).fetch);
      await expect(ocrPackInfo(BASE), label).rejects.toMatchObject({ reason: 'invalid' });
    }
  });

  it('refuses a pack built for another ONNX Runtime or pdf.js: it is to install again', async () => {
    for (const runtime of [
      { 'onnxruntime-web': '1.22.0', 'pdfjs-dist': PDFJS_VERSION },
      { 'onnxruntime-web': ORT_WEB_VERSION, 'pdfjs-dist': '5.0.0' },
      undefined,
    ]) {
      vi.stubGlobal('fetch', fakeFetch(served({}, manifest({ runtime }))).fetch);
      await expect(ocrPackInfo(BASE)).rejects.toMatchObject({ reason: 'invalid' });
    }
  });

  it('refuses a manifest that lacks a model, the runtime or pdf.js', async () => {
    for (const missing of [
      MODEL_FILES.detection,
      RUNTIME_FILES.wasm,
      PDF_FILES.worker,
      PDF_FILES.jbig2,
      PDF_FILES.openjpeg,
    ]) {
      const files = manifest().files.filter((f) => f.path !== missing);
      const json = manifest({ files, totalBytes: files.reduce((s, f) => s + f.bytes, 0) });
      vi.stubGlobal('fetch', fakeFetch(served({}, json)).fetch);
      await expect(ocrPackInfo(BASE), missing).rejects.toMatchObject({ reason: 'invalid' });
    }
  });

  it('reads a host that answers with the app page as no pack, never as damaged', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch({ [`${BASE}ocr-pack.json`]: '<!doctype html><title>app</title>' }).fetch,
    );
    await expect(ocrPackInfo(BASE)).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('uses the installed copy offline', async () => {
    const pack = await info();
    await installOcrPack(pack, () => undefined);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    expect((await ocrPackInfo(BASE)).id).toBe('ppocrv5-mobile-latin');
  });

  it('says unavailable offline when nothing is installed', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    const error = await ocrPackInfo(BASE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrPackError);
    expect(error).toMatchObject({ reason: 'unavailable' });
  });
});

describe('installOcrPack', () => {
  it('stores every file and the manifest in its own cache, with progress', async () => {
    const pack = await info();
    const progress: number[] = [];
    await installOcrPack(pack, (loaded, total) => {
      expect(total).toBe(pack.totalBytes);
      progress.push(loaded);
    });
    const cache = storage.caches.get(OCR_CACHE);
    expect(cache?.urls()).toEqual(
      [...Object.keys(FILES).map((path) => BASE + path), `${BASE}ocr-pack.json`].sort(),
    );
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(pack.totalBytes);
    expect(await isOcrPackInstalled(pack)).toBe(true);
  });

  it('fetches with no-store, so a file is not also kept in the HTTP cache', async () => {
    const pack = await info();
    const { fetch, inits } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    await installOcrPack(pack, () => undefined);
    expect(inits.every((init) => init?.cache === 'no-store')).toBe(true);
  });

  it('resumes: the files already stored are not downloaded again', async () => {
    const pack = await info();
    const first = fakeFetch(
      served({ [BASE + RUNTIME_FILES.wasm]: { body: new Uint8Array(0), status: 500 } }),
    );
    vi.stubGlobal('fetch', first.fetch);
    await expect(installOcrPack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'download',
    });
    const second = fakeFetch(served());
    vi.stubGlobal('fetch', second.fetch);
    await installOcrPack(pack, () => undefined);
    expect(second.requests).not.toContain(BASE + MODEL_FILES.detection);
    expect(second.requests).toContain(BASE + RUNTIME_FILES.wasm);
  });

  it('drops a file whose bytes are not the ones the manifest hashes: damaged', async () => {
    const pack = await info();
    const other = bytes(FILES[MODEL_FILES.detection]?.length ?? 0, 99);
    vi.stubGlobal(
      'fetch',
      fakeFetch(served({ [BASE + MODEL_FILES.detection]: { body: other } })).fetch,
    );
    await expect(installOcrPack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'invalid',
    });
    const cache = storage.caches.get(OCR_CACHE);
    expect(cache?.urls()).not.toContain(BASE + MODEL_FILES.detection);
    expect(await isOcrPackInstalled(pack)).toBe(false);
  });

  it('drops a file of another size than the manifest says', async () => {
    const pack = await info();
    vi.stubGlobal(
      'fetch',
      fakeFetch(served({ [BASE + PDF_FILES.api]: { body: bytes(10) } })).fetch,
    );
    await expect(installOcrPack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'invalid',
    });
  });

  it('says a file the server does not have is a pack it does not give', async () => {
    const pack = await info();
    vi.stubGlobal(
      'fetch',
      fakeFetch(served({ [BASE + MODEL_FILES.recognition]: { body: bytes(1), status: 404 } }))
        .fetch,
    );
    await expect(installOcrPack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'unavailable',
    });
  });

  it('stops when cancelled, and keeps what it stored', async () => {
    const pack = await info();
    const controller = new AbortController();
    let calls = 0;
    const promise = installOcrPack(
      pack,
      () => {
        calls += 1;
        if (calls === 3) controller.abort();
      },
      controller.signal,
    );
    await expect(promise).rejects.toThrow();
    expect(await isOcrPackInstalled(pack)).toBe(false);
    expect(storage.caches.get(OCR_CACHE)?.urls()).not.toContain(`${BASE}ocr-pack.json`);
  });

  it('refuses to start without enough free storage', async () => {
    const pack = await info();
    vi.stubGlobal('navigator', {
      storage: {
        persist: () => Promise.resolve(true),
        estimate: () => Promise.resolve({ quota: 1000, usage: 900 }),
      },
    });
    await expect(installOcrPack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'storage',
    });
  });

  it('drops the files of the folder the pack no longer lists (an older runtime)', async () => {
    const pack = await info();
    const cache = await storage.open(OCR_CACHE);
    await cache.put(`${BASE}runtime/1.0.0/ort-wasm-simd-threaded.wasm`, new Response('old'));
    await installOcrPack(pack, () => undefined);
    expect(cache.urls()).not.toContain(`${BASE}runtime/1.0.0/ort-wasm-simd-threaded.wasm`);
  });
});

describe('what is installed, read from the cache only', () => {
  it('needs no request at all, before and after an installation', async () => {
    const { fetch, requests } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    expect(await installedOcrPackInfo(BASE)).toBeNull();
    expect(await storedOcrPackBytes(BASE)).toBe(0);
    expect(requests).toEqual([]);

    const pack = await ocrPackInfo(BASE);
    await installOcrPack(pack, () => undefined);
    requests.length = 0;
    expect((await installedOcrPackInfo(BASE))?.id).toBe('ppocrv5-mobile-latin');
    expect(await storedOcrPackBytes(BASE)).toBe(pack.totalBytes);
    expect(requests).toEqual([]);
  });

  it('is null when a file was evicted, or the stored manifest names another runtime', async () => {
    const pack = await info();
    await installOcrPack(pack, () => undefined);
    const cache = await storage.open(OCR_CACHE);
    await cache.delete(BASE + MODEL_FILES.recognition);
    expect(await installedOcrPackInfo(BASE)).toBeNull();

    await installOcrPack(pack, () => undefined);
    await cache.put(
      `${BASE}ocr-pack.json`,
      new Response(JSON.stringify(manifest({ runtime: { 'onnxruntime-web': '0.1.0' } }))),
    );
    expect(await installedOcrPackInfo(BASE)).toBeNull();
  });

  it('is null without the Cache API', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await installedOcrPackInfo(BASE)).toBeNull();
    expect(await storedOcrPackBytes(BASE)).toBe(0);
  });
});

describe('removeOcrPack', () => {
  it('deletes every file of the folder and the manifest, with or without a finished install', async () => {
    const pack = await info();
    await installOcrPack(pack, () => undefined);
    const cache = await storage.open(OCR_CACHE);
    await cache.put('https://app.test/ocr/other/x.bin', new Response('kept'));
    await removeOcrPack(BASE);
    expect(cache.urls()).toEqual(['https://app.test/ocr/other/x.bin']);
    expect(await installedOcrPackInfo(BASE)).toBeNull();
  });
});
