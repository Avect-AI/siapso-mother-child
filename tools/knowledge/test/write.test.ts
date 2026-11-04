// SPDX-License-Identifier: MIT
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parsePack } from '@siapso/engine';
import type { Pack } from '@siapso/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPack, MAX_GZIP_BYTES, PACK_FRAGMENTS, writePack } from '../src/index.js';
import { loadValid } from './helpers.js';

const made: string[] = [];

async function outDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'siapso-out-'));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function validPack(): Promise<Pack> {
  return buildPack(await loadValid());
}

describe('PACK_FRAGMENTS', () => {
  it('lists the fragment files in a fixed order', () => {
    expect(PACK_FRAGMENTS).toEqual([
      'substances.json',
      'classes.json',
      'products.json',
      'plants.json',
      'rules.json',
      'danger-signs.json',
      'sources.json',
      'messages.fr.json',
      'messages.en.json',
    ]);
  });
});

describe('writePack', () => {
  it('writes the fragments, pack.json and manifest.json, and nothing else', async () => {
    const dir = await outDir();
    await writePack(await validPack(), dir);
    expect((await readdir(dir)).sort()).toEqual(
      [...PACK_FRAGMENTS, 'pack.json', 'manifest.json'].sort(),
    );
  });

  it('writes a manifest whose hashes and sizes match the fragment bytes', async () => {
    const dir = await outDir();
    const manifest = await writePack(await validPack(), dir);
    expect(manifest.fragments.map((f) => f.path)).toEqual([...PACK_FRAGMENTS]);
    for (const fragment of manifest.fragments) {
      const bytes = await readFile(path.join(dir, fragment.path));
      expect(fragment.bytes).toBe(bytes.length);
      expect(fragment.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    const onDisk: unknown = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    expect(onDisk).toEqual(manifest);
  });

  it('describes the pack in the manifest, with no timestamp', async () => {
    const dir = await outDir();
    const manifest = await writePack(await validPack(), dir);
    expect(manifest).toMatchObject({
      schema: 1,
      version: '0.0.1',
      date: '2026-11-04',
      clinicallyValidated: false,
      counts: {
        substances: 2,
        classes: 1,
        products: 2,
        plants: 1,
        rules: 5,
        dangerSigns: 2,
        sources: 0,
      },
    });
    expect(Object.keys(manifest)).toEqual([
      'schema',
      'version',
      'date',
      'clinicallyValidated',
      'counts',
      'fragments',
    ]);
  });

  it('writes JSON with two-space indentation and a trailing newline', async () => {
    const dir = await outDir();
    await writePack(await validPack(), dir);
    for (const name of [...PACK_FRAGMENTS, 'pack.json', 'manifest.json']) {
      const text = await readFile(path.join(dir, name), 'utf8');
      expect(text.endsWith('}\n') || text.endsWith(']\n'), name).toBe(true);
      expect(text, name).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    }
  });

  it('writes fragments that assemble into the whole pack, and a pack.json that parsePack accepts', async () => {
    const dir = await outDir();
    const pack = await validPack();
    await writePack(pack, dir);
    const read = async (name: string): Promise<unknown> =>
      JSON.parse(await readFile(path.join(dir, name), 'utf8'));
    expect(parsePack(await read('pack.json'))).toStrictEqual(pack);
    expect(await read('rules.json')).toStrictEqual(pack.rules);
    expect(await read('sources.json')).toStrictEqual(pack.sources);
    expect(await read('messages.fr.json')).toStrictEqual(pack.messages.fr);
    expect(await read('messages.en.json')).toStrictEqual(pack.messages.en);
  });

  it('gives byte-identical files on two builds', async () => {
    const first = await outDir();
    const second = await outDir();
    const manifestA = await writePack(await validPack(), first);
    const manifestB = await writePack(await validPack(), second);
    expect(manifestA).toEqual(manifestB);
    for (const name of [...PACK_FRAGMENTS, 'pack.json', 'manifest.json']) {
      const a = await readFile(path.join(first, name));
      const b = await readFile(path.join(second, name));
      expect(a.equals(b), name).toBe(true);
    }
  });

  it('creates the output directory when it does not exist', async () => {
    const dir = path.join(await outDir(), 'nested', 'pack');
    await writePack(await validPack(), dir);
    expect(await readdir(dir)).toContain('manifest.json');
  });

  it('removes stale files from the output directory before writing', async () => {
    const dir = path.join(await outDir(), 'pack');
    await mkdir(path.join(dir, 'old-folder'), { recursive: true });
    await writeFile(path.join(dir, 'stale.json'), '{}');
    await writeFile(path.join(dir, 'old-folder', 'x.json'), '{}');
    await writePack(await validPack(), dir);
    expect((await readdir(dir)).sort()).toEqual(
      [...PACK_FRAGMENTS, 'pack.json', 'manifest.json'].sort(),
    );
  });

  it('refuses to clean a directory that is not named pack, and leaves it untouched', async () => {
    const dir = await outDir();
    await writeFile(path.join(dir, 'precious.txt'), 'keep');
    await expect(writePack(await validPack(), dir)).rejects.toThrow(/named "pack"/);
    expect(await readdir(dir)).toEqual(['precious.txt']);
  });

  it('does not remove anything when the pack is over the size budget', async () => {
    const dir = path.join(await outDir(), 'pack');
    await mkdir(dir);
    await writeFile(path.join(dir, 'previous.json'), '{}');
    const pack = await validPack();
    const heavy: Pack = {
      ...pack,
      messages: {
        ...pack.messages,
        fr: {
          ...pack.messages.fr,
          heavy: { fact: randomBytes(4_200_000).toString('base64'), risk: 'Risque.' },
        },
      },
    };
    await expect(writePack(heavy, dir)).rejects.toThrow(/size budget/);
    expect(await readdir(dir)).toEqual(['previous.json']);
  });

  it('refuses a pack whose gzip size is over the budget, and writes nothing', async () => {
    const dir = await outDir();
    const pack = await validPack();
    // Random bytes do not compress: about 5.6 MB of text, over 3 MB once gzipped.
    const heavy: Pack = {
      ...pack,
      messages: {
        ...pack.messages,
        fr: {
          ...pack.messages.fr,
          heavy: { fact: randomBytes(4_200_000).toString('base64'), risk: 'Risque.' },
        },
      },
    };
    await expect(writePack(heavy, dir)).rejects.toThrow(/size budget/);
    expect(await readdir(dir)).toEqual([]);
    expect(MAX_GZIP_BYTES).toBe(3 * 1024 * 1024);
  });
});
