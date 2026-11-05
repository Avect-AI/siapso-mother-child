// SPDX-License-Identifier: MIT
// What is written about a profile (the profile, its history, the contacts
// saved), and the mode and welcome of the settings, are written only with the
// code this tab opened. A tab left open from before (frozen, cached, or that
// missed the other tabs' message) cannot write her profile back for whoever
// made the next code, nor change the mode under her code: after the
// forgotten-code erase there is no code until the next person makes one, and
// that code is another verifier (another salt and hash).
//
// The code a tab opened is kept here, per page, as the fingerprint of its
// verifier (salt and hash, never the code). A tab that opened no code yet (a
// test that seeds data, a tab on the welcome) writes profile data only while
// some code is stored, and the mode or the welcome only while none is.
import { isCodeVerifier, type CodeVerifier } from '../domain/code.js';

/**
 * A write refused: no code on this phone, or not the code this tab opened (it
 * was erased, perhaps from another tab, and another one made since).
 */
export class NoCodeError extends Error {
  constructor(message = 'No code this tab opened is on this phone: nothing is written') {
    super(message);
    this.name = 'NoCodeError';
  }
}

/** A second code refused: a code is already on this phone (made in another tab). */
export class CodeExistsError extends Error {
  constructor() {
    super('A code is already on this phone: it is not replaced');
    this.name = 'CodeExistsError';
  }
}

/** What tells two verifiers apart: their salt and hash (the code itself is never known). */
export function codeFingerprint(verifier: CodeVerifier): string {
  return `${verifier.salt}.${verifier.hash}`;
}

let opened: string | null = null;

/** The code this tab opened (at an unlock, a new code, a rehash), or none (an erase). */
export function codeOpened(verifier: CodeVerifier | null): void {
  opened = verifier === null ? null : codeFingerprint(verifier);
}

/** The fingerprint of the code this tab opened, or null when it opened none. */
export function openedCode(): string | null {
  return opened;
}

/** The part of a readwrite transaction over the settings that the guard uses. */
interface WithSettings {
  objectStore: (name: 'settings') => { get: (key: 'code') => Promise<unknown> };
  abort: () => void;
  done: Promise<void>;
}

function refuse(tx: WithSettings, error: Error): never {
  // Abandoned on purpose: its end is not an error to report.
  tx.done.catch(() => undefined);
  tx.abort();
  throw error;
}

/**
 * Throws NoCodeError, and abandons the transaction, unless the code `expected`
 * (by default the one this tab opened) is the one stored; with no code opened,
 * unless some code is stored. Called first in the readwrite transaction that
 * writes, which also covers the settings: the check and the write are one
 * transaction, so an erase or a new code never falls between them.
 */
export async function requireCode(
  tx: WithSettings,
  expected: string | null = openedCode(),
): Promise<void> {
  const stored: unknown = await tx.objectStore('settings').get('code');
  if (!isCodeVerifier(stored)) refuse(tx, new NoCodeError());
  if (expected !== null && codeFingerprint(stored) !== expected) refuse(tx, new NoCodeError());
}

/**
 * For a change of the mode or of the welcome: throws NoCodeError, and
 * abandons the transaction, unless this tab opened the code stored, or, when
 * it opened none, unless no code is stored (the welcome of a new phone).
 */
export async function requireCodeForSettings(
  tx: WithSettings,
  expected: string | null = openedCode(),
): Promise<void> {
  const stored: unknown = await tx.objectStore('settings').get('code');
  const current = isCodeVerifier(stored) ? codeFingerprint(stored) : null;
  if (current !== expected) refuse(tx, new NoCodeError());
}
