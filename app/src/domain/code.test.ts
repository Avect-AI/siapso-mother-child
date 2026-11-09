// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';
import { codeKeysOf, pbkdf2Of, verifierOf, weakVerifier, withoutLength } from '../test/verifier.js';
import {
  AUTO_LOCK_MS,
  checkCode,
  codeLength,
  CODE_MAX,
  CODE_MIN,
  constantTimeEqual,
  createCodeKeys,
  createVerifier,
  easyToGuess,
  fromBase64Url,
  isCode,
  isCodeVerifier,
  isLockoutState,
  LOCK_WARNING_MS,
  lockoutDelayMs,
  MAX_WAIT_MS,
  mergeLockouts,
  NO_LOCKOUT,
  nextLockout,
  openCode,
  PBKDF2_ITERATIONS,
  remainingLockMs,
  toBase64Url,
  verifierFields,
  type CodeVerifier,
  type LockoutState,
} from './code.js';
import { seal, unseal } from './crypto.js';

// Every verifier the app makes is at the full count: a derivation takes a
// while, so the tests share one per code.
vi.setConfig({ testTimeout: 30_000 });

describe('codes', () => {
  it('uses the values of the brief', () => {
    expect([CODE_MIN, CODE_MAX, PBKDF2_ITERATIONS, AUTO_LOCK_MS, MAX_WAIT_MS]).toEqual([
      4, 6, 600_000, 120_000, 1_800_000,
    ]);
  });

  it('warns 30 s before the auto-lock: more than the 20 s WCAG 2.2.1 asks to extend', () => {
    expect(LOCK_WARNING_MS).toBe(30_000);
    expect(LOCK_WARNING_MS).toBeLessThan(AUTO_LOCK_MS);
  });

  it('finds the codes most often tried first: one digit repeated, digits in a row, a year', () => {
    for (const code of [
      '0000',
      '1111',
      '99999',
      '777777',
      '1234',
      '0123',
      '12345',
      '123456',
      '456789',
      '4321',
      '3210',
      '987654',
      '1950',
      '1990',
      '2026',
      '2030',
    ]) {
      expect(easyToGuess(code), code).toBe(true);
    }
  });

  it('leaves other codes alone', () => {
    for (const code of ['2468', '1357', '7392', '1949', '2031', '1235', '8901', '135790', '0918']) {
      expect(easyToGuess(code), code).toBe(false);
    }
  });

  it('accepts 4 to 6 digits, nothing else', () => {
    for (const code of ['0000', '12345', '987654']) expect(isCode(code), code).toBe(true);
    for (const code of ['', '123', '1234567', '12a4', ' 1234', '1234 ', '١٢٣٤', '12.4']) {
      expect(isCode(code), code).toBe(false);
    }
  });
});

