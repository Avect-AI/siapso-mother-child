// SPDX-License-Identifier: MIT
// The key of the open session, in this page's memory only: the wrapping key
// of the data keys (domain/crypto.ts), which the code gives at the unlock,
// held together with the fingerprint of the code it comes from (code-guard.ts).
// It is never stored, and it is forgotten at every lock (the two minutes, the
// quick exit, a lock from another tab), at the forgotten-code erase and when
// another code is made: the session closes the vault then. While it is
// closed, nothing about a profile can be read or written.
//
// A record is sealed with the key of one code, and written only while that
// code is the one stored: the fingerprint the record was sealed under goes
// with it to the write's transaction (requireCode), so a code changed while
// the record was being encrypted refuses the write rather than storing a
// record no code opens.
import { seal, unseal, type Sealed } from '../domain/crypto.js';
import { NoCodeError } from './code-guard.js';

/** Profile data read or written while the code is not open in this page. */
export class LockedError extends NoCodeError {
  constructor() {
    super('The code is not open in this page: nothing about a profile is read or written');
    this.name = 'LockedError';
  }
}

interface OpenVault {
  key: CryptoKey;
  /** The fingerprint of the code the key comes from; null when a test opens a key alone. */
  fingerprint: string | null;
}

let vault: OpenVault | null = null;

/**
 * The code opened the session: its wrapping key is kept, with the fingerprint
 * of that code, until the vault closes.
 */
export function openVault(key: CryptoKey, fingerprint: string | null = null): void {
  vault = { key, fingerprint };
}

/** Forgets the wrapping key (a lock, an exit, an erase, another code). */
export function closeVault(): void {
  vault = null;
}

export function isVaultOpen(): boolean {
  return vault !== null;
}

function openOrThrow(): OpenVault {
  if (vault === null) throw new LockedError();
  return vault;
}

/** The wrapping key while the vault is open; LockedError otherwise. */
export function vaultKey(): CryptoKey {
  return openOrThrow().key;
}

/**
 * The fingerprint of the code the open key comes from, to check in a write's
 * transaction (undefined: the code this tab opened, code-guard.ts);
 * LockedError while closed.
 */
export function vaultFingerprint(): string | undefined {
  return openOrThrow().fingerprint ?? undefined;
}

/**
 * `value` sealed for the record `scope` with the open session's key, and the
 * fingerprint of the code that key comes from, both read before the
 * encryption starts: the write checks that code (requireCode).
 */
export async function sealRecord(
  value: unknown,
  scope: string,
): Promise<{ sealed: Sealed; fingerprint: string | undefined }> {
  const { key, fingerprint } = openOrThrow();
  return { sealed: await seal(value, key, scope), fingerprint: fingerprint ?? undefined };
}

/** The value of a sealed record, with the open session's key (UnsealError when it does not open). */
export async function openRecord(sealed: Sealed, scope: string): Promise<unknown> {
  return unseal(sealed, vaultKey(), scope);
}

/** What a profile's encryption is bound to. */
export function profileScope(id: string): string {
  return `profile:${id}`;
}

/** What a history entry's encryption is bound to: its profile and its own id. */
export function historyScope(profileId: string, id: string): string {
  return `history:${profileId}:${id}`;
}

/** What the saved contacts' encryption is bound to. */
export const CONTACTS_SCOPE = 'contacts:saved';
