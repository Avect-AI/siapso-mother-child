// SPDX-License-Identifier: MIT
// knowledge/pack.yaml may name the lowest version that is still safe to use
// (minimum-safe-version): it goes into the signed manifest, so the app can
// refuse a rollback to a withdrawn pack.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import {
  buildPack,
  compareVersions,
  generateSigningKey,
  packYamlAt,
  publicEntryOf,
  safeVersionHistoryProblems,
  signPack,
  verifyManifest,
  writePack,
  type Manifest,
} from '../src/index.js';
import { loadValid, REPO_ROOT, tempCopy } from './helpers.js';

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function run(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, {
    cwd: REPO_ROOT,
    env: {},
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

/** A copy of the valid fixtures whose pack.yaml has `extra` lines. */
async function contentWith(extra: string): Promise<{ root: string; remove: () => Promise<void> }> {
  const copy = await tempCopy();
  const file = path.join(copy.root, 'knowledge', 'pack.yaml');
  await writeFile(file, `${await readFile(file, 'utf8')}${extra}\n`);
  return copy;
}

async function manifestIn(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
}

describe('compareVersions', () => {
  it('follows semantic version order', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(() => compareVersions('1.2', '1.2.0')).toThrow(/version/);
  });
});

describe('minimum-safe-version in knowledge/pack.yaml', () => {
  it('is optional: without it the manifest has no minimumSafeVersion', async () => {
    const copy = await contentWith('');
    try {
      const out = path.join(copy.root, 'pack');
      const result = await run([
        'build',
        '--root',
        copy.root,
        '--schemas',
        REPO_ROOT,
        '--out',
        out,
      ]);

      expect(result.code).toBe(0);
      expect(await manifestIn(out)).not.toHaveProperty('minimumSafeVersion');
    } finally {
      await copy.remove();
    }
  });

  it('goes into the manifest when set, and is covered by the signature', async () => {
    const copy = await contentWith('minimum-safe-version: 0.0.1');
    try {
      const out = path.join(copy.root, 'pack');
      const built = await run(['build', '--root', copy.root, '--schemas', REPO_ROOT, '--out', out]);
      expect(built.err).toEqual([]);
      expect((await manifestIn(out)).minimumSafeVersion).toBe('0.0.1');

      const key = generateSigningKey('team-1');
      await signPack(out, key);
      const file = path.join(out, 'manifest.json');
      const signature = (await readFile(path.join(out, 'manifest.sig'), 'utf8')).trim();
      const changed = (await readFile(file, 'utf8')).replace(
        '"minimumSafeVersion": "0.0.1"',
        '"minimumSafeVersion": "0.0.0"',
      );
      expect(
        verifyManifest(new TextEncoder().encode(changed), signature, publicEntryOf(key).publicKey),
      ).toBe(false);
    } finally {
      await copy.remove();
    }
  });

  it('may not be above the version of the pack', async () => {
    const copy = await contentWith('minimum-safe-version: 0.0.2');
    try {
      const result = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);

      expect(result.code).toBe(1);
      expect(result.err).toContain(
        'knowledge/pack.yaml: minimum-safe-version: must not be above the version of the pack (0.0.1)',
      );
    } finally {
      await copy.remove();
    }
  });

  it('must be a semantic version', async () => {
    const copy = await contentWith('minimum-safe-version: latest');
    try {
      const result = await run(['check', '--root', copy.root, '--schemas', REPO_ROOT]);

      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/knowledge\/pack\.yaml: minimum-safe-version/);
    } finally {
      await copy.remove();
    }
  });
});

describe('writePack with a minimum safe version', () => {
  async function outDir(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'siapso-msv-'));
    made.push(root);
    return path.join(root, 'pack');
  }

  it('writes it after the clinical validation', async () => {
    const pack = buildPack(await loadValid());
    const dir = await outDir();

    const manifest = await writePack(pack, dir, { minimumSafeVersion: '0.0.1' });

    expect(Object.keys(manifest).slice(0, 5)).toEqual([
      'schema',
      'version',
      'date',
      'clinicallyValidated',
      'minimumSafeVersion',
    ]);
  });

  it('refuses one above the version of the pack, and writes nothing', async () => {
    const pack = buildPack(await loadValid());
    const dir = await outDir();

    await expect(writePack(pack, dir, { minimumSafeVersion: '9.0.0' })).rejects.toThrow(
      /minimum safe version 9\.0\.0 is above the version of the pack 0\.0\.1/,
    );
  });
});

