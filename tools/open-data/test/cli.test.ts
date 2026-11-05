// SPDX-License-Identifier: MIT
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { generateSampleEvents, renderJsonl } from '../src/index.js';
import { makeEvent, REPO_ROOT } from './helpers.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'siapso-open-data-'));
  temporary.push(dir);
  return dir;
}

async function run(args: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, {
    cwd,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

const BUILD = [
  'build',
  '--input',
  'open-data/test-data/events.sample.jsonl',
  '--week',
  '2026-W45',
  '--release',
  'r1',
  '--release-date',
  '2026-12-06',
  '--test',
];

describe('sample events', () => {
  it('are deterministic and carry the test label', () => {
    const first = renderJsonl(generateSampleEvents(), 'TEST DATA');
    expect(renderJsonl(generateSampleEvents(), 'TEST DATA')).toBe(first);
    expect(first.split('\n')[0]).toBe('# TEST DATA');
    expect(first).not.toContain('\r');
  });

  it('match the committed sample file', async () => {
    const committed = await readFile(
      path.join(REPO_ROOT, 'open-data/test-data/events.sample.jsonl'),
      'utf8',
    );
    expect(committed).toBe(
      renderJsonl(generateSampleEvents(), 'TEST DATA: synthetic events, not real people'),
    );
  });
});

describe('cli build', () => {
  it('rebuilds the committed CSV byte for byte from the committed events', async () => {
    const dir = await tempDir();
    const { code } = await run([...BUILD, '--out-dir', dir], REPO_ROOT);
    expect(code).toBe(0);
    expect(await readdir(dir)).toEqual(['2026-W45-r1-test.csv']);
    const committed = await readFile(
      path.join(REPO_ROOT, 'open-data/published/2026-W45-r1-test.csv'),
      'utf8',
    );
    expect(await readFile(path.join(dir, '2026-W45-r1-test.csv'), 'utf8')).toBe(committed);
  });

  it('refuses to publish before 28 days after the week ends', async () => {
    const dir = await tempDir();
    const early = BUILD.map((arg) => (arg === '2026-12-06' ? '2026-12-05' : arg));
    const { code, err } = await run([...early, '--out-dir', dir], REPO_ROOT);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/cannot be published before 2026-12-06/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses to build a week that already has a published file, even with another release id', async () => {
    const dir = await tempDir();
    expect((await run([...BUILD, '--out-dir', dir], REPO_ROOT)).code).toBe(0);
    const before = await readFile(path.join(dir, '2026-W45-r1-test.csv'), 'utf8');
    const again = await run([...BUILD, '--out-dir', dir], REPO_ROOT);
    expect(again.code).toBe(1);
    expect(again.err.join('\n')).toMatch(/already published/);
    const other = BUILD.map((arg) => (arg === 'r1' ? 'r2' : arg));
    expect((await run([...other, '--out-dir', dir], REPO_ROOT)).code).toBe(1);
    expect(await readdir(dir)).toEqual(['2026-W45-r1-test.csv']);
    expect(await readFile(path.join(dir, '2026-W45-r1-test.csv'), 'utf8')).toBe(before);
  });

  it('allows a replacement only after the file is withdrawn', async () => {
    const dir = await tempDir();
    await run([...BUILD, '--out-dir', dir], REPO_ROOT);
    await rm(path.join(dir, '2026-W45-r1-test.csv'));
    const other = BUILD.map((arg) => (arg === 'r1' ? 'r2' : arg));
    expect((await run([...other, '--out-dir', dir], REPO_ROOT)).code).toBe(0);
    expect(await readdir(dir)).toEqual(['2026-W45-r2-test.csv']);
  });

  it('drops events of other weeks', async () => {
    const dir = await tempDir();
    const late = Array.from({ length: 20 }, () => JSON.stringify(makeEvent({ week: '2026-W46' })));
    await writeFile(path.join(dir, 'late.jsonl'), `${late.join('\n')}\n`);
    const { code, out } = await run(
      [
        'build',
        '--input',
        'late.jsonl',
        '--week',
        '2026-W45',
        '--release',
        'r1',
        '--release-date',
        '2026-12-06',
        '--out-dir',
        'out',
      ],
      dir,
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/20 events of other weeks dropped/);
    const csv = await readFile(path.join(dir, 'out/2026-W45-r1.csv'), 'utf8');
    expect(csv).not.toContain('published');
    expect(csv).not.toMatch(/^#/);
  });

  it('names the file without -test for real data and refuses a test label there', async () => {
    const dir = await tempDir();
    const real = BUILD.filter((arg) => arg !== '--test');
    const { code, err } = await run(
      [...real, '--label', 'TEST DATA: x', '--out-dir', dir],
      REPO_ROOT,
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/needs --test/);
  });

  it('refuses a label with characters outside the allowlist', async () => {
    const dir = await tempDir();
    const label = `TEST DATA ${String.fromCharCode(0x2014)} x`;
    const { code } = await run([...BUILD, '--label', label, '--out-dir', dir], REPO_ROOT);
    expect(code).toBe(1);
  });

  it('fails with the line number when an event is not valid, and writes nothing', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'bad.jsonl'), '{"week":"2026-W45","region":"paris"}\n');
    const { code, err } = await run(
      [
        'build',
        '--input',
        'bad.jsonl',
        '--week',
        '2026-W45',
        '--release',
        'r1',
        '--release-date',
        '2026-12-06',
        '--out-dir',
        'out',
      ],
      dir,
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/line 1/);
    await expect(readdir(path.join(dir, 'out'))).rejects.toThrow();
  });

  it('prints usage for an unknown command', async () => {
    const { code, err } = await run(['frobnicate'], REPO_ROOT);
    expect(code).toBe(2);
    expect(err.join('\n')).toMatch(/Usage/);
  });

  it('requires its options', async () => {
    const { code } = await run(['build'], REPO_ROOT);
    expect(code).toBe(2);
  });
});
