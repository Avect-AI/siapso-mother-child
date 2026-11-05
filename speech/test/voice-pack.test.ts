// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VOICE_PACK_URL,
  ORT_WEB_VERSION,
  RUNTIME_FILES,
  VOICE_CACHE,
  VOICE_PACKS,
  VoicePackError,
  installVoicePack,
  installedVoicePackInfo,
  isVoicePackInstalled,
  removeVoicePack,
  removeVoicePackFiles,
  storedVoicePackBytes,
  voicePackInfo,
  type VoicePackInfo,
} from '../src/voice-pack.js';
import { FakeCacheStorage, bytes, fakeFetch, type FakeFile } from './fakes.js';

const BASE = 'https://app.test/voice/whisper-small-wolof-q8/';

const FILES = {
  'config.json': bytes(300),
  'onnx/encoder_model_quantized.onnx': bytes(5000, 2),
  'onnx/decoder_model_merged_quantized.onnx': bytes(8000, 3),
  [RUNTIME_FILES.mjs]: bytes(700, 4),
  [RUNTIME_FILES.wasm]: bytes(3000, 5),
};

function manifest(overrides: Record<string, unknown> = {}) {
  const files = Object.entries(FILES).map(([path, body]) => ({
    path,
    bytes: body.length,
    sha256: 'x',
  }));
  return {
    id: 'whisper-small-wolof-q8',
    licence: 'MIT',
    languages: ['wo', 'fr'],
    prompts: { wo: [50258], fr: [50258, 50265, 50359, 50363] },
    source: { repo: 'M9and2M/whisper-small-wolof', revision: 'abc' },
    runtime: { 'onnxruntime-web': ORT_WEB_VERSION, licence: 'MIT' },
    files,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    ...overrides,
  };
}

function served(extra: Record<string, FakeFile | string> = {}, json: unknown = manifest()) {
  const files: Record<string, FakeFile | string> = {
    [`${BASE}voice-pack.json`]: JSON.stringify(json),
  };
  for (const [path, body] of Object.entries(FILES)) files[BASE + path] = { body };
  return { ...files, ...extra };
}

let storage: FakeCacheStorage;