describe('verifier', () => {
  it('round trip: the code it was made from opens it, at the real iteration count', async () => {
    const verifier = await verifierOf('2468');

    expect(verifier.iterations).toBe(PBKDF2_ITERATIONS);
    expect(verifier.version).toBe(2);
    // base64url: 16 bytes of salt, 32 bytes of the HKDF check of PBKDF2-SHA-256.
    expect(fromBase64Url(verifier.salt)).toHaveLength(16);
    expect(fromBase64Url(verifier.hash)).toHaveLength(32);
    expect(verifier.salt).toMatch(/^[\w-]+$/);
    expect(verifier.hash).toMatch(/^[\w-]+$/);
    expect(await checkCode('2468', verifier)).toBe(true);
  });

  it("keeps the code's length beside its verifier, in clear, so the code screen opens at it", async () => {
    const four = await verifierOf('2468');
    const six = await verifierOf('135790');

    expect(four.length).toBe(4);
    expect(six.length).toBe(6);
    expect(codeLength(four)).toBe(4);
    expect(codeLength(six)).toBe(6);
    expect(verifierFields(six)).toEqual({
      salt: six.salt,
      hash: six.hash,
      iterations: PBKDF2_ITERATIONS,
      version: 2,
      length: 6,
    });
  });

  it('reads no length from a verifier of before (none) or one it is not (left out)', async () => {
    const before = withoutLength(await verifierOf('2468'));
    expect(codeLength(before)).toBeNull();
    expect(verifierFields(before)).not.toHaveProperty('length');
    for (const length of [3, 7, 4.5, '4', null]) {
      const odd = { ...before, length } as unknown as CodeVerifier;
      // Still the verifier of her code: the length is left out, never the code.
      expect(isCodeVerifier(odd), String(length)).toBe(true);
      expect(codeLength(odd), String(length)).toBeNull();
      expect(verifierFields(odd), String(length)).not.toHaveProperty('length');
    }
  });

  it('never holds the code: a new salt each time, so one code gives two verifiers', async () => {
    const first = await verifierOf('1357');
    const second = await createVerifier('1357');

    expect(JSON.stringify(first)).not.toContain('1357');
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('refuses a wrong code, a code of another length and a code that is not one', async () => {
    const verifier = await verifierOf('2468');

    expect(await checkCode('2469', verifier)).toBe(false);
    expect(await checkCode('24680', verifier)).toBe(false);
    expect(await checkCode('246', verifier)).toBe(false);
    expect(await checkCode('abcd', verifier)).toBe(false);
  });

  it('refuses every code against a verifier that is not one', async () => {
    const verifier = await verifierOf('2468');

    expect(await checkCode('2468', { ...verifier, hash: '' })).toBe(false);
    expect(await checkCode('2468', { ...verifier, salt: '%%%' })).toBe(false);
    expect(await checkCode('2468', { ...verifier, iterations: 0 })).toBe(false);
  });

  it('never makes a verifier below 600 000 iterations, nor for something that is not a code', async () => {
    await expect(createVerifier('12')).rejects.toThrow(RangeError);
    await expect(createVerifier('1234', 1000)).rejects.toThrow(RangeError);
    await expect(createVerifier('1234', 599_999)).rejects.toThrow(RangeError);
  });

  it('still opens a verifier made with fewer iterations by an older version (the session rehashes it)', async () => {
    const old = await weakVerifier('2468', 1000);

    expect(isCodeVerifier(old)).toBe(true);
    expect(await checkCode('2468', old)).toBe(true);
    expect(await checkCode('1111', old)).toBe(false);
  });

  it('stores the check half only: neither the PBKDF2 output nor the wrapping key', async () => {
    const { verifier, wrappingKey } = await codeKeysOf('2468');
    const salt = fromBase64Url(verifier.salt);
    const secret = await pbkdf2Of('2468', salt, verifier.iterations);
    const sealed = await seal({ pseudonym: 'Awa' }, wrappingKey, 'profile:a');

    expect(verifier.hash).not.toBe(toBase64Url(secret));
    // What storage holds, used as a key, opens nothing.
    const stored = await crypto.subtle.importKey(
      'raw',
      fromBase64Url(verifier.hash) as BufferSource,
      'AES-GCM',
      false,
      ['decrypt'],
    );
    await expect(unseal(sealed, stored, 'profile:a')).rejects.toThrow();
    expect(wrappingKey.extractable).toBe(false);
  });

  it('opens with the right code: its wrapping key opens what the code sealed', async () => {
    const { verifier, wrappingKey } = await codeKeysOf('2468');
    const sealed = await seal({ pseudonym: 'Awa' }, wrappingKey, 'profile:a');

    const opened = await openCode('2468', verifier);

    expect(opened?.renew).toBe(false);
    expect(opened?.wrappingKey?.extractable).toBe(false);
    if (!opened?.wrappingKey) throw new Error('no key');
    expect(await unseal(sealed, opened.wrappingKey, 'profile:a')).toEqual({ pseudonym: 'Awa' });
    expect(await openCode('1111', verifier)).toBeNull();
  });

  it('works out PBKDF2 once per unlock, then splits it', async () => {
    const verifier = await verifierOf('2468');
    const derive = vi.spyOn(crypto.subtle, 'deriveBits');

    await openCode('2468', verifier);

    const pbkdf2 = derive.mock.calls.filter(([params]) => (params as Algorithm).name === 'PBKDF2');
    expect(pbkdf2).toHaveLength(1);
    derive.mockRestore();
  });

  it('opens an older verifier with no key, to be made again: its hash is the PBKDF2 output', async () => {
    const old = await weakVerifier('2468', 1000);

    expect(await openCode('2468', old)).toEqual({ wrappingKey: null, renew: true });
    expect(await openCode('1111', old)).toBeNull();
  });

  it('opens a split verifier with fewer iterations with its key, to be made again', async () => {
    const weak = await weakVerifier('2468', 1000, { split: true });

    const opened = await openCode('2468', weak);

    expect(opened?.renew).toBe(true);
    expect(opened?.wrappingKey).not.toBeNull();
    expect(await openCode('1111', weak)).toBeNull();
  });

  it('opens nothing with a verifier of a format it does not know', async () => {
    const verifier = await verifierOf('2468');

    expect(await openCode('2468', { ...verifier, version: 3 })).toBeNull();
  });

  it('makes the verifier and its wrapping key with one new salt', async () => {
    const first = await createCodeKeys('1357');
    const sealed = await seal([1, 2], first.wrappingKey, 'contacts:saved');
    const second = await createCodeKeys('1357');

    expect(second.verifier.salt).not.toBe(first.verifier.salt);
    await expect(unseal(sealed, second.wrappingKey, 'contacts:saved')).rejects.toThrow();
  });

  it('recognises a stored verifier and nothing else', async () => {
    expect(isCodeVerifier(await verifierOf('2468'))).toBe(true);
    expect(isCodeVerifier(await weakVerifier('2468', 1000))).toBe(true);
    for (const value of [
      null,
      '2468',
      { salt: 'a', hash: 'b' },
      { salt: 'a', hash: 'b', iterations: '600000' },
      { salt: 1, hash: 'b', iterations: 600_000 },
      { salt: 'a', hash: 'b', iterations: 600_000, version: '2' },
    ]) {
      expect(isCodeVerifier(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('constantTimeEqual', () => {
  it('compares bytes', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
  });

  it('reads every byte, even when the first one already differs', () => {
    const reads: number[] = [];
    const counted = (bytes: number[]) =>
      new Proxy(bytes, {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) reads.push(Number(property));
          return Reflect.get(target, property, receiver) as unknown;
        },
      });

    expect(constantTimeEqual(counted([9, 2, 3, 4]), counted([1, 2, 3, 4]))).toBe(false);
    // Four bytes of each side read, whatever the first difference.
    expect(reads).toHaveLength(8);
    reads.length = 0;
    expect(constantTimeEqual(counted([1, 2, 3, 4]), counted([1, 2, 3, 4]))).toBe(true);
    expect(reads).toHaveLength(8);
  });
});

describe('base64url', () => {
  it('round trips bytes without padding, and refuses what is not base64url', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 128, 1]);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(fromBase64Url(text)).toEqual(bytes);
    expect(() => fromBase64Url('a+b/')).toThrow(SyntaxError);
  });
});

describe('lockout', () => {
  it('lets four wrong codes go, locks 30 s at the fifth, then doubles at each failure', () => {
    let state: LockoutState = NO_LOCKOUT;
    const now = 1_000_000;
    for (let failure = 1; failure <= 4; failure += 1) {
      state = nextLockout(state, now);
      expect(state, `failure ${String(failure)}`).toEqual({ failures: failure, lockedUntil: null });
    }
    state = nextLockout(state, now);
    expect(state).toEqual({ failures: 5, lockedUntil: now + 30_000 });

    const later = now + 30_000;
    state = nextLockout(state, later);
    expect(state).toEqual({ failures: 6, lockedUntil: later + 60_000 });
    state = nextLockout(state, later + 60_000);
    expect(state).toEqual({ failures: 7, lockedUntil: later + 60_000 + 120_000 });
  });

  it('starts again from nothing after a success', () => {
    // The session stores NO_LOCKOUT after a right code: the next failure is the first.
    expect(nextLockout(NO_LOCKOUT, 5)).toEqual({ failures: 1, lockedUntil: null });
  });

  it('doubles up to a wait of 30 minutes, never longer', () => {
    expect([1, 4, 5, 6, 7, 8, 9, 10].map(lockoutDelayMs)).toEqual([
      0, 0, 30_000, 60_000, 120_000, 240_000, 480_000, 960_000,
    ]);
    // 30 s doubled six times would be 32 minutes: the 11th failure and every later one wait 30.
    for (const failures of [11, 12, 20, 5000]) {
      expect(lockoutDelayMs(failures), String(failures)).toBe(MAX_WAIT_MS);
    }
    expect(nextLockout({ failures: 40, lockedUntil: 0 }, 1000)).toEqual({
      failures: 41,
      lockedUntil: 1000 + MAX_WAIT_MS,
    });
  });

  it('says how long is left, never longer than the delay when the clock was set back', () => {
    const locked = { failures: 5, lockedUntil: 100_000 };
    expect(remainingLockMs(locked, 70_000)).toBe(30_000);
    expect(remainingLockMs(locked, 90_000)).toBe(10_000);
    expect(remainingLockMs(locked, 100_000)).toBe(0);
    expect(remainingLockMs(NO_LOCKOUT, 0)).toBe(0);
    // The phone's clock went back a day: the wait is still 30 s at most.
    expect(remainingLockMs(locked, 100_000 - 86_400_000)).toBe(30_000);
  });

  it('merges what two tabs know: the most failures and the latest end of a wait', () => {
    expect(mergeLockouts(NO_LOCKOUT, undefined)).toEqual(NO_LOCKOUT);
    expect(
      mergeLockouts({ failures: 3, lockedUntil: null }, { failures: 4, lockedUntil: null }),
    ).toEqual({ failures: 4, lockedUntil: null });
    expect(
      mergeLockouts({ failures: 6, lockedUntil: 500 }, { failures: 5, lockedUntil: 900 }),
    ).toEqual({ failures: 6, lockedUntil: 900 });
    expect(mergeLockouts({ failures: 5, lockedUntil: 900 }, NO_LOCKOUT)).toEqual({
      failures: 5,
      lockedUntil: 900,
    });
  });

  it('recognises a stored lockout and nothing else', () => {
    expect(isLockoutState(NO_LOCKOUT)).toBe(true);
    expect(isLockoutState({ failures: 6, lockedUntil: 12 })).toBe(true);
    for (const value of [
      null,
      {},
      { failures: -1, lockedUntil: null },
      { failures: 1.5, lockedUntil: null },
      { failures: 2, lockedUntil: '12' },
    ]) {
      expect(isLockoutState(value), JSON.stringify(value)).toBe(false);
    }
  });
});
