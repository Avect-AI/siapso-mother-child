// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { BUILTIN_MESSAGES, type Message, type Pack } from '@siapso/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { breakIndexedDB, hangIndexedDB } from '../test/idb.js';
import { getStoredPack, storePack } from './db.js';
import { loadPack, PackLoadError } from './pack-loader.js';

const message: Message = { fact: 'Fact.', risk: 'Risk.', orientation: 'Orientation.' };
const builtins = Object.fromEntries(Object.values(BUILTIN_MESSAGES).map((id) => [id, message]));

function samplePack(version = '0.1.0'): Pack {
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
        label: { fr: 'Saignement', en: 'Bleeding' },
        sources: [],
      },
    ],
    sources: [],
    messages: { fr: builtins, en: builtins },
  };
}

/** The files `pnpm knowledge:build` writes for a pack (same layout as tools/knowledge/src/write.ts). */
function packFiles(pack: Pack): Record<string, string> {
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
    counts: {},
    fragments: Object.entries(files).map(([path, text]) => ({
      path,
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: Buffer.byteLength(text),
    })),
  };
  return { ...files, 'manifest.json': JSON.stringify(manifest) };
}

/** A fetch that serves `files` under /pack/, answers 404 for anything else and records each URL. */
function serving(files: Record<string, string>, urls: string[] = []): typeof fetch {
  return (input) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    const name = url.split('/pack/')[1] ?? '';
    const body = files[name];
    return Promise.resolve(
      body === undefined ? new Response('Not found', { status: 404 }) : new Response(body),
    );
  };
}

const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadPack from the network', () => {
  it('loads the fragments listed in the manifest, assembles the pack and stores it', async () => {
    const pack = samplePack();
    const urls: string[] = [];

    const result = await loadPack(serving(packFiles(pack), urls));

    expect(result.source).toBe('network');
    expect(result.fallbackReason).toBeNull();
    expect(result.pack).toEqual(pack);
    expect(urls[0]).toBe('/pack/manifest.json');
    expect(urls).toHaveLength(10);
    expect(await result.stored).toBe('stored');
    expect((await getStoredPack('current'))?.pack).toEqual(pack);
  });

  it('hands the pack back as soon as it is verified, without waiting for the device to store it', async () => {
    hangIndexedDB();

    const result = await loadPack(serving(packFiles(samplePack())));

    expect(result.source).toBe('network');
    expect(result.pack.version).toBe('0.1.0');
  });

  it('logs and reports a pack the device cannot store, and still uses it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    breakIndexedDB('QuotaExceededError');

    const result = await loadPack(serving(packFiles(samplePack())));

    expect(result.source).toBe('network');
    await expect(result.stored).rejects.toThrow('QuotaExceededError');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not stored/), expect.any(Error));
  });

  it('does not rewrite a pack already stored with the same version and hashes', async () => {
    const files = packFiles(samplePack());
    await (
      await loadPack(serving(files))
    ).stored;

    expect(await (await loadPack(serving(files))).stored).toBe('unchanged');
  });

  it('keeps the previous version when a new one is stored', async () => {
    await (
      await loadPack(serving(packFiles(samplePack('0.1.0'))))
    ).stored;
    await (
      await loadPack(serving(packFiles(samplePack('0.2.0'))))
    ).stored;

    expect((await getStoredPack('current'))?.pack.version).toBe('0.2.0');
    expect((await getStoredPack('previous'))?.pack.version).toBe('0.1.0');
  });
});

describe('loadPack falling back to the device', () => {
  it('returns the stored pack with source "cache" and the reason when the network fails', async () => {
    const pack = samplePack();
    await (
      await loadPack(serving(packFiles(pack)))
    ).stored;

    const result = await loadPack(offline);

    expect(result.source).toBe('cache');
    expect(result.pack).toEqual(pack);
    expect(result.fallbackReason).toMatch(/Failed to fetch/);
    expect(await result.stored).toBe('unchanged');
  });

  it('keeps using the stored pack when a newer download is invalid, and says why', async () => {
    const pack = samplePack();
    await (
      await loadPack(serving(packFiles(pack)))
    ).stored;
    const files = packFiles(samplePack('0.2.0'));
    files['rules.json'] = '{}\n';

    const result = await loadPack(serving(files));

    expect(result.source).toBe('cache');
    expect(result.pack).toEqual(pack);
    expect(result.fallbackReason).toMatch(/rules/);
  });

  it('throws a PackLoadError when neither the network nor the device has a pack', async () => {
    await expect(loadPack(offline)).rejects.toBeInstanceOf(PackLoadError);
    await expect(loadPack(offline)).rejects.toThrow(/network.*device/);
  });

  it('rejects a stored pack that fails parsePack, so it falls through to PackLoadError', async () => {
    await storePack({ version: '0.1.0' } as unknown as Pack, 'corrupted');

    await expect(loadPack(offline)).rejects.toBeInstanceOf(PackLoadError);
    await expect(loadPack(offline)).rejects.toThrow(/from this device \(pack\.schema/);
  });
});

describe('loadPack refusing a bad download', () => {
  it('treats an HTTP error as a network failure', async () => {
    await expect(loadPack(serving({}))).rejects.toThrow(/404/);
  });

  it('rejects a pack that fails parsePack and never stores it', async () => {
    const files = packFiles({
      ...samplePack(),
      rules: [{ id: 'broken' }] as unknown as Pack['rules'],
    });

    await expect(loadPack(serving(files))).rejects.toThrow(PackLoadError);
    await expect(loadPack(serving(files))).rejects.toThrow(/rules/);
    expect(await getStoredPack('current')).toBeUndefined();
  });

  it('rejects a fragment whose sha256 does not match the manifest', async () => {
    const files = packFiles(samplePack());
    // Same length, one letter changed: only the hash can tell.
    files['danger-signs.json'] = (files['danger-signs.json'] ?? '').replace('Bleeding', 'Bleedinx');

    await expect(loadPack(serving(files))).rejects.toThrow(/danger-signs\.json.*sha256/);
    expect(await getStoredPack('current')).toBeUndefined();
  });

  it('rejects a truncated fragment', async () => {
    const files = packFiles(samplePack());
    files['danger-signs.json'] = '[]\n';

    await expect(loadPack(serving(files))).rejects.toThrow(/danger-signs\.json: 3 bytes/);
  });

  it('rejects a manifest that does not list every fragment', async () => {
    const files = packFiles(samplePack());
    const manifest = JSON.parse(files['manifest.json'] ?? '') as { fragments: { path: string }[] };
    manifest.fragments = manifest.fragments.filter((f) => f.path !== 'rules.json');
    files['manifest.json'] = JSON.stringify(manifest);

    await expect(loadPack(serving(files))).rejects.toThrow(/rules\.json/);
  });
});
