// SPDX-License-Identifier: MIT
// Packs are signed here with keys generated at test time by the pack tools
// (the same code as `siapso-pack sign`); no key is stored anywhere.
import { createHash } from 'node:crypto';
import { BUILTIN_MESSAGES, type Message, type Pack } from '@siapso/engine';
import {
  generateSigningKey,
  publicEntryOf,
  signManifest,
  type SigningKey,
} from '@siapso/pack-tools';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PACK_PUBLIC_KEYS } from '../config/pack-keys.js';
import { breakIndexedDB, hangIndexedDB } from '../test/idb.js';
import { getStoredPack, openAppDb, storePack } from './db.js';
import {
  BUILD_MIN_SAFE_VERSION,
  BUILD_MIN_VERSION,
  BUILD_TRUST,
  loadPack,
  PackLoadError,
  PackRollbackError,
  previousPackVersion,
  rollbackPack,
} from './pack-loader.js';
import type { PackTrust } from './pack-verify.js';

const message: Message = { fact: 'Fact.', risk: 'Risk.', orientation: 'Orientation.' };
const builtins = Object.fromEntries(Object.values(BUILTIN_MESSAGES).map((id) => [id, message]));

const team = generateSigningKey('team-1');
/** A release build: the team key, no unsigned pack. */
const release: PackTrust = { keys: [publicEntryOf(team)], allowUnsigned: false };
/** A test or demo build (VITE_ALLOW_UNSIGNED_PACK=true) with no key. */
const testBuild: PackTrust = { keys: [], allowUnsigned: true };

function samplePack(version = '0.1.0', bleeding = 'Bleeding'): Pack {
  return {
    schema: 1,
    version,
    date: '2026-11-05',
    clinicallyValidated: false,
    substances: [],
    classes: [],
    products: [],
    plants: [],
    rules: [],
    dangerSigns: [
      {
        id: 'bleeding',
        group: 'pregnancy',
        label: { fr: 'Saignement', en: bleeding },
        sources: [],
      },
    ],
    sources: [],
    messages: { fr: builtins, en: builtins },
  };
}

/**
 * The files `pnpm knowledge:build` writes for a pack (same layout as
 * tools/knowledge/src/write.ts), with the minimum safe version of
 * knowledge/pack.yaml when given, signed as `siapso-pack sign` does when a
 * key is given.
 */
function packFiles(
  pack: Pack,
  key: SigningKey | null = team,
  minimumSafeVersion?: string,
): Record<string, string> {
  const fragments: Record<string, unknown> = {
    'substances.json': pack.substances,
    'classes.json': pack.classes,
    'products.json': pack.products,
    'plants.json': pack.plants,
    'rules.json': pack.rules,
    'danger-signs.json': pack.dangerSigns,
    'sources.json': pack.sources,
    'messages.fr.json': pack.messages.fr,
    'messages.en.json': pack.messages.en,
  };
  const files = Object.fromEntries(
    Object.entries(fragments).map(([name, value]) => [name, `${JSON.stringify(value, null, 2)}\n`]),
  );
  const manifest = {
    schema: 1,
    version: pack.version,
    date: pack.date,
    clinicallyValidated: pack.clinicallyValidated,
    ...(minimumSafeVersion === undefined ? {} : { minimumSafeVersion }),
    counts: {},
    fragments: Object.entries(files).map(([path, text]) => ({
      path,
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: Buffer.byteLength(text),
    })),
    ...(key === null ? {} : { keyId: key.keyId }),
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const signed =
    key === null
      ? {}
      : { 'manifest.sig': `${signManifest(new TextEncoder().encode(text), key)}\n` };
  return { ...files, 'manifest.json': text, ...signed };
}

/** Changes the manifest of `files` without signing it again. */
function editManifest(
  files: Record<string, string>,
  edit: (manifest: Record<string, unknown>) => void,
) {
  const manifest = JSON.parse(files['manifest.json'] ?? '') as Record<string, unknown>;
  edit(manifest);
  files['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
}

/** A fetch that serves `files` under /pack/, answers 404 for anything else and records each name. */
function serving(files: Record<string, string>, requested: string[] = []): typeof fetch {
  return (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const name = url.split('/pack/')[1] ?? '';
    requested.push(name);
    const body = files[name];
    return Promise.resolve(
      body === undefined ? new Response('Not found', { status: 404 }) : new Response(body),
    );
  };
}

const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;

/** Loads and waits until the device has the pack. */
async function install(files: Record<string, string>, trust: PackTrust = release) {
  const result = await loadPack(serving(files), { trust });
  await result.stored;
  return result;
}

const ALL_FRAGMENTS = [
  'substances.json',
  'classes.json',
  'products.json',
  'plants.json',
  'rules.json',
  'danger-signs.json',
  'sources.json',
  'messages.fr.json',
  'messages.en.json',
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadPack from the network', () => {
  it('checks the signature, loads every fragment, assembles the pack and stores it', async () => {
    const pack = samplePack();
    const requested: string[] = [];

    const result = await loadPack(serving(packFiles(pack), requested), { trust: release });

    expect(result.source).toBe('network');
    expect(result.fallbackReason).toBeNull();
    expect(result.origin).toEqual({ signed: true, keyId: 'team-1' });
    expect(result.pack).toEqual(pack);
    expect(requested).toEqual(['manifest.json', 'manifest.sig', ...ALL_FRAGMENTS]);
    expect(await result.stored).toBe('stored');
    expect(await getStoredPack('current')).toMatchObject({
      pack,
      origin: { signed: true, keyId: 'team-1' },
    });
  });

  it('asks for the files under the base URL of the build', async () => {
    const urls: string[] = [];
    const recording: typeof fetch = (input) => {
      urls.push(input instanceof Request ? input.url : input.toString());
      return serving(packFiles(samplePack()))(input);
    };

    await loadPack(recording, { trust: release });

    expect(urls[0]).toBe('/pack/manifest.json');
  });

  it('hands the pack back as soon as it is verified, without waiting for the device', async () => {
    hangIndexedDB();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await loadPack(serving(packFiles(samplePack())), {
      trust: release,
      deviceTimeoutMs: 20,
    });

    expect(result.source).toBe('network');
    expect(result.pack.version).toBe('0.1.0');
    // The active pack could not be read, so it could not be compared: the new one is not stored.
    await expect(result.stored).rejects.toThrow(/not stored.*no answer/);
    expect(warn).toHaveBeenCalled();
  });

  it('logs and reports a pack the device cannot store, and still uses it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    breakIndexedDB('QuotaExceededError');

    const result = await loadPack(serving(packFiles(samplePack())), { trust: release });

    expect(result.source).toBe('network');
    await expect(result.stored).rejects.toThrow('QuotaExceededError');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not stored/), expect.any(Error));
  });

  it('keeps the previous version when a new one is stored', async () => {
    await install(packFiles(samplePack('0.1.0')));
    await install(packFiles(samplePack('0.2.0')));

    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
    expect((await getStoredPack('previous'))?.pack.version).toBe('0.1.0');
  });
});

