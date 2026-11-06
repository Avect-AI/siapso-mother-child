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
 * A fetch limited to the files of the pack (`paths`, relative to `baseUrl`):
 * any other address is refused (a blob address too: the worker's own are
 * revoked once loaded, withModuleUrl), and a path of the pack folder that
 * the manifest does not list answers 404 (a static host could otherwise
 * answer the app page).
 */
export function guardedFetch(baseUrl: string, paths: readonly string[], fetchImpl: Fetch): Fetch {
  const folder = packFolder(baseUrl);
  const allowed = new Set(paths.map((path) => new URL(path, folder).href));
  // The address resolved against the pack folder goes on: a relative one,
  // handed on as given, would be read against the worker script instead.
  return (input, init) => {
    const url = new URL(urlOf(input), folder).href;
    if (!url.startsWith(folder)) {
      return Promise.reject(new Error(`Request outside the reading pack refused: ${url}`));
    }
    if (!allowed.has(url)) return Promise.resolve(notInstalled());
    return fetchImpl(url, init);
  };
}

/** The network constructors of a worker scope that closeNetwork replaces. */
const CLOSED_CONSTRUCTORS = ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport'] as const;

function closed(name: string): Error {
  return new Error(`${name} is closed in the reading worker: no request leaves it.`);
}

/**
 * Closes the ways out of the reading worker that are not its fetch, before
 * anything loads: XMLHttpRequest, WebSocket, EventSource and WebTransport
 * throw when made, importScripts throws (a module worker has none anyway),
 * and fetch refuses every address until the worker puts the pack guard in
 * its place (guardedFetch). A module import of an address and the workers
 * ONNX Runtime starts for its threads are not covered: docs/threat-model.md.
 */
export function closeNetwork(scope: Record<string, unknown>): void {
  for (const name of CLOSED_CONSTRUCTORS) {
    if (!(name in scope)) continue;
    // A constructor that always throws: `new XMLHttpRequest()` and the like fail at once.
    scope[name] = function refused(): never {
      throw closed(name);
    };
  }
  if ('importScripts' in scope) {
    scope['importScripts'] = () => {
      throw closed('importScripts');
    };
  }
  scope['fetch'] = (input: RequestInfo | URL) =>
    Promise.reject(new Error(`Request refused before the reading pack is loaded: ${urlOf(input)}`));
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
 * An installed file of the pack as a blob address of this worker, for `use`
 * only (a module import with no request): the address is revoked once `use`
 * settles, so the copy of the file is not kept for the life of the worker.
 * ONNX Runtime starts the workers of its threads from its loader's address
 * while the models load, so its loader is revoked once they are loaded.
 */
export async function withModuleUrl<T>(
  url: string,
  use: (address: string) => Promise<T>,
  cacheName: string = OCR_CACHE,
): Promise<T> {
  const code = await readInstalledFile(url, cacheName);
  const address = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    return await use(address);
  } finally {
    URL.revokeObjectURL(address);
  }
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
