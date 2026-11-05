// SPDX-License-Identifier: MIT
// Every key here is generated at test time and lives only in memory or in a
// temporary directory: no key is ever written inside the repository.
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPack,
  generateSigningKey,
  keyFileOf,
  keyIdOf,
  parseSigningKey,
  publicEntryOf,
  SIGNATURE_FILE,
  signManifest,
  signPack,
  verifyManifest,
  writePack,
  type Manifest,
} from '../src/index.js';
import { loadValid } from './helpers.js';

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A pack built from the valid fixtures into <temp>/pack, as `siapso-pack build` writes it. */
async function builtPack(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'siapso-sign-'));
  made.push(root);
  const dir = path.join(root, 'pack');
  await writePack(buildPack(await loadValid()), dir);
  return dir;
}

async function manifestOf(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

describe('generateSigningKey', () => {
  it('makes a 32-byte Ed25519 key pair named after its public key by default', () => {
    const key = generateSigningKey();

    expect(key.privateKey).toHaveLength(32);
    expect(key.publicKey).toHaveLength(32);
    expect(key.keyId).toBe(keyIdOf(key.publicKey));
    expect(key.keyId).toMatch(/^ed25519-[0-9a-f]{16}$/);
    expect(generateSigningKey().keyId).not.toBe(key.keyId);
  });

  it('keeps the key id it is given, and refuses one the manifest could not carry plainly', () => {
    expect(generateSigningKey('siapso-2026-11').keyId).toBe('siapso-2026-11');
    expect(() => generateSigningKey('')).toThrow(/key id/);
    expect(() => generateSigningKey('has space')).toThrow(/key id/);
    expect(() => generateSigningKey('x'.repeat(65))).toThrow(/key id/);
  });
});

describe('the key file', () => {
  it('reads back the key it was written from', () => {
    const key = generateSigningKey('team-1');
    const text = JSON.stringify(keyFileOf(key));

    const read = parseSigningKey(text);

    expect(read.keyId).toBe('team-1');
    expect(read.privateKey).toEqual(key.privateKey);
    expect(read.publicKey).toEqual(key.publicKey);
    expect(keyFileOf(key)).toMatchObject({ keyId: 'team-1', algorithm: 'Ed25519' });
  });

  it('gives the public entry for app/src/config/pack-keys.ts, and nothing private', () => {
    const key = generateSigningKey('team-1');

    const entry = publicEntryOf(key);

    expect(entry).toEqual({
      keyId: 'team-1',
      publicKey: Buffer.from(key.publicKey).toString('base64'),
    });
    expect(JSON.stringify(entry)).not.toContain(Buffer.from(key.privateKey).toString('base64'));
  });

  it('refuses a broken key file without ever printing what it holds', () => {
    const file = keyFileOf(generateSigningKey('team-1'));
    const other = keyFileOf(generateSigningKey('team-2'));
    const broken = [
      'not json',
      JSON.stringify({ ...file, algorithm: 'RSA' }),
      JSON.stringify({ ...file, privateKey: 'AAAA' }),
      JSON.stringify({ ...file, privateKey: '!!!' }),
      JSON.stringify({ ...file, publicKey: other.publicKey }),
      JSON.stringify({ ...file, keyId: 'has space' }),
      JSON.stringify([file]),
    ];

    for (const text of broken) {
      let message = '';
      try {
        parseSigningKey(text);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, text).toMatch(/key/);
      expect(message).not.toContain(file.privateKey);
    }
  });
});

describe('signManifest and verifyManifest', () => {
  const bytes = new TextEncoder().encode('{"schema":1}\n');

  it('verify a signature with the public key of the signing key', () => {
    const key = generateSigningKey();
    const signature = signManifest(bytes, key);

    expect(Buffer.from(signature, 'base64')).toHaveLength(64);
    expect(verifyManifest(bytes, signature, publicEntryOf(key).publicKey)).toBe(true);
  });

  it('refuse other bytes, another key and a broken signature', () => {
    const key = generateSigningKey();
    const signature = signManifest(bytes, key);
    const changed = new TextEncoder().encode('{"schema":2}\n');

    expect(verifyManifest(changed, signature, publicEntryOf(key).publicKey)).toBe(false);
    expect(verifyManifest(bytes, signature, publicEntryOf(generateSigningKey()).publicKey)).toBe(
      false,
    );
    expect(verifyManifest(bytes, 'AAAA', publicEntryOf(key).publicKey)).toBe(false);
    expect(verifyManifest(bytes, signature, 'AAAA')).toBe(false);
  });
});

describe('signPack', () => {
  it('adds the key id to manifest.json and signs its exact bytes in manifest.sig', async () => {
    const dir = await builtPack();
    const before = await manifestOf(dir);
    const key = generateSigningKey('team-1');

    const signed = await signPack(dir, key);

    expect(signed).toEqual({ ...before, keyId: 'team-1' });
    const text = await readFile(path.join(dir, 'manifest.json'), 'utf8');
    expect(text).toBe(`${JSON.stringify(signed, null, 2)}\n`);
    const signature = (await readFile(path.join(dir, SIGNATURE_FILE), 'utf8')).trim();
    const bytes = await readFile(path.join(dir, 'manifest.json'));
    expect(verifyManifest(new Uint8Array(bytes), signature, publicEntryOf(key).publicKey)).toBe(
      true,
    );
  });

  it('gives the same bytes when signed again with the same key (Ed25519 is deterministic)', async () => {
    const dir = await builtPack();
    const key = generateSigningKey();
    await signPack(dir, key);
    const first = await readFile(path.join(dir, SIGNATURE_FILE), 'utf8');

    await signPack(dir, key);

    expect(await readFile(path.join(dir, SIGNATURE_FILE), 'utf8')).toBe(first);
  });

  it('replaces the key id and the signature when signed with a new key (rotation)', async () => {
    const dir = await builtPack();
    await signPack(dir, generateSigningKey('old'));
    const next = generateSigningKey('new');

    await signPack(dir, next);

    expect((await manifestOf(dir)).keyId).toBe('new');
    const signature = (await readFile(path.join(dir, SIGNATURE_FILE), 'utf8')).trim();
    const bytes = new Uint8Array(await readFile(path.join(dir, 'manifest.json')));
    expect(verifyManifest(bytes, signature, publicEntryOf(next).publicKey)).toBe(true);
  });

  it('leaves the signature invalid when manifest.json is changed after signing', async () => {
    const dir = await builtPack();
    const key = generateSigningKey();
    await signPack(dir, key);
    const file = path.join(dir, 'manifest.json');
    await writeFile(file, (await readFile(file, 'utf8')).replace('"0.0.1"', '"9.9.9"'));

    const signature = (await readFile(path.join(dir, SIGNATURE_FILE), 'utf8')).trim();
    const bytes = new Uint8Array(await readFile(file));
    expect(verifyManifest(bytes, signature, publicEntryOf(key).publicKey)).toBe(false);
  });

  it('refuses to sign a manifest whose fragments differ from the files, and writes nothing', async () => {
    const dir = await builtPack();
    const before = await readFile(path.join(dir, 'manifest.json'), 'utf8');
    const rules = path.join(dir, 'rules.json');
    await writeFile(rules, (await readFile(rules, 'utf8')).replace(/\n$/, ' \n'));

    await expect(signPack(dir, generateSigningKey())).rejects.toThrow(
      /rules\.json does not match manifest\.json/,
    );
    expect(await readFile(path.join(dir, 'manifest.json'), 'utf8')).toBe(before);
    expect(await exists(path.join(dir, SIGNATURE_FILE))).toBe(false);
  });

  it('refuses a manifest that lists a file outside the pack directory', async () => {
    const dir = await builtPack();
    const manifest = await manifestOf(dir);
    const first = manifest.fragments[0];
    if (first) first.path = '../outside.json';
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));

    await expect(signPack(dir, generateSigningKey())).rejects.toThrow(/outside\.json/);
  });

  it('refuses a directory without a manifest', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'siapso-sign-empty-'));
    made.push(dir);

    await expect(signPack(dir, generateSigningKey())).rejects.toThrow(/manifest\.json/);
  });
});
