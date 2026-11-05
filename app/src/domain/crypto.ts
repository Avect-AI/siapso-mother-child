// SPDX-License-Identifier: MIT
// Encryption at rest of what the phone keeps about the women (SCRUM-39): the
// profiles, the history of their results and the contacts saved. WebCrypto
// only, nothing sent anywhere.
//
// Key hierarchy:
// - The code gives one PBKDF2-SHA-256 output (600 000 iterations, a random
//   16-byte salt; domain/code.ts), worked out once per unlock and never kept.
// - HKDF-SHA-256 splits it in two with distinct labels: the check, stored as
//   the verifier, and the wrapping key, kept in memory only while the session
//   is open (non-extractable). Knowing the check gives nothing of the wrapping
//   key: HKDF outputs under distinct labels are independent.
// - Every record written has its own random 256-bit data key, encrypted
//   (wrapped) with the wrapping key and stored next to the record; the record
//   is encrypted with its data key. AES-GCM everywhere, a random 96-bit IV per
//   encryption, and additional data that binds the envelope version and the
//   record (its store and id): a record moved, a key swapped or a byte
//   changed fails to open.
//
// Threat model (docs/threat-model.md): someone who holds the phone without the
// code reads nothing about a profile from storage. The code has 4 to 6 digits:
// someone who copies the storage and tries every code offline (10^4 to 10^6
// PBKDF2 derivations) can open it; that forensic attacker is out of scope.
import { fromBase64Url, toBase64Url } from './code.js';

/** The envelope's format, bound in the additional data of every encryption. */
export const SEALED_VERSION = 1;

const KEY_BITS = 256;
const IV_BYTES = 12;
const CHECK_BYTES = 32;
/** HKDF labels: one secret, two independent halves. */
const CHECK_INFO = 'siapso code verifier v2';
const WRAP_INFO = 'siapso data key wrapping v2';

/**
 * A record as it is stored: its data key encrypted with the wrapping key, and
 * the record (JSON) encrypted with its data key. Every field is base64url.
 */
export interface Sealed {
  /** SEALED_VERSION when written: any other is refused. */
  v: number;
  /** The IV of the wrapped data key. */
  keyIv: string;
  /** The record's data key (32 bytes), AES-GCM encrypted with the wrapping key, tag included. */
  key: string;
  /** The IV of the record. */
  iv: string;
  /** The record as JSON, AES-GCM encrypted with its data key, tag included. */
  data: string;
}

/** A sealed record that does not open: another code, a changed byte, another record's place. */
export class UnsealError extends Error {
  constructor(message = 'This record does not open with this code') {
    super(message);
    this.name = 'UnsealError';
  }
}

const encoder = new TextEncoder();

function randomIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

/** What the encryption of a data key binds: the version and the record. */
function keyLabel(scope: string): Uint8Array {
  return encoder.encode(`siapso:key:v${String(SEALED_VERSION)}:${scope}`);
}

/** What the encryption of a record binds: the version and the record. */
function dataLabel(scope: string): Uint8Array {
  return encoder.encode(`siapso:data:v${String(SEALED_VERSION)}:${scope}`);
}

function gcm(iv: Uint8Array, additionalData: Uint8Array): AesGcmParams {
  return {
    name: 'AES-GCM',
    iv: iv as BufferSource,
    additionalData: additionalData as BufferSource,
  };
}

/**
 * The two halves of the code's PBKDF2 output, by HKDF-SHA-256 under distinct
 * labels: the check (stored as the verifier) and the wrapping key (AES-GCM
 * 256, non-extractable, memory only).
 */
export async function splitCodeSecret(
  secret: Uint8Array,
): Promise<{ check: Uint8Array; wrappingKey: CryptoKey }> {
  const base = await crypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const params = (info: string): HkdfParams => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: encoder.encode(info),
  });
  const check = new Uint8Array(
    await crypto.subtle.deriveBits(params(CHECK_INFO), base, CHECK_BYTES * 8),
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    params(WRAP_INFO),
    base,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
  return { check, wrappingKey };
}

/** The data key of `sealed` as bytes, once the wrapping key opens it. Callers wipe them. */
async function unwrapBytes(
  sealed: Sealed,
  wrappingKey: CryptoKey,
  scope: string,
): Promise<Uint8Array> {
  if (!isSealed(sealed) || sealed.v !== SEALED_VERSION)
    throw new UnsealError('Not a sealed record');
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        gcm(fromBase64Url(sealed.keyIv), keyLabel(scope)),
        wrappingKey,
        fromBase64Url(sealed.key) as BufferSource,
      ),
    );
  } catch {
    throw new UnsealError();
  }
}

/** `raw` encrypted with the wrapping key, bound to the record. */
async function wrapBytes(
  raw: Uint8Array,
  wrappingKey: CryptoKey,
  scope: string,
): Promise<Pick<Sealed, 'keyIv' | 'key'>> {
  const keyIv = randomIv();
  const key = await crypto.subtle.encrypt(
    gcm(keyIv, keyLabel(scope)),
    wrappingKey,
    raw as BufferSource,
  );
  return { keyIv: toBase64Url(keyIv), key: toBase64Url(new Uint8Array(key)) };
}

function dataKeyOf(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * `value` (JSON) sealed for the record `scope` ("profile:<id>",
 * "history:<profile id>:<id>", "contacts:saved"): a new data key and new IVs
 * every time, so two writes of the same record share nothing.
 */
export async function seal(value: unknown, wrappingKey: CryptoKey, scope: string): Promise<Sealed> {
  const raw = crypto.getRandomValues(new Uint8Array(KEY_BITS / 8));
  try {
    const dataKey = await dataKeyOf(raw);
    const wrapped = await wrapBytes(raw, wrappingKey, scope);
    const iv = randomIv();
    const data = await crypto.subtle.encrypt(
      gcm(iv, dataLabel(scope)),
      dataKey,
      encoder.encode(JSON.stringify(value)),
    );
    return {
      v: SEALED_VERSION,
      ...wrapped,
      iv: toBase64Url(iv),
      data: toBase64Url(new Uint8Array(data)),
    };
  } finally {
    raw.fill(0);
  }
}

/** The value sealed for `scope`; UnsealError when it does not open (another code, a change, another record). */
export async function unseal(
  sealed: Sealed,
  wrappingKey: CryptoKey,
  scope: string,
): Promise<unknown> {
  const raw = await unwrapBytes(sealed, wrappingKey, scope);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      gcm(fromBase64Url(sealed.iv), dataLabel(scope)),
      await dataKeyOf(raw),
      fromBase64Url(sealed.data) as BufferSource,
    );
  } catch {
    throw new UnsealError();
  } finally {
    raw.fill(0);
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new UnsealError('A sealed record that is not JSON');
  }
}

/**
 * The same record with its data key wrapped by `to` instead of `from` (a new
 * verifier): the record itself is not encrypted again. UnsealError when
 * `from` does not open its key.
 */
export async function rewrap(
  sealed: Sealed,
  from: CryptoKey,
  to: CryptoKey,
  scope: string,
): Promise<Sealed> {
  const raw = await unwrapBytes(sealed, from, scope);
  try {
    return { ...sealed, ...(await wrapBytes(raw, to, scope)) };
  } finally {
    raw.fill(0);
  }
}

/** Whether a stored value is a sealed record (anything else was kept in clear by an older version). */
export function isSealed(value: unknown): value is Sealed {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { v, keyIv, key, iv, data } = value as Record<string, unknown>;
  return (
    typeof v === 'number' && [keyIv, key, iv, data].every((field) => typeof field === 'string')
  );
}
