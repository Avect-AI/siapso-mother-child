// SPDX-License-Identifier: MIT
// Where a knowledge pack comes from, and how pack versions compare
// (docs/pack-signing.md, docs/threat-model.md). manifest.sig is an Ed25519
// signature, in base64, of the exact bytes of manifest.json; the manifest's
// keyId names the key of app/src/config/pack-keys.ts that checks it. A
// manifest without keyId is unsigned: only a demo build (`pnpm build` at the
// repository root, not production mode, VITE_ALLOW_UNSIGNED_PACK=true)
// accepts it.
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import type { PackPublicKey } from '../config/pack-keys.js';
import { base64Bytes } from '../config/pack-signing.js';

ed.hashes.sha512 = sha512;

/** Which packs this build accepts. */
export interface PackTrust {
  /** The public keys that may sign a pack. */
  keys: readonly PackPublicKey[];
  /** A test or demo build: a pack whose origin cannot be proven is accepted too. */
  allowUnsigned: boolean;
}

/** Who signed a pack, or why an unsigned one was accepted (test and demo builds only). */
export type PackOrigin = { signed: true; keyId: string } | { signed: false; reason: string };

/** A pack whose origin or version this build refuses. */
export class PackVerifyError extends Error {
  override name = 'PackVerifyError';
}

/** RFC 8032 checks (zip215: false): a non-canonical signature is refused too. */
function verifies(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

const UNSIGNED_REFUSED =
  'manifest.json: the pack is not signed, and this build only accepts signed packs (only a demo build with VITE_ALLOW_UNSIGNED_PACK=true accepts one)';

/**
 * Checks where a manifest comes from, before anything in it is trusted.
 * `keyId` is the manifest's keyId as parsed; `signature` downloads
 * manifest.sig, and is only called when a known key must check it. Resolves
 * with the origin, or rejects with a PackVerifyError.
 */
export async function checkOrigin(
  manifest: Uint8Array,
  keyId: unknown,
  trust: PackTrust,
  signature: () => Promise<string>,
): Promise<PackOrigin> {
  if (keyId === undefined) {
    if (trust.allowUnsigned) return { signed: false, reason: 'the pack is not signed' };
    throw new PackVerifyError(UNSIGNED_REFUSED);
  }
  if (typeof keyId !== 'string' || keyId === '') {
    throw new PackVerifyError('manifest.json: keyId must be a non-empty string');
  }
  const key = trust.keys.find((candidate) => candidate.keyId === keyId);
  if (key === undefined) {
    if (trust.allowUnsigned) {
      return {
        signed: false,
        reason: `the pack is signed with key "${keyId}", which this build does not know`,
      };
    }
    throw new PackVerifyError(`manifest.json: signed with an unknown key "${keyId}"`);
  }
  const signatureBytes = base64Bytes(await signature());
  const publicKey = base64Bytes(key.publicKey);
  if (signatureBytes?.length !== 64 || publicKey?.length !== 32) {
    throw new PackVerifyError('manifest.sig: not a base64 Ed25519 signature');
  }
  if (!verifies(signatureBytes, manifest, publicKey)) {
    throw new PackVerifyError(
      `manifest.sig: the signature does not match manifest.json (key "${keyId}")`,
    );
  }
  return { signed: true, keyId };
}

/**
 * Whether this build may still use a pack accepted earlier with `origin`
 * (undefined: stored before packs were signed). A key removed from the list,
 * after a compromise, takes its packs with it.
 */
export function isTrusted(origin: PackOrigin | undefined, trust: PackTrust): boolean {
  if (origin?.signed === true && trust.keys.some((key) => key.keyId === origin.keyId)) return true;
  return trust.allowUnsigned;
}

/** A short text that tells two origins apart (every unsigned origin is the same). */
export function originKey(origin: PackOrigin | undefined): string {
  if (origin === undefined) return 'none';
  return origin.signed ? `signed ${origin.keyId}` : 'unsigned';
}

/** Why a pack with this origin is not trusted, for the messages ("the stored pack ..."). */
export function distrustReason(origin: PackOrigin | undefined): string {
  return origin?.signed === true
    ? `is signed with key "${origin.keyId}", which this build no longer trusts`
    : 'is not signed, and this build only accepts signed packs';
}

/** The version format of knowledge/schema/pack-meta.schema.json. */
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/;

export function isVersion(value: unknown): value is string {
  return typeof value === 'string' && VERSION.test(value);
}

/** Compares two runs of digits as numbers, without a size limit. */
function compareNumbers(a: string, b: string): number {
  const [x, y] = [a.replace(/^0+(?=\d)/, ''), b.replace(/^0+(?=\d)/, '')];
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Semver precedence of two pre-release tags. */
function comparePreRelease(a: string, b: string): number {
  const [left, right] = [a.split('.'), b.split('.')];
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const [x, y] = [left[i] ?? '', right[i] ?? ''];
    const [xNumeric, yNumeric] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    let order: number;
    if (xNumeric && yNumeric) order = compareNumbers(x, y);
    else if (xNumeric !== yNumeric) order = xNumeric ? -1 : 1;
    else order = x < y ? -1 : x > y ? 1 : 0;
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

/**
 * Semantic version precedence: negative when `a` is older than `b`, 0 when
 * equal, positive when newer. A pre-release comes before its release.
 */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [VERSION.exec(a), VERSION.exec(b)];
  if (x === null || y === null) {
    throw new Error(`not a version: ${x === null ? a : b}`);
  }
  for (let part = 1; part <= 3; part += 1) {
    const order = compareNumbers(x[part] ?? '0', y[part] ?? '0');
    if (order !== 0) return order;
  }
  const [preX, preY] = [x[4], y[4]];
  if (preX === undefined || preY === undefined) {
    return preX === preY ? 0 : preX === undefined ? 1 : -1;
  }
  return comparePreRelease(preX, preY);
}
