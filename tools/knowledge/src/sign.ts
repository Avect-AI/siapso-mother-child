// SPDX-License-Identifier: MIT
// Ed25519 signature of the knowledge pack (docs/pack-signing.md). manifest.sig
// holds the base64 signature of the exact bytes of manifest.json, whose keyId
// names the public key that checks it. The app keeps only public keys
// (app/src/config/pack-keys.ts): a private key never enters the repository,
// and no message printed here ever contains one.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { json, type Manifest } from './write.js';

ed.hashes.sha512 = sha512;

export const MANIFEST_FILE = 'manifest.json';
export const SIGNATURE_FILE = 'manifest.sig';

/** A key id stays plain in JSON and in a file name: letters, digits, dot, dash, underscore. */
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface SigningKey {
  keyId: string;
  /** The 32-byte Ed25519 secret seed (RFC 8032). */
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/** A private key file: written by keygen, read by sign, held by the PACK_SIGNING_KEY secret. */
export interface KeyFile {
  keyId: string;
  algorithm: 'Ed25519';
  privateKey: string;
  publicKey: string;
}

/** What app/src/config/pack-keys.ts lists for a key. */
export interface PublicKeyEntry {
  keyId: string;
  publicKey: string;
}

export class SigningKeyError extends Error {
  override name = 'SigningKeyError';
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Decodes a base64 field of `size` bytes; the message names the field, never its value. */
function decode(value: unknown, size: number, field: string): Uint8Array {
  if (typeof value !== 'string' || !BASE64.test(value)) {
    throw new SigningKeyError(`signing key: ${field} must be base64`);
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'));
  if (bytes.length !== size) {
    throw new SigningKeyError(`signing key: ${field} must be ${String(size)} bytes`);
  }
  return bytes;
}

function checkKeyId(keyId: unknown): string {
  if (typeof keyId !== 'string' || !KEY_ID.test(keyId)) {
    throw new SigningKeyError(
      'signing key: the key id must be 1 to 64 letters, digits, dots, dashes or underscores',
    );
  }
  return keyId;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The default key id: "ed25519-" and the first 16 hex digits of the public key's SHA-256. */
export function keyIdOf(publicKey: Uint8Array): string {
  return `ed25519-${sha256Hex(publicKey).slice(0, 16)}`;
}

/** A new key pair from the system's secure random source, held in memory only. */
export function generateSigningKey(keyId?: string): SigningKey {
  const { secretKey, publicKey } = ed.keygen();
  return {
    keyId: checkKeyId(keyId ?? keyIdOf(publicKey)),
    privateKey: secretKey,
    publicKey,
  };
}

export function keyFileOf(key: SigningKey): KeyFile {
  return {
    keyId: key.keyId,
    algorithm: 'Ed25519',
    privateKey: base64(key.privateKey),
    publicKey: base64(key.publicKey),
  };
}

export function publicEntryOf(key: SigningKey): PublicKeyEntry {
  return { keyId: key.keyId, publicKey: base64(key.publicKey) };
}

/**
 * Reads a key file (the text of the file or of PACK_SIGNING_KEY). The public
 * key it lists must be the one of its private key, so a key file mixed up
 * with another one is refused before it signs anything.
 */
export function parseSigningKey(text: string): SigningKey {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SigningKeyError('signing key: not a JSON key file written by siapso-pack keygen');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SigningKeyError('signing key: not a JSON key file written by siapso-pack keygen');
  }
  const file = value as Partial<Record<keyof KeyFile, unknown>>;
  if (file.algorithm !== 'Ed25519') {
    throw new SigningKeyError('signing key: the algorithm must be "Ed25519"');
  }
  const keyId = checkKeyId(file.keyId);
  const privateKey = decode(file.privateKey, 32, 'privateKey');
  const publicKey = decode(file.publicKey, 32, 'publicKey');
  if (base64(ed.getPublicKey(privateKey)) !== base64(publicKey)) {
    throw new SigningKeyError('signing key: publicKey is not the public key of privateKey');
  }
  return { keyId, privateKey, publicKey };
}

/** Where the app lists the public keys it trusts, relative to the repository root. */
export const PACK_KEYS_FILE = 'app/src/config/pack-keys.ts';

/**
 * The entries of app/src/config/pack-keys.ts, read from its text: each
 * `{ keyId: '...', publicKey: '...' }` as keygen prints it.
 */
export function listedPublicKeys(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  const entry = /keyId:\s*(['"])([^'"]+)\1\s*,\s*publicKey:\s*(['"])([^'"]+)\3/g;
  for (const match of text.matchAll(entry)) {
    const [, , keyId, , publicKey] = match;
    if (keyId !== undefined && publicKey !== undefined) entries.set(keyId, publicKey);
  }
  return entries;
}

/** The base64 Ed25519 signature of `bytes`. */
export function signManifest(bytes: Uint8Array, key: SigningKey): string {
  return base64(ed.sign(bytes, key.privateKey));
}

/** Whether `signature` (base64) signs `bytes` for `publicKey` (base64), with RFC 8032 checks. */
export function verifyManifest(bytes: Uint8Array, signature: string, publicKey: string): boolean {
  try {
    const signatureBytes = decode(signature, 64, 'signature');
    const publicKeyBytes = decode(publicKey, 32, 'publicKey');
    return ed.verify(signatureBytes, bytes, publicKeyBytes, { zip215: false });
  } catch {
    return false;
  }
}

async function readManifest(dir: string): Promise<Manifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path.join(dir, MANIFEST_FILE), 'utf8'));
  } catch (error) {
    throw new Error(
      `${MANIFEST_FILE}: cannot be read in ${dir} (${error instanceof Error ? error.message : String(error)}): run "pnpm knowledge:build" first`,
      { cause: error },
    );
  }
  const manifest = value as Partial<Manifest> | null;
  if (typeof manifest !== 'object' || manifest === null || !Array.isArray(manifest.fragments)) {
    throw new Error(`${MANIFEST_FILE}: no fragment list`);
  }
  return manifest as Manifest;
}

/**
 * Signs the pack built in `dir`: every fragment must still match the
 * manifest (a manifest is never signed for files it does not describe), then
 * manifest.json gets the key id and manifest.sig the signature of its exact
 * bytes. The signature is checked with the public key before anything is
 * written. Returns the signed manifest.
 */
export async function signPack(dir: string, key: SigningKey): Promise<Manifest> {
  const manifest = await readManifest(dir);
  for (const entry of manifest.fragments) {
    if (path.basename(entry.path) !== entry.path) {
      throw new Error(`${MANIFEST_FILE}: ${entry.path} is not a file of the pack directory`);
    }
    const bytes = new Uint8Array(await readFile(path.join(dir, entry.path)));
    if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256) {
      throw new Error(
        `${entry.path} does not match ${MANIFEST_FILE}: run "pnpm knowledge:build" again before signing`,
      );
    }
  }
  const signed: Manifest = { ...manifest, keyId: key.keyId };
  const text = json(signed);
  const bytes = new TextEncoder().encode(text);
  const signature = signManifest(bytes, key);
  if (!verifyManifest(bytes, signature, base64(key.publicKey))) {
    throw new SigningKeyError('signing key: the signature does not verify with its public key');
  }
  await writeFile(path.join(dir, MANIFEST_FILE), text);
  await writeFile(path.join(dir, SIGNATURE_FILE), `${signature}\n`);
  return signed;
}
