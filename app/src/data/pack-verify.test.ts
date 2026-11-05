// SPDX-License-Identifier: MIT
// The keys are generated at test time by the pack tools, which also sign:
// what `siapso-pack sign` writes is what the app checks.
import {
  generateSigningKey,
  publicEntryOf,
  signManifest,
  type SigningKey,
} from '@siapso/pack-tools';
import { describe, expect, it, vi } from 'vitest';
import {
  checkOrigin,
  compareVersions,
  isTrusted,
  isVersion,
  PackVerifyError,
  type PackTrust,
} from './pack-verify.js';

const team = generateSigningKey('team-1');
const manifest = new TextEncoder().encode('{\n  "schema": 1,\n  "keyId": "team-1"\n}\n');

function trust(keys: SigningKey[], allowUnsigned = false): PackTrust {
  return { keys: keys.map(publicEntryOf), allowUnsigned };
}

const signedOnly = trust([team]);
const testBuild = trust([], true);

/** A manifest.sig fetcher that answers `text` and counts its calls. */
function signatureOf(text: string) {
  return vi.fn(() => Promise.resolve(text));
}

describe('checkOrigin of a signed manifest', () => {
  it('accepts the exact bytes signed by a known key', async () => {
    const signature = signatureOf(`${signManifest(manifest, team)}\n`);

    await expect(checkOrigin(manifest, 'team-1', signedOnly, signature)).resolves.toEqual({
      signed: true,
      keyId: 'team-1',
    });
    expect(signature).toHaveBeenCalledTimes(1);
  });

  it('picks the key named by keyId among several (rotation)', async () => {
    const next = generateSigningKey('team-2');

    await expect(
      checkOrigin(
        manifest,
        'team-2',
        trust([team, next]),
        signatureOf(signManifest(manifest, next)),
      ),
    ).resolves.toEqual({ signed: true, keyId: 'team-2' });
  });

  it('refuses a manifest changed after it was signed, by a single byte', async () => {
    const signature = signatureOf(signManifest(manifest, team));
    const tampered = manifest.slice();
    tampered[5] = (tampered[5] ?? 0) ^ 1;

    await expect(checkOrigin(tampered, 'team-1', signedOnly, signature)).rejects.toThrow(
      /manifest\.sig: the signature does not match manifest\.json \(key "team-1"\)/,
    );
  });

  it('refuses a signature made by another key under a known key id', async () => {
    const intruder = generateSigningKey('team-1');

    await expect(
      checkOrigin(manifest, 'team-1', signedOnly, signatureOf(signManifest(manifest, intruder))),
    ).rejects.toBeInstanceOf(PackVerifyError);
  });

  it('refuses a signature that is not 64 bytes of base64', async () => {
    for (const text of ['', 'not base64!', 'AAAA']) {
      await expect(
        checkOrigin(manifest, 'team-1', signedOnly, signatureOf(text)),
        text,
      ).rejects.toThrow(/manifest\.sig/);
    }
  });

  it('refuses an unknown key id without downloading the signature', async () => {
    const signature = signatureOf(signManifest(manifest, team));

    await expect(checkOrigin(manifest, 'someone-else', signedOnly, signature)).rejects.toThrow(
      /signed with an unknown key "someone-else"/,
    );
    expect(signature).not.toHaveBeenCalled();
  });

  it('refuses a key id that is not a non-empty string, in every build', async () => {
    for (const keyId of ['', 42, null]) {
      await expect(
        checkOrigin(manifest, keyId, testBuild, signatureOf('')),
        String(keyId),
      ).rejects.toThrow(/keyId/);
    }
  });

  it('still refuses a bad signature from a known key in a test build', async () => {
    const both = trust([team], true);

    await expect(
      checkOrigin(
        manifest,
        'team-1',
        both,
        signatureOf(signManifest(manifest, generateSigningKey())),
      ),
    ).rejects.toThrow(/does not match/);
  });

  it('lets a test build use a pack signed with a key it does not know, saying so', async () => {
    const signature = signatureOf('');

    await expect(checkOrigin(manifest, 'later-key', testBuild, signature)).resolves.toEqual({
      signed: false,
      reason: expect.stringMatching(/"later-key".*does not know/) as unknown,
    });
    expect(signature).not.toHaveBeenCalled();
  });
});

describe('checkOrigin of an unsigned manifest', () => {
  it('refuses it unless the build accepts unsigned packs', async () => {
    const signature = signatureOf('');

    await expect(checkOrigin(manifest, undefined, signedOnly, signature)).rejects.toThrow(
      /not signed.*VITE_ALLOW_UNSIGNED_PACK/,
    );
    await expect(checkOrigin(manifest, undefined, trust([]), signature)).rejects.toThrow(
      /not signed/,
    );
    expect(signature).not.toHaveBeenCalled();
  });

  it('accepts it in a test or demo build, and says it is unsigned', async () => {
    await expect(checkOrigin(manifest, undefined, testBuild, signatureOf(''))).resolves.toEqual({
      signed: false,
      reason: expect.stringMatching(/not signed/) as unknown,
    });
  });
});

describe('isTrusted', () => {
  it('trusts a pack signed by a key still in the list', () => {
    expect(isTrusted({ signed: true, keyId: 'team-1' }, signedOnly)).toBe(true);
  });

  it('no longer trusts a pack whose key was removed (a compromised key)', () => {
    expect(isTrusted({ signed: true, keyId: 'old' }, signedOnly)).toBe(false);
  });

  it('trusts an unsigned pack, or one stored before signatures, only in a test build', () => {
    const unsigned = { signed: false, reason: 'not signed' } as const;
    expect(isTrusted(unsigned, signedOnly)).toBe(false);
    expect(isTrusted(undefined, signedOnly)).toBe(false);
    expect(isTrusted(unsigned, testBuild)).toBe(true);
    expect(isTrusted(undefined, testBuild)).toBe(true);
  });
});

describe('compareVersions', () => {
  it('orders versions by major, minor and patch numbers', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('puts a pre-release before its release, in semver order', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      const [lower, higher] = [ordered[i] ?? '', ordered[i + 1] ?? ''];
      expect(compareVersions(lower, higher), `${lower} < ${higher}`).toBeLessThan(0);
      expect(compareVersions(higher, lower), `${higher} > ${lower}`).toBeGreaterThan(0);
    }
  });

  it('refuses what is not a version', () => {
    expect(isVersion('0.1.0')).toBe(true);
    expect(isVersion('0.1.0-rc.1')).toBe(true);
    for (const value of ['', '1', '1.2', 'v1.2.3', '01.2.3', '1.2.3+build', 7, null]) {
      expect(isVersion(value), String(value)).toBe(false);
    }
    expect(() => compareVersions('1.2', '1.2.0')).toThrow(/version/);
  });
});
