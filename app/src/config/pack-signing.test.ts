// SPDX-License-Identifier: MIT
// @vitest-environment node
// Keys are generated at test time; packs are built and signed in temporary
// directories, never in the repository.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUILTIN_MESSAGES, type Message, type Pack } from '@siapso/engine';
import {
  generateSigningKey,
  publicEntryOf,
  signPack,
  writePack,
  type SigningKey,
} from '@siapso/pack-tools';
import { afterEach, describe, expect, it, vi } from 'vitest';
import config, {
  buildInfo,
  bundledPack,
  checkPackSigning,
  demoOutDirProblem,
} from '../../vite.config.js';
import { PACK_PUBLIC_KEYS, type PackPublicKey } from './pack-keys.js';
import {
  allowsUnsignedPack,
  base64Bytes,
  packKeyProblems,
  signingBuildError,
  unsignedPackAllowed,
} from './pack-signing.js';

const message: Message = { fact: 'Fact.', risk: 'Risk.' };
const builtins = Object.fromEntries(Object.values(BUILTIN_MESSAGES).map((id) => [id, message]));
const PACK: Pack = {
  schema: 1,
  version: '0.1.0',
  date: '2026-11-05',
  clinicallyValidated: false,
  substances: [],
  classes: [],
  products: [],
  plants: [],
  rules: [],
  dangerSigns: [],
  sources: [],
  messages: { fr: builtins, en: builtins },
};

const key = publicEntryOf(generateSigningKey('team-1'));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('allowsUnsignedPack', () => {
  it('is true only for the exact value "true"', () => {
    expect(allowsUnsignedPack('true')).toBe(true);
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes', ' true']) {
      expect(allowsUnsignedPack(value), String(value)).toBe(false);
    }
  });
});

describe('base64Bytes', () => {
  it('decodes base64, and gives null for anything else', () => {
    expect(base64Bytes('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    expect(base64Bytes('AQID\n')).toEqual(new Uint8Array([1, 2, 3]));
    expect(base64Bytes('not base64!')).toBeNull();
  });
});

describe('packKeyProblems', () => {
  it('accepts well-formed keys', () => {
    expect(packKeyProblems([key, publicEntryOf(generateSigningKey('team-2'))])).toEqual([]);
  });

  it('names a key that is not 32 bytes of base64, a bad key id and a repeated key id', () => {
    const problems = packKeyProblems([
      key,
      { keyId: 'team-1', publicKey: key.publicKey },
      { keyId: 'short', publicKey: 'AAAA' },
      { keyId: 'not-base64', publicKey: '!!!' },
      { keyId: 'has space', publicKey: key.publicKey },
    ]);

    expect(problems).toEqual([
      expect.stringMatching(/"team-1".*more than once/),
      expect.stringMatching(/"short".*32 bytes/),
      expect.stringMatching(/"not-base64".*32 bytes/),
      expect.stringMatching(/"has space".*key id/),
    ]);
  });

  it('finds nothing wrong with the committed list', () => {
    expect(packKeyProblems(PACK_PUBLIC_KEYS)).toEqual([]);
  });
});

describe('signingBuildError', () => {
  it('refuses a build with no public key and no VITE_ALLOW_UNSIGNED_PACK=true: it would refuse every pack', () => {
    for (const flag of [undefined, '', 'false']) {
      const error = signingBuildError([], flag);
      expect(error, String(flag)).toMatch(/would refuse every knowledge pack/);
      expect(error).toMatch(/app\/src\/config\/pack-keys\.ts/);
      expect(error).toMatch(/pnpm build at the repository root/);
      expect(error).toMatch(/docs\/pack-signing\.md/);
    }
  });

  it('allows a test or demo build that accepts unsigned packs', () => {
    expect(signingBuildError([], 'true')).toBeNull();
  });

  it('allows a build with a public key, with or without the flag', () => {
    expect(signingBuildError([key], undefined)).toBeNull();
    expect(signingBuildError([key], 'true')).toBeNull();
  });

  it('refuses a malformed key list in every build', () => {
    expect(signingBuildError([{ keyId: 'short', publicKey: 'AAAA' }], 'true')).toMatch(
      /pack-keys\.ts.*"short"/,
    );
  });
});

describe('unsignedPackAllowed', () => {
  it('honours the flag only outside production mode', () => {
    expect(unsignedPackAllowed('demo', 'true')).toBe(true);
    expect(unsignedPackAllowed('development', 'true')).toBe(true);
    expect(unsignedPackAllowed('production', 'true')).toBe(false);
    expect(unsignedPackAllowed('demo', undefined)).toBe(false);
  });
});

/**
 * A pack built by the pack tools into <temp>/pack, with a minimum safe
 * version when given, signed with `signer` unless it is null.
 */
async function builtPack(signer: SigningKey | null, minimumSafeVersion?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'siapso-release-'));
  temps.push(root);
  const dir = path.join(root, 'pack');
  await writePack(PACK, dir, minimumSafeVersion === undefined ? {} : { minimumSafeVersion });
  if (signer !== null) await signPack(dir, signer);
  return dir;
}

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const team = generateSigningKey('team-1');
const listed = [publicEntryOf(team)];

