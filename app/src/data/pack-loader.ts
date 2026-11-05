// SPDX-License-Identifier: MIT
// Loads the knowledge pack built by `pnpm knowledge:build` (served under
// /pack/ and precached by the service worker), see docs/pack-signing.md:
// 1. manifest.json, whose signature (manifest.sig) is checked before anything
//    in it is trusted (pack-verify.ts);
// 2. its version: never below the version of the pack built with the app
//    (the floor), and strictly above the pack active on this device and any
//    version rolled back on it, unless it is that very pack;
// 3. only the fragments whose sha256 differs from the active pack are
//    downloaded, the others are taken from it; every downloaded fragment is
//    checked against its hash, and the whole pack validated by parsePack.
// Nothing is activated before all of this passed. A valid pack is handed back
// at once and stored in IndexedDB in the background, where the pack it
// replaces is kept for a rollback; when the download fails or is refused, the
// stored pack is used, if this build still trusts it and it is not below the
// floor (unless the user rolled back to it).
import { parsePack, type Pack } from '@siapso/engine';
import { PACK_PUBLIC_KEYS } from '../config/pack-keys.js';
import { unsignedPackAllowed } from '../config/pack-signing.js';
import {
  getStoredPack,
  restorePreviousPack,
  storePack,
  type PackDetails,
  type StoredPack,
  type StoreOptions,
  type StoreOutcome,
  versionOf,
} from './db.js';
import {
  checkOrigin,
  compareVersions,
  distrustReason,
  isTrusted,
  isVersion,
  originKey,
  PackVerifyError,
  type PackOrigin,
  type PackTrust,
} from './pack-verify.js';

export class PackLoadError extends Error {
  override name = 'PackLoadError';
}

export class PackRollbackError extends Error {
  override name = 'PackRollbackError';
}

/** A file of the pack that could not be downloaded (no network, an HTTP error). */
class PackDownloadError extends Error {
  override name = 'PackDownloadError';
}

/** A pack refused because its version was rolled back on this device. */
class PackRolledBackError extends PackVerifyError {
  override name = 'PackRolledBackError';
}

/**
 * Why the stored copy is used: 'offline', the pack could not be downloaded;
 * 'refused', it failed a check (origin, version, hashes, content);
 * 'rolled-back', the user went back to the previous pack on this phone.
 */
export type PackFallback = 'offline' | 'refused' | 'rolled-back';

export interface LoadedPack {
  pack: Pack;
  /**
   * 'network': matches the manifest downloaded (or served by the service
   * worker) now; 'cache': the pack stored on the device, used because the
   * download failed or was refused.
   */
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
  /** Who signed the pack, or why an unsigned one was accepted (test and demo builds). */
  origin?: PackOrigin;
  /** Why the stored copy is used, when the source is 'cache'. */
  fallback?: PackFallback;
}

export interface LoadOptions {
  /** Which packs are accepted; the trust of this build by default. */
  trust?: PackTrust;
  /** How long to wait for the pack stored on the device before going on without it. */
  deviceTimeoutMs?: number;
  /** The lowest version accepted (null: none); the version of the pack built with the app by default. */
  minVersion?: string | null;
  /**
   * The minimum safe version of the pack built with the app (null: none), by
   * default: a pack rolled back to below it is set aside.
   */
  minSafeVersion?: string | null;
}

/**
 * The trust of this build: the public keys of src/config/pack-keys.ts, and
 * VITE_ALLOW_UNSIGNED_PACK=true in a test or demo build (never in production
 * mode).
 */
export const BUILD_TRUST: PackTrust = {
  keys: PACK_PUBLIC_KEYS,
  allowUnsigned: unsignedPackAllowed(
    import.meta.env.MODE,
    import.meta.env.VITE_ALLOW_UNSIGNED_PACK,
  ),
};

/**
 * The version of the pack built with the app (vite.config.ts reads it from
 * app/public/pack/manifest.json): the loader never accepts a lower one, so
 * an old signed pack cannot be replayed even on a phone with no pack yet.
 */
export const BUILD_MIN_VERSION: string | null = __MIN_PACK_VERSION__;

