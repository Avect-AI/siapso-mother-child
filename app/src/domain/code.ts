// SPDX-License-Identifier: MIT
// The code that opens the app on a shared phone (spec section 2, Codes). The
// code itself is never stored: only a verifier, the PBKDF2-SHA-256 of the code
// with a random salt, compared in constant time.
//
// Threat model: casual access by someone else in the family on a shared
// phone, not a forensic attacker. Offline, the only clock is the phone's: a
// clock set forward ends a wait early (one set back never stretches it, see
// remainingLockMs).
//
// The profiles are encrypted at rest (SCRUM-39, domain/crypto.ts). One PBKDF2
// output per unlock is split with HKDF into the check, stored as the verifier
// (version 2), and the wrapping key of the data keys, kept in memory only: the
// stored verifier never gives the key. A verifier of the versions before (no
// version: its hash is the PBKDF2 output itself, so any key derived from that
// output would be readable from storage) opens with no key, and is made again
// with a new salt at the next right code.
import { splitCodeSecret } from './crypto.js';

export const CODE_MIN = 4;
export const CODE_MAX = 6;
/** The only count a verifier is made with; an older, lower one is rehashed after the next unlock. */
export const PBKDF2_ITERATIONS = 600_000;
/** Two minutes without a touch, a key or a pointer, or hidden for longer, and the app locks. */
export const AUTO_LOCK_MS = 120_000;
/**
 * How long before the auto-lock the screen warns, while a form has answers not
 * saved: more than the 20 seconds WCAG 2.2.1 asks to extend a time limit.
 */
export const LOCK_WARNING_MS = 30_000;
/** The longest wait after wrong codes: the doubling stops at 30 minutes (from the 11th wrong code). */
export const MAX_WAIT_MS = 30 * 60_000;

/** Wrong codes allowed before the first wait. */
const FREE_FAILURES = 4;
/** The first wait, at the fifth wrong code; each further wrong code doubles it, up to MAX_WAIT_MS. */
const FIRST_WAIT_MS = 30_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

/** The verifier format of SCRUM-39: the hash is the HKDF check half of the PBKDF2 output. */
export const VERIFIER_VERSION = 2;

/**
 * What is stored instead of the code: base64url salt (16 bytes) and hash (32
 * bytes), and the PBKDF2-SHA-256 iterations.
 */
export interface CodeVerifier {
  salt: string;
  hash: string;
  iterations: number;
  /**
   * 2: the hash is the check half of the PBKDF2 output split with HKDF (the
   * other half wraps the data keys and is never stored). Absent: a verifier
   * of the versions before SCRUM-39, whose hash is the PBKDF2 output itself.
   */
  version?: number;
  /**
   * The code's length (4 to 6), in clear (SCRUM-56): the code screen tries
   * the code as soon as that many digits are in. Absent on a verifier kept
   * before it was: the next right code adds it (data/migration.ts).
   */
  length?: number;
}

/** A code worked out: its verifier, to store, and the key that wraps the data keys, memory only. */
export interface CodeKeys {
  verifier: CodeVerifier;
  wrappingKey: CryptoKey;
}

/**
 * The right code opened a verifier: the wrapping key of the data keys (null
 * for a verifier of the format before SCRUM-39, which holds no key), and
 * whether the verifier must be made again (that older format, or fewer
 * iterations than the app makes now).
 */
export interface OpenedCode {
  wrappingKey: CryptoKey | null;
  renew: boolean;
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

/** The years a code may be (a birth year, the year of the day): the first ones tried. */
const FIRST_YEAR = 1950;
const LAST_YEAR = 2030;

/**
 * Whether a code is among those someone else tries first: one digit repeated
 * (0000), digits in a row up or down (1234, 0123, 987654), or a year from
 * 1950 to 2030 (a birth year). Under the wait after wrong codes, a person
 * gets about 11 tries in the first hour. The code screen warns and asks a
 * second time; it never refuses: the choice stays hers.
 */
export function easyToGuess(code: string): boolean {
  if (!isCode(code)) return false;
  // ASCII digits only (isCode): each code unit is one digit.
  const digits = Array.from({ length: code.length }, (_, i) => code.charCodeAt(i) - 48);
  const steps = digits.slice(1).map((digit, i) => digit - (digits[i] ?? 0));
  if (steps.every((step) => step === 0)) return true;
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) return true;
  const year = Number(code);
  return code.length === 4 && year >= FIRST_YEAR && year <= LAST_YEAR;
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

/** The code as a non-extractable PBKDF2 key: the code text is not kept, and the key cannot be read back. */
function codeKey(code: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, [
    'deriveBits',
  ]);
}

