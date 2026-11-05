// SPDX-License-Identifier: MIT
// The app and the pack build agree on the fragment files: the loader asks for
// exactly the fragments that `pnpm knowledge:build` writes (PACK_FRAGMENTS of
// @siapso/pack-tools), in the same order, and loads what the build wrote. And
// on the signature: what `siapso-pack sign` writes is what the app checks.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUILTIN_MESSAGES, type Message, type Pack } from '@siapso/engine';
import {
  generateSigningKey,
  PACK_FRAGMENTS,
  publicEntryOf,
  signPack,
  writePack,
} from '@siapso/pack-tools';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPack } from './pack-loader.js';

const message: Message = { fact: 'Fact.', risk: 'Risk.' };
const builtins = Object.fromEntries(Object.values(BUILTIN_MESSAGES).map((id) => [id, message]));

const PACK: Pack = {
  schema: 1,
  version: '0.1.0',
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

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A pack written by the build into <temp>/pack, and a fetch that serves it and records each name. */
async function built(): Promise<{ dir: string; served: typeof fetch; requested: string[] }> {
  const root = await mkdtemp(path.join(tmpdir(), 'siapso-fragments-'));
  temps.push(root);
  const dir = path.join(root, 'pack');
  const manifest = await writePack(PACK, dir);
  expect(manifest.fragments.map((f) => f.path)).toEqual([...PACK_FRAGMENTS]);
  const requested: string[] = [];
  const served: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const name = url.split('/pack/')[1] ?? '';
    requested.push(name);
    return new Response(await readFile(path.join(dir, name)));
  };
  return { dir, served, requested };
}

describe('the pack fragments', () => {
  it('are the ones the build writes, requested in the build order', async () => {
    const { served, requested } = await built();

    // A fragment the build does not write would fail as "not listed": the load
    // succeeds only when every fragment the app needs is in the manifest.
    const loaded = await loadPack(served, { trust: { keys: [], allowUnsigned: true } });
    expect(loaded.source).toBe('network');
    expect(loaded.pack).toEqual(PACK);
    expect(requested).toEqual(['manifest.json', ...PACK_FRAGMENTS]);
    expect(await loaded.stored).toBe('stored');
  });
});

describe('the pack signature', () => {
  it('written by siapso-pack sign is checked by the app with the public key', async () => {
    const { dir, served, requested } = await built();
    const key = generateSigningKey('release-test');
    await signPack(dir, key);

    const loaded = await loadPack(served, {
      trust: { keys: [publicEntryOf(key)], allowUnsigned: false },
    });

    expect(loaded.origin).toEqual({ signed: true, keyId: 'release-test' });
    expect(loaded.pack).toEqual(PACK);
    expect(requested).toEqual(['manifest.json', 'manifest.sig', ...PACK_FRAGMENTS]);
  });

  it('no longer verifies once manifest.json is changed on the server', async () => {
    const { dir, served } = await built();
    const key = generateSigningKey('release-test');
    await signPack(dir, key);
    const file = path.join(dir, 'manifest.json');
    await writeFile(file, (await readFile(file, 'utf8')).replace('"0.1.0"', '"0.1.1"'));

    await expect(
      loadPack(served, { trust: { keys: [publicEntryOf(key)], allowUnsigned: false } }),
    ).rejects.toThrow(/signature does not match/);
  });
});