beforeEach(() => {
  storage = new FakeCacheStorage();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('location', { href: 'https://app.test/#/search' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function info(): Promise<VoicePackInfo> {
  vi.stubGlobal('fetch', fakeFetch(served()).fetch);
  return voicePackInfo(BASE);
}

describe('voicePackInfo', () => {
  it('reads voice-pack.json under the base URL', async () => {
    const { fetch, requests } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    const pack = await voicePackInfo(BASE);
    expect(requests).toEqual([`${BASE}voice-pack.json`]);
    expect(pack).toMatchObject({
      id: 'whisper-small-wolof-q8',
      baseUrl: BASE,
      licence: 'MIT',
      languages: ['wo', 'fr'],
      prompts: { wo: [50258], fr: [50258, 50265, 50359, 50363] },
      totalBytes: 17000,
    });
    expect(pack.files.map((f) => f.path)).toEqual(Object.keys(FILES));
    expect(pack.files[0]).toEqual({ path: 'config.json', bytes: 300 });
    expect(pack.runtime).toBe(ORT_WEB_VERSION);
  });

  it('keeps the ONNX Runtime files in a folder named after their version', () => {
    expect(RUNTIME_FILES).toEqual({
      mjs: `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.asyncify.wasm`,
    });
  });

  it.each([
    ['no runtime', undefined],
    ['another ONNX Runtime', { 'onnxruntime-web': '1.22.0', licence: 'MIT' }],
  ])('refuses a pack built for %s: it must be installed again', async (_, runtime) => {
    vi.stubGlobal('fetch', fakeFetch(served({}, manifest({ runtime }))).fetch);
    await expect(voicePackInfo(BASE)).rejects.toMatchObject({
      reason: 'invalid',
      message: /ONNX Runtime/,
    });
  });

  it('resolves the default base URL against the page, whatever the route', async () => {
    const { fetch, requests } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    expect(DEFAULT_VOICE_PACK_URL).toBe('voice/whisper-small-wolof-q8/');
    expect(VOICE_PACKS).toEqual({
      wo: 'voice/whisper-small-wolof-q8/',
      fr: 'voice/whisper-base-fr-q8/',
    });
    const pack = await voicePackInfo();
    expect(requests).toEqual([`${BASE}voice-pack.json`]);
    expect(pack.baseUrl).toBe(BASE);
  });

  it('adds the trailing slash to a base URL without one', async () => {
    vi.stubGlobal('fetch', fakeFetch(served()).fetch);
    expect((await voicePackInfo(BASE.slice(0, -1))).baseUrl).toBe(BASE);
  });

  it('falls back to the installed copy when the network fails', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await voicePackInfo(BASE)).toEqual(pack);
  });

  it('falls back to the installed copy when the server answers 200 with something else than JSON', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    // A static host that answers every path with the app page.
    vi.stubGlobal(
      'fetch',
      fakeFetch({ [`${BASE}voice-pack.json`]: '<!doctype html><title>Carnet</title>' }).fetch,
    );
    expect(await voicePackInfo(BASE)).toEqual(pack);
  });

  it('says the manifest is invalid when the server answers with something else than JSON and nothing is installed', async () => {
    vi.stubGlobal('fetch', fakeFetch({ [`${BASE}voice-pack.json`]: '<!doctype html>' }).fetch);
    await expect(voicePackInfo(BASE)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('says the pack is unavailable when it is neither online nor installed', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(voicePackInfo(BASE)).rejects.toMatchObject({ reason: 'unavailable' });
    vi.stubGlobal('fetch', fakeFetch({}).fetch);
    await expect(voicePackInfo(BASE)).rejects.toBeInstanceOf(VoicePackError);
  });

  it.each([
    ['no licence', { licence: undefined }],
    ['no id', { id: '' }],
    ['a path outside the pack', { files: [{ path: '../app.js', bytes: 1 }], totalBytes: 1 }],
    ['an absolute path', { files: [{ path: '/onnx/a.onnx', bytes: 1 }], totalBytes: 1 }],
    ['a negative size', { files: [{ path: 'a', bytes: -1 }], totalBytes: -1 }],
    ['a wrong total', { totalBytes: 1 }],
    ['no language', { languages: [] }],
    ['a language without a decoder prompt', { languages: ['wo', 'fr', 'en'] }],
    [
      'a decoder prompt that is not token ids',
      { prompts: { wo: ['<|startoftranscript|>'], fr: [1] } },
    ],
    ['an empty decoder prompt', { prompts: { wo: [], fr: [1] } }],
    ['no ONNX Runtime files', { files: [{ path: 'config.json', bytes: 300 }], totalBytes: 300 }],
  ])('refuses a manifest with %s', async (_, overrides) => {
    vi.stubGlobal('fetch', fakeFetch(served({}, manifest(overrides))).fetch);
    await expect(voicePackInfo(BASE)).rejects.toMatchObject({ reason: 'invalid' });
  });
});

describe('isVoicePackInstalled', () => {
  it('is false before installation and true once every file is in the cache', async () => {
    const pack = await info();
    expect(await isVoicePackInstalled(pack)).toBe(false);
    await installVoicePack(pack, () => undefined);
    expect(await isVoicePackInstalled(pack)).toBe(true);
  });

  it('is false when one file is missing', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    const cache = await storage.open(VOICE_CACHE);
    await cache.delete(`${BASE}onnx/encoder_model_quantized.onnx`);
    expect(await isVoicePackInstalled(pack)).toBe(false);
  });

  it('is false when the Cache API is not available', async () => {
    const pack = await info();
    vi.stubGlobal('caches', undefined);
    expect(await isVoicePackInstalled(pack)).toBe(false);
  });
});

describe('installVoicePack', () => {
  it('stores every file under its URL in the Transformers.js cache, with progress up to the total', async () => {
    const pack = await info();
    const progress: [number, number][] = [];
    await installVoicePack(pack, (loaded, total) => progress.push([loaded, total]));

    const cache = await storage.open(VOICE_CACHE);
    expect(cache.urls()).toEqual(
      [...Object.keys(FILES).map((path) => BASE + path), `${BASE}voice-pack.json`].sort(),
    );
    const stored = await cache.match(`${BASE}onnx/encoder_model_quantized.onnx`);
    expect(stored).toBeDefined();
    expect(new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(
      FILES['onnx/encoder_model_quantized.onnx'],
    );

    expect(progress.length).toBeGreaterThan(10);
    expect(progress.at(-1)).toEqual([17000, 17000]);
    let previous = 0;
    for (const [loaded, total] of progress) {
      expect(loaded).toBeGreaterThanOrEqual(previous);
      expect(total).toBe(17000);
      previous = loaded;
    }
  });

  it('stops on abort, keeps the files already complete and resumes from them', async () => {
    const pack = await info();
    const controller = new AbortController();
    const install = installVoicePack(
      pack,
      (loaded) => {
        if (loaded > 6000) controller.abort();
      },
      controller.signal,
    );
    await expect(install).rejects.toMatchObject({ name: 'AbortError' });

    const cache = await storage.open(VOICE_CACHE);
    // config.json and the encoder (5300 bytes) were complete; the decoder was cut off.
    expect(cache.urls()).toEqual([
      `${BASE}config.json`,
      `${BASE}onnx/encoder_model_quantized.onnx`,
    ]);
    expect(await isVoicePackInstalled(pack)).toBe(false);

    const { fetch, requests } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    const progress: number[] = [];
    await installVoicePack(pack, (loaded) => progress.push(loaded));
    expect(requests).not.toContain(`${BASE}config.json`);
    expect(requests).not.toContain(`${BASE}onnx/encoder_model_quantized.onnx`);
    expect(progress[0]).toBeGreaterThanOrEqual(5300);
    expect(progress.at(-1)).toBe(17000);
    expect(await isVoicePackInstalled(pack)).toBe(true);
  });

  it('downloads around the HTTP cache, so the pack is stored once, in the voice cache', async () => {
    const pack = await info();
    const { fetch, inits } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    await installVoicePack(pack, () => undefined);
    expect(inits).toHaveLength(Object.keys(FILES).length);
    for (const init of inits) expect(init?.cache).toBe('no-store');
  });

  it('does not start when the signal is already aborted', async () => {
    const pack = await info();
    const controller = new AbortController();
    controller.abort();
    await expect(installVoicePack(pack, () => undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect((await storage.open(VOICE_CACHE)).urls()).toEqual([]);
  });

  it('refuses a file whose size does not match the manifest, and does not keep it', async () => {
    const pack = await info();
    vi.stubGlobal(
      'fetch',
      fakeFetch(served({ [`${BASE}onnx/encoder_model_quantized.onnx`]: { body: bytes(4999) } }))
        .fetch,
    );
    await expect(installVoicePack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'download',
    });
    const cache = await storage.open(VOICE_CACHE);
    expect(cache.urls()).not.toContain(`${BASE}onnx/encoder_model_quantized.onnx`);
  });

  it('reports an HTTP error as a download error', async () => {
    const pack = await info();
    vi.stubGlobal(
      'fetch',
      fakeFetch(served({ [`${BASE}config.json`]: { body: bytes(10), status: 500 } })).fetch,
    );
    await expect(installVoicePack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'download',
    });
  });

  it('checks the free storage before downloading', async () => {
    const pack = await info();
    const { fetch, requests } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.resolve({ quota: 10000, usage: 0 }), persist: vi.fn() },
    });
    await expect(installVoicePack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'storage',
    });
    expect(requests).toEqual([]);
  });

  it('asks the browser for persistent storage, so the pack is not evicted', async () => {
    const pack = await info();
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.resolve({ quota: 1e9, usage: 0 }), persist },
    });
    await installVoicePack(pack, () => undefined);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('reports a full storage while writing as a storage error', async () => {
    const pack = await info();
    const cache = await storage.open(VOICE_CACHE);
    cache.put = () => Promise.reject(new DOMException('quota', 'QuotaExceededError'));
    await expect(installVoicePack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'storage',
    });
  });

  it('fails clearly when the Cache API is not available', async () => {
    const pack = await info();
    vi.stubGlobal('caches', undefined);
    await expect(installVoicePack(pack, () => undefined)).rejects.toMatchObject({
      reason: 'storage',
    });
  });
});