/**
 * The minimum safe version of the pack built with the app, when it names
 * one: no rollback below it, and a pack rolled back to below it is replaced.
 */
export const BUILD_MIN_SAFE_VERSION: string | null = __MIN_SAFE_PACK_VERSION__;

/**
 * Generous: the device read only waits this long when IndexedDB is blocked
 * by another tab; a large pack on an entry-level phone takes a while to read.
 */
export const DEVICE_TIMEOUT_MS = 10_000;

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

const NAMES = Object.keys(FRAGMENTS) as FragmentName[];

interface ManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
}

interface Manifest {
  schema: 1;
  version: string;
  date: unknown;
  clinicallyValidated: unknown;
  /** The lowest version still safe to use, when the pack names one (signed with the manifest). */
  minimumSafeVersion: string | null;
  /** The entry of each fragment the app reads. */
  entries: Record<FragmentName, ManifestEntry>;
}

function packUrl(name: string): string {
  return `${import.meta.env.BASE_URL}pack/${name}`;
}

async function download(fetchImpl: typeof fetch, name: string): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetchImpl(packUrl(name));
  } catch (error) {
    throw new PackDownloadError(`${name}: ${reason(error)}`, { cause: error });
  }
  if (!response.ok) throw new PackDownloadError(`${name}: HTTP ${String(response.status)}`);
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

function keyIdOf(json: unknown): unknown {
  return typeof json === 'object' && json !== null
    ? (json as { keyId?: unknown }).keyId
    : undefined;
}

/** Checks the manifest's form: schema, semantic version, and a valid entry for each fragment. */
function readManifest(json: unknown): Manifest {
  const manifest = json as Partial<Record<string, unknown>> | null;
  if (typeof manifest !== 'object' || manifest === null || !Array.isArray(manifest['fragments'])) {
    throw new Error('manifest.json: no fragment list');
  }
  if (manifest['schema'] !== 1) {
    throw new Error(`manifest.json: unsupported schema ${String(manifest['schema'])}, expected 1`);
  }
  const version = manifest['version'];
  if (!isVersion(version)) {
    throw new PackVerifyError(
      `manifest.json: version "${String(version)}" is not a semantic version`,
    );
  }
  const minimum = manifest['minimumSafeVersion'];
  if (minimum !== undefined && (!isVersion(minimum) || compareVersions(minimum, version) > 0)) {
    throw new PackVerifyError(
      `manifest.json: minimumSafeVersion ${JSON.stringify(minimum)} must be a version at most ${version}`,
    );
  }
  const listed = manifest['fragments'] as Partial<ManifestEntry>[];
  const entries = {} as Record<FragmentName, ManifestEntry>;
  for (const name of NAMES) {
    const entry = listed.find((f) => f.path === name);
    if (!entry) throw new Error(`manifest.json: ${name} is not listed`);
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`manifest.json: the sha256 of ${name} is missing or malformed`);
    }
    if (typeof entry.bytes !== 'number' || !Number.isInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`manifest.json: the size of ${name} is missing or malformed`);
    }
    entries[name] = { path: name, sha256: entry.sha256, bytes: entry.bytes };
  }
  return {
    schema: 1,
    version,
    date: manifest['date'],
    clinicallyValidated: manifest['clinicallyValidated'],
    minimumSafeVersion: minimum ?? null,
    entries,
  };
}

