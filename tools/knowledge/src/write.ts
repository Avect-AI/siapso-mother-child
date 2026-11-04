// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Pack } from '@siapso/engine';

/** The fragment files the app assembles into a Pack, in a fixed order. */
export const PACK_FRAGMENTS: readonly string[] = [
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

/** Total gzip size the fragments must stay under (the app downloads them). */
export const MAX_GZIP_BYTES = 3 * 1024 * 1024;

export interface Manifest {
  schema: 1;
  version: string;
  date: string;
  clinicallyValidated: boolean;
  counts: Record<
    'substances' | 'classes' | 'products' | 'plants' | 'rules' | 'dangerSigns' | 'sources',
    number
  >;
  fragments: { path: string; sha256: string; bytes: number }[];
}

/** Two-space indentation and a trailing newline: stable, diff-friendly bytes. */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fragmentsOf(pack: Pack): Record<string, unknown> {
  return {
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
}

/**
 * Creates the directory, or removes what it holds so that no stale file
 * survives a build. As a safety guard, a directory that has content is only
 * cleaned when it is named "pack".
 */
async function emptyDirectory(dir: string): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (names.length > 0 && path.basename(path.resolve(dir)) !== 'pack') {
    throw new Error(
      `Refusing to clean ${dir}: only a directory named "pack" is emptied before a build`,
    );
  }
  await mkdir(dir, { recursive: true });
  await Promise.all(
    names.map((name) => rm(path.join(dir, name), { recursive: true, force: true })),
  );
}

/**
 * Writes the fragments, `pack.json` (the whole pack) and `manifest.json`
 * (which lists only the fragments) into `outDir`, after removing stale files
 * from it. Nothing is touched when the fragments are over the gzip size budget. The output depends only on the
 * pack: no timestamp, same bytes on every build.
 */
export async function writePack(pack: Pack, outDir: string): Promise<Manifest> {
  const values = fragmentsOf(pack);
  const files = PACK_FRAGMENTS.map((name) => ({ name, text: json(values[name]) }));

  const gzipBytes = files.reduce(
    (total, file) => total + gzipSync(file.text, { level: 9 }).length,
    0,
  );
  if (gzipBytes > MAX_GZIP_BYTES) {
    throw new Error(
      `The pack is over its size budget: ${String(gzipBytes)} bytes gzipped, the limit is ${String(MAX_GZIP_BYTES)}`,
    );
  }

  const manifest: Manifest = {
    schema: 1,
    version: pack.version,
    date: pack.date,
    clinicallyValidated: pack.clinicallyValidated,
    counts: {
      substances: pack.substances.length,
      classes: pack.classes.length,
      products: pack.products.length,
      plants: pack.plants.length,
      rules: pack.rules.length,
      dangerSigns: pack.dangerSigns.length,
      sources: pack.sources.length,
    },
    fragments: files.map(({ name, text }) => ({
      path: name,
      sha256: createHash('sha256').update(text).digest('hex'),
      bytes: Buffer.byteLength(text),
    })),
  };

  await emptyDirectory(outDir);
  await Promise.all([
    ...files.map((file) => writeFile(path.join(outDir, file.name), file.text)),
    writeFile(path.join(outDir, 'pack.json'), json(pack)),
    writeFile(path.join(outDir, 'manifest.json'), json(manifest)),
  ]);
  return manifest;
}