describe('installVoicePack and an older runtime', () => {
  it('downloads only the files at a new path, and drops what the pack no longer lists', async () => {
    const pack = await info();
    const cache = await storage.open(VOICE_CACHE);
    // An earlier install: the model files, and the runtime of an older version.
    for (const [path, body] of Object.entries(FILES)) {
      if (path.startsWith('runtime/')) continue;
      await cache.put(
        BASE + path,
        new Response(body.slice(0), { headers: { 'content-length': String(body.length) } }),
      );
    }
    await cache.put(
      `${BASE}runtime/1.22.0/ort-wasm-simd-threaded.asyncify.wasm`,
      new Response('old'),
    );
    const { fetch, requests } = fakeFetch(served());
    vi.stubGlobal('fetch', fetch);
    await installVoicePack(pack, () => undefined);
    expect(requests).toEqual([BASE + RUNTIME_FILES.mjs, BASE + RUNTIME_FILES.wasm]);
    expect(cache.urls()).not.toContain(
      `${BASE}runtime/1.22.0/ort-wasm-simd-threaded.asyncify.wasm`,
    );
    expect(await installedVoicePackInfo(BASE)).toEqual(pack);
  });
});

describe('removeVoicePack', () => {
  it('deletes every file of the pack and its manifest', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    const cache = await storage.open(VOICE_CACHE);
    await cache.put('https://app.test/other', new Response('keep'));
    await removeVoicePack(pack);
    expect(cache.urls()).toEqual(['https://app.test/other']);
    expect(await isVoicePackInstalled(pack)).toBe(false);
  });
});

