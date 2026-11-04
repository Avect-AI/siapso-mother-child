// SPDX-License-Identifier: MIT
// The app and the pack build agree on the fragment files: the loader asks for
// exactly the fragments that `pnpm knowledge:build` writes (PACK_FRAGMENTS of
// @siapso/pack-tools), in the same order, and loads what the build wrote.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUILTIN_MESSAGES, type Message, type Pack } from '@siapso/engine';
import { PACK_FRAGMENTS, writePack } from '@siapso/pack-tools';
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

describe('the pack fragments', () => {
  it('are the ones the build writes, requested in the build order', async () => {
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

    // A fragment the build does not write would fail as "not listed": the load
    // succeeds only when every fragment the app needs is in the manifest.
    const loaded = await loadPack(served);
    expect(loaded.source).toBe('network');
    expect(loaded.pack).toEqual(PACK);
    expect(requested).toEqual(['manifest.json', ...PACK_FRAGMENTS]);
    expect(await loaded.stored).toBe('stored');
  });
});
