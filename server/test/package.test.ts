// SPDX-License-Identifier: MIT
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { hashKey } from '../src/auth.js';
import { main } from '../src/main.js';
import { REPO_ROOT } from './helpers.js';

const SERVER = path.join(REPO_ROOT, 'server');

async function sources(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') found.push(...(await sources(full)));
    } else found.push(full);
  }
  return found;
}

describe('source files', () => {
  it('carry no UTF-8 byte order mark', async () => {
    const files = await sources(SERVER);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const bytes = await readFile(file);
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), file).toBe(false);
    }
  });
});

describe('Dockerfile', () => {
  it('copies only paths that exist in the repository (the pack is built before the image)', async () => {
    const text = await readFile(path.join(SERVER, 'Dockerfile'), 'utf8');
    const built = new Set(['app/public/pack/pack.json']);
    const copies = text
      .split('\n')
      .filter((line) => /^COPY\s/.test(line) && !line.includes('--from='))
      .map((line) => line.split(/\s+/).slice(1, -1));
    expect(copies.length).toBeGreaterThan(5);
    for (const sources of copies) {
      for (const source of sources) {
        if (built.has(source)) continue;
        expect(existsSync(path.join(REPO_ROOT, source)), source).toBe(true);
      }
    }
  });

  it('copies no node_modules of a package that has none', async () => {
    const text = await readFile(path.join(SERVER, 'Dockerfile'), 'utf8');
    expect(text).not.toContain('/app/engine/node_modules');
  });

  it('runs as a non-root user, with a health check', async () => {
    const text = await readFile(path.join(SERVER, 'Dockerfile'), 'utf8');
    expect(text).toMatch(/^USER node$/m);
    expect(text).toMatch(/^HEALTHCHECK /m);
  });

  it('has a .dockerignore that leaves out git data, dependencies, worktrees and scratch', async () => {
    const text = await readFile(path.join(REPO_ROOT, '.dockerignore'), 'utf8');
    for (const entry of ['.git', '**/node_modules', '.claude', '.superpowers']) {
      expect(text.split(/\r?\n/)).toContain(entry);
    }
  });
});

describe('main', () => {
  it('refuses to start with an empty keys list', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'siapso-keys-'));
    const file = path.join(dir, 'keys.json');
    await writeFile(file, '{"keys":[]}');
    const before = process.env.SIAPSO_API_KEYS_FILE;
    process.env.SIAPSO_API_KEYS_FILE = file;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await main([])).toBe(1);
      expect(stderr.mock.calls.join('')).toMatch(/no API key/);
    } finally {
      stderr.mockRestore();
      if (before === undefined) delete process.env.SIAPSO_API_KEYS_FILE;
      else process.env.SIAPSO_API_KEYS_FILE = before;
      await rm(dir, { recursive: true });
    }
  });

  it('refuses a malformed key file with exit code 1 and no content echoed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'siapso-keys-'));
    const file = path.join(dir, 'keys.json');
    await writeFile(file, `{"keys":[{"id":"a","sha256":"${hashKey('x')}","secret":"leak"}]}`);
    const before = process.env.SIAPSO_API_KEYS_FILE;
    process.env.SIAPSO_API_KEYS_FILE = file;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await main([])).toBe(1);
      expect(stderr.mock.calls.join('')).not.toContain('leak');
    } finally {
      stderr.mockRestore();
      if (before === undefined) delete process.env.SIAPSO_API_KEYS_FILE;
      else process.env.SIAPSO_API_KEYS_FILE = before;
      await rm(dir, { recursive: true });
    }
  });
});