/** A fetch that fails the test if called: these functions never use the network. */
function noNetwork() {
  const network = vi.fn(() => Promise.reject(new Error('the network must not be used')));
  vi.stubGlobal('fetch', network);
  return network;
}

/** Installs the pack, then stops at the decoder: config.json and the encoder (5300 bytes) are kept. */
async function cutShort(): Promise<VoicePackInfo> {
  const pack = await info();
  const controller = new AbortController();
  await installVoicePack(
    pack,
    (loaded) => {
      if (loaded > 6000) controller.abort();
    },
    controller.signal,
  ).catch(() => undefined);
  return pack;
}

describe('installedVoicePackInfo', () => {
  it('reads the copy of the manifest an installation stored, without the network', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    const network = noNetwork();
    expect(await installedVoicePackInfo(BASE)).toEqual(pack);
    expect(network).not.toHaveBeenCalled();
  });

  it('resolves a pack folder relative to the page, as VOICE_PACKS gives it', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    noNetwork();
    expect(VOICE_PACKS.wo).toBe('voice/whisper-small-wolof-q8/');
    expect((await installedVoicePackInfo(VOICE_PACKS.wo))?.baseUrl).toBe(BASE);
  });

  it('is null when nothing is installed, without the network', async () => {
    const network = noNetwork();
    expect(await installedVoicePackInfo(BASE)).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it('is null when a file is missing, even with the manifest stored', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    await (await storage.open(VOICE_CACHE)).delete(`${BASE}config.json`);
    noNetwork();
    expect(await installedVoicePackInfo(BASE)).toBeNull();
  });

  it('keeps the ONNX Runtime version in the stored copy', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    const stored = await (await storage.open(VOICE_CACHE)).match(`${BASE}voice-pack.json`);
    expect(((await stored?.json()) as { runtime?: unknown }).runtime).toEqual({
      'onnxruntime-web': ORT_WEB_VERSION,
    });
  });

  it('reads a pack installed for another ONNX Runtime as not installed, its files kept to resume', async () => {
    const pack = await info();
    await installVoicePack(pack, () => undefined);
    const cache = await storage.open(VOICE_CACHE);
    // The copy an older app stored: the same files, another runtime version.
    await cache.put(
      `${BASE}voice-pack.json`,
      new Response(JSON.stringify({ ...manifest(), runtime: { 'onnxruntime-web': '1.22.0' } })),
    );
    noNetwork();
    expect(await installedVoicePackInfo(BASE)).toBeNull();
    expect(await storedVoicePackBytes(BASE)).toBe(17000);
  });

  it('is null for an installation cut short (no manifest stored yet)', async () => {
    await cutShort();
    noNetwork();
    expect(await installedVoicePackInfo(BASE)).toBeNull();
  });

  it('is null when the stored manifest cannot be read, or with no Cache API', async () => {
    const cache = await storage.open(VOICE_CACHE);
    await cache.put(`${BASE}voice-pack.json`, new Response('<html>'));
    noNetwork();
    expect(await installedVoicePackInfo(BASE)).toBeNull();
    vi.stubGlobal('caches', undefined);
    expect(await installedVoicePackInfo(BASE)).toBeNull();
  });
});

describe('storedVoicePackBytes', () => {
  it('adds up the files already stored in the pack folder, with no manifest and no network', async () => {
    await cutShort();
    const cache = await storage.open(VOICE_CACHE);
    await cache.put(
      'https://app.test/voice/whisper-base-fr-q8/config.json',
      new Response('x', { headers: { 'content-length': '999' } }),
    );
    const network = noNetwork();
    expect(await storedVoicePackBytes(BASE)).toBe(5300);
    expect(network).not.toHaveBeenCalled();
  });

  it('is 0 when nothing is stored, or with no Cache API', async () => {
    noNetwork();
    expect(await storedVoicePackBytes(BASE)).toBe(0);
    vi.stubGlobal('caches', undefined);
    expect(await storedVoicePackBytes(BASE)).toBe(0);
  });
});

describe('removeVoicePackFiles', () => {
  it('deletes every file stored in the pack folder, even without a manifest', async () => {
    await cutShort();
    const cache = await storage.open(VOICE_CACHE);
    await cache.put('https://app.test/other', new Response('keep'));
    await cache.put('https://app.test/voice/whisper-base-fr-q8/config.json', new Response('keep'));
    const network = noNetwork();
    await removeVoicePackFiles(BASE);
    expect(cache.urls()).toEqual([
      'https://app.test/other',
      'https://app.test/voice/whisper-base-fr-q8/config.json',
    ]);
    expect(await storedVoicePackBytes(BASE)).toBe(0);
    expect(network).not.toHaveBeenCalled();
  });

  it('does nothing with no Cache API', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(removeVoicePackFiles(BASE)).resolves.toBeUndefined();
  });
});
