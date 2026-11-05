// SPDX-License-Identifier: MIT
// The code that opens the app on a shared phone (spec section 2, Codes). The
// code itself is never stored: only a verifier, the PBKDF2-SHA-256 of the code
// with a random salt, compared in constant time.
//
// Threat model: casual access by someone else in the family on a shared
// phone, not a forensic attacker. Offline, the only clock is the phone's: a
// clock set forward ends a wait early (one set back never stretches it, see
// remainingLockMs). The profiles are encrypted at rest with SCRUM-39, which
// derives its keys from the key material that unlockKey hands over. That data
// key must never reuse the verifier's derivation: the verifier is the
// PBKDF2 output itself and is stored, so a key equal to it, or derived from
// it, would be readable from storage. SCRUM-39 derives with another salt (or
// splits one PBKDF2 output with HKDF into a stored verifier part and a
// secret key part, changing the verifier format).

export const CODE_MIN = 4;
export const CODE_MAX = 6;
/** The only count a verifier is made with; an older, lower one is rehashed after the next unlock. */
export const PBKDF2_ITERATIONS = 600_000;
/** Two minutes without a touch, a key or a pointer, or hidden for longer, and the app locks. */
export const AUTO_LOCK_MS = 120_000;
/** The longest wait after wrong codes: the doubling stops at 30 minutes (from the 11th wrong code). */
export const MAX_WAIT_MS = 30 * 60_000;

/** Wrong codes allowed before the first wait. */
const FREE_FAILURES = 4;
/** The first wait, at the fifth wrong code; each further wrong code doubles it, up to MAX_WAIT_MS. */
const FIRST_WAIT_MS = 30_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

/** What is stored instead of the code: base64url salt and hash, PBKDF2-SHA-256 of 32 bytes. */
export interface CodeVerifier {
  salt: string;
  hash: string;
  iterations: number;
}

/** Wrong codes in a row, and the end of the wait they set (epoch milliseconds), if any. */
export interface LockoutState {
  failures: number;
  lockedUntil: number | null;
}

export const NO_LOCKOUT: LockoutState = { failures: 0, lockedUntil: null };

/** 4 to 6 ASCII digits: what a mobile money user types every day. */
export function isCode(text: string): boolean {
  return new RegExp(`^[0-9]{${String(CODE_MIN)},${String(CODE_MAX)}}$`).test(text);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The bytes of a base64url text; a SyntaxError for anything else. */
export function fromBase64Url(text: string): Uint8Array {
  if (!/^[\w-]*$/.test(text)) throw new SyntaxError('Not base64url');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Whether two byte strings are equal, in a time that depends only on their
 * lengths: every byte is read and combined, never a return at the first
 * difference, so the time taken says nothing about how much of a guess was
 * right.
 */
export function constantTimeEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (i < a.length ? (a[i] ?? 0) : 0) ^ (i < b.length ? (b[i] ?? 0) : 0);
  }
  return difference === 0;
}

/**
 * The code as a non-extractable PBKDF2 key: the key material a session keeps
 * while open. The code text is not kept, and the key cannot be read back.
 */
export function codeKey(code: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ]);
}