describe('loadPack with the same version', () => {
  it('downloads no fragment and rewrites nothing when the pack has not changed', async () => {
    const files = packFiles(samplePack());
    await install(files);
    const requested: string[] = [];

    const result = await loadPack(serving(files, requested), { trust: release });

    expect(requested).toEqual(['manifest.json', 'manifest.sig']);
    expect(result.source).toBe('network');
    expect(result.pack).toEqual(samplePack());
    expect(await result.stored).toBe('unchanged');
  });

  it('refuses another content under the same version, even validly signed (a replay or a forgotten bump)', async () => {
    await install(packFiles(samplePack('0.1.0')));
    const requested: string[] = [];

    const result = await loadPack(
      serving(packFiles(samplePack('0.1.0', 'Heavy bleeding')), requested),
      { trust: release },
    );

    expect(result.source).toBe('cache');
    expect(result.fallback).toBe('refused');
    expect(result.pack.dangerSigns[0]?.label.en).toBe('Bleeding');
    expect(result.fallbackReason).toMatch(
      /version 0\.1\.0 is not newer than the active pack 0\.1\.0/,
    );
    expect(requested).toEqual(['manifest.json', 'manifest.sig']);
    expect((await getStoredPack('current'))?.pack.dangerSigns[0]?.label.en).toBe('Bleeding');
  });

  it('refuses a same-version manifest that only changes the date or the clinical validation', async () => {
    await install(packFiles({ ...samplePack('0.1.0'), clinicallyValidated: true }));
    const withdrawn = { ...samplePack('0.1.0'), date: '2026-12-01', clinicallyValidated: false };

    const result = await loadPack(serving(packFiles(withdrawn)), { trust: release });

    expect(result.source).toBe('cache');
    expect(result.pack.clinicallyValidated).toBe(true);
    expect(result.fallbackReason).toMatch(/not newer/);
  });

  it('still takes the same pack signed with a new key (rotation), without downloading it again', async () => {
    const pack = samplePack('0.1.0');
    await install(packFiles(pack));
    const next = generateSigningKey('team-2');
    const both: PackTrust = {
      keys: [publicEntryOf(team), publicEntryOf(next)],
      allowUnsigned: false,
    };
    const requested: string[] = [];

    const result = await loadPack(serving(packFiles(pack, next), requested), { trust: both });

    expect(result.source).toBe('network');
    expect(requested).toEqual(['manifest.json', 'manifest.sig']);
    expect(await result.stored).toBe('stored');
    expect((await getStoredPack('current'))?.origin).toEqual({ signed: true, keyId: 'team-2' });
  });
});

