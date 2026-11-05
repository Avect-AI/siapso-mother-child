// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { createAuthenticator, hashKey, parseKeyFile } from '../src/auth.js';
import { createQuota } from '../src/quota.js';

describe('API keys', () => {
  const file = JSON.stringify({
    keys: [
      { id: 'partner-a', sha256: hashKey('secret-a') },
      { id: 'partner-b', sha256: hashKey('secret-b') },
    ],
  });

  it('hashes with SHA-256 in lowercase hex', () => {
    expect(hashKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('finds the id of a valid key and nothing for a wrong or missing key', () => {
    const authenticate = createAuthenticator(parseKeyFile(file));
    expect(authenticate('secret-a')).toBe('partner-a');
    expect(authenticate('secret-b')).toBe('partner-b');
    expect(authenticate('secret-c')).toBeUndefined();
    expect(authenticate('')).toBeUndefined();
    expect(authenticate(undefined)).toBeUndefined();
  });

  it('refuses a malformed key file without echoing it', () => {
    for (const bad of [
      'not json',
      '{}',
      '{"keys":[{"id":"a","sha256":"zz"}]}',
      '{"keys":[{"id":"a","sha256":"' + hashKey('x') + '","extra":1}]}',
      '{"keys":[{"id":"a","sha256":"' +
        hashKey('x') +
        '"},{"id":"a","sha256":"' +
        hashKey('y') +
        '"}]}',
    ]) {
      expect(() => parseKeyFile(bad)).toThrow(/key file/);
    }
  });
});

describe('quota', () => {
  it('allows the limit per window per key, then refuses with a retry delay', () => {
    let now = 1_000;
    const quota = createQuota({ limit: 2, windowMs: 60_000, now: () => now });
    expect(quota.consume('a').allowed).toBe(true);
    expect(quota.consume('a').allowed).toBe(true);
    const refused = quota.consume('a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(60);
    expect(quota.consume('b').allowed).toBe(true);
    now += 30_000;
    expect(quota.consume('a').retryAfterSeconds).toBe(30);
    now += 30_000;
    expect(quota.consume('a').allowed).toBe(true);
  });

  it('forgets expired windows', () => {
    let now = 0;
    const quota = createQuota({ limit: 1, windowMs: 1_000, now: () => now });
    quota.consume('a');
    quota.consume('b');
    expect(quota.size()).toBe(2);
    now = 5_000;
    quota.consume('c');
    expect(quota.size()).toBe(1);
  });
});
