// SPDX-License-Identifier: MIT
// How the reading worker reaches the pack: the Cache API only, never the
// network. Its own reads go to the cache; the fetch it leaves to ONNX
// Runtime and pdf.js is replaced by one that answers the pack's files from
// the cache and refuses every other address (a CDN, the Hugging Face hub,
// the app itself). A file that is not installed is an error, never a
// download. Pure but for the Cache API, so it is unit-tested.
import { OCR_CACHE, OcrPackError } from './ocr-pack.js';

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function packFolder(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`The reading pack must be served over HTTP(S): ${baseUrl}`);
  }
  if (!url.pathname.endsWith('/') || url.pathname === '/') {
    throw new Error(`The reading pack URL must be a folder ending with a slash: ${baseUrl}`);
  }
  return url.href;
}

function notInstalled(): Response {
  return new Response(null, { status: 404, statusText: 'Not in the installed reading pack' });
}

async function openCache(cacheName: string): Promise<Cache | undefined> {
  const storage = (globalThis as { caches?: CacheStorage }).caches;
  if (storage === undefined) return undefined;
  try {
    return await storage.open(cacheName);
  } catch {
    return undefined;
  }
}

/** A fetch that only reads the cache `cacheName`: an installed file, else 404. Never the network. */
export function cacheOnlyFetch(cacheName: string = OCR_CACHE): Fetch {
  return async (input) => {
    const cache = await openCache(cacheName);
    return (await cache?.match(urlOf(input))) ?? notInstalled();
  };
}

/**
 * A fetch limited to the files of the pack (`paths`, relative to `baseUrl`)
 * and to the blob addresses the worker made itself (`own`): any other
 * address is refused, and a path of the pack folder that the manifest does
 * not list answers 404 (a static host could otherwise answer the app page).
 */
export function guardedFetch(
  baseUrl: string,
  paths: readonly string[],
  fetchImpl: Fetch,
  own: readonly string[] = [],
): Fetch {
  const folder = packFolder(baseUrl);
  const allowed = new Set(paths.map((path) => new URL(path, folder).href));
  const blobs = new Set(own);
  return (input, init) => {
    const url = new URL(urlOf(input), folder).href;
    if (blobs.has(url)) return fetchImpl(input, init);
    if (!url.startsWith(folder)) {
      return Promise.reject(new Error(`Request outside the reading pack refused: ${url}`));
    }
    if (!allowed.has(url)) return Promise.resolve(notInstalled());
    return fetchImpl(input, init);
  };
}

/** The bytes of an installed file of the pack, from the cache only; `unavailable` when it is not there. */
export async function readInstalledFile(
  url: string,
  cacheName: string = OCR_CACHE,
): Promise<ArrayBuffer> {
  const cache = await openCache(cacheName);
  const response = await cache?.match(url);
  if (response === undefined) {
    throw new OcrPackError('unavailable', `The reading pack file ${url} is not installed.`);
  }
  return response.arrayBuffer();
}

/**
 * How many threads ONNX Runtime may use, as for the voice (speech
 * runtime-config.ts): one unless the page is cross-origin isolated; then
 * half the cores, at most four, and at most two on a phone with 2 GB of
 * memory or less. The spike saw no gain from threads on a laptop
 * (docs/ocr.md): measured again on phones with pnpm ocr:bench.
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
