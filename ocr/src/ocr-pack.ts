// SPDX-License-Identifier: MIT
// The prescription reading pack ("Lecture d'ordonnance"): the PaddleOCR
// models, the ONNX Runtime Web files and pdf.js, served from the app origin
// (default ocr/<id>/) and kept in a Cache API cache of its own, so the
// reading runs with no network at all. Installed only when she asks for it,
// as the voice pack is (docs/ocr.md). Whether it is installed says nothing
// about a profile.

/** Cache API cache of the reading pack, its files only (never an image or a text read). */
export const OCR_CACHE = 'siapso-ocr-pack';

/** The pack id: PP-OCRv5 mobile detection and the Latin recognition model. */
export const OCR_PACK_ID = 'ppocrv5-mobile-latin';

/** The pack folder, relative to the page (works under any deployment base path). */
export const OCR_PACK_URL = `ocr/${OCR_PACK_ID}/`;

/** Manifest written by ocr/scripts/install-local.mjs. */
export const MANIFEST_FILE = 'ocr-pack.json';

/**
 * The ONNX Runtime Web build the reading worker bundles: the very version the
 * speech worker pins (ORT_WEB_VERSION of @siapso/speech), so one ONNX Runtime
 * ships in the app. test/versions.test.ts checks both and the installed package.
 */
export const ORT_WEB_VERSION = '1.31.0-dev.20260914-8d85527a0';

/** The pdf.js version whose files the pack carries (test/versions.test.ts). */
export const PDFJS_VERSION = '6.4.299';

/**
 * ONNX Runtime Web files of the pack: the plain build (WebAssembly, SIMD,
 * threads when the page is cross-origin isolated), 14.3 MB against 26.9 MB
 * for the asyncify build of the voice pack. Under runtime/<version>/: an app
 * that moves to another ONNX Runtime finds them missing, so the pack reads as
 * to install again, and the installation downloads only these files.
 */
export const RUNTIME_FILES = {
  mjs: `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.mjs`,
  wasm: `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.wasm`,
} as const;

/**
 * pdf.js, under its version for the same reason: its API, its worker code,
 * and the WebAssembly decoders of the images a scanner puts in a PDF:
 * JBIG2 and CCITT fax (jbig2.wasm, from PDFium) and JPEG 2000 (openjpeg.wasm,
 * from OpenJPEG), which pdf.js 6 decodes with nothing else.
 */
export const PDF_FILES = {
  api: `pdf/${PDFJS_VERSION}/pdf.min.mjs`,
  worker: `pdf/${PDFJS_VERSION}/pdf.worker.min.mjs`,
  jbig2: `pdf/${PDFJS_VERSION}/wasm/jbig2.wasm`,
  openjpeg: `pdf/${PDFJS_VERSION}/wasm/openjpeg.wasm`,
} as const;

/** The models and the characters the recognition model reads. */
export const MODEL_FILES = {
  detection: 'models/det.onnx',
  recognition: 'models/rec-latin.onnx',
  dictionary: 'models/dict-latin.json',
} as const;

/** Free space kept on top of the pack size before an installation starts. */
const STORAGE_MARGIN = 1.1;

export interface OcrPackFile {
  path: string;
  bytes: number;
  /** Lowercase hex SHA-256 of the file: checked once stored. */
  sha256: string;
}

export interface OcrModelSource {
  /** Hugging Face repository. */
  repo: string;
  /** Full commit of the repository the file was taken from. */
  revision: string;
  licence: string;
}

export interface OcrPackInfo {
  id: string;
  /** Absolute URL of the pack folder, ending with a slash. */
  baseUrl: string;
  files: OcrPackFile[];
  totalBytes: number;
  licence: string;
  models: { detection: OcrModelSource; recognition: OcrModelSource };
  /** The ONNX Runtime Web and pdf.js versions of the pack's files. */
  runtime: { onnxruntime: string; pdfjs: string };
}

