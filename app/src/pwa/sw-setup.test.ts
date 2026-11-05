// SPDX-License-Identifier: MIT
// @vitest-environment node
import { VOICE_CACHE } from '@siapso/speech';
import { describe, expect, it, vi } from 'vitest';
import {
  CROSS_ORIGIN_ISOLATION_HEADERS,
  NAVIGATE_FALLBACK,
  NAVIGATE_FALLBACK_DENYLIST,
  VOICE_PACK_CACHE,
  crossOriginIsolation,
  setUpServiceWorker,
  splitPrecache,
  voiceWorkerAnswer,
  withCrossOriginIsolation,
  type VoiceWorkerStore,
  type WorkboxApi,
} from './sw-setup.js';

const BASE = 'https://app.test/';
const WORKER = 'assets/worker-Bx9_a-1.js';

type Listener = (event: never) => void;

/** The service worker as setUpServiceWorker sees it: its events, skipWaiting and location. */
function fakeScope() {
  const listeners = new Map<string, Listener[]>();
  return {
    location: { href: `${BASE}sw.js` },
    skipWaiting: vi.fn(() => Promise.resolve()),
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    /** A message from a page; the answer on its port, if any. */
    async send(data: unknown): Promise<unknown> {
      let answer: unknown;
      const waits: Promise<unknown>[] = [];
      for (const listener of listeners.get('message') ?? []) {
        (listener as (event: unknown) => void)({
          data,
          ports: [{ postMessage: (value: unknown) => (answer = value) }],
          waitUntil: (promise: Promise<unknown>) => waits.push(promise),
        });
      }
      await Promise.allSettled(waits);
      return answer;
    },
    /** An install or activate event: resolves or rejects as its waitUntil does. */
    async fire(type: 'install' | 'activate'): Promise<void> {
      const waits: Promise<unknown>[] = [];
      for (const listener of listeners.get(type) ?? []) {
        (listener as (event: unknown) => void)({
          waitUntil: (promise: Promise<unknown>) => waits.push(promise),
        });
      }
      await Promise.all(waits);
    },
  };
}

function fakeWorkbox() {
  const calls: string[] = [];
  const api: WorkboxApi<string> & {
    navigation?: { url: string; denylist: RegExp[] };
    voiceRoute?: { match: (url: URL) => boolean; answer: (request: Request) => Promise<Response> };
  } = {
    addPlugins: vi.fn(() => calls.push('addPlugins')),
    precacheAndRoute: vi.fn(() => calls.push('precacheAndRoute')),
    cleanupOutdatedCaches: vi.fn(() => calls.push('cleanupOutdatedCaches')),
    clientsClaim: vi.fn(() => calls.push('clientsClaim')),
    registerNavigation: vi.fn((url: string, denylist: RegExp[]) => {
      calls.push('registerNavigation');
      api.navigation = { url, denylist };
    }),
    registerRoute: vi.fn(
      (match: (url: URL) => boolean, answer: (request: Request) => Promise<Response>) => {
        api.voiceRoute = { match, answer };
      },
    ),
  };
  return { api, calls };
}

function fakeStore(options: { installed?: boolean; failing?: boolean } = {}) {
  const cached = new Map<string, Response>();
  const store: VoiceWorkerStore = {
    voiceInstalled: vi.fn(() => Promise.resolve(options.installed === true)),
    cache: vi.fn((urls: readonly string[]) => {
      if (options.failing === true) return Promise.reject(new Error('offline'));
      for (const url of urls) cached.set(url, new Response('worker'));
      return Promise.resolve();
    }),
    prune: vi.fn(() => Promise.resolve()),
    drop: vi.fn(() => {
      cached.clear();
      return Promise.resolve();
    }),
    match: vi.fn((url: string) => Promise.resolve(cached.get(url)?.clone())),
  };
  return { store, cached };
}

function setUp(entries: string[] = [], options: { installed?: boolean; failing?: boolean } = {}) {
  const scope = fakeScope();
  const { api, calls } = fakeWorkbox();
  const { store, cached } = fakeStore(options);
  setUpServiceWorker(scope, entries, api, store);
  return { scope, api, calls, store, cached };
}

