// SPDX-License-Identifier: MIT
// Loads the knowledge pack built by `pnpm knowledge:build` (served under
// /pack/ and precached by the service worker): the manifest, then each
// fragment, checked against its sha256, assembled and validated by parsePack.
// A valid pack is handed back at once and stored in IndexedDB in the
// background; when the download fails or is invalid, the stored pack is used.
import { parsePack, type Pack } from '@siapso/engine';
import { getStoredPack, storePack, type StoreOutcome } from './db.js';

export class PackLoadError extends Error {
  override name = 'PackLoadError';
}

export interface LoadedPack {
  pack: Pack;
  /** 'network': downloaded (or served by the service worker); 'cache': read from IndexedDB. */
  source: 'network' | 'cache';
  /** Why the downloaded pack was not used, when the source is 'cache'. */
  fallbackReason: string | null;
  /**
   * Settles once the device has the pack: 'stored', or 'unchanged' when the
   * same version with the same fragments was already there (always for a
   * pack read from the device). Rejects when the device cannot store it; the
   * pack still works for this session.
   */
  stored: Promise<StoreOutcome>;
}

/** Each fragment and the Pack field it fills (tools/knowledge/src/write.ts writes them). */
const FRAGMENTS = {
  'substances.json': 'substances',
  'classes.json': 'classes',
  'products.json': 'products',
  'plants.json': 'plants',
  'rules.json': 'rules',
  'danger-signs.json': 'dangerSigns',
  'sources.json': 'sources',
  'messages.fr.json': 'fr',
  'messages.en.json': 'en',
} as const;

type FragmentName = keyof typeof FRAGMENTS;

interface ManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
}

interface Manifest {
  schema: unknown;
  version: unknown;
  date: unknown;
  clinicallyValidated: unknown;
  fragments: ManifestEntry[];
}

function packUrl(name: string): string {
  return `${import.meta.env.BASE_URL}pack/${name}`;
}

async function download(fetchImpl: typeof fetch, name: string): Promise<ArrayBuffer> {
  const response = await fetchImpl(packUrl(name));
  if (!response.ok) throw new Error(`${name}: HTTP ${String(response.status)}`);
  return response.arrayBuffer();
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !('subtle' in crypto)) {
    throw new Error('WebCrypto is unavailable (the page needs a secure context)');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseJson(bytes: ArrayBuffer, name: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${name}: not valid JSON`);
  }
}

function readManifest(json: unknown): Manifest {
  const manifest = json as Partial<Manifest> | null;
  if (typeof manifest !== 'object' || manifest === null || !Array.isArray(manifest.fragments)) {
    throw new Error('manifest.json: no fragment list');
  }
  if (manifest.schema !== 1) {
    throw new Error(`manifest.json: unsupported schema ${String(manifest.schema)}, expected 1`);
  }
  return manifest as Manifest;
}

async function fetchFragment(
  fetchImpl: typeof fetch,
  manifest: Manifest,
  name: FragmentName,
): Promise<unknown> {
  const entry = manifest.fragments.find((f) => f.path === name);
  if (!entry) throw new Error(`manifest.json: ${name} is not listed`);
  const bytes = await download(fetchImpl, name);
  if (bytes.byteLength !== entry.bytes) {
    throw new Error(
      `${name}: ${String(bytes.byteLength)} bytes, the manifest says ${String(entry.bytes)}`,
    );
  }
  if ((await sha256Hex(bytes)) !== entry.sha256) {
    throw new Error(`${name}: sha256 does not match the manifest`);
  }
  return parseJson(bytes, name);
}

async function fromNetwork(fetchImpl: typeof fetch): Promise<{ pack: Pack; fingerprint: string }> {
  const manifest = readManifest(parseJson(await download(fetchImpl, 'manifest.json'), 'manifest'));
  const names = Object.keys(FRAGMENTS) as FragmentName[];
  const values = await Promise.all(names.map((name) => fetchFragment(fetchImpl, manifest, name)));
  const parts = Object.fromEntries(names.map((name, i) => [FRAGMENTS[name], values[i]]));
  const { fr, en, ...collections } = parts;
  const pack = parsePack({
    schema: manifest.schema,
    version: manifest.version,
    date: manifest.date,
    clinicallyValidated: manifest.clinicallyValidated,
    ...collections,
    messages: { fr, en },
  });
  // Every fragment was checked against its listed hash: version and hashes identify the pack.
  const hashes = names.map((name) => manifest.fragments.find((f) => f.path === name)?.sha256);
  return { pack, fingerprint: [pack.version, ...hashes].join(' ') };
}

async function fromDevice(): Promise<Pack> {
  const stored = await getStoredPack('current');
  if (stored === undefined) throw new Error('no pack is stored');
  return parsePack(stored.pack);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Stores in the background; a failure is logged and left for the caller to report. */
function storeInBackground(pack: Pack, fingerprint: string): Promise<StoreOutcome> {
  const stored = storePack(pack, fingerprint);
  stored.catch((error: unknown) => {
    console.warn('Knowledge pack not stored on this device', error);
  });
  return stored;
}

/**
 * The knowledge pack, from the network (handed back as soon as it is
 * verified, then stored on the device in the background) or, when that
 * fails, from the device. Throws a PackLoadError when neither works.
 */
export async function loadPack(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<LoadedPack> {
  let networkError: unknown;
  try {
    const { pack, fingerprint } = await fromNetwork(fetchImpl);
    return {
      pack,
      source: 'network',
      fallbackReason: null,
      stored: storeInBackground(pack, fingerprint),
    };
  } catch (error) {
    networkError = error;
  }
  try {
    return {
      pack: await fromDevice(),
      source: 'cache',
      fallbackReason: reason(networkError),
      stored: Promise.resolve('unchanged'),
    };
  } catch (deviceError) {
    throw new PackLoadError(
      `The knowledge pack could not be loaded from the network (${reason(networkError)}) nor from this device (${reason(deviceError)})`,
      { cause: networkError },
    );
  }
}
