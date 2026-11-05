// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from './code.js';
import {
  isSealed,
  rewrap,
  seal,
  splitCodeSecret,
  unseal,
  UnsealError,
  type Sealed,
} from './crypto.js';

/** A wrapping key as the code gives one: the HKDF half of 32 random bytes. */
async function wrappingKey(): Promise<CryptoKey> {
  return (await splitCodeSecret(crypto.getRandomValues(new Uint8Array(32)))).wrappingKey;
}

/** The same base64url text with one bit of its first byte flipped. */
function flipped(text: string): string {
  const bytes = fromBase64Url(text);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return toBase64Url(bytes);
}

/** An AES-GCM key made of these bytes, as anyone reading storage could import them. */
function keyOf(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['decrypt']);
}

const profile = {
  id: 'a',
  pseudonym: 'Aminata Ndèye',
  conditions: ['hiv-cotrimoxazole'],
  term: { kind: 'weeks', weeks: 20, givenOn: '2026-11-04' },
};

describe('the code secret split in two', () => {
  it('gives a 32-byte check and a wrapping key that cannot be read back', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const { check, wrappingKey: key } = await splitCodeSecret(secret);

    expect(check).toHaveLength(32);
    expect(toBase64Url(check)).not.toBe(toBase64Url(secret));
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
  });

  it('gives the same halves for the same secret, so the code opens what it sealed', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const first = await splitCodeSecret(secret);
    const again = await splitCodeSecret(secret);

    expect(toBase64Url(again.check)).toBe(toBase64Url(first.check));
    const sealed = await seal(profile, first.wrappingKey, 'profile:a');
    expect(await unseal(sealed, again.wrappingKey, 'profile:a')).toEqual(profile);
  });

  it('never makes the wrapping key out of what is stored: neither the check nor the secret opens', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const { check, wrappingKey: key } = await splitCodeSecret(secret);
    const sealed = await seal(profile, key, 'profile:a');

    for (const bytes of [check, secret]) {
      await expect(
        crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: fromBase64Url(sealed.keyIv) as BufferSource,
            additionalData: new TextEncoder().encode('siapso:key:v1:profile:a'),
          },
          await keyOf(bytes),
          fromBase64Url(sealed.key) as BufferSource,
        ),
      ).rejects.toThrow();
    }
  });
});