describe('the minimum safe version never decreases nor disappears (compared with origin/main)', () => {
  it('passes when nothing was set before, when it is kept, and when it goes up', () => {
    expect(safeVersionHistoryProblems(undefined, undefined, 'origin/main')).toEqual([]);
    expect(safeVersionHistoryProblems('0.0.1', undefined, 'origin/main')).toEqual([]);
    expect(safeVersionHistoryProblems('0.0.1', '0.0.1', 'origin/main')).toEqual([]);
    expect(safeVersionHistoryProblems('0.0.2', '0.0.1', 'origin/main')).toEqual([]);
  });

  it('fails when it goes down or is removed', () => {
    expect(safeVersionHistoryProblems('0.0.0', '0.0.1', 'origin/main')).toEqual([
      {
        file: 'knowledge/pack.yaml',
        path: 'minimum-safe-version',
        message: 'must not go below 0.0.1, its value on origin/main: it never decreases',
      },
    ]);
    expect(safeVersionHistoryProblems(undefined, '0.0.1', 'origin/main')).toEqual([
      {
        file: 'knowledge/pack.yaml',
        path: 'minimum-safe-version',
        message: 'must not be removed: it is 0.0.1 on origin/main',
      },
    ]);
  });

  it('reads knowledge/pack.yaml at a git revision, and gives null where there is none', async () => {
    expect(packYamlAt(REPO_ROOT, 'HEAD')).toMatch(/^version: /m);
    const outside = await mkdtemp(path.join(tmpdir(), 'siapso-no-git-'));
    made.push(outside);
    expect(packYamlAt(outside, 'HEAD')).toBeNull();
    expect(packYamlAt(REPO_ROOT, 'no-such-ref-for-siapso')).toBeNull();
  });

  /** siapso-pack check on a copy whose pack.yaml has `extra`, the base pack.yaml being `base`. */
  async function checkAgainst(extra: string, base: string | null, args: string[] = []) {
    const copy = await contentWith(extra);
    const refs: string[] = [];
    try {
      const out: string[] = [];
      const err: string[] = [];
      const code = await main(['check', '--root', copy.root, '--schemas', REPO_ROOT, ...args], {
        cwd: REPO_ROOT,
        env: {},
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        readBasePackYaml: (_root, ref) => {
          refs.push(ref);
          return base;
        },
      });
      return { code, out, err, refs };
    } finally {
      await copy.remove();
    }
  }

  const baseWith = (extra: string) =>
    `version: 0.0.1\ndate: 2026-11-04\nclinically-validated: false\n${extra}\n`;

  it('is checked by siapso-pack check against origin/main', async () => {
    const kept = await checkAgainst(
      'minimum-safe-version: 0.0.1',
      baseWith('minimum-safe-version: 0.0.1'),
    );
    expect(kept.err).toEqual([]);
    expect(kept.code).toBe(0);
    expect(kept.refs).toEqual(['origin/main']);

    const removed = await checkAgainst('', baseWith('minimum-safe-version: 0.0.1'));
    expect(removed.code).toBe(1);
    expect(removed.err).toContain(
      'knowledge/pack.yaml: minimum-safe-version: must not be removed: it is 0.0.1 on origin/main',
    );

    const lowered = await checkAgainst(
      'minimum-safe-version: 0.0.0',
      baseWith('minimum-safe-version: 0.0.1'),
    );
    expect(lowered.code).toBe(1);
    expect(lowered.err.join('\n')).toMatch(/must not go below 0\.0\.1/);
  });

  it('is skipped when origin/main has no value or cannot be read', async () => {
    expect((await checkAgainst('', baseWith(''))).code).toBe(0);
    expect((await checkAgainst('', null)).code).toBe(0);
  });

  it('compares with another revision given by --base', async () => {
    const result = await checkAgainst('', baseWith(''), ['--base', 'release/1.0']);

    expect(result.refs).toEqual(['release/1.0']);
  });
});