/** The one expensive derivation of an unlock: PBKDF2-SHA-256 of the code with the verifier's salt. */
async function derive(code: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    await codeKey(code),
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * A new verifier for `code` and its wrapping key: a new random salt, then
 * PBKDF2-SHA-256 at PBKDF2_ITERATIONS or more, split with HKDF. RangeError
 * for anything but a code, or for a lower count: a weak verifier is never
 * made.
 */
export async function createCodeKeys(
  code: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CodeKeys> {
  if (!isCode(code)) throw new RangeError('A code is 4 to 6 digits');
  if (!Number.isInteger(iterations) || iterations < PBKDF2_ITERATIONS) {
    throw new RangeError(
      `A verifier takes at least ${String(PBKDF2_ITERATIONS)} iterations, not ${String(iterations)}`,
    );
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const secret = await derive(code, salt, iterations);
  try {
    const { check, wrappingKey } = await splitCodeSecret(secret);
    return {
      verifier: {
        salt: toBase64Url(salt),
        hash: toBase64Url(check),
        iterations,
        version: VERIFIER_VERSION,
        length: code.length,
      },
      wrappingKey,
    };
  } finally {
    secret.fill(0);
  }
}

/** A verifier for `code` (createCodeKeys, without its key). */
export async function createVerifier(
  code: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CodeVerifier> {
  return (await createCodeKeys(code, iterations)).verifier;
}

/**
 * What `code` opens of `verifier` (OpenedCode), or null for a wrong code, a
 * verifier that is not one, or of a format this version does not know. One
 * PBKDF2 derivation, compared in constant time.
 */
export async function openCode(code: string, verifier: CodeVerifier): Promise<OpenedCode | null> {
  if (!isCode(code) || !isCodeVerifier(verifier)) return null;
  const version = verifier.version;
  if (version !== undefined && version !== VERIFIER_VERSION) return null;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(verifier.salt);
    expected = fromBase64Url(verifier.hash);
  } catch {
    return null;
  }
  if (expected.length !== HASH_BYTES) return null;
  const secret = await derive(code, salt, verifier.iterations);
  try {
    if (version === undefined) {
      return constantTimeEqual(secret, expected) ? { wrappingKey: null, renew: true } : null;
    }
    const { check, wrappingKey } = await splitCodeSecret(secret);
    if (!constantTimeEqual(check, expected)) return null;
    return { wrappingKey, renew: verifier.iterations < PBKDF2_ITERATIONS };
  } finally {
    secret.fill(0);
  }
}

/** Whether `code` opens `verifier` (constant-time comparison of the derived bytes). */
export async function checkCode(code: string, verifier: CodeVerifier): Promise<boolean> {
  return (await openCode(code, verifier)) !== null;
}

export function isCodeVerifier(value: unknown): value is CodeVerifier {
  if (typeof value !== 'object' || value === null) return false;
  const { salt, hash, iterations, version } = value as Record<string, unknown>;
  return (
    typeof salt === 'string' &&
    typeof hash === 'string' &&
    typeof iterations === 'number' &&
    Number.isInteger(iterations) &&
    iterations >= 1 &&
    (version === undefined || (typeof version === 'number' && Number.isInteger(version)))
  );
}

/**
 * The length of the code of `verifier` (SCRUM-56), or null when none is kept,
 * or what is kept is not the length of a code (it is then left out, never
 * the verifier: she can still type her code and "Ouvrir").
 */
export function codeLength(verifier: CodeVerifier): number | null {
  const { length } = verifier as { length?: unknown };
  return typeof length === 'number' &&
    Number.isInteger(length) &&
    length >= CODE_MIN &&
    length <= CODE_MAX
    ? length
    : null;
}

/** The fields of a verifier, as stored (nothing else a value may carry, no length that is not one). */
export function verifierFields(verifier: CodeVerifier): CodeVerifier {
  const { salt, hash, iterations, version } = verifier;
  const length = codeLength(verifier);
  return {
    salt,
    hash,
    iterations,
    ...(version === undefined ? {} : { version }),
    ...(length === null ? {} : { length }),
  };
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
