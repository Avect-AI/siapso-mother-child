// SPDX-License-Identifier: MIT
// What the app's service worker (src/sw.ts) does, with Workbox and the
// caches handed in, so it is tested without a service worker
// (sw-setup.test.ts):
//
// - it precaches the build (the app shell, fonts, icons and the knowledge
//   pack; never the voice pack nor the prescription reading pack, see
//   vite.config.ts) and answers every navigation with the app page, except a
//   voice pack file, a reading pack file or a deployment file, which stay
//   missing when they are missing;
// - every answer of the precache carries the cross-origin isolation headers
//   (COOP same-origin, COEP require-corp): a page served by the worker is
//   cross-origin isolated, so ONNX Runtime may run the speech model on
//   several threads (6.7 s instead of 13 s per 3.3 s utterance on a laptop,
//   docs/voice.md). Everything the app loads is from its own origin, so
//   nothing else changes. A page the worker did not serve (the very first
//   visit, a hard reload) is not isolated: the model then runs on one thread;
// - the speech worker's script (assets/worker-*.js: Transformers.js and the
//   JavaScript of ONNX Runtime, about 490 KB) is left out of the precache: it
//   goes to a cache of its own only once a voice is installed (the page asks
//   the worker in control to keep the very script it runs, and the waiting
//   one, if any, to keep its own), and every install of a new version that finds
//   a voice installed caches its new script first, failing otherwise, so an
//   update never leaves an installed voice without its worker offline. Its
//   answers, cached or from the network, carry the isolation headers too (a
//   worker script under COEP needs them). Older scripts go when the new
//   version activates, all of them when the voice is removed;
// - the prescription reading worker's script (assets/ocr-worker-*.js, about
//   64 KB: the JavaScript of ONNX Runtime) is precached with the app shell,
//   isolated like it: a reading starts a new worker offline once the reading
//   pack is installed, with or without a voice. Its entry has a name of its
//   own (ocr/src/ocr-worker.ts) so that the speech worker's pattern never
//   takes it (worker-scripts.test.ts);
// - its first install takes control of the page (the page then says it is
//   ready without the Internet), and an update waits until the user accepts
//   the update prompt, which sends SKIP_WAITING.

/** The page every navigation gets, relative to the worker. */
export const NAVIGATE_FALLBACK = 'index.html';