function release(packDir: string, keys: readonly PackPublicKey[] = listed, flag?: string) {
  return checkPackSigning({
    command: 'build',
    mode: 'production',
    isPreview: false,
    flag,
    keys,
    packDir,
  });
}

describe('a production build (pnpm release:build)', () => {
  it('goes on when the pack it ships is signed by a listed key', async () => {
    await expect(release(await builtPack(team))).resolves.toBeUndefined();
  });

  it('fails when VITE_ALLOW_UNSIGNED_PACK is set: unsigned packs are for the demo build', async () => {
    await expect(release(await builtPack(team), listed, 'true')).rejects.toThrow(
      /VITE_ALLOW_UNSIGNED_PACK=true is not allowed in a production build.*pnpm build at the repository root/,
    );
  });

  it('fails when no public key is listed', async () => {
    await expect(release(await builtPack(team), [])).rejects.toThrow(
      /would refuse every knowledge pack/,
    );
  });

  it('fails when the pack it ships is not signed', async () => {
    await expect(release(await builtPack(null))).rejects.toThrow(
      /Release build refused: the pack in app\/public\/pack is not signed.*pnpm release:build --key/,
    );
  });

  it('fails when the pack is signed with a key the list does not hold', async () => {
    await expect(release(await builtPack(generateSigningKey('stranger')))).rejects.toThrow(
      /signed with key "stranger", which app\/src\/config\/pack-keys\.ts does not list/,
    );
  });

  it('fails when the signature does not match, with the same check as the app', async () => {
    const dir = await builtPack(team);
    const file = path.join(dir, 'manifest.json');
    await writeFile(file, (await readFile(file, 'utf8')).replace('"0.1.0"', '"0.1.1"'));

    await expect(release(dir)).rejects.toThrow(
      /Release build refused: the signature of the pack in app\/public\/pack does not hold.*does not match/,
    );
  });

  it('fails when manifest.sig is missing', async () => {
    const dir = await builtPack(team);
    await rm(path.join(dir, 'manifest.sig'));

    await expect(release(dir)).rejects.toThrow(/signature of the pack.*does not hold/);
  });

  it('fails when the pack was not built', async () => {
    await expect(release(path.join(tmpdir(), 'siapso-no-such-pack'))).rejects.toThrow(
      /manifest\.json is missing: run pnpm knowledge:build/,
    );
  });
});

describe('a demo build (pnpm build, Vite mode demo)', () => {
  it('accepts an unsigned pack with the flag, and says so loudly', async () => {
    const warn = vi.fn();

    await checkPackSigning({
      command: 'build',
      mode: 'demo',
      isPreview: false,
      flag: 'true',
      keys: [],
      packDir: await builtPack(null),
      warn,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/DEMO BUILD.*unsigned knowledge pack.*never publish/is),
    );
  });

  it('still fails without the flag and without a key', async () => {
    await expect(
      checkPackSigning({
        command: 'build',
        mode: 'demo',
        isPreview: false,
        flag: undefined,
        keys: [],
        packDir: await builtPack(null),
      }),
    ).rejects.toThrow(/would refuse every knowledge pack/);
  });
});

describe('the development server and the preview', () => {
  it('only warn on the development server, and say nothing on the preview of a build', async () => {
    const warn = vi.fn();
    const serve = {
      command: 'serve',
      mode: 'development',
      flag: undefined,
      keys: [],
      warn,
    } as const;

    await checkPackSigning({ ...serve, isPreview: false });
    await checkPackSigning({ ...serve, isPreview: true });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/VITE_ALLOW_UNSIGNED_PACK/));
  });
});

describe('a build that does not accept unsigned packs, whatever its mode', () => {
  const staging = async (packDir: string) =>
    checkPackSigning({
      command: 'build',
      mode: 'staging',
      isPreview: false,
      flag: undefined,
      keys: listed,
      packDir,
    });

  it('checks the pack it ships as a release does', async () => {
    await expect(staging(await builtPack(null))).rejects.toThrow(
      /Release build refused: the pack in app\/public\/pack is not signed/,
    );
    await expect(staging(await builtPack(team))).resolves.toBeUndefined();
  });
});