describe('loadPack updating by fragment', () => {
  it('downloads only the fragments whose hash changed and reuses the others', async () => {
    await install(packFiles(samplePack('0.1.0')));
    const requested: string[] = [];
    const next = samplePack('0.2.0', 'Heavy bleeding');

    const result = await loadPack(serving(packFiles(next), requested), { trust: release });

    expect(requested).toEqual(['manifest.json', 'manifest.sig', 'danger-signs.json']);
    expect(result.pack).toEqual(next);
    expect(await result.stored).toBe('stored');
    expect((await getStoredPack('current'))?.pack).toEqual(next);
    expect((await getStoredPack('previous'))?.pack.version).toBe('0.1.0');
  });

  it('activates nothing when a changed fragment fails its hash: the active pack stays', async () => {
    await install(packFiles(samplePack('0.1.0')));
    const files = packFiles(samplePack('0.2.0', 'Heavy bleeding'));
    files['danger-signs.json'] = (files['danger-signs.json'] ?? '').replace('Heavy', 'Heavx');

    const result = await loadPack(serving(files), { trust: release });

    expect(result.source).toBe('cache');
    expect(result.pack.version).toBe('0.1.0');
    expect(result.fallbackReason).toMatch(/danger-signs\.json: sha256 does not match/);
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
    expect(await getStoredPack('previous')).toBeUndefined();
  });

  it('activates nothing when the updated pack fails parsePack', async () => {
    await install(packFiles(samplePack('0.1.0')));
    const files = packFiles({
      ...samplePack('0.2.0'),
      rules: [{ id: 'broken' }] as unknown as Pack['rules'],
    });

    const result = await loadPack(serving(files), { trust: release });

    expect(result.source).toBe('cache');
    expect(result.fallbackReason).toMatch(/rules/);
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
  });

  it('downloads every fragment when the stored pack has no hashes (stored by an older app)', async () => {
    await storePack(samplePack('0.1.0'), '0.1.0 old', {
      origin: { signed: true, keyId: 'team-1' },
    });
    const requested: string[] = [];

    await loadPack(serving(packFiles(samplePack('0.2.0')), requested), { trust: release });

    expect(requested).toEqual(['manifest.json', 'manifest.sig', ...ALL_FRAGMENTS]);
  });
});

describe('loadPack refusing an older version', () => {
  it('keeps the active pack and downloads no fragment of an older one, even validly signed', async () => {
    await install(packFiles(samplePack('0.2.0')));
    const requested: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await loadPack(serving(packFiles(samplePack('0.1.0')), requested), {
      trust: release,
    });

    expect(result.source).toBe('cache');
    expect(result.fallback).toBe('refused');
    expect(result.pack.version).toBe('0.2.0');
    expect(result.fallbackReason).toMatch(
      /version 0\.1\.0 is not newer than the active pack 0\.2\.0/,
    );
    expect(requested).toEqual(['manifest.json', 'manifest.sig']);
    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
    // A refused pack is logged, by its reason only.
    expect(warn).toHaveBeenCalledWith('Knowledge pack refused:', expect.stringMatching(/0\.1\.0/));
  });

  it('compares versions as numbers, not as text', async () => {
    await install(packFiles(samplePack('0.10.0')));

    const result = await loadPack(serving(packFiles(samplePack('0.9.0'))), { trust: release });

    expect(result.source).toBe('cache');
    expect(result.pack.version).toBe('0.10.0');
  });

  it('never logs key material when it refuses a pack', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const files = packFiles(samplePack());
    editManifest(files, (manifest) => {
      manifest['clinicallyValidated'] = true;
    });

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(PackLoadError);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toMatch(/signature does not match/);
    expect(logged).not.toContain(publicEntryOf(team).publicKey);
    expect(logged).not.toContain((files['manifest.sig'] ?? '').trim());
  });

  it('refuses a manifest whose version is not a semantic version', async () => {
    const files = packFiles(samplePack('banana'));

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(
      /manifest\.json: version "banana" is not a semantic version/,
    );
  });
});

