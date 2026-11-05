// SPDX-License-Identifier: MIT
// Verifiers for tests. The app makes them at 600 000 iterations only; a test
// that needs one made with fewer (a verifier from an older version, to be
// made again) builds it here, with the same derivation.
import { createCodeKeys, toBase64Url, type CodeKeys, type CodeVerifier } from '../domain/code.js';
import { splitCodeSecret } from '../domain/crypto.js';
import { openVault } from '../data/vault.js';

/** The PBKDF2-SHA-256 output of `code`, as every verifier starts from. */
export async function pbkdf2Of(
  code: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * A verifier of `code` with fewer iterations than the app ever makes. By
 * default in the format of the versions before SCRUM-39 (the hash is the
 * PBKDF2 output itself); `split: true` makes it in today's format (the HKDF
 * check half), as a later version raising the count would find it.
 */
export async function weakVerifier(
  code: string,
  iterations: number,
  { split = false }: { split?: boolean } = {},
): Promise<CodeVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const secret = await pbkdf2Of(code, salt, iterations);
  if (!split) return { salt: toBase64Url(salt), hash: toBase64Url(secret), iterations };
  const { check } = await splitCodeSecret(secret);
  return { salt: toBase64Url(salt), hash: toBase64Url(check), iterations, version: 2 };
}

/** A verifier of `code` at the full count in the format before SCRUM-39, as the phone kept it. */
export function legacyVerifier(code: string): Promise<CodeVerifier> {
  return weakVerifier(code, 600_000);
}

const made = new Map<string, Promise<CodeKeys>>();

/** The verifier of `code` at the full count and its wrapping key, made once per test file (a derivation takes a while). */
export function codeKeysOf(code: string): Promise<CodeKeys> {
  let keys = made.get(code);
  if (keys === undefined) {
    keys = createCodeKeys(code);
    made.set(code, keys);
  }
  return keys;
}

/** The verifier of `code` at the full count, made once per test file. */
export async function verifierOf(code: string): Promise<CodeVerifier> {
  return (await codeKeysOf(code)).verifier;
}

/**
 * Opens the vault of this page with the key of `code`, as an unlock does, so
 * a test can write and read profile data (the setup closes it after each test).
 */
export async function openVaultOf(code: string): Promise<void> {
  openVault((await codeKeysOf(code)).wrappingKey);
}