describe('bundledPack (what the build ships)', () => {
  it('names the version, the minimum safe version and the key of the built pack', async () => {
    expect(bundledPack(await builtPack(team, '0.0.9'))).toEqual({
      version: '0.1.0',
      minimumSafeVersion: '0.0.9',
      keyId: 'team-1',
    });
  });

  it('has no minimum safe version and no key for an unsigned pack that names none', async () => {
    expect(bundledPack(await builtPack(null))).toEqual({
      version: '0.1.0',
      minimumSafeVersion: null,
      keyId: null,
    });
  });

  it('is null when no pack was built', () => {
    expect(bundledPack(path.join(tmpdir(), 'siapso-no-such-pack'))).toBeNull();
  });

  it('refuses a version or a minimum safe version that is not semantic', async () => {
    const dir = await builtPack(null, '0.0.9');
    const file = path.join(dir, 'manifest.json');
    const text = await readFile(file, 'utf8');

    await writeFile(file, text.replace('"0.1.0"', '"latest"'));
    expect(() => bundledPack(dir)).toThrow(/version latest is not a semantic version/);

    await writeFile(file, text.replace('"0.0.9"', '"soon"'));
    expect(() => bundledPack(dir)).toThrow(/minimumSafeVersion soon is not a semantic version/);
  });
});

describe('the build marker (build-info.json)', () => {
  it('says the mode, whether unsigned packs are accepted and which pack ships, nothing secret', () => {
    const info = JSON.parse(
      buildInfo('demo', true, { version: '0.1.0', minimumSafeVersion: null, keyId: null }),
    ) as unknown;

    expect(info).toEqual({
      mode: 'demo',
      acceptsUnsignedPack: true,
      packVersion: '0.1.0',
      packMinimumSafeVersion: null,
      packKeyId: null,
    });
  });

  it('keeps a demo build out of app/dist, where a release goes', () => {
    const app = path.join(tmpdir(), 'app');

    expect(demoOutDirProblem(true, app, 'dist')).toMatch(/never goes to app\/dist.*dist-demo/);
    expect(demoOutDirProblem(true, app, path.join(app, 'dist'))).not.toBeNull();
    expect(demoOutDirProblem(true, app, 'dist-demo')).toBeNull();
    expect(demoOutDirProblem(false, app, 'dist')).toBeNull();
  });

  it('compares without case on Windows, where DIST is the same folder as dist', () => {
    const app = path.join(tmpdir(), 'app');

    expect(demoOutDirProblem(true, app, 'DIST', 'win32')).not.toBeNull();
    expect(demoOutDirProblem(true, app.toUpperCase(), 'Dist', 'win32')).not.toBeNull();
    // Elsewhere DIST is another folder.
    expect(demoOutDirProblem(true, app, 'DIST', 'linux')).toBeNull();
  });
});

describe('vite.config.ts', () => {
  const run = (mode: string) =>
    config({ command: 'build', mode, isSsrBuild: false, isPreview: false }) as Promise<{
      define?: Record<string, string>;
      build?: { outDir?: string };
      plugins?: unknown[];
    }>;

  it('refuses VITE_ALLOW_UNSIGNED_PACK in production mode, from the environment', async () => {
    vi.stubEnv('VITE_ALLOW_UNSIGNED_PACK', 'true');

    await expect(run('production')).rejects.toThrow(/not allowed in a production build/);
  });

  it('refuses a production build while pack-keys.ts lists no key', async () => {
    vi.stubEnv('VITE_ALLOW_UNSIGNED_PACK', '');
    if (PACK_PUBLIC_KEYS.length === 0) {
      await expect(run('production')).rejects.toThrow(/would refuse every knowledge pack/);
    }
  });

  it('makes a demo build from app/.env.demo into dist-demo, with the floor and the marker', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pack = bundledPack();

    if (pack === null) {
      await expect(run('demo')).rejects.toThrow(/manifest\.json is missing/);
    } else {
      const built = await run('demo');
      expect(built.define?.['__MIN_PACK_VERSION__']).toBe(JSON.stringify(pack.version));
      expect(built.define?.['__MIN_SAFE_PACK_VERSION__']).toBe(
        JSON.stringify(pack.minimumSafeVersion),
      );
      expect(built.build?.outDir).toBe('dist-demo');
      expect(built.plugins?.flat()).toContainEqual(
        expect.objectContaining({ name: 'siapso-build-info' }),
      );
    }
  });
});