describe('a sealed record', () => {
  it('round trip: what was sealed comes back exactly', async () => {
    const key = await wrappingKey();
    const contacts = [{ id: 'c1', role: 'midwife', name: 'Awa Diop', phone: '77 123 45 67' }];

    expect(await unseal(await seal(profile, key, 'profile:a'), key, 'profile:a')).toEqual(profile);
    expect(
      await unseal(await seal(contacts, key, 'contacts:saved'), key, 'contacts:saved'),
    ).toEqual(contacts);
  });

  it('holds nothing readable: no pseudonym, condition or term in what is stored', async () => {
    const sealed = await seal(profile, await wrappingKey(), 'profile:a');
    const stored = JSON.stringify(sealed);

    for (const clear of ['Aminata', 'hiv', 'weeks', '2026-11-04', 'pseudonym']) {
      expect(stored).not.toContain(clear);
    }
    expect(Object.keys(sealed).sort()).toEqual(['data', 'iv', 'key', 'keyIv', 'v']);
  });

  it('opens with the key of its code only: another code fails', async () => {
    const sealed = await seal(profile, await wrappingKey(), 'profile:a');

    await expect(unseal(sealed, await wrappingKey(), 'profile:a')).rejects.toBeInstanceOf(
      UnsealError,
    );
  });

  it('takes a new data key and new 96-bit IVs at every write, even for the same record', async () => {
    const key = await wrappingKey();
    const seals: Sealed[] = [];
    for (let i = 0; i < 50; i += 1) seals.push(await seal(profile, key, 'profile:a'));

    for (const sealed of seals) {
      expect(fromBase64Url(sealed.iv)).toHaveLength(12);
      expect(fromBase64Url(sealed.keyIv)).toHaveLength(12);
    }
    for (const field of ['iv', 'keyIv', 'key', 'data'] as const) {
      expect(new Set(seals.map((sealed) => sealed[field])).size, field).toBe(seals.length);
    }
    // Every IV of every key, data and wrapping alike, is used once.
    expect(new Set(seals.flatMap((sealed) => [sealed.iv, sealed.keyIv])).size).toBe(100);
  });

  it('refuses a ciphertext, an IV, a wrapped key or a key IV changed by one bit', async () => {
    const key = await wrappingKey();
    const sealed = await seal(profile, key, 'profile:a');

    for (const field of ['data', 'iv', 'key', 'keyIv'] as const) {
      const tampered = { ...sealed, [field]: flipped(sealed[field]) };
      await expect(unseal(tampered, key, 'profile:a'), field).rejects.toBeInstanceOf(UnsealError);
    }
  });

  it('is bound to its record: read under another id or store, it fails', async () => {
    const key = await wrappingKey();
    const sealed = await seal(profile, key, 'profile:a');

    for (const scope of ['profile:b', 'history:a:a', 'contacts:saved', '']) {
      await expect(unseal(sealed, key, scope), scope).rejects.toBeInstanceOf(UnsealError);
    }
  });

  it('is bound to its version: the same bytes under another version fail', async () => {
    const key = await wrappingKey();
    const sealed = await seal(profile, key, 'profile:a');

    const other: Sealed = { ...sealed, v: 2 };
    await expect(unseal(other, key, 'profile:a')).rejects.toBeInstanceOf(UnsealError);
  });

  it('keeps its own key: a wrapped key moved to another record opens nothing there', async () => {
    const key = await wrappingKey();
    const a = await seal(profile, key, 'profile:a');
    const b = await seal({ ...profile, id: 'b', pseudonym: 'Ndèye' }, key, 'profile:b');

    const swapped = { ...b, key: a.key, keyIv: a.keyIv };
    await expect(unseal(swapped, key, 'profile:b')).rejects.toBeInstanceOf(UnsealError);
  });

  it('refuses what is not a sealed record', async () => {
    const key = await wrappingKey();
    await expect(
      unseal({ v: 1, iv: '%', keyIv: '', key: '', data: '' }, key, 'profile:a'),
    ).rejects.toBeInstanceOf(UnsealError);
  });

  it('is told apart from a record kept in clear', async () => {
    const sealed = await seal(profile, await wrappingKey(), 'profile:a');

    expect(isSealed(sealed)).toBe(true);
    for (const value of [profile, null, [], 'x', { v: 1, iv: 'a' }, { ...sealed, data: 3 }]) {
      expect(isSealed(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('a data key wrapped again', () => {
  it('opens with the new code key only, and its data is not encrypted again', async () => {
    const before = await wrappingKey();
    const after = await wrappingKey();
    const sealed = await seal(profile, before, 'history:a:h1');

    const moved = await rewrap(sealed, before, after, 'history:a:h1');

    expect(moved.data).toBe(sealed.data);
    expect(moved.iv).toBe(sealed.iv);
    expect(moved.key).not.toBe(sealed.key);
    expect(moved.keyIv).not.toBe(sealed.keyIv);
    expect(await unseal(moved, after, 'history:a:h1')).toEqual(profile);
    await expect(unseal(moved, before, 'history:a:h1')).rejects.toBeInstanceOf(UnsealError);
  });

  it('refuses to move a key the old code key does not open', async () => {
    const sealed = await seal(profile, await wrappingKey(), 'profile:a');

    await expect(
      rewrap(sealed, await wrappingKey(), await wrappingKey(), 'profile:a'),
    ).rejects.toBeInstanceOf(UnsealError);
  });
});