describe('setUpServiceWorker', () => {
  it('precaches the build with the cross-origin isolation headers on every answer', () => {
    const { api, calls } = setUp(['index.html', 'assets/app.js']);
    expect(api.addPlugins).toHaveBeenCalledWith([crossOriginIsolation]);
    expect(api.precacheAndRoute).toHaveBeenCalledWith(['index.html', 'assets/app.js']);
    // The plugin is in place before the precache answers anything.
    expect(calls.indexOf('addPlugins')).toBeLessThan(calls.indexOf('precacheAndRoute'));
    expect(api.cleanupOutdatedCaches).toHaveBeenCalledOnce();
  });

  it('answers every navigation with the app page, but a voice pack or deployment file', () => {
    const { api } = setUp();
    expect(api.navigation?.url).toBe('index.html');
    expect(api.navigation?.denylist).toBe(NAVIGATE_FALLBACK_DENYLIST);
  });

  it('takes control of the page at its first install, so the page can say it is ready offline', () => {
    const { api } = setUp();
    expect(api.clientsClaim).toHaveBeenCalledOnce();
  });

  it('lets an update take over only when the page asks for it (the update prompt)', async () => {
    const { scope } = setUp();
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    await scope.send({ type: 'OTHER' });
    await scope.send(null);
    await scope.send('SKIP_WAITING');
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    // What workbox-window's messageSkipWaiting sends.
    await scope.send({ type: 'SKIP_WAITING' });
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
  });
});

