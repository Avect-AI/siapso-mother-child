// SPDX-License-Identifier: MIT
// The voice pack: the converted model and the ONNX Runtime files, served
// from the app origin (default /voice/<id>/) and kept in the Cache API cache
// that Transformers.js reads, so the model loads with no network at all.

/** Cache API cache used by Transformers.js for model files and the ONNX Runtime binaries. */
export const VOICE_CACHE = 'transformers-cache';

/**
 * One pack per language, relative to the page (works under any deployment
 * base path). The Wolof fine-tune lost too much French, so French has its own
 * pack, built from the multilingual Whisper base model (docs/voice.md).
 */
export const VOICE_PACKS = {
  wo: 'voice/whisper-small-wolof-q8/',
  fr: 'voice/whisper-base-fr-q8/',
} as const;

/** The Wolof pack. */
export const DEFAULT_VOICE_PACK_URL = VOICE_PACKS.wo;

/** Manifest written by speech/convert/convert.py, completed by speech/scripts/install-local.mjs. */
export const MANIFEST_FILE = 'voice-pack.json';

/**
 * The ONNX Runtime Web build whose JavaScript the speech worker bundles (the
 * one Transformers.js 4.3.1 pins, a dev build). Its WebAssembly files in the
 * pack must be the same build: test/ort-version.test.ts checks the installed
 * package, and install-local copies the files from it under this version.
 */
export const ORT_WEB_VERSION = '1.31.0-dev.20260914-8d85527a0';

/**
 * ONNX Runtime Web files of the pack: the asyncify build (WebAssembly and
 * WebGPU), which runs on one thread unless the page is cross-origin
 * isolated, and then uses several. Under runtime/<version>/: an app that
 * moves to another ONNX Runtime finds them missing, so the pack reads as to
 * install again, and the installation downloads only these files.
 */
export const RUNTIME_FILES = {
  mjs: `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.asyncify.wasm`,
} as const;

/** Free space kept on top of the pack size before an installation starts. */
const STORAGE_MARGIN = 1.1;

export interface VoicePackFile {
  path: string;
  bytes: number;
}

export interface VoicePackInfo {
  id: string;
  /** Absolute URL of the pack folder, ending with a slash. */
  baseUrl: string;
  files: VoicePackFile[];
  totalBytes: number;
  licence: string;
  /** Languages the pack transcribes (ISO 639-1 codes, for example `wo` and `fr`); the first is the default. */
  languages: string[];
  /**
   * Whisper decoder prompt (token ids) for each language. The Wolof fine-tune
   * was trained with <|startoftranscript|> alone; a language of the base
   * model uses <|startoftranscript|><|xx|><|transcribe|><|notimestamps|>.
   */
  prompts: Record<string, number[]>;
  /** The ONNX Runtime Web version the pack's runtime files are (ORT_WEB_VERSION). */
  runtime: string;
}

/**
 * Why a voice operation failed, for a clear message on the voice screen:
 * - `unavailable`: the pack is not installed (or not reachable to install);
 * - `invalid`: its manifest is wrong;
 * - `storage`: not enough space, or no Cache API;
 * - `download`: the installation download failed;
 * - `load`: the model could not start (worker, memory, runtime);
 * - `transcribe`: a transcription failed or timed out.
 */
export type VoicePackErrorReason =
  'unavailable' | 'invalid' | 'storage' | 'download' | 'load' | 'transcribe';

export class VoicePackError extends Error {
  readonly reason: VoicePackErrorReason;

  constructor(reason: VoicePackErrorReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VoicePackError';
    this.reason = reason;
  }
}

/** Absolute URL of a file of the pack. */
export function voicePackUrl(info: Pick<VoicePackInfo, 'baseUrl'>, path: string): string {
  return new URL(path, info.baseUrl).href;
}

