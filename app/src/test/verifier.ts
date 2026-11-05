// SPDX-License-Identifier: MIT
// Verifiers for tests. The app makes them at 600 000 iterations only; a test
// that needs one made with fewer (a verifier from an older version, to be
// rehashed) builds it here, with the same derivation.
import { createVerifier, toBase64Url, type CodeVerifier } from '../domain/code.js';

/** A verifier of `code` with fewer iterations than the app ever makes. */
export async function weakVerifier(code: string, iterations: number): Promise<CodeVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return { salt: toBase64Url(salt), hash: toBase64Url(new Uint8Array(bits)), iterations };
}

const made = new Map<string, Promise<CodeVerifier>>();

/** The verifier of `code` at the full count, made once per test file (a derivation takes a while). */
export function verifierOf(code: string): Promise<CodeVerifier> {
  let verifier = made.get(code);
  if (verifier === undefined) {
    verifier = createVerifier(code);
    made.set(code, verifier);
  }
  return verifier;
}
