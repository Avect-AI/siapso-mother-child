// SPDX-License-Identifier: MIT
// The key of the open session, in this page's memory only: the wrapping key
// of the data keys (domain/crypto.ts), which the code gives at the unlock. It
// is never stored, and it is forgotten at every lock (the two minutes, the
// quick exit, a lock from another tab), at the forgotten-code erase and when
// another code is made: the session closes the vault then. While it is
// closed, nothing about a profile can be read or written.
import { seal, unseal, type Sealed } from '../domain/crypto.js';
import { NoCodeError } from './code-guard.js';

/** Profile data read or written while the code is not open in this page. */
export class LockedError extends NoCodeError {
  constructor() {
    super('The code is not open in this page: nothing about a profile is read or written');
    this.name = 'LockedError';
  }
}

let wrappingKey: CryptoKey | null = null;

/** The code opened the session: its wrapping key is kept until the vault closes. */
export function openVault(key: CryptoKey): void {
  wrappingKey = key;
}

/** Forgets the wrapping key (a lock, an exit, an erase, another code). */
export function closeVault(): void {
  wrappingKey = null;
}

export function isVaultOpen(): boolean {
  return wrappingKey !== null;
}

/** The wrapping key while the vault is open; LockedError otherwise. */
export function vaultKey(): CryptoKey {
  if (wrappingKey === null) throw new LockedError();
  return wrappingKey;
}

/** `value` sealed for the record `scope` with the open session's key. */
export async function sealRecord(value: unknown, scope: string): Promise<Sealed> {
  return seal(value, vaultKey(), scope);
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