function resolveBase(baseUrl: string): string {
  const withSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const page = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return new URL(withSlash, page).href;
  } catch (error) {
    throw new VoicePackError('invalid', `Invalid voice pack URL: ${baseUrl}`, { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes(':') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function parseManifest(value: unknown, baseUrl: string): VoicePackInfo {
  const invalid = (detail: string) =>
    new VoicePackError('invalid', `Invalid ${MANIFEST_FILE}: ${detail}`);
  if (!isRecord(value)) throw invalid('not an object');
  const { id, licence, files, totalBytes, languages, prompts, runtime } = value;
  if (typeof id !== 'string' || id === '') throw invalid('no id');
  if (typeof licence !== 'string' || licence === '') throw invalid('no licence');
  if (!Array.isArray(files) || files.length === 0) throw invalid('no files');
  const parsed: VoicePackFile[] = files.map((file: unknown) => {
    if (!isRecord(file) || typeof file['path'] !== 'string' || !isSafePath(file['path'])) {
      throw invalid('a file path is missing or leaves the pack folder');
    }
    const bytes = file['bytes'];
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw invalid(`bad size for ${file['path']}`);
    }
    return { path: file['path'], bytes };
  });
  const sum = parsed.reduce((total, file) => total + file.bytes, 0);
  if (totalBytes !== sum)
    throw invalid(`totalBytes is ${String(totalBytes)}, the files add up to ${String(sum)}`);
  // The runtime files must be the build the worker bundles: another one is to install again.
  const version = isRecord(runtime) ? runtime['onnxruntime-web'] : undefined;
  if (version !== ORT_WEB_VERSION) {
    throw invalid(
      `the pack holds ONNX Runtime ${typeof version === 'string' ? version : 'of no version'}, this app needs ${ORT_WEB_VERSION} (run pnpm voice:install-local)`,
    );
  }
  const paths = new Set(parsed.map((file) => file.path));
  if (!paths.has(RUNTIME_FILES.mjs) || !paths.has(RUNTIME_FILES.wasm)) {
    throw invalid('the ONNX Runtime files are missing (run pnpm voice:install-local)');
  }
  if (!Array.isArray(languages) || languages.length === 0) throw invalid('no language');
  if (!isRecord(prompts)) throw invalid('no decoder prompts');
  const langs: string[] = [];
  const table: Record<string, number[]> = {};
  for (const lang of languages) {
    if (typeof lang !== 'string' || lang === '') throw invalid('a language is not a code');
    const prompt = prompts[lang];
    const isTokenIds =
      Array.isArray(prompt) &&
      prompt.length > 0 &&
      prompt.every(
        (token) => typeof token === 'number' && Number.isSafeInteger(token) && token >= 0,
      );
    if (!isTokenIds) throw invalid(`no decoder prompt (token ids) for ${lang}`);
    langs.push(lang);
    table[lang] = [...(prompt as number[])];
  }
  return {
    id,
    baseUrl,
    files: parsed,
    totalBytes: sum,
    licence,
    languages: langs,
    prompts: table,
    runtime: ORT_WEB_VERSION,
  };
}

async function openCache(): Promise<Cache | undefined> {
  const storage = (globalThis as { caches?: CacheStorage }).caches;
  if (storage === undefined) return undefined;
  try {
    return await storage.open(VOICE_CACHE);
  } catch {
    // Some private modes expose the API but refuse to open a cache.
    return undefined;
  }
}

/**
 * Reads `<baseUrl>voice-pack.json`. When the network is not available, the
 * copy stored by installVoicePack is used, so an installed pack keeps
 * working in airplane mode.
 */
export async function voicePackInfo(
  baseUrl: string = DEFAULT_VOICE_PACK_URL,
): Promise<VoicePackInfo> {
  const base = resolveBase(baseUrl);
  const url = new URL(MANIFEST_FILE, base).href;
  const online = await readJson(() => fetch(url, { cache: 'no-cache' }));
  if (online.json !== undefined) return parseManifest(online.json, base);
  // Offline, or a host that answers with something else (often the app page):
  // the copy stored by installVoicePack.
  const cache = await openCache();
  const installed = await readJson(async () => (await cache?.match(url)) ?? notFound());
  if (installed.json !== undefined) return parseManifest(installed.json, base);
  if (online.status === 'not-json') {
    throw new VoicePackError('invalid', `${MANIFEST_FILE} at ${url} is not JSON`);
  }
  throw new VoicePackError('unavailable', `The voice pack is not available at ${url}`);
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

async function readJson(
  get: () => Promise<Response>,
): Promise<{ json?: unknown; status: 'ok' | 'missing' | 'not-json' }> {
  let response: Response;
  try {
    response = await get();
  } catch {
    return { status: 'missing' };
  }
  if (!response.ok) return { status: 'missing' };
  try {
    return { json: (await response.json()) as unknown, status: 'ok' };
  } catch {
    return { status: 'not-json' };
  }
}

/**
 * The pack installed in the folder `baseUrl`, read from the voice cache only,
 * never from the network: the copy of the manifest an installation stored
 * last, when every file it lists is there too. Null otherwise (nothing
 * installed, an installation cut short, a file evicted), so a screen can say
 * whether the voice is ready without any request.
 */
export async function installedVoicePackInfo(baseUrl: string): Promise<VoicePackInfo | null> {
  const base = resolveBase(baseUrl);
  const cache = await openCache();
  if (cache === undefined) return null;
  const stored = await readJson(
    async () => (await cache.match(new URL(MANIFEST_FILE, base).href)) ?? notFound(),
  );
  if (stored.json === undefined) return null;
  let info: VoicePackInfo;
  try {
    info = parseManifest(stored.json, base);
  } catch {
    return null;
  }
  return (await isVoicePackInstalled(info)) ? info : null;
}

/** The voice cache entries stored in the pack folder `baseUrl` (files and manifest); none without the Cache API. */
async function storedInFolder(baseUrl: string): Promise<{ cache: Cache; requests: Request[] }[]> {
  const base = resolveBase(baseUrl);
  const cache = await openCache();
  if (cache === undefined) return [];
  const requests = (await cache.keys()).filter((request) => request.url.startsWith(base));
  return [{ cache, requests }];
}

/**
 * The bytes of the pack folder `baseUrl` already in the voice cache, from the
 * sizes stored with each file, without the manifest and without the
 * network: an installation cut short shows how much it kept for later.
 */
export async function storedVoicePackBytes(baseUrl: string): Promise<number> {
  let total = 0;
  for (const { cache, requests } of await storedInFolder(baseUrl)) {
    for (const request of requests) {
      const length = Number((await cache.match(request))?.headers.get('content-length') ?? 0);
      if (Number.isSafeInteger(length) && length > 0) total += length;
    }
  }
  return total;
}

/**
 * Deletes everything the voice cache holds in the pack folder `baseUrl`,
 * with or without a manifest: the files an installation cut short kept, too.
 */
export async function removeVoicePackFiles(baseUrl: string): Promise<void> {
  for (const { cache, requests } of await storedInFolder(baseUrl)) {
    for (const request of requests) await cache.delete(request);
  }
}

/** True when every file of the pack is in the Cache API cache read by Transformers.js. */
export async function isVoicePackInstalled(info: VoicePackInfo): Promise<boolean> {
  const cache = await openCache();
  if (cache === undefined) return false;
  for (const file of info.files) {
    if ((await cache.match(voicePackUrl(info, file.path))) === undefined) return false;
  }
  return true;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The installation was cancelled.', 'AbortError');
}

async function checkStorage(remaining: number): Promise<void> {
  const storage = (globalThis as { navigator?: { storage?: StorageManager } }).navigator?.storage;
  if (storage === undefined) return;
  // Ask the browser not to evict the pack under storage pressure; the answer does not block.
  // Both calls are guarded: older browsers lack them or reject them.
  void Promise.resolve()
    .then(() => storage.persist())
    .catch(() => false);
  const estimate = await Promise.resolve()
    .then(() => storage.estimate())
    .catch(() => undefined);
  if (estimate?.quota === undefined) return;
  const free = estimate.quota - (estimate.usage ?? 0);
  if (free < remaining * STORAGE_MARGIN) {
    throw new VoicePackError(
      'storage',
      `Not enough storage for the voice pack: ${String(remaining)} bytes needed, ${String(free)} free`,
    );
  }
}

/**
 * Downloads every file of the pack into the Cache API cache that
 * Transformers.js reads. Files already stored are kept, so an interrupted
 * installation resumes where it stopped; the file in progress when the
 * signal aborts is not kept. `onProgress` receives the bytes stored so far
 * and the pack size.
 */
export async function installVoicePack(
  info: VoicePackInfo,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  const cache = await openCache();
  if (cache === undefined) {
    throw new VoicePackError('storage', 'This browser cannot store the voice pack (no Cache API).');
  }

  const missing: VoicePackFile[] = [];
  let loaded = 0;
  for (const file of info.files) {
    if ((await cache.match(voicePackUrl(info, file.path))) === undefined) missing.push(file);
    else loaded += file.bytes;
  }
  await checkStorage(info.totalBytes - loaded);
  onProgress(loaded, info.totalBytes);

  for (const file of missing) {
    if (signal?.aborted) throw abortError(signal);
    const url = voicePackUrl(info, file.path);
    let response: Response;
    try {
      // no-store: the file goes to the voice cache only, not also to the HTTP cache.
      response = await fetch(
        url,
        signal === undefined ? { cache: 'no-store' } : { cache: 'no-store', signal },
      );
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      throw new VoicePackError('download', `Could not download ${file.path}`, { cause: error });
    }
    if (!response.ok || response.body === null) {
      throw new VoicePackError(
        'download',
        `Could not download ${file.path}: HTTP ${String(response.status)}`,
      );
    }

    // Stream the body into the cache, counting bytes, so a 200 MB file never sits in memory.
    let received = 0;
    const start = loaded;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        onProgress(start + Math.min(received, file.bytes), info.totalBytes);
        controller.enqueue(chunk);
      },
    });
    const headers = new Headers({ 'content-length': String(file.bytes) });
    const type = response.headers.get('content-type');
    if (type !== null) headers.set('content-type', type);
    try {
      await cache.put(url, new Response(response.body.pipeThrough(counter), { headers }));
    } catch (error) {
      await cache.delete(url).catch(() => false);
      if (signal?.aborted) throw abortError(signal);
      const full = error instanceof DOMException && error.name === 'QuotaExceededError';
      throw new VoicePackError(full ? 'storage' : 'download', `Could not store ${file.path}`, {
        cause: error,
      });
    }
    if (received !== file.bytes) {
      await cache.delete(url);
      throw new VoicePackError(
        'download',
        `${file.path} has ${String(received)} bytes, the manifest says ${String(file.bytes)}`,
      );
    }
    loaded += file.bytes;
  }

  // Files of the folder the pack no longer lists (the runtime of an older
  // ONNX Runtime, for example) are dropped.
  const listed = new Set([
    ...info.files.map((file) => voicePackUrl(info, file.path)),
    voicePackUrl(info, MANIFEST_FILE),
  ]);
  for (const request of await cache.keys()) {
    if (request.url.startsWith(info.baseUrl) && !listed.has(request.url))
      await cache.delete(request);
  }

  // The manifest last: voicePackInfo reads it offline.
  await cache.put(
    voicePackUrl(info, MANIFEST_FILE),
    new Response(JSON.stringify(manifestOf(info)), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  onProgress(info.totalBytes, info.totalBytes);
}

function manifestOf(info: VoicePackInfo) {
  const { id, licence, languages, prompts, files, totalBytes } = info;
  return {
    id,
    licence,
    languages,
    prompts,
    files,
    totalBytes,
    runtime: { 'onnxruntime-web': info.runtime },
  };
}

/** Deletes every file of the pack and its manifest from the cache. */
export async function removeVoicePack(info: VoicePackInfo): Promise<void> {
  const cache = await openCache();
  if (cache === undefined) return;
  for (const path of [...info.files.map((file) => file.path), MANIFEST_FILE]) {
    await cache.delete(voicePackUrl(info, path));
  }
}