/**
 * Why a reading or a pack operation failed, for a clear message:
 * - `unavailable`: the pack is not installed, or the server does not give it;
 * - `invalid`: its manifest is wrong, or a file received is not the one the
 *   manifest describes (size or SHA-256): damaged;
 * - `storage`: not enough space, or no Cache API;
 * - `download`: the installation stopped part way (what was stored is kept);
 * - `load`: the models could not start (worker, memory, runtime);
 * - `read`: the reading failed;
 * - `timeout`: the reading took longer than its time limit;
 * - `cancelled`: the reading was cancelled;
 * - `not-image`: the file is neither a photo nor a PDF;
 * - `too-large`: the file is too big for this phone (bytes or pixels);
 * - `pdf-password`: the PDF is protected by a password;
 * - `pdf-damaged`: the PDF cannot be opened.
 */
export type OcrErrorReason =
  | 'unavailable'
  | 'invalid'
  | 'storage'
  | 'download'
  | 'load'
  | 'read'
  | 'timeout'
  | 'cancelled'
  | 'not-image'
  | 'too-large'
  | 'pdf-password'
  | 'pdf-damaged';

export class OcrPackError extends Error {
  readonly reason: OcrErrorReason;

  constructor(reason: OcrErrorReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OcrPackError';
    this.reason = reason;
  }
}

/** Absolute URL of a file of the pack. */
export function ocrPackUrl(info: Pick<OcrPackInfo, 'baseUrl'>, path: string): string {
  return new URL(path, info.baseUrl).href;
}

function resolveBase(baseUrl: string): string {
  const withSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const page = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return new URL(withSlash, page).href;
  } catch (error) {
    throw new OcrPackError('invalid', `Invalid reading pack URL: ${baseUrl}`, { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A relative path that stays in the pack folder. */
export function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes(':') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function modelSource(value: unknown): OcrModelSource | undefined {
  if (!isRecord(value)) return undefined;
  const { repo, revision, licence } = value;
  if (typeof repo !== 'string' || repo === '') return undefined;
  if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision)) return undefined;
  if (typeof licence !== 'string' || licence === '') return undefined;
  return { repo, revision, licence };
}

/** Validates ocr-pack.json; `baseUrl` is the absolute pack folder. */
export function parseOcrManifest(value: unknown, baseUrl: string): OcrPackInfo {
  const invalid = (detail: string) =>
    new OcrPackError('invalid', `Invalid ${MANIFEST_FILE}: ${detail}`);
  if (!isRecord(value)) throw invalid('not an object');
  const { id, licence, files, totalBytes, models, runtime } = value;
  if (typeof id !== 'string' || id === '') throw invalid('no id');
  if (typeof licence !== 'string' || licence === '') throw invalid('no licence');
  if (!Array.isArray(files) || files.length === 0) throw invalid('no files');
  const parsed: OcrPackFile[] = files.map((file: unknown) => {
    if (!isRecord(file) || typeof file['path'] !== 'string' || !isSafePath(file['path'])) {
      throw invalid('a file path is missing or leaves the pack folder');
    }
    const bytes = file['bytes'];
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw invalid(`bad size for ${file['path']}`);
    }
    const sha256 = file['sha256'];
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      throw invalid(`no SHA-256 for ${file['path']}`);
    }
    return { path: file['path'], bytes, sha256 };
  });
  const sum = parsed.reduce((total, file) => total + file.bytes, 0);
  if (totalBytes !== sum) {
    throw invalid(`totalBytes is ${String(totalBytes)}, the files add up to ${String(sum)}`);
  }
  // The runtime and pdf.js files must be the builds the worker expects: another one is to install again.
  const ort = isRecord(runtime) ? runtime['onnxruntime-web'] : undefined;
  const pdfjs = isRecord(runtime) ? runtime['pdfjs-dist'] : undefined;
  if (ort !== ORT_WEB_VERSION || pdfjs !== PDFJS_VERSION) {
    throw invalid(
      `the pack holds ONNX Runtime ${String(ort)} and pdf.js ${String(pdfjs)}, this app needs ${ORT_WEB_VERSION} and ${PDFJS_VERSION} (run pnpm ocr:install-local)`,
    );
  }
  const paths = new Set(parsed.map((file) => file.path));
  const needed = [
    ...Object.values(MODEL_FILES),
    ...Object.values(RUNTIME_FILES),
    ...Object.values(PDF_FILES),
  ];
  const missing = needed.filter((path) => !paths.has(path));
  if (missing.length > 0) throw invalid(`missing ${missing.join(', ')}`);
  const detection = isRecord(models) ? modelSource(models['detection']) : undefined;
  const recognition = isRecord(models) ? modelSource(models['recognition']) : undefined;
  if (detection === undefined || recognition === undefined) {
    throw invalid('the models must name their repository, full revision and licence');
  }
  return {
    id,
    baseUrl,
    files: parsed,
    totalBytes: sum,
    licence,
    models: { detection, recognition },
    runtime: { onnxruntime: ORT_WEB_VERSION, pdfjs: PDFJS_VERSION },
  };
}

