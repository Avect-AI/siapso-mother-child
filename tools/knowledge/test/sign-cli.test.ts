// SPDX-License-Identifier: MIT
// siapso-pack keygen and sign. Every key is generated at test time into a
// temporary directory outside the repository.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import {
  buildPack,
  keyFileOf,
  generateSigningKey,
  publicEntryOf,
  SIGNATURE_FILE,
  verifyManifest,
  writePack,
} from '../src/index.js';
import { loadValid, REPO_ROOT, tempCopy } from './helpers.js';

interface Result {
  code: number;
  out: string[];
  err: string[];
}

async function run(
  args: string[],
  env: Record<string, string | undefined> = {},
  cwd = REPO_ROOT,
): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, {
    cwd,
    env,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

const made: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'siapso-sign-cli-'));
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

/** A built pack in <temp>/pack. */
async function builtPack(): Promise<string> {
  const dir = path.join(await tempDir(), 'pack');
  await writePack(buildPack(await loadValid()), dir);
  return dir;
}

async function signatureVerifies(dir: string, publicKey: string): Promise<boolean> {
  const bytes = new Uint8Array(await readFile(path.join(dir, 'manifest.json')));
  const signature = (await readFile(path.join(dir, SIGNATURE_FILE), 'utf8')).trim();
  return verifyManifest(bytes, signature, publicKey);
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('siapso-pack keygen', () => {
  it('writes the key file and prints the public entry for pack-keys.ts', async () => {
    const file = path.join(await tempDir(), 'release.json');

    const result = await run(['keygen', '--out', file, '--key-id', 'test-2026']);

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    const key = JSON.parse(await readFile(file, 'utf8')) as { publicKey: string };
    const output = result.out.join('\n');
    expect(output).toContain(`{ keyId: 'test-2026', publicKey: '${key.publicKey}' },`);
    expect(output).toMatch(/app\/src\/config\/pack-keys\.ts/);
    expect(output).toMatch(/never in a repository/);
  });

  it('refuses a path inside the repository, writes nothing and exits 1', async () => {
    const file = path.join(REPO_ROOT, 'app', 'never-written-key.json');

    const result = await run(['keygen', '--out', file]);

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/inside the repository/);
    expect(await exists(file)).toBe(false);
  });

  it('needs --out', async () => {
    const result = await run(['keygen']);

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/keygen needs --out/);
  });

  it('refuses an option of another command', async () => {
    const result = await run([
      'keygen',
      '--out',
      path.join(await tempDir(), 'k.json'),
      '--key',
      'x',
    ]);

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toMatch(/unknown option "--key"/);
  });
});

/** A root whose app/src/config/pack-keys.ts lists `entries`, as the team writes it. */
async function rootListing(entries: { keyId: string; publicKey: string }[]): Promise<string> {
  const root = await tempDir();
  await mkdir(path.join(root, 'app', 'src', 'config'), { recursive: true });
  const lines = entries.map((e) => `  { keyId: '${e.keyId}', publicKey: '${e.publicKey}' },`);
  await writeFile(
    path.join(root, 'app', 'src', 'config', 'pack-keys.ts'),
    [
      'export interface PackPublicKey {',
      '  readonly keyId: string;',
      '  readonly publicKey: string;',
      '}',
      '',
      'export const PACK_PUBLIC_KEYS: readonly PackPublicKey[] = [',
      ...lines,
      '];',
      '',
    ].join('\n'),
  );
  return root;
}

