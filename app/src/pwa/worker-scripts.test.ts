// SPDX-License-Identifier: MIT
// @vitest-environment node
// Every Web Worker of the workspace has a script name of its own. Vite names
// a worker chunk after its entry file (assets/<entry>-<hash>.js), and the
// service worker tells the speech worker's script by that name: it keeps it
// out of the precache until a voice is installed. A second entry of the same
// name (the reading worker was ./worker.ts too) would leave the precache with
// it, and fail offline without a voice. This test reads the sources, so a
// new worker entry is checked the day it is written.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isVoiceWorkerUrl, splitPrecache } from './sw-setup.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGES = ['app', 'engine', 'resolver', 'speech', 'ocr'];
const ENTRY = /new\s+(?:Shared)?Worker\(\s*new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g;

interface WorkerEntry {
  /** The package folder, such as speech. */
  pack: string;
  /** The source file that starts the worker, from the repository root. */
  source: string;
  /** The entry's file name without its extension: the start of the script name. */
  name: string;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(child);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

function workerEntries(): WorkerEntry[] {
  return PACKAGES.flatMap((pack) =>
    sources(path.join(root, pack, 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(ENTRY)].map(([, entry = '']) => ({
        pack,
        source: path.relative(root, file).split(path.sep).join('/'),
        name: path.basename(entry).replace(/\.[^.]+$/, ''),
      })),
    ),
  );
}

/** Script names as Vite writes them, with hashes of the shapes it gives. */
const scripts = (name: string) =>
  ['AbCd1234', 'Bx9_a-1Z', 'C6uef2FI'].map((hash) => `assets/${name}-${hash}.js`);

describe('worker scripts', () => {
  const entries = workerEntries();

  it('finds the speech worker and the reading worker', () => {
    expect(entries.map((entry) => entry.pack).sort()).toEqual(['ocr', 'speech']);
  });

  it('gives each worker a script name of its own', () => {
    const names = entries.map((entry) => entry.name);
    expect(new Set(names).size, JSON.stringify(entries)).toBe(names.length);
  });

  it('keeps apart the speech worker script only: every other worker is precached with the app', () => {
    for (const entry of entries) {
      const speech = entry.pack === 'speech';
      for (const script of scripts(entry.name)) {
        expect(
          isVoiceWorkerUrl(new URL(`https://app.test/${script}`), 'https://app.test'),
          script,
        ).toBe(speech);
        const { app, voiceWorker } = splitPrecache([script]);
        expect(speech ? voiceWorker : app, `${entry.source}: ${script}`).toEqual([script]);
      }
    }
  });
});