async function openCache(): Promise<Cache | undefined> {
  const storage = (globalThis as { caches?: CacheStorage }).caches;
  if (storage === undefined) return undefined;
  try {
    return await storage.open(OCR_CACHE);
  } catch {
    // Some private modes expose the API but refuse to open a cache.
    return undefined;
  }
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
 * Reads `<baseUrl>ocr-pack.json` from the server, for the install screen.
 * When the network is not available, the copy stored by installOcrPack is
 * used. Only the install action calls this: a screen that only needs to know
 * whether the pack is there calls installedOcrPackInfo, which never asks the
 * network.
 */
export async function ocrPackInfo(baseUrl: string = OCR_PACK_URL): Promise<OcrPackInfo> {
  const base = resolveBase(baseUrl);
  const url = new URL(MANIFEST_FILE, base).href;
  const online = await readJson(() => fetch(url, { cache: 'no-cache' }));
  if (online.json !== undefined) return parseOcrManifest(online.json, base);
  const cache = await openCache();
  const installed = await readJson(async () => (await cache?.match(url)) ?? notFound());
  if (installed.json !== undefined) return parseOcrManifest(installed.json, base);
  throw new OcrPackError(
    'unavailable',
    online.status === 'not-json'
      ? `${MANIFEST_FILE} at ${url} is not JSON: the server does not serve the reading pack`
      : `The reading pack is not available at ${url}`,
  );
}

/**
 * The pack installed in the folder `baseUrl`, read from its cache only,
 * never from the network: the manifest an installation stored last, when
 * every file it lists is there too. Null otherwise (nothing installed, an
 * installation cut short, a file evicted, a pack for another runtime).
 */
export async function installedOcrPackInfo(
  baseUrl: string = OCR_PACK_URL,
): Promise<OcrPackInfo | null> {
  const base = resolveBase(baseUrl);
  const cache = await openCache();
  if (cache === undefined) return null;
  const stored = await readJson(
    async () => (await cache.match(new URL(MANIFEST_FILE, base).href)) ?? notFound(),
  );
  if (stored.json === undefined) return null;
  let info: OcrPackInfo;
  try {
    info = parseOcrManifest(stored.json, base);
  } catch {
    return null;
  }
  return (await isOcrPackInstalled(info)) ? info : null;
}

/** True when every file of the pack is in its cache (cache only, no request). */
export async function isOcrPackInstalled(info: OcrPackInfo): Promise<boolean> {
  const cache = await openCache();
  if (cache === undefined) return false;
  for (const file of info.files) {
    if ((await cache.match(ocrPackUrl(info, file.path))) === undefined) return false;
  }
  return true;
}

async function storedInFolder(
  baseUrl: string,
): Promise<{ cache: Cache; requests: Request[] } | undefined> {
  const base = resolveBase(baseUrl);
  const cache = await openCache();
  if (cache === undefined) return undefined;
  const requests = (await cache.keys()).filter((request) => request.url.startsWith(base));
  return { cache, requests };
}

/**
 * The bytes of the pack folder already in its cache, from the sizes stored
 * with each file, without the network: an installation cut short shows how
 * much it kept for later.
 */
export async function storedOcrPackBytes(baseUrl: string = OCR_PACK_URL): Promise<number> {
  const stored = await storedInFolder(baseUrl);
  if (stored === undefined) return 0;
  let total = 0;
  for (const request of stored.requests) {
    const length = Number((await stored.cache.match(request))?.headers.get('content-length') ?? 0);
    if (Number.isSafeInteger(length) && length > 0) total += length;
  }
  return total;
}

/** Deletes everything the cache holds in the pack folder, a finished installation or not. */
export async function removeOcrPack(baseUrl: string = OCR_PACK_URL): Promise<void> {
  const stored = await storedInFolder(baseUrl);
  if (stored === undefined) return;
  for (const request of stored.requests) await stored.cache.delete(request);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The installation was cancelled.', 'AbortError');
}

async function checkStorage(remaining: number): Promise<void> {
  const storage = (globalThis as { navigator?: { storage?: StorageManager } }).navigator?.storage;
  if (storage === undefined) return;
  // Ask the browser not to evict the pack under storage pressure; the answer does not block.
  void Promise.resolve()
    .then(() => storage.persist())
    .catch(() => false);
  const estimate = await Promise.resolve()
    .then(() => storage.estimate())
    .catch(() => undefined);
  if (estimate?.quota === undefined) return;
  const free = estimate.quota - (estimate.usage ?? 0);
  if (free < remaining * STORAGE_MARGIN) {
    throw new OcrPackError(
      'storage',
      `Not enough storage for the reading pack: ${String(remaining)} bytes needed, ${String(free)} free`,
    );
  }
}

async function sha256Hex(response: Response | undefined): Promise<string | undefined> {
  if (response === undefined) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Downloads every file of the pack into its cache. Files already stored are
 * kept, so an interrupted installation resumes where it stopped; the file in
 * progress when the signal aborts is not kept. Each file is checked once
 * stored, by size and SHA-256 (the largest is 14 MB): a damaged file is
 * deleted. `onProgress` receives the bytes stored so far and the pack size.
 * Nothing else ever downloads the pack.
 */
export async function installOcrPack(
  info: OcrPackInfo,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  const cache = await openCache();
  if (cache === undefined) {
    throw new OcrPackError('storage', 'This browser cannot store the reading pack (no Cache API).');
  }

  const missing: OcrPackFile[] = [];
  let loaded = 0;
  for (const file of info.files) {
    if ((await cache.match(ocrPackUrl(info, file.path))) === undefined) missing.push(file);
    else loaded += file.bytes;
  }
  await checkStorage(info.totalBytes - loaded);
  onProgress(loaded, info.totalBytes);

  for (const file of missing) {
    if (signal?.aborted) throw abortError(signal);
    const url = ocrPackUrl(info, file.path);
    let response: Response;
    try {
      // no-store: the file goes to the pack cache only, not also to the HTTP cache.
      response = await fetch(
        url,
        signal === undefined ? { cache: 'no-store' } : { cache: 'no-store', signal },
      );
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      throw new OcrPackError('download', `Could not download ${file.path}`, { cause: error });
    }
    if (!response.ok || response.body === null) {
      // A file the server does not have is a pack it does not give, not a download cut short.
      const gone = response.status === 404 || response.status === 410;
      throw new OcrPackError(
        gone ? 'unavailable' : 'download',
        `Could not download ${file.path}: HTTP ${String(response.status)}`,
      );
    }

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
      throw new OcrPackError(full ? 'storage' : 'download', `Could not store ${file.path}`, {
        cause: error,
      });
    }
    if (received !== file.bytes) {
      await cache.delete(url);
      throw new OcrPackError(
        'invalid',
        `${file.path} has ${String(received)} bytes, the manifest says ${String(file.bytes)}`,
      );
    }
    if ((await sha256Hex(await cache.match(url))) !== file.sha256) {
      await cache.delete(url);
      throw new OcrPackError('invalid', `${file.path} is not the file the manifest describes`);
    }
    loaded += file.bytes;
  }

  // Files of the folder the pack no longer lists (an older runtime) are dropped.
  const listed = new Set([
    ...info.files.map((file) => ocrPackUrl(info, file.path)),
    ocrPackUrl(info, MANIFEST_FILE),
  ]);
  for (const request of await cache.keys()) {
    if (request.url.startsWith(info.baseUrl) && !listed.has(request.url)) {
      await cache.delete(request);
    }
  }

  // The manifest last: installedOcrPackInfo reads it with no network.
  await cache.put(
    ocrPackUrl(info, MANIFEST_FILE),
    new Response(JSON.stringify(manifestOf(info)), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  onProgress(info.totalBytes, info.totalBytes);
}

function manifestOf(info: OcrPackInfo) {
  const { id, licence, models, files, totalBytes } = info;
  return {
    id,
    licence,
    models,
    files,
    totalBytes,
    runtime: { 'onnxruntime-web': info.runtime.onnxruntime, 'pdfjs-dist': info.runtime.pdfjs },
  };
}