async function fetchFragment(
  fetchImpl: typeof fetch,
  name: FragmentName,
  entry: ManifestEntry,
): Promise<unknown> {
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

/** The value a fragment holds, taken from an assembled pack. */
function fragmentOf(pack: Pack, name: FragmentName): unknown {
  const field = FRAGMENTS[name];
  return field === 'fr' || field === 'en' ? pack.messages[field] : pack[field];
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `promise`, or a rejection once `ms` have passed without an answer. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`no answer from storage after ${String(ms)} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Whether `version` is below the floor (a version that is not semantic counts as below). */
function belowFloor(version: unknown, floor: string | null): boolean {
  if (floor === null) return false;
  return !isVersion(version) || compareVersions(version, floor) < 0;
}

function floorReason(version: unknown, floor: string | null): string {
  return `${String(version)} is older than ${String(floor)}, the version this app was built with`;
}

/**
 * The highest minimum safe version known: the one the active pack names and
 * the one of the pack built with the app (null when neither names one).
 */
function requiredSafeVersion(
  current: StoredPack | undefined,
  minSafe: string | null,
): string | null {
  const known = [current?.minimumSafeVersion, minSafe].filter(isVersion);
  return known.reduce<string | null>(
    (highest, version) =>
      highest === null || compareVersions(version, highest) > 0 ? version : highest,
    null,
  );
}

/** Why a rollback to `version` is refused by the minimum safe version, or null. */
function unsafeRollback(version: unknown, required: string | null): string | null {
  if (required === null) return null;
  if (isVersion(version) && compareVersions(version, required) >= 0) return null;
  return `version ${String(version)} is below ${required}, the minimum safe version`;
}

/** The pack active on this device, as this build sees it. */
interface Device {
  /** The stored pack, when it can be read, is trusted by this build, valid and not below the floor. */
  active: { stored: StoredPack; pack: Pack } | null;
  /** Why there is no active pack. */
  reason: string;
  /** The stored pack could be read: a new pack may replace it. */
  readable: boolean;
  /** The fingerprint of a stored pack set aside (not trusted, not valid, below the floor). */
  setAside?: string;
}

async function readDevice(
  trust: PackTrust,
  timeoutMs: number,
  floor: string | null,
  minSafe: string | null,
): Promise<Device> {
  let stored: StoredPack | undefined;
  try {
    stored = await withTimeout(getStoredPack('current'), timeoutMs);
  } catch (error) {
    return { active: null, reason: reason(error), readable: false };
  }
  if (stored === undefined) return { active: null, reason: 'no pack is stored', readable: true };
  const setAside = (why: string): Device => ({
    active: null,
    reason: why,
    readable: true,
    setAside: stored.fingerprint,
  });
  if (!isTrusted(stored.origin, trust)) {
    return setAside(`the stored pack ${distrustReason(stored.origin)}`);
  }
  let pack: Pack;
  try {
    pack = parsePack(stored.pack);
  } catch (error) {
    return setAside(reason(error));
  }
  if (stored.rolledBackFrom === undefined) {
    if (belowFloor(pack.version, floor)) {
      return setAside(`the stored pack ${floorReason(pack.version, floor)}`);
    }
  } else {
    // A pack the user rolled back to stays, even below the floor (going back
    // was their choice), unless the pack built with the app withdrew it: then
    // the app pack replaces it and the rollback mark goes, even when it is the
    // very version the user left.
    const unsafe = unsafeRollback(pack.version, minSafe);
    if (unsafe !== null) return setAside(`the pack rolled back to: ${unsafe} of this app`);
  }
  return { active: { stored, pack }, reason: '', readable: true };
}

/** A verified pack: 'unchanged' is the active pack, which the manifest describes exactly. */
interface Downloaded {
  kind: 'unchanged' | 'new';
  pack: Pack;
  fingerprint: string;
  details: PackDetails;
  origin: PackOrigin;
}

/**
 * Refuses a version that must not replace the active pack: it must be
 * strictly newer than the active pack and than any version rolled back on
 * this device (a changed pack always gets a new version).
 */
function checkVersion(version: string, active: StoredPack): void {
  const rolledBack = active.rolledBackFrom;
  if (isVersion(rolledBack) && compareVersions(version, rolledBack) <= 0) {
    throw new PackRolledBackError(
      `manifest.json: version ${version} was rolled back on this device; a version above ${rolledBack} is needed`,
    );
  }
  const current = active.pack.version;
  if (isVersion(current) && compareVersions(version, current) <= 0) {
    throw new PackVerifyError(
      `manifest.json: version ${version} is not newer than the active pack ${current}; a changed pack needs a higher version`,
    );
  }
}

async function fromNetwork(
  fetchImpl: typeof fetch,
  trust: PackTrust,
  device: Device,
  floor: string | null,
): Promise<Downloaded> {
  const manifestBytes = await download(fetchImpl, 'manifest.json');
  const json = parseJson(manifestBytes, 'manifest.json');
  const origin = await checkOrigin(new Uint8Array(manifestBytes), keyIdOf(json), trust, async () =>
    new TextDecoder().decode(await download(fetchImpl, 'manifest.sig')),
  );
  const manifest = readManifest(json);
  if (belowFloor(manifest.version, floor)) {
    throw new PackVerifyError(`manifest.json: version ${floorReason(manifest.version, floor)}`);
  }
  const hashes = Object.fromEntries(NAMES.map((name) => [name, manifest.entries[name].sha256]));
  // Everything the pack takes from the manifest: a re-signed manifest that only
  // withdraws the clinical validation is not mistaken for the active pack.
  const fingerprint = [
    manifest.version,
    String(manifest.date),
    String(manifest.clinicallyValidated),
    ...NAMES.map((name) => hashes[name]),
    // Only when set, so a manifest without it keeps the fingerprint it had.
    ...(manifest.minimumSafeVersion === null ? [] : [`safe:${manifest.minimumSafeVersion}`]),
  ].join(' ');
  const details: PackDetails = {
    hashes,
    origin,
    ...(manifest.minimumSafeVersion === null
      ? {}
      : { minimumSafeVersion: manifest.minimumSafeVersion }),
  };
  const active = device.active;
  // The very pack that is active (signed again with another key, for a rotation).
  if (active?.stored.fingerprint === fingerprint) {
    return { kind: 'unchanged', pack: active.pack, fingerprint, details, origin };
  }
  if (active) checkVersion(manifest.version, active.stored);

  const values = await Promise.all(
    NAMES.map((name) =>
      active?.stored.hashes?.[name] === manifest.entries[name].sha256
        ? fragmentOf(active.pack, name)
        : fetchFragment(fetchImpl, name, manifest.entries[name]),
    ),
  );
  const parts = Object.fromEntries(NAMES.map((name, i) => [FRAGMENTS[name], values[i]]));
  const { fr, en, ...collections } = parts;
  const pack = parsePack({
    schema: manifest.schema,
    version: manifest.version,
    date: manifest.date,
    clinicallyValidated: manifest.clinicallyValidated,
    ...collections,
    messages: { fr, en },
  });
  return { kind: 'new', pack, fingerprint, details, origin };
}

/** Logs a store failure and leaves it for the caller to report. */
function logged(stored: Promise<StoreOutcome>): Promise<StoreOutcome> {
  stored.catch((error: unknown) => {
    console.warn('Knowledge pack not stored on this device', error);
  });
  return stored;
}

function storeOf(downloaded: Downloaded, device: Device): Promise<StoreOutcome> {
  if (!device.readable) {
    // The active pack could not be compared with this one: never overwrite it blindly.
    return logged(
      Promise.reject(
        new Error(`not stored: the pack on this device could not be read (${device.reason})`),
      ),
    );
  }
  const sameOrigin = originKey(device.active?.stored.origin) === originKey(downloaded.origin);
  if (downloaded.kind === 'unchanged' && sameOrigin) return Promise.resolve('unchanged');
  const options: StoreOptions = device.setAside === undefined ? {} : { replaces: device.setAside };
  return logged(storePack(downloaded.pack, downloaded.fingerprint, downloaded.details, options));
}

function fallbackOf(error: unknown): PackFallback {
  if (error instanceof PackDownloadError) return 'offline';
  return error instanceof PackRolledBackError ? 'rolled-back' : 'refused';
}

/**
 * The knowledge pack, from the network (handed back as soon as it is
 * verified, then stored on the device in the background) or, when that
 * fails or is refused, from the device. Throws a PackLoadError when neither
 * works. A refused pack is logged, by its reason only (never key material).
 */
export async function loadPack(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  options: LoadOptions = {},
): Promise<LoadedPack> {
  const trust = options.trust ?? BUILD_TRUST;
  const floor = options.minVersion === undefined ? BUILD_MIN_VERSION : options.minVersion;
  const minSafe =
    options.minSafeVersion === undefined ? BUILD_MIN_SAFE_VERSION : options.minSafeVersion;
  const device = await readDevice(
    trust,
    options.deviceTimeoutMs ?? DEVICE_TIMEOUT_MS,
    floor,
    minSafe,
  );
  let networkError: unknown;
  try {
    const downloaded = await fromNetwork(fetchImpl, trust, device, floor);
    return {
      pack: downloaded.pack,
      source: 'network',
      fallbackReason: null,
      stored: storeOf(downloaded, device),
      origin: downloaded.origin,
    };
  } catch (error) {
    networkError = error;
    // Every refusal, by its reason (never key material); not a download failure.
    if (!(error instanceof PackDownloadError))
      console.warn('Knowledge pack refused:', reason(error));
  }
  if (device.active) {
    const { origin } = device.active.stored;
    return {
      pack: device.active.pack,
      source: 'cache',
      fallbackReason: reason(networkError),
      fallback: fallbackOf(networkError),
      stored: Promise.resolve('unchanged'),
      ...(origin === undefined ? {} : { origin }),
    };
  }
  throw new PackLoadError(
    `The knowledge pack could not be loaded from the network (${reason(networkError)}) nor from this device (${device.reason})`,
    { cause: networkError },
  );
}

/**
 * Makes the previous pack the active one again (the Status screen offers it
 * in accompanied mode), when this build trusts it, it is valid, and it is at
 * or above the highest minimum safe version known (the active pack's and the
 * app pack's); even below the floor: going back is the user's choice. The
 * pack it replaces is dropped, and its version is not taken again from the
 * network: only a higher one is. Resolves with the restored pack, as the
 * loader hands one back; rejects with a PackRollbackError, changing nothing,
 * otherwise.
 */
export async function rollbackPack(
  trust: PackTrust = BUILD_TRUST,
  minSafe: string | null = BUILD_MIN_SAFE_VERSION,
): Promise<LoadedPack> {
  let pack: Pack | undefined;
  let restored: StoredPack | undefined;
  try {
    restored = await restorePreviousPack((previous, current) => {
      if (!isTrusted(previous.origin, trust)) {
        throw new PackRollbackError(`The previous pack ${distrustReason(previous.origin)}`);
      }
      const unsafe = unsafeRollback(versionOf(previous), requiredSafeVersion(current, minSafe));
      if (unsafe !== null) throw new PackRollbackError(`The previous pack: ${unsafe}`);
      try {
        pack = parsePack(previous.pack);
      } catch (error) {
        throw new PackRollbackError(`The previous pack is not valid: ${reason(error)}`, {
          cause: error,
        });
      }
    });
  } catch (error) {
    if (error instanceof PackRollbackError) throw error;
    throw new PackRollbackError(`The previous pack could not be restored: ${reason(error)}`, {
      cause: error,
    });
  }
  if (restored === undefined || pack === undefined) {
    throw new PackRollbackError('There is no previous pack to roll back to');
  }
  const { origin } = restored;
  return {
    pack,
    source: 'cache',
    fallbackReason: null,
    fallback: 'rolled-back',
    stored: Promise.resolve('stored'),
    ...(origin === undefined ? {} : { origin }),
  };
}

/**
 * The version a rollback would restore: the previous pack on this device,
 * when rollbackPack would take it (trusted by this build, valid, at or above
 * the minimum safe version); null otherwise, or when it cannot be read.
 */
export async function previousPackVersion(
  trust: PackTrust = BUILD_TRUST,
  minSafe: string | null = BUILD_MIN_SAFE_VERSION,
): Promise<string | null> {
  try {
    const [previous, current] = await Promise.all([
      getStoredPack('previous'),
      getStoredPack('current'),
    ]);
    if (previous === undefined || !isTrusted(previous.origin, trust)) return null;
    const version = versionOf(previous);
    if (unsafeRollback(version, requiredSafeVersion(current, minSafe)) !== null) return null;
    parsePack(previous.pack);
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}
