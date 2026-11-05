// SPDX-License-Identifier: MIT
// Key files are only ever written to temporary directories outside the
// repository; the paths inside it are refused before anything is written.
import { realpathSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSigningKey, readKeyFile, repositoryOf, writeKeyFile } from '../src/index.js';
import { REPO_ROOT } from './helpers.js';

const made: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'siapso-keygen-'));
  made.push(dir);
  return dir;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const links: string[] = [];

afterEach(async () => {
  // Links first, one by one and never recursively: a recursive removal must
  // never reach the repository through a link.
  for (const link of links.splice(0)) {
    await unlink(link).catch(() => rmdir(link));
  }
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The repository root with its links resolved, as repositoryOf names it. */
const REAL_ROOT = realpathSync.native(REPO_ROOT);

/**
 * A link at `<temp>/<name>` to `target`: a junction on Windows (no
 * administrator right needed), a directory symlink elsewhere.
 */
async function linkTo(target: string, name = 'link'): Promise<string> {
  const link = path.join(await tempDir(), name);
  await symlink(target, link, 'junction');
  links.push(link);
  return link;
}

describe('repositoryOf', () => {
  it('finds the repository root itself and any path under it', () => {
    expect(repositoryOf(REPO_ROOT, REPO_ROOT)).toBe(REAL_ROOT);
    expect(repositoryOf(path.join(REPO_ROOT, 'app', 'release.json'), REPO_ROOT)).toBe(REAL_ROOT);
  });

  it('finds any git work tree above the path, whatever the root', async () => {
    const outside = await tempDir();
    const other = path.join(outside, 'other-repo');
    await mkdir(path.join(other, '.git'), { recursive: true });
    await mkdir(path.join(other, 'deep'));

    expect(repositoryOf(path.join(other, 'deep', 'key.json'), REPO_ROOT)).toBe(
      realpathSync.native(other),
    );
  });

  it('finds nothing for a folder outside every repository', async () => {
    const outside = await tempDir();

    expect(repositoryOf(path.join(outside, 'key.json'), REPO_ROOT)).toBeNull();
  });

  it('follows a link (a junction on Windows) into the repository', async () => {
    const link = await linkTo(path.join(REPO_ROOT, 'app'));

    expect(repositoryOf(path.join(link, 'key.json'), REPO_ROOT)).toBe(REAL_ROOT);
  });

  it('follows a link to the repository root given as the root', async () => {
    const outside = await tempDir();
    const linkedRoot = await linkTo(outside, 'linked-root');

    expect(repositoryOf(path.join(outside, 'key.json'), linkedRoot)).toBe(
      realpathSync.native(outside),
    );
  });

  it('refuses a folder that does not exist', async () => {
    const outside = await tempDir();

    expect(() => repositoryOf(path.join(outside, 'missing', 'key.json'), REPO_ROOT)).toThrow(
      /folder .*missing.* does not exist/,
    );
  });
});

describe('writeKeyFile', () => {
  it('writes the key pair outside the repository and returns the public entry', async () => {
    const file = path.join(await tempDir(), 'siapso-pack-key.json');

    const entry = await writeKeyFile(file, REPO_ROOT, 'test-1');

    const key = parseSigningKey(await readFile(file, 'utf8'));
    expect(entry).toEqual({
      keyId: 'test-1',
      publicKey: Buffer.from(key.publicKey).toString('base64'),
    });
    expect((await readKeyFile(file, REPO_ROOT)).keyId).toBe('test-1');
  });

  it.skipIf(process.platform === 'win32')('makes the file readable by its owner only', async () => {
    const file = path.join(await tempDir(), 'key.json');

    await writeKeyFile(file, REPO_ROOT);

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('refuses a path inside the repository and writes nothing', async () => {
    const file = path.join(REPO_ROOT, 'never-written-key.json');

    await expect(writeKeyFile(file, REPO_ROOT)).rejects.toThrow(/inside the repository/);
    expect(await exists(file)).toBe(false);
  });

  it('refuses a path inside another git work tree', async () => {
    const other = path.join(await tempDir(), 'repo');
    await mkdir(path.join(other, '.git'), { recursive: true });
    const file = path.join(other, 'key.json');

    await expect(writeKeyFile(file, REPO_ROOT)).rejects.toThrow(/inside the repository/);
    expect(await exists(file)).toBe(false);
  });

  it('never overwrites an existing file', async () => {
    const file = path.join(await tempDir(), 'key.json');
    await writeFile(file, 'keep me\n');

    await expect(writeKeyFile(file, REPO_ROOT)).rejects.toThrow(/already exists/);
    expect(await readFile(file, 'utf8')).toBe('keep me\n');
  });

  it('refuses a path that reaches the repository through a link (a junction on Windows)', async () => {
    const link = await linkTo(path.join(REPO_ROOT, 'app'));
    const file = path.join(link, 'never-written-key.json');

    await expect(writeKeyFile(file, REPO_ROOT)).rejects.toThrow(/inside the repository/);
    expect(await exists(path.join(REPO_ROOT, 'app', 'never-written-key.json'))).toBe(false);
  });

  it('refuses a folder that does not exist, and writes nothing', async () => {
    const file = path.join(await tempDir(), 'missing', 'key.json');

    await expect(writeKeyFile(file, REPO_ROOT)).rejects.toThrow(/does not exist/);
    expect(await exists(file)).toBe(false);
  });
});

describe('readKeyFile', () => {
  it('refuses to read a key file inside the repository', async () => {
    await expect(readKeyFile(path.join(REPO_ROOT, 'some-key.json'), REPO_ROOT)).rejects.toThrow(
      /inside the repository/,
    );
  });

  it('refuses a key file that is itself a link to a file inside the repository', async (ctx) => {
    const link = path.join(await tempDir(), 'key.json');
    try {
      // A file link: Windows only allows it with developer mode or as administrator.
      await symlink(path.join(REPO_ROOT, 'package.json'), link, 'file');
    } catch {
      ctx.skip();
      return;
    }
    links.push(link);

    await expect(readKeyFile(link, REPO_ROOT)).rejects.toThrow(/inside the repository/);
  });

  it('refuses one reached through a link into the repository', async () => {
    const link = await linkTo(path.join(REPO_ROOT, 'app'));

    await expect(readKeyFile(path.join(link, 'some-key.json'), REPO_ROOT)).rejects.toThrow(
      /inside the repository/,
    );
  });
});