async function derive(key: CryptoKey, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * A verifier for `code`: a new random salt, then PBKDF2-SHA-256 at
 * PBKDF2_ITERATIONS or more. RangeError for anything but a code, or for a
 * lower count: a weak verifier is never made.
 */
export async function createVerifier(
  code: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CodeVerifier> {
  if (!isCode(code)) throw new RangeError('A code is 4 to 6 digits');
  if (!Number.isInteger(iterations) || iterations < PBKDF2_ITERATIONS) {
    throw new RangeError(
      `A verifier takes at least ${String(PBKDF2_ITERATIONS)} iterations, not ${String(iterations)}`,
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(await codeKey(code), salt, iterations);
  return { salt: toBase64Url(salt), hash: toBase64Url(hash), iterations };
}

/**
 * The key material of `code` when it opens `verifier`, else null: a
 * non-extractable PBKDF2 key, kept by the session while it is open (SCRUM-39
 * derives the data key from it with its own salt). A verifier that is not one
 * opens with no code.
 */
export async function unlockKey(code: string, verifier: CodeVerifier): Promise<CryptoKey | null> {
  if (!isCode(code) || !isCodeVerifier(verifier)) return null;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(verifier.salt);
    expected = fromBase64Url(verifier.hash);
  } catch {
    return null;
  }
  if (expected.length !== HASH_BYTES) return null;
  const key = await codeKey(code);
  const derived = await derive(key, salt, verifier.iterations);
  return constantTimeEqual(derived, expected) ? key : null;
}

/** Whether `code` opens `verifier` (constant-time comparison of the derived bytes). */
export async function checkCode(code: string, verifier: CodeVerifier): Promise<boolean> {
  return (await unlockKey(code, verifier)) !== null;
}

export function isCodeVerifier(value: unknown): value is CodeVerifier {
  if (typeof value !== 'object' || value === null) return false;
  const { salt, hash, iterations } = value as Record<string, unknown>;
  return (
    typeof salt === 'string' &&
    typeof hash === 'string' &&
    typeof iterations === 'number' &&
    Number.isInteger(iterations) &&
    iterations >= 1
  );
}

export function isLockoutState(value: unknown): value is LockoutState {
  if (typeof value !== 'object' || value === null) return false;
  const { failures, lockedUntil } = value as Record<string, unknown>;
  return (
    typeof failures === 'number' &&
    Number.isInteger(failures) &&
    failures >= 0 &&
    (lockedUntil === null || (typeof lockedUntil === 'number' && Number.isFinite(lockedUntil)))
  );
}

/**
 * The wait after this many wrong codes in a row: none up to four, 30 s at
 * the fifth, then doubled at each one, up to 30 minutes.
 */
export function lockoutDelayMs(failures: number): number {
  if (failures <= FREE_FAILURES) return 0;
  // 2^7 x 30 s is past the cap already: no larger power is ever computed.
  return Math.min(FIRST_WAIT_MS * 2 ** Math.min(failures - FREE_FAILURES - 1, 7), MAX_WAIT_MS);
}

/**
 * What two tabs (or memory and storage) know of the wrong codes, merged so
 * that neither gives free tries: the most failures and the latest end of a
 * wait.
 */
export function mergeLockouts(a: LockoutState, b: LockoutState | undefined): LockoutState {
  if (b === undefined) return a;
  const ends = [a.lockedUntil, b.lockedUntil].filter((end): end is number => end !== null);
  return {
    failures: Math.max(a.failures, b.failures),
    lockedUntil: ends.length === 0 ? null : Math.max(...ends),
  };
}

/** One try at the code: what was known before it, what is kept for it, and whether it may go on. */
export interface CodeClaim {
  before: LockoutState;
  after: LockoutState;
  allowed: boolean;
}

/**
 * A try at the code claimed against what this tab knows and what is stored
 * (merged, so no tab gets free tries): during a wait it is refused and
 * nothing changes; otherwise it is counted as a wrong code before the code
 * is worked out (a right code then resets it), so a tab closed in the middle
 * of a try never gets it for free.
 */
export function claimTry(
  known: LockoutState,
  stored: LockoutState | undefined,
  nowMs: number,
): CodeClaim {
  const before = mergeLockouts(known, stored);
  if (remainingLockMs(before, nowMs) > 0) return { before, after: before, allowed: false };
  return { before, after: nextLockout(before, nowMs), allowed: true };
}

/** The state after one more wrong code at `nowMs`. A right code goes back to NO_LOCKOUT. */
export function nextLockout(state: LockoutState, nowMs: number): LockoutState {
  const failures = state.failures + 1;
  const delay = lockoutDelayMs(failures);
  return { failures, lockedUntil: delay === 0 ? null : nowMs + delay };
}

/**
 * How long until a code may be tried again, 0 when it may now. Never longer
 * than the delay of the failures: a phone clock set back does not stretch the
 * wait.
 */
export function remainingLockMs(state: LockoutState, nowMs: number): number {
  if (state.lockedUntil === null) return 0;
  const left = state.lockedUntil - nowMs;
  return left <= 0 ? 0 : Math.min(left, lockoutDelayMs(state.failures));
}