describe('loadPack and the version floor (the pack built with the app)', () => {
  const floor = { trust: release, minVersion: '0.2.0' };
  const old = () => serving(packFiles(samplePack('0.1.0')));

  it('refuses an older signed pack on a first install', async () => {
    await expect(loadPack(old(), floor)).rejects.toThrow(
      /version 0\.1\.0 is older than 0\.2\.0, the version this app was built with/,
    );
    expect(await getStoredPack('current')).toBeUndefined();
  });

  it('refuses it after the data of the app was cleared', async () => {
    await install(packFiles(samplePack('0.2.0')));
    await (await openAppDb()).clear('pack');

    await expect(loadPack(old(), floor)).rejects.toThrow(/older than 0\.2\.0/);
  });

  it('refuses it when the device does not answer in time', async () => {
    hangIndexedDB();

    await expect(loadPack(old(), { ...floor, deviceTimeoutMs: 20 })).rejects.toThrow(
      /older than 0\.2\.0/,
    );
  });

  it('refuses it when the device cannot be read', async () => {
    breakIndexedDB('UnknownError');

    await expect(loadPack(old(), floor)).rejects.toThrow(/older than 0\.2\.0/);
  });

  it('refuses it when the stored pack is signed by a revoked key', async () => {
    const rotated: PackTrust = {
      keys: [publicEntryOf(team), publicEntryOf(generateSigningKey('team-2'))],
      allowUnsigned: false,
    };
    await storePack(samplePack('0.3.0'), 'revoked', { origin: { signed: true, keyId: 'old' } });

    await expect(loadPack(old(), { ...floor, trust: rotated })).rejects.toThrow(
      /older than 0\.2\.0/,
    );
  });

  it('does not fall back to a stored pack older than the floor', async () => {
    await install(packFiles(samplePack('0.1.0')));

    await expect(loadPack(offline, floor)).rejects.toThrow(
      /from this device \(the stored pack 0\.1\.0 is older than 0\.2\.0/,
    );
  });

  it('takes the pack of the floor itself, and anything newer', async () => {
    expect((await loadPack(serving(packFiles(samplePack('0.2.0'))), floor)).source).toBe('network');
    expect((await install(packFiles(samplePack('0.2.1')), floor.trust)).pack.version).toBe('0.2.1');
  });

  it('keeps a pack the user rolled back to, even below the floor', async () => {
    await install(packFiles(samplePack('0.1.0')));
    await install(packFiles(samplePack('0.2.0')));
    await rollbackPack(release);

    const result = await loadPack(serving(packFiles(samplePack('0.2.0'))), floor);

    expect(result.source).toBe('cache');
    expect(result.fallback).toBe('rolled-back');
    expect(result.pack.version).toBe('0.1.0');
  });

  it('is the version of the pack built with the app by default (none in unit tests)', () => {
    expect(BUILD_MIN_VERSION).toBeNull();
  });
});

describe('loadPack refusing a pack whose origin is not proven', () => {
  it('refuses a manifest changed after it was signed, and stores nothing', async () => {
    const files = packFiles(samplePack('0.1.0'));
    editManifest(files, (manifest) => {
      manifest['clinicallyValidated'] = true;
    });

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(
      /manifest\.sig: the signature does not match/,
    );
    expect(await getStoredPack('current')).toBeUndefined();
  });

  it('keeps the active pack when a tampered update arrives, and says why', async () => {
    await install(packFiles(samplePack('0.1.0')));
    const files = packFiles(samplePack('0.2.0', 'Heavy bleeding'));
    editManifest(files, (manifest) => {
      manifest['version'] = '0.3.0';
    });

    const result = await loadPack(serving(files), { trust: release });

    expect(result.source).toBe('cache');
    expect(result.pack.version).toBe('0.1.0');
    expect(result.fallbackReason).toMatch(/signature does not match/);
  });

  it('refuses a fragment changed after signing: its hash no longer matches', async () => {
    const files = packFiles(samplePack());
    // Same length, one letter changed: only the hash can tell.
    files['danger-signs.json'] = (files['danger-signs.json'] ?? '').replace('Bleeding', 'Bleedinx');

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(
      /danger-signs\.json.*sha256/,
    );
    expect(await getStoredPack('current')).toBeUndefined();
  });

  it('refuses a pack signed with an unknown key', async () => {
    const files = packFiles(samplePack(), generateSigningKey('stranger'));

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(
      /signed with an unknown key "stranger"/,
    );
  });

  it('refuses a pack signed by an intruder under the team key id', async () => {
    const files = packFiles(samplePack(), generateSigningKey('team-1'));

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(/does not match/);
  });

  it('refuses a signed manifest whose manifest.sig is missing', async () => {
    const files = packFiles(samplePack());
    delete files['manifest.sig'];

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(
      /manifest\.sig: HTTP 404/,
    );
  });

  it('refuses an unsigned pack in a build that has keys', async () => {
    const files = packFiles(samplePack(), null);

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(/not signed/);
    expect(await getStoredPack('current')).toBeUndefined();
  });

  it('refuses an unsigned pack in a build with no key and no VITE_ALLOW_UNSIGNED_PACK', async () => {
    const files = packFiles(samplePack(), null);

    await expect(
      loadPack(serving(files), { trust: { keys: [], allowUnsigned: false } }),
    ).rejects.toThrow(/VITE_ALLOW_UNSIGNED_PACK/);
  });

  it('accepts an unsigned pack in a test or demo build, and says it is unsigned', async () => {
    const requested: string[] = [];

    const result = await loadPack(serving(packFiles(samplePack(), null), requested), {
      trust: testBuild,
    });

    expect(result.source).toBe('network');
    expect(result.origin).toEqual({ signed: false, reason: 'the pack is not signed' });
    expect(requested).toEqual(['manifest.json', ...ALL_FRAGMENTS]);
    expect(await result.stored).toBe('stored');
  });

  it('uses the trust of the build by default: pack-keys.ts and VITE_ALLOW_UNSIGNED_PACK', async () => {
    expect(BUILD_TRUST).toEqual({
      keys: PACK_PUBLIC_KEYS,
      allowUnsigned: import.meta.env.VITE_ALLOW_UNSIGNED_PACK === 'true',
    });

    const load = loadPack(serving(packFiles(samplePack(), null)));

    if (BUILD_TRUST.allowUnsigned) {
      await expect(load).resolves.toMatchObject({ source: 'network' });
    } else {
      await expect(load).rejects.toThrow(/not signed/);
    }
  });
});

describe('the trust of the build (read once, when the app module loads)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function freshBuildTrust(): Promise<PackTrust> {
    vi.resetModules();
    return (await import('./pack-loader.js')).BUILD_TRUST;
  }

  it('accepts an unsigned pack with VITE_ALLOW_UNSIGNED_PACK=true outside production mode', async () => {
    vi.stubEnv('VITE_ALLOW_UNSIGNED_PACK', 'true');

    const trust = await freshBuildTrust();

    expect(trust.allowUnsigned).toBe(true);
    expect(trust.keys).toEqual(PACK_PUBLIC_KEYS);
  });

  it('refuses it with any other value', async () => {
    for (const flag of ['false', '', 'TRUE', '1']) {
      vi.stubEnv('VITE_ALLOW_UNSIGNED_PACK', flag);
      expect((await freshBuildTrust()).allowUnsigned, flag).toBe(false);
    }
  });

  it('refuses it in production mode, even with the flag', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ALLOW_UNSIGNED_PACK', 'true');

    expect((await freshBuildTrust()).allowUnsigned).toBe(false);
  });
});

