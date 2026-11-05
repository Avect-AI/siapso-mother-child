// SPDX-License-Identifier: MIT
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAppSize, LIMIT_BYTES, measure } from './check-app-size.mjs';

let dist;

async function file(relative, bytes) {
  const target = path.join(dist, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.alloc(bytes));
}

const quiet = () => undefined;

beforeEach(async () => {
  dist = await mkdtemp(path.join(tmpdir(), 'siapso-dist-'));
});

afterEach(async () => {
  await rm(dist, { recursive: true, force: true });
});

describe('measure', () => {
  it('sums every file of the app, in subfolders too, but not the pack or the voice files', async () => {
    await file('index.html', 100);
    await file('assets/index.js', 2000);
    await file('fonts/a.woff2', 300);
    await file('pack/products.json', 5_000_000);
    await file('voice/model.onnx', 9_000_000);

    const { total, files } = await measure(dist);

    expect(total).toBe(2400);
    expect(files.map((f) => f.path)).toEqual(['assets/index.js', 'fonts/a.woff2', 'index.html']);
  });

  it('counts the speech worker with the voice, not the app: it is cached only once a voice is installed', async () => {
    await file('index.html', 100);
    await file('assets/index-abc.js', 2000);
    await file('assets/worker-Bx9_a-1.js', 500_000);

    const { total, files, voice } = await measure(dist);

    expect(total).toBe(2100);
    expect(files.map((f) => f.path)).toEqual(['assets/index-abc.js', 'index.html']);
    expect(voice).toEqual({
      total: 500_000,
      files: [{ path: 'assets/worker-Bx9_a-1.js', bytes: 500_000 }],
    });
  });
});

describe('checkAppSize', () => {
  it('passes at exactly 1.5 MB', async () => {
    await file('assets/index.js', LIMIT_BYTES);
    expect(LIMIT_BYTES).toBe(1_572_864);
    expect(await checkAppSize(dist, quiet)).toBe(0);
  });

  it('fails one byte over 1.5 MB and says by how much', async () => {
    await file('assets/index.js', LIMIT_BYTES + 1);
    const lines = [];
    expect(await checkAppSize(dist, (line) => lines.push(line))).toBe(1);
    expect(lines.join('\n')).toMatch(/over the 1572864 byte budget by 1 byte/);
  });

  it('fails when there is no build to measure', async () => {
    const lines = [];
    expect(await checkAppSize(path.join(dist, 'missing'), (line) => lines.push(line))).toBe(1);
    expect(lines.join('\n')).toMatch(/pnpm build/);
  });

  it('says the size of the speech worker apart', async () => {
    await file('assets/index.js', 1000);
    await file('assets/worker-x.js', 400_000);
    const lines = [];
    expect(await checkAppSize(dist, (line) => lines.push(line))).toBe(0);
    expect(lines.join('\n')).toMatch(/Voice: 400000 bytes .* speech worker/);
  });

  it('fails when the build holds no app file at all', async () => {
    await file('pack/manifest.json', 10);
    expect(await checkAppSize(dist, quiet)).toBe(1);
  });
});
