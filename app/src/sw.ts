// SPDX-License-Identifier: MIT
// The app's service worker, built by vite-plugin-pwa (injectManifest): the
// precache list replaces self.__WB_MANIFEST at build time. What it does is in
// pwa/sw-setup.ts, tested there; here, only Workbox and the Cache API.
import { clientsClaim } from 'workbox-core';
import {
  addPlugins,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  VOICE_PACK_CACHE,
  VOICE_WORKER_CACHE,
  setUpServiceWorker,
  type ServiceWorkerScopeLike,
  type VoiceWorkerStore,
} from './pwa/sw-setup.js';

declare const self: ServiceWorkerScopeLike & { __WB_MANIFEST: (PrecacheEntry | string)[] };

/** The speech worker's script in its own cache (sw-setup.ts says when). */
const voiceWorker: VoiceWorkerStore = {
  async voiceInstalled() {
    if (!(await caches.has(VOICE_PACK_CACHE))) return false;
    const requests = await (await caches.open(VOICE_PACK_CACHE)).keys();
    return requests.some((request) => request.url.endsWith('/voice-pack.json'));
  },
  async cache(urls) {
    const cache = await caches.open(VOICE_WORKER_CACHE);
    for (const url of urls) {
      if ((await cache.match(url)) !== undefined) continue;
      const response = await fetch(url, { cache: 'reload' });
      if (!response.ok) throw new Error(`The speech worker script ${url} could not be fetched.`);
      await cache.put(url, response);
    }
  },
  async prune(urls) {
    if (!(await caches.has(VOICE_WORKER_CACHE))) return;
    const cache = await caches.open(VOICE_WORKER_CACHE);
    for (const request of await cache.keys()) {
      if (!urls.includes(request.url)) await cache.delete(request);
    }
  },
  async drop() {
    await caches.delete(VOICE_WORKER_CACHE);
  },
  async match(url) {
    if (!(await caches.has(VOICE_WORKER_CACHE))) return undefined;
    return (await caches.open(VOICE_WORKER_CACHE)).match(url);
  },
};

setUpServiceWorker(
  self,
  self.__WB_MANIFEST,
  {
    addPlugins,
    precacheAndRoute,
    cleanupOutdatedCaches,
    clientsClaim,
    registerNavigation: (url, denylist) => {
      registerRoute(new NavigationRoute(createHandlerBoundToURL(url), { denylist }));
    },
    registerRoute: (match, answer) => {
      registerRoute(
        ({ url }) => match(url),
        ({ request }) => answer(request),
      );
    },
  },
  voiceWorker,
);