/**
 * Navigations never answered with the app page: a voice pack file, a
 * prescription reading pack file, and a deployment file such as
 * config/referral.json (under any base path).
 */
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [/\/voice\//, /\/ocr\//, /\/config\//];

/** The cache of the speech worker's script, filled only once a voice is installed. */
export const VOICE_WORKER_CACHE = 'siapso-voice-worker';

/** The cache of the voice packs (VOICE_CACHE of @siapso/speech, checked in the test). */
export const VOICE_PACK_CACHE = 'transformers-cache';

/** The speech worker's script, by the name Vite gives it. */
const VOICE_WORKER_FILE = /(^|\/)assets\/worker-[\w-]+\.js$/;

/** The headers that make a page cross-origin isolated. */
export const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

/** `response` with the cross-origin isolation headers; an error or opaque answer as it is. */
export function withCrossOriginIsolation(response: Response): Response {
  if (response.type === 'error' || response.type.startsWith('opaque') || response.status === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CROSS_ORIGIN_ISOLATION_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A Workbox plugin: the precache answers with the isolation headers. */
export const crossOriginIsolation = {
  handlerWillRespond: ({ response }: { response: Response }): Promise<Response> =>
    Promise.resolve(withCrossOriginIsolation(response)),
};

/** An entry of the precache list, as vite-plugin-pwa writes it. */
type PrecacheEntryLike = string | { url: string };

function entryUrl(entry: PrecacheEntryLike): string {
  return typeof entry === 'string' ? entry : entry.url;
}

/** The precache list without the speech worker's script, and that script apart. */
export function splitPrecache<Entry extends PrecacheEntryLike>(
  entries: readonly Entry[],
): { app: Entry[]; voiceWorker: string[] } {
  const app: Entry[] = [];
  const voiceWorker: string[] = [];
  for (const entry of entries) {
    if (VOICE_WORKER_FILE.test(entryUrl(entry))) voiceWorker.push(entryUrl(entry));
    else app.push(entry);
  }
  return { app, voiceWorker };
}

/** The speech worker's script: from its cache, else from the network; isolated either way. */
export async function voiceWorkerAnswer(
  request: Request,
  cache: { match: (url: string) => Promise<Response | undefined> },
  network: (request: Request) => Promise<Response>,
): Promise<Response> {
  const cached = await cache.match(request.url);
  return withCrossOriginIsolation(cached ?? (await network(request)));
}

/** The cache of the speech worker's script, and whether a voice is installed (src/sw.ts). */
export interface VoiceWorkerStore {
  /** Whether a voice pack is installed: its voice-pack.json is in the voice pack cache. */
  voiceInstalled: () => Promise<boolean>;
  /** Downloads the scripts not cached yet; rejects when one cannot be. */
  cache: (urls: readonly string[]) => Promise<void>;
  /** Deletes every cached script but these. */
  prune: (urls: readonly string[]) => Promise<void>;
  /** Deletes the cache. */
  drop: () => Promise<void>;
  match: (url: string) => Promise<Response | undefined>;
}

interface MessageEventLike {
  data: unknown;
  ports?: readonly { postMessage: (message: unknown) => void }[];
  waitUntil?: (promise: Promise<unknown>) => void;
}

interface ExtendableEventLike {
  waitUntil: (promise: Promise<unknown>) => void;
}

/** What setUpServiceWorker uses of the service worker scope. */
export interface ServiceWorkerScopeLike {
  location: { href: string };
  addEventListener: {
    (type: 'message', listener: (event: MessageEventLike) => void): void;
    (type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  };
  skipWaiting: () => Promise<void>;
}

/** What setUpServiceWorker uses of Workbox. */
export interface WorkboxApi<Entry> {
  addPlugins: (plugins: (typeof crossOriginIsolation)[]) => void;
  precacheAndRoute: (entries: Entry[]) => void;
  cleanupOutdatedCaches: () => void;
  clientsClaim: () => void;
  /** Answers navigations with the precached `url`, except those `denylist` matches. */
  registerNavigation: (url: string, denylist: RegExp[]) => void;
  /** Answers the requests whose URL `match` takes with `answer`. */
  registerRoute: (
    match: (url: URL) => boolean,
    answer: (request: Request) => Promise<Response>,
  ) => void;
}

function messageType(data: unknown): unknown {
  return typeof data === 'object' && data !== null && 'type' in data ? data.type : undefined;
}

/** A speech worker script of this origin (`origin`): only such a file is kept on a page's word. */
export function isVoiceWorkerUrl(url: URL, origin: string): boolean {
  return url.origin === origin && VOICE_WORKER_FILE.test(url.pathname);
}

/**
 * The scripts a CACHE_VOICE_WORKER message asks for: the one the page names
 * (the script it runs, which may be of another build than this worker), or,
 * named by no page, this build's own; null for a name that is not a speech
 * worker script of this origin.
 */
function scriptsAsked(data: unknown, own: readonly string[], origin: string): string[] | null {
  if (typeof data !== 'object' || data === null || !('url' in data)) return [...own];
  const { url } = data;
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return isVoiceWorkerUrl(parsed, origin) ? [parsed.href] : null;
}

/**
 * Sets up the service worker: precache, navigations, isolation, the speech
 * worker's script, first install and updates.
 */
export function setUpServiceWorker<Entry extends PrecacheEntryLike>(
  scope: ServiceWorkerScopeLike,
  entries: Entry[],
  workbox: WorkboxApi<Entry>,
  voiceWorker: VoiceWorkerStore,
): void {
  const { app, voiceWorker: scripts } = splitPrecache(entries);
  const voiceUrls = scripts.map((url) => new URL(url, scope.location.href).href);
  const origin = new URL(scope.location.href).origin;

  scope.addEventListener('message', (event) => {
    const type = messageType(event.data);
    // An update takes over only when the user accepts it (registerType 'prompt').
    if (type === 'SKIP_WAITING') {
      void scope.skipWaiting();
      return;
    }
    let work: Promise<void> | undefined;
    if (type === 'CACHE_VOICE_WORKER') {
      const asked = scriptsAsked(event.data, voiceUrls, origin);
      work =
        asked === null
          ? Promise.reject(new Error('Not a speech worker script of this origin.'))
          : voiceWorker.cache(asked);
    }
    if (type === 'DROP_VOICE_WORKER') work = voiceWorker.drop();
    if (work === undefined) return;
    const answered = work.then(
      () => ({ ok: true }),
      () => ({ ok: false }),
    );
    event.waitUntil?.(answered);
    void answered.then((answer) => {
      event.ports?.[0]?.postMessage(answer);
    });
  });
  // A new version with a voice installed brings its worker's script, or does not install.
  scope.addEventListener('install', (event) => {
    event.waitUntil(
      voiceWorker.voiceInstalled().then(async (installed) => {
        if (installed) await voiceWorker.cache(voiceUrls);
      }),
    );
  });
  scope.addEventListener('activate', (event) => {
    event.waitUntil(voiceWorker.prune(voiceUrls));
  });

  workbox.addPlugins([crossOriginIsolation]);
  workbox.precacheAndRoute(app);
  workbox.cleanupOutdatedCaches();
  workbox.clientsClaim();
  // Any speech worker script it keeps: this build's, or the one a page runs.
  workbox.registerRoute(
    (url) => isVoiceWorkerUrl(url, origin),
    (request) => voiceWorkerAnswer(request, voiceWorker, (missing) => fetch(missing)),
  );
  workbox.registerNavigation(NAVIGATE_FALLBACK, NAVIGATE_FALLBACK_DENYLIST);
}