describe('the speech worker script', () => {
  it('is not in the app precache: it is downloaded with a voice', () => {
    const { api } = setUp([
      'index.html',
      { url: WORKER, revision: null } as never,
      'assets/index-a.js',
    ]);
    expect(api.precacheAndRoute).toHaveBeenCalledWith(['index.html', 'assets/index-a.js']);
    // Its route answers any speech worker script of this origin, this build's or the page's.
    const match = (url: string) => api.voiceRoute?.match(new URL(url)) ?? false;
    expect(match(`${BASE}${WORKER}`)).toBe(true);
    expect(match(`${BASE}assets/worker-Older1.js`)).toBe(true);
    expect(match(`${BASE}assets/index-a.js`)).toBe(false);
    expect(match(`https://other.test/${WORKER}`)).toBe(false);
  });

  it('splits by name, whatever the form of the entry', () => {
    expect(
      splitPrecache([
        'a.js',
        `/${WORKER}`,
        { url: 'assets/worker-x.js', revision: 'r' },
        'assets/workerless.js',
      ]),
    ).toEqual({
      app: ['a.js', 'assets/workerless.js'],
      voiceWorker: [`/${WORKER}`, 'assets/worker-x.js'],
    });
  });

  it('is cached at install when a voice is installed, so an update never breaks the voice offline', async () => {
    const { scope, store, cached } = setUp([WORKER], { installed: true });
    await scope.fire('install');
    expect(store.cache).toHaveBeenCalledWith([`${BASE}${WORKER}`]);
    expect([...cached.keys()]).toEqual([`${BASE}${WORKER}`]);
  });

  it('is not downloaded at install when no voice is installed', async () => {
    const { scope, store } = setUp([WORKER], { installed: false });
    await scope.fire('install');
    expect(store.cache).not.toHaveBeenCalled();
  });

  it('fails the install when a voice is installed and its worker cannot be cached', async () => {
    const { scope } = setUp([WORKER], { installed: true, failing: true });
    await expect(scope.fire('install')).rejects.toThrow('offline');
  });

  it('drops the scripts of older builds when the new worker activates', async () => {
    const { scope, store } = setUp([WORKER]);
    await scope.fire('activate');
    expect(store.prune).toHaveBeenCalledWith([`${BASE}${WORKER}`]);
  });

  it('is cached when the page asks, once a voice is installed, and dropped when it is removed', async () => {
    const { scope, store, cached } = setUp([WORKER]);
    expect(await scope.send({ type: 'CACHE_VOICE_WORKER' })).toEqual({ ok: true });
    expect(store.cache).toHaveBeenCalledWith([`${BASE}${WORKER}`]);
    expect(cached.size).toBe(1);
    expect(await scope.send({ type: 'DROP_VOICE_WORKER' })).toEqual({ ok: true });
    expect(store.drop).toHaveBeenCalledOnce();
    expect(cached.size).toBe(0);
  });

  it('caches the very script the page names, its own build or not', async () => {
    const { scope, store, cached } = setUp([WORKER]);
    const older = `${BASE}assets/worker-Older1.js`;
    expect(await scope.send({ type: 'CACHE_VOICE_WORKER', url: older })).toEqual({ ok: true });
    expect(store.cache).toHaveBeenCalledWith([older]);
    expect([...cached.keys()]).toEqual([older]);
  });

  it('refuses a name that is not a speech worker script of this origin', async () => {
    const { scope, store } = setUp([WORKER]);
    for (const url of [
      `${BASE}assets/index-a.js`,
      `https://other.test/${WORKER}`,
      `${BASE}voice/whisper-small-wolof-q8/runtime/x.mjs`,
      'not a url',
      42,
    ]) {
      expect(await scope.send({ type: 'CACHE_VOICE_WORKER', url })).toEqual({ ok: false });
    }
    expect(store.cache).not.toHaveBeenCalled();
  });

  it('says when it could not be cached', async () => {
    const { scope } = setUp([WORKER], { failing: true });
    expect(await scope.send({ type: 'CACHE_VOICE_WORKER' })).toEqual({ ok: false });
  });

  it('is answered from its cache, else the network, with the isolation headers on both', async () => {
    const { scope, api } = setUp([WORKER]);
    const network = vi.fn(() => Promise.resolve(new Response('from the network')));
    vi.stubGlobal('fetch', network);
    try {
      const request = new Request(`${BASE}${WORKER}`);
      const online = await api.voiceRoute?.answer(request);
      expect(await online?.text()).toBe('from the network');
      expect(online?.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
      await scope.send({ type: 'CACHE_VOICE_WORKER' });
      const cached = await api.voiceRoute?.answer(request);
      expect(await cached?.text()).toBe('worker');
      expect(cached?.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(network).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads the voice packs in the cache @siapso/speech fills', () => {
    expect(VOICE_PACK_CACHE).toBe(VOICE_CACHE);
  });
});

describe('voiceWorkerAnswer', () => {
  it('prefers the cache, and isolates what it answers', async () => {
    const cache = { match: () => Promise.resolve(new Response('cached')) };
    const network = vi.fn(() => Promise.resolve(new Response('network')));
    const answer = await voiceWorkerAnswer(new Request(`${BASE}${WORKER}`), cache, network);
    expect(await answer.text()).toBe('cached');
    expect(answer.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(network).not.toHaveBeenCalled();
  });
});

describe('navigation fallback', () => {
  const denied = (path: string) => NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(path));

  it('is the app page', () => {
    expect(NAVIGATE_FALLBACK).toBe('index.html');
  });

  it('never answers a /voice/ request with the app page', () => {
    expect(denied('/voice/whisper-small-wolof-q8/voice-pack.json')).toBe(true);
    // Also under a deployment base path.
    expect(denied('/siapso/voice/whisper-small-wolof-q8/onnx/encoder_model_quantized.onnx')).toBe(
      true,
    );
    expect(denied('/')).toBe(false);
    expect(denied('/index.html')).toBe(false);
  });

  it('never answers an /ocr/ request with the app page: a reading pack file not served stays missing', () => {
    expect(denied('/ocr/ppocrv5-mobile-latin/ocr-pack.json')).toBe(true);
    expect(denied('/siapso/ocr/ppocrv5-mobile-latin/models/det.onnx')).toBe(true);
    expect(denied('/#/prescription')).toBe(false);
  });

  it('never answers a /config/ request with the app page: a missing file stays missing', () => {
    expect(denied('/config/referral.json')).toBe(true);
    expect(denied('/siapso/config/referral.json')).toBe(true);
    expect(denied('/#/danger/call')).toBe(false);
  });
});

describe('cross-origin isolation', () => {
  it('adds COOP same-origin and COEP require-corp, so ONNX Runtime may use threads', async () => {
    const page = new Response('<!doctype html>', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/html' },
    });
    const isolated = withCrossOriginIsolation(page);
    expect(isolated.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(isolated.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    // The rest of the answer is kept.
    expect(isolated.status).toBe(200);
    expect(isolated.statusText).toBe('OK');
    expect(isolated.headers.get('content-type')).toBe('text/html');
    expect(await isolated.text()).toBe('<!doctype html>');
    expect(CROSS_ORIGIN_ISOLATION_HEADERS).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
  });

  it('leaves an error answer as it is', () => {
    const failed = Response.error();
    expect(withCrossOriginIsolation(failed)).toBe(failed);
  });

  it('works as a Workbox plugin, on what the precache answers', async () => {
    const answered = await crossOriginIsolation.handlerWillRespond({
      response: new Response('x'),
    });
    expect(answered.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  });
});