describe('loadPack falling back to the device', () => {
  it('returns the stored pack with source "cache" and the reason when the network fails', async () => {
    const pack = samplePack();
    await install(packFiles(pack));

    const result = await loadPack(offline, { trust: release });

    expect(result.source).toBe('cache');
    expect(result.fallback).toBe('offline');
    expect(result.pack).toEqual(pack);
    expect(result.origin).toEqual({ signed: true, keyId: 'team-1' });
    expect(result.fallbackReason).toMatch(/Failed to fetch/);
    expect(await result.stored).toBe('unchanged');
  });

  it('says "offline" for an HTTP error and "refused" for a pack that fails its checks', async () => {
    await install(packFiles(samplePack()));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tampered = packFiles(samplePack('0.2.0'));
    editManifest(tampered, (manifest) => {
      manifest['date'] = '2027-01-01';
    });

    expect((await loadPack(serving({}), { trust: release })).fallback).toBe('offline');
    expect((await loadPack(serving(tampered), { trust: release })).fallback).toBe('refused');
  });

  it('keeps using the stored pack when a newer download is invalid, and says why', async () => {
    const pack = samplePack();
    await install(packFiles(pack));
    const files = packFiles(samplePack('0.2.0', 'Heavy bleeding'));
    files['danger-signs.json'] = '{}\n';

    const result = await loadPack(serving(files), { trust: release });

    expect(result.source).toBe('cache');
    expect(result.pack).toEqual(pack);
    expect(result.fallbackReason).toMatch(/danger-signs\.json: 3 bytes/);
  });

  it('never downloads a fragment the active pack already has, even if the server copy is broken', async () => {
    await install(packFiles(samplePack('0.1.0')));
    const files = packFiles(samplePack('0.2.0', 'Heavy bleeding'));
    // rules.json did not change: its hash matches the active pack, so it is not fetched.
    files['rules.json'] = '{}\n';

    const result = await loadPack(serving(files), { trust: release });

    expect(result.source).toBe('network');
    expect(result.pack.version).toBe('0.2.0');
  });

  it('refuses a stored unsigned pack in a release build (stored by a demo build)', async () => {
    await install(packFiles(samplePack(), null), testBuild);

    await expect(loadPack(offline, { trust: release })).rejects.toThrow(
      /from this device \(the stored pack is not signed/,
    );
  });

  it('refuses a stored pack whose key was removed from the build (a compromised key)', async () => {
    await install(packFiles(samplePack()));
    const rotated: PackTrust = {
      keys: [publicEntryOf(generateSigningKey('team-2'))],
      allowUnsigned: false,
    };

    await expect(loadPack(offline, { trust: rotated })).rejects.toThrow(
      /key "team-1", which this build no longer trusts/,
    );
  });

  it('replaces a stored pack it no longer trusts with a trusted one, whatever their versions', async () => {
    await install(packFiles(samplePack('0.3.0'), null), testBuild);

    const result = await install(packFiles(samplePack('0.2.0')));

    expect(result.source).toBe('network');
    expect(await getStoredPack('current')).toMatchObject({
      pack: { version: '0.2.0' },
      origin: { signed: true, keyId: 'team-1' },
    });
  });

  it('records the new origin when the same pack comes back signed', async () => {
    const pack = samplePack();
    await install(packFiles(pack, null), testBuild);

    const result = await loadPack(serving(packFiles(pack)), {
      trust: { keys: [publicEntryOf(team)], allowUnsigned: true },
    });

    expect(await result.stored).toBe('stored');
    expect((await getStoredPack('current'))?.origin).toEqual({ signed: true, keyId: 'team-1' });
  });

  it('throws a PackLoadError when neither the network nor the device has a pack', async () => {
    await expect(loadPack(offline, { trust: release })).rejects.toBeInstanceOf(PackLoadError);
    await expect(loadPack(offline, { trust: release })).rejects.toThrow(/network.*device/);
  });

  it('rejects a stored pack that fails parsePack, so it falls through to PackLoadError', async () => {
    await storePack({ version: '0.1.0' } as unknown as Pack, 'corrupted');

    await expect(loadPack(offline, { trust: testBuild })).rejects.toBeInstanceOf(PackLoadError);
    await expect(loadPack(offline, { trust: testBuild })).rejects.toThrow(
      /from this device \(pack\.schema/,
    );
  });

  it('replaces a corrupted stored pack with a valid download', async () => {
    await storePack({ version: '9.0.0' } as unknown as Pack, 'corrupted');

    const result = await install(packFiles(samplePack('0.1.0')));

    expect(result.source).toBe('network');
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
  });
});

describe('loadPack refusing a bad download', () => {
  it('treats an HTTP error as a network failure', async () => {
    await expect(loadPack(serving({}), { trust: release })).rejects.toThrow(/404/);
  });

  it('rejects a pack that fails parsePack and never stores it', async () => {
    const files = packFiles({
      ...samplePack(),
      rules: [{ id: 'broken' }] as unknown as Pack['rules'],
    });

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(PackLoadError);
    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(/rules/);
    expect(await getStoredPack('current')).toBeUndefined();
  });

  it('rejects a truncated fragment', async () => {
    const files = packFiles(samplePack());
    files['danger-signs.json'] = '[]\n';

    await expect(loadPack(serving(files), { trust: release })).rejects.toThrow(
      /danger-signs\.json: 3 bytes/,
    );
  });

  it('rejects a manifest that does not list every fragment', async () => {
    const files = packFiles(samplePack(), null);
    editManifest(files, (manifest) => {
      manifest['fragments'] = (manifest['fragments'] as { path: string }[]).filter(
        (f) => f.path !== 'rules.json',
      );
    });

    await expect(loadPack(serving(files), { trust: testBuild })).rejects.toThrow(
      /rules\.json is not listed/,
    );
  });

  it('rejects a manifest entry without a sha256, so nothing is reused by mistake', async () => {
    await storePack(samplePack('0.1.0'), '0.1.0 old', { hashes: {} });
    const files = packFiles(samplePack('0.2.0'), null);
    editManifest(files, (manifest) => {
      for (const entry of manifest['fragments'] as { sha256?: string }[]) delete entry.sha256;
    });

    const result = await loadPack(serving(files), { trust: testBuild });

    expect(result.source).toBe('cache');
    expect(result.pack.version).toBe('0.1.0');
    expect(result.fallbackReason).toMatch(/the sha256 of substances\.json is missing/);
  });

  it('rejects a manifest of another schema', async () => {
    const files = packFiles(samplePack(), null);
    editManifest(files, (manifest) => {
      manifest['schema'] = 2;
    });

    await expect(loadPack(serving(files), { trust: testBuild })).rejects.toThrow(
      /unsupported schema 2/,
    );
  });
});

describe('rollbackPack', () => {
  it('restores the previous pack and drops the newer one', async () => {
    await install(packFiles(samplePack('0.1.0')));
    await install(packFiles(samplePack('0.2.0')));

    const restored = await rollbackPack(release);

    expect(restored).toMatchObject({
      pack: samplePack('0.1.0'),
      source: 'cache',
      fallback: 'rolled-back',
      fallbackReason: null,
      origin: { signed: true, keyId: 'team-1' },
    });
    expect(await restored.stored).toBe('stored');
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
    expect(await getStoredPack('previous')).toBeUndefined();
  });

  it('names the version a rollback would restore, only when this build trusts it', async () => {
    expect(await previousPackVersion(release)).toBeNull();
    await install(packFiles(samplePack('0.1.0')));
    expect(await previousPackVersion(release)).toBeNull();
    await install(packFiles(samplePack('0.2.0')));

    expect(await previousPackVersion(release)).toBe('0.1.0');
    expect(await previousPackVersion({ keys: [], allowUnsigned: false })).toBeNull();

    await rollbackPack(release);
    expect(await previousPackVersion(release)).toBeNull();
  });

  it('names no version when the device cannot be read', async () => {
    breakIndexedDB('UnknownError');

    expect(await previousPackVersion(release)).toBeNull();
  });

  it('is not undone by the next load: the rolled back version is refused, a higher one is taken', async () => {
    await install(packFiles(samplePack('0.1.0')));
    const bad = packFiles(samplePack('0.2.0', 'Wrong'));
    await install(bad);
    await rollbackPack(release);

    const again = await loadPack(serving(bad), { trust: release });

    expect(again.source).toBe('cache');
    expect(again.fallback).toBe('rolled-back');
    expect(again.pack.version).toBe('0.1.0');
    expect(again.fallbackReason).toMatch(/version 0\.2\.0 was rolled back on this device/);

    const same = await loadPack(serving(packFiles(samplePack('0.1.0'))), { trust: release });
    expect(same.source).toBe('network');
    expect(await same.stored).toBe('unchanged');

    const fixed = await install(packFiles(samplePack('0.2.1')));
    expect(fixed.source).toBe('network');
    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.1');
  });

  it('refuses when there is no previous pack, and changes nothing', async () => {
    await install(packFiles(samplePack('0.1.0')));

    await expect(rollbackPack(release)).rejects.toThrow(PackRollbackError);
    await expect(rollbackPack(release)).rejects.toThrow(/no previous pack/);
    expect((await getStoredPack('current'))?.pack.version).toBe('0.1.0');
  });

  it('refuses a previous pack this build does not trust, and changes nothing', async () => {
    await install(packFiles(samplePack('0.1.0'), null), testBuild);
    await install(packFiles(samplePack('0.2.0')));

    await expect(rollbackPack(release)).rejects.toThrow(/previous pack is not signed/);
    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
    expect((await getStoredPack('previous'))?.pack.version).toBe('0.1.0');
  });

  it('refuses a previous pack that fails parsePack, and changes nothing', async () => {
    await storePack({ version: '0.1.0' } as unknown as Pack, 'corrupted', {
      origin: { signed: true, keyId: 'team-1' },
    });
    await install(packFiles(samplePack('0.2.0')));

    await expect(rollbackPack(release)).rejects.toThrow(/previous pack is not valid.*pack\.schema/);
    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
  });
});

describe('the minimum safe version (knowledge/pack.yaml, signed in the manifest)', () => {
  const v = (version: string) => samplePack(version);

  it('is stored with the pack, from the signed manifest', async () => {
    await install(packFiles(v('0.2.0'), team, '0.1.0'));

    expect((await getStoredPack('current'))?.minimumSafeVersion).toBe('0.1.0');
  });

  it('refuses a manifest whose minimum safe version is above its version, or not a version', async () => {
    for (const minimum of ['0.3.0', 'soon']) {
      await expect(
        loadPack(serving(packFiles(v('0.2.0'), team, minimum)), { trust: release }),
        minimum,
      ).rejects.toThrow(/minimumSafeVersion/);
    }
  });

  it('allows a rollback to a version at or above the minimum safe version of the active pack', async () => {
    await install(packFiles(v('1.0.0')));
    await install(packFiles(v('1.1.0'), team, '1.0.0'));

    expect(await previousPackVersion(release, null)).toBe('1.0.0');
    expect((await rollbackPack(release, null)).pack.version).toBe('1.0.0');
  });

  it('refuses a rollback below the minimum safe version of the active pack, and hides it', async () => {
    await install(packFiles(v('1.0.0')));
    await install(packFiles(v('1.1.0'), team, '1.1.0'));

    expect(await previousPackVersion(release, null)).toBeNull();
    await expect(rollbackPack(release, null)).rejects.toThrow(
      /version 1\.0\.0 is below 1\.1\.0, the minimum safe version/,
    );
    expect((await getStoredPack('current'))?.pack.version).toBe('1.1.0');
    expect((await getStoredPack('previous'))?.pack.version).toBe('1.0.0');
  });

  it('refuses a rollback below the minimum safe version of the pack built with the app', async () => {
    await install(packFiles(v('1.0.0')));
    await install(packFiles(v('1.1.0')));

    expect(await previousPackVersion(release, '1.0.1')).toBeNull();
    await expect(rollbackPack(release, '1.0.1')).rejects.toThrow(/below 1\.0\.1/);
    // Equal is allowed.
    expect(await previousPackVersion(release, '1.0.0')).toBe('1.0.0');
  });

  it('never lets a phone jump back from 3.0.0 to 0.1.0 when 3.0.0 says 2.0.0 is the minimum', async () => {
    await install(packFiles(v('0.1.0')));
    await install(packFiles(v('3.0.0'), team, '2.0.0'));

    await expect(rollbackPack(release, null)).rejects.toThrow(/0\.1\.0 is below 2\.0\.0/);
    expect((await getStoredPack('current'))?.pack.version).toBe('3.0.0');
  });

  it('changes nothing when no minimum safe version is set (as before)', async () => {
    await install(packFiles(v('0.1.0')));
    await install(packFiles(v('3.0.0')));

    expect((await rollbackPack(release, null)).pack.version).toBe('0.1.0');
  });

  it('replaces a rolled back pack below the minimum safe version of the app with the app pack, and clears the mark', async () => {
    // 1.0 then 1.1, rolled back to 1.0; the app 1.2 says 1.2 is the minimum.
    await install(packFiles(v('1.0.0')));
    await install(packFiles(v('1.1.0')));
    await rollbackPack(release, null);

    const result = await loadPack(serving(packFiles(v('1.2.0'), team, '1.2.0')), {
      trust: release,
      minVersion: '1.2.0',
      minSafeVersion: '1.2.0',
    });

    expect(result.source).toBe('network');
    expect(result.pack.version).toBe('1.2.0');
    expect(await result.stored).toBe('stored');
    expect((await getStoredPack('current'))?.rolledBackFrom).toBeUndefined();
    expect(await previousPackVersion(release, '1.2.0')).toBeNull();
  });

  it('takes the app pack even when it is the version rolled back from: the phone is never left without a pack', async () => {
    await install(packFiles(v('1.0.0')));
    const withdrawnFix = packFiles(v('1.1.0'), team, '1.1.0');
    await install(packFiles(v('1.1.0')));
    await rollbackPack(release, null);

    const result = await loadPack(serving(withdrawnFix), {
      trust: release,
      minVersion: '1.1.0',
      minSafeVersion: '1.1.0',
    });

    expect(result.source).toBe('network');
    expect(result.pack.version).toBe('1.1.0');
    expect(await result.stored).toBe('stored');
    expect(await getStoredPack('current')).toMatchObject({
      pack: { version: '1.1.0' },
      minimumSafeVersion: '1.1.0',
    });
    expect((await getStoredPack('current'))?.rolledBackFrom).toBeUndefined();
  });

  it('keeps the rolled back pack when the app sets no minimum safe version (as before)', async () => {
    await install(packFiles(v('1.0.0')));
    const same = packFiles(v('1.1.0'));
    await install(same);
    await rollbackPack(release, null);

    const result = await loadPack(serving(same), {
      trust: release,
      minVersion: '1.1.0',
      minSafeVersion: null,
    });

    expect(result.source).toBe('cache');
    expect(result.fallback).toBe('rolled-back');
    expect(result.pack.version).toBe('1.0.0');
  });

  it('is none by default in unit tests (the pack built with the app sets it)', () => {
    expect(BUILD_MIN_SAFE_VERSION).toBeNull();
  });
});

describe('previousPackVersion and broken packs', () => {
  it('offers no rollback to a previous pack that fails parsePack', async () => {
    await storePack({ version: '0.1.0' } as unknown as Pack, 'corrupted', {
      origin: { signed: true, keyId: 'team-1' },
    });
    await install(packFiles(samplePack('0.2.0')));

    expect(await previousPackVersion(release, null)).toBeNull();
  });
});

describe('the console log of a refused pack', () => {
  it('names every refusal, a broken fragment included, and never a download failure', async () => {
    await install(packFiles(samplePack('0.1.0')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const files = packFiles(samplePack('0.2.0', 'Heavy bleeding'));
    files['danger-signs.json'] = (files['danger-signs.json'] ?? '').replace('Heavy', 'Heavx');

    await loadPack(serving(files), { trust: release });
    await loadPack(offline, { trust: release });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Knowledge pack refused:',
      expect.stringMatching(/danger-signs\.json: sha256 does not match/),
    );
  });
});