describe('siapso-pack sign', () => {
  it('signs the pack with the key file given by --key', async () => {
    const dir = await builtPack();
    const file = path.join(await tempDir(), 'key.json');
    const keygen = await run(['keygen', '--out', file, '--key-id', 'file-key']);
    expect(keygen.code).toBe(0);
    const publicKey = (JSON.parse(await readFile(file, 'utf8')) as { publicKey: string }).publicKey;
    const root = await rootListing([{ keyId: 'file-key', publicKey }]);

    const result = await run(['sign', '--root', root, '--out', dir, '--key', file]);

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toMatch(/signed: pack 0\.0\.1 with key file-key/);
    expect(await signatureVerifies(dir, publicKey)).toBe(true);
  });

  it('signs with the key held by PACK_SIGNING_KEY (the CI secret)', async () => {
    const dir = await builtPack();
    const key = generateSigningKey('ci-key');
    const root = await rootListing([publicEntryOf(key)]);

    const result = await run(['sign', '--root', root, '--out', dir], {
      PACK_SIGNING_KEY: JSON.stringify(keyFileOf(key)),
    });

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(await signatureVerifies(dir, publicEntryOf(key).publicKey)).toBe(true);
  });

  it('warns when the key id is not listed in app/src/config/pack-keys.ts, and still signs', async () => {
    const dir = await builtPack();
    const key = generateSigningKey('not-listed');

    const result = await run(['sign', '--out', dir], {
      PACK_SIGNING_KEY: JSON.stringify(keyFileOf(key)),
    });

    expect(result.code).toBe(0);
    expect(result.err.join('\n')).toMatch(
      /warning: key "not-listed" is not listed in app\/src\/config\/pack-keys\.ts.*refuse/,
    );
    expect(await signatureVerifies(dir, publicEntryOf(key).publicKey)).toBe(true);
  });

  it('warns when pack-keys.ts lists the key id with another public key', async () => {
    const dir = await builtPack();
    const key = generateSigningKey('team-1');
    const root = await rootListing([
      { keyId: 'team-1', publicKey: publicEntryOf(generateSigningKey()).publicKey },
    ]);

    const result = await run(['sign', '--root', root, '--out', dir], {
      PACK_SIGNING_KEY: JSON.stringify(keyFileOf(key)),
    });

    expect(result.code).toBe(0);
    expect(result.err.join('\n')).toMatch(/warning: key "team-1" is listed .* another public key/);
  });

  it('warns when pack-keys.ts cannot be found under the root', async () => {
    const dir = await builtPack();
    const key = generateSigningKey('team-1');

    const result = await run(['sign', '--root', await tempDir(), '--out', dir], {
      PACK_SIGNING_KEY: JSON.stringify(keyFileOf(key)),
    });

    expect(result.code).toBe(0);
    expect(result.err.join('\n')).toMatch(/warning: .*pack-keys\.ts.* cannot be read/);
  });

  it('exits 1 without a key, and leaves the pack unsigned', async () => {
    const dir = await builtPack();

    const result = await run(['sign', '--out', dir], { PACK_SIGNING_KEY: '' });

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/--key <file> or the PACK_SIGNING_KEY/);
    expect(await exists(path.join(dir, SIGNATURE_FILE))).toBe(false);
  });

  it('refuses a key file inside the repository before reading it', async () => {
    const dir = await builtPack();

    const result = await run(['sign', '--out', dir, '--key', path.join(REPO_ROOT, 'key.json')]);

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toMatch(/inside the repository/);
  });

  it('never prints the private key of a broken key', async () => {
    const dir = await builtPack();
    const file = keyFileOf(generateSigningKey('broken'));
    const secret = file.privateKey;

    const result = await run(['sign', '--out', dir], {
      PACK_SIGNING_KEY: JSON.stringify({
        ...file,
        publicKey: publicEntryOf(generateSigningKey()).publicKey,
      }),
    });

    expect(result.code).toBe(1);
    expect([...result.out, ...result.err].join('\n')).not.toContain(secret);
  });
});

describe('siapso-pack build stays unsigned', () => {
  it('writes no manifest.sig and no keyId, even when PACK_SIGNING_KEY is set', async () => {
    const copy = await tempCopy();
    try {
      const out = path.join(copy.root, 'pack');
      const key = generateSigningKey();

      const result = await run(
        ['build', '--root', copy.root, '--schemas', REPO_ROOT, '--out', out],
        { PACK_SIGNING_KEY: JSON.stringify(keyFileOf(key)) },
      );

      expect(result.code).toBe(0);
      expect(await readdir(out)).not.toContain(SIGNATURE_FILE);
      const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8')) as {
        keyId?: string;
      };
      expect(manifest.keyId).toBeUndefined();
    } finally {
      await copy.remove();
    }
  });

  it('removes the signature of the previous build, which no longer matches', async () => {
    const copy = await tempCopy();
    try {
      const out = path.join(copy.root, 'pack');
      const args = ['build', '--root', copy.root, '--schemas', REPO_ROOT, '--out', out];
      expect((await run(args)).code).toBe(0);
      const key = generateSigningKey();
      expect(
        (await run(['sign', '--out', out], { PACK_SIGNING_KEY: JSON.stringify(keyFileOf(key)) }))
          .code,
      ).toBe(0);

      expect((await run(args)).code).toBe(0);

      expect(await readdir(out)).not.toContain(SIGNATURE_FILE);
    } finally {
      await copy.remove();
    }
  });
});
