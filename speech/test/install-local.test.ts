// SPDX-License-Identifier: MIT
// @vitest-environment node
// The licence texts and the manifest written by speech/scripts/install-local.mjs:
// ONNX Runtime's LICENSE and ThirdPartyNotices.txt are pinned at the commit the
// installed onnxruntime-web was built from, checked by size and SHA-256, and
// listed in voice-pack.json. No model is read and nothing is downloaded: the
// pack is a fixture in a temporary folder and the network a stub.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PINNED_TEXTS,
  checkOrtCommit,
  install,
  pinnedText,
  pinnedTexts,
} from '../scripts/install-local.mjs';
import type { PackDependencies, PinnedText } from '../scripts/install-local.mjs';
import { ORT_WEB_VERSION } from '../src/voice-pack.js';

const sha256 = (body: string | Buffer): string => createHash('sha256').update(body).digest('hex');

/** A pinned text whose size and hash are those of `body`. */
function pinnedAs(text: PinnedText, body: string): PinnedText {
  return { ...text, bytes: Buffer.byteLength(body), sha256: sha256(body) };
}

function ortDir(): string {
  const speechPackage = fileURLToPath(new URL('../package.json', import.meta.url));
  const transformers = createRequire(speechPackage).resolve('@huggingface/transformers');
  let dir = path.dirname(createRequire(transformers).resolve('onnxruntime-web'));
  while (path.basename(dir) !== 'onnxruntime-web') dir = path.dirname(dir);
  return dir;
}

let temp = '';
beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'siapso-voice-install-'));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('the ONNX Runtime texts of the voice pack', () => {
  it('pins LICENSE and ThirdPartyNotices.txt by full commit, size and SHA-256', () => {
    expect(PINNED_TEXTS.onnxruntime).toMatchObject({
      repo: 'microsoft/onnxruntime',
      file: 'LICENSE',
      path: 'licenses/onnxruntime-web-LICENSE.txt',
      bytes: 1073,
      sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
    });
    expect(PINNED_TEXTS.onnxruntimeNotices).toMatchObject({
      repo: 'microsoft/onnxruntime',
      file: 'ThirdPartyNotices.txt',
      path: 'licenses/onnxruntime-ThirdPartyNotices.txt',
      bytes: 338088,
      sha256: '143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3',
    });
    for (const text of Object.values(PINNED_TEXTS)) {
      expect(text.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(text.url).toBe(
        `https://raw.githubusercontent.com/${text.repo}/${text.commit}/${text.file}`,
      );
    }
  });

  it('takes them at the commit the installed onnxruntime-web was built from', () => {
    const built = readFileSync(path.join(ortDir(), '__commit.txt'), 'utf8').trim();
    expect(PINNED_TEXTS.onnxruntime.commit).toBe(built);
    expect(PINNED_TEXTS.onnxruntimeNotices.commit).toBe(built);
    expect(ORT_WEB_VERSION.endsWith(built.slice(0, 9))).toBe(true);
    expect(() => {
      checkOrtCommit(built);
    }).not.toThrow();
  });

  it('refuses an onnxruntime-web built from another commit', () => {
    expect(() => {
      checkOrtCommit('0123456789abcdef0123456789abcdef01234567');
    }).toThrow(/built from 0123456789abcdef0123456789abcdef01234567.*pinned at/);
  });

  it('reads a text from a local folder when it is there, checked by its hash', async () => {
    const body = 'Third party notices\n';
    const pinned = pinnedAs(PINNED_TEXTS.onnxruntimeNotices, body);
    await mkdir(path.join(temp, 'licenses'), { recursive: true });
    await writeFile(path.join(temp, pinned.path), body);
    const network = vi.fn();
    expect((await pinnedText(pinned, temp, network)).toString()).toBe(body);
    expect(network).not.toHaveBeenCalled();
    await writeFile(path.join(temp, pinned.path), 'another text');
    await expect(pinnedText(pinned, temp, network)).rejects.toThrow(/not the pinned file/);
  });

  it('downloads it at the pinned commit otherwise, and refuses another text', async () => {
    const body = 'Third party notices\n';
    const pinned = pinnedAs(PINNED_TEXTS.onnxruntimeNotices, body);
    const network = vi.fn(() => Promise.resolve(new Response(body)));
    expect((await pinnedText(pinned, undefined, network)).toString()).toBe(body);
    expect(network).toHaveBeenCalledWith(pinned.url);
    const changed = vi.fn(() => Promise.resolve(new Response('Third party notices, changed\n')));
    await expect(pinnedText(pinned, undefined, changed)).rejects.toThrow(/not the pinned file/);
    const missing = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(pinnedText(pinned, undefined, missing)).rejects.toThrow(/HTTP 404/);
  });

  it('reads each text once for every pack, from the first folder that has it', async () => {
    const licence = pinnedAs(PINNED_TEXTS.onnxruntime, 'MIT License\n');
    const notices = pinnedAs(PINNED_TEXTS.onnxruntimeNotices, 'Third party notices\n');
    const first = path.join(temp, 'first');
    const second = path.join(temp, 'second');
    await mkdir(path.join(second, 'licenses'), { recursive: true });
    await mkdir(first, { recursive: true });
    await writeFile(path.join(second, licence.path), 'MIT License\n');
    const network = vi.fn(() => Promise.resolve(new Response('Third party notices\n')));
    const texts = await pinnedTexts([first, second], network, [licence, notices]);
    expect(texts.map((t) => [t.path, t.bytes.toString()])).toEqual([
      [licence.path, 'MIT License\n'],
      [notices.path, 'Third party notices\n'],
    ]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledWith(notices.url);
  });
});

describe('the voice pack written by install', () => {
  /** A converted pack and the packages the speech worker bundles, as small fixtures. */
  async function fixture(): Promise<{ deps: PackDependencies; source: string; target: string }> {
    const source = path.join(temp, 'out');
    const target = path.join(temp, 'voice');
    const pack = path.join(source, 'test-pack');
    await mkdir(pack, { recursive: true });
    await writeFile(path.join(pack, 'config.json'), '{}\n');
    await writeFile(
      path.join(pack, 'voice-pack.json'),
      JSON.stringify({
        id: 'test-pack',
        licence: 'MIT',
        licenceNote: 'A note on the licence of the model.',
        languages: ['fr'],
        prompts: { fr: [1, 2] },
        source: { repo: 'openai/whisper-base', revision: 'abc', licence: 'MIT' },
        files: [{ path: 'config.json', bytes: 3, sha256: sha256('{}\n') }],
      }),
    );
    const library = async (name: string, version: string, licence: string) => {
      const dir = path.join(temp, 'packages', name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'LICENSE'), `${name} licence\n`);
      return { dir, version, licence };
    };
    const ort = await library('onnxruntime-web', ORT_WEB_VERSION, 'MIT');
    await mkdir(path.join(ort.dir, 'dist'), { recursive: true });
    for (const name of [
      'ort-wasm-simd-threaded.asyncify.mjs',
      'ort-wasm-simd-threaded.asyncify.wasm',
    ]) {
      await writeFile(path.join(ort.dir, 'dist', name), `${name}\n`);
    }
    return {
      source,
      target,
      deps: {
        transformers: await library('transformers', '4.3.1', 'Apache-2.0'),
        tokenizers: await library('tokenizers', '0.2.0', 'Apache-2.0'),
        jinja: await library('jinja', '0.5.10', 'MIT'),
        ort,
      },
    };
  }

  it('ships the ONNX Runtime notices and lists every file with its size and SHA-256', async () => {
    const { deps, source, target } = await fixture();
    const texts = [
      { path: PINNED_TEXTS.onnxruntime.path, bytes: Buffer.from('MIT License\n') },
      { path: PINNED_TEXTS.onnxruntimeNotices.path, bytes: Buffer.from('Third party notices\n') },
    ];
    await install('test-pack', deps, texts, { source, target, log: () => undefined });

    const to = path.join(target, 'test-pack');
    const manifest = JSON.parse(await readFile(path.join(to, 'voice-pack.json'), 'utf8')) as {
      files: { path: string; bytes: number; sha256: string }[];
      totalBytes: number;
      runtime: Record<string, string>;
    };
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toEqual([
      'config.json',
      `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.asyncify.mjs`,
      `runtime/${ORT_WEB_VERSION}/ort-wasm-simd-threaded.asyncify.wasm`,
      'NOTICE.md',
      'licenses/transformers.js-LICENSE.txt',
      'licenses/huggingface-tokenizers-LICENSE.txt',
      'licenses/huggingface-jinja-LICENSE.txt',
      'licenses/onnxruntime-web-LICENSE.txt',
      'licenses/onnxruntime-ThirdPartyNotices.txt',
      'licenses/openai-whisper-LICENSE.txt',
    ]);
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(to, file.path));
      expect(file.bytes, file.path).toBe(bytes.length);
      expect(file.sha256, file.path).toBe(sha256(bytes));
    }
    expect(manifest.totalBytes).toBe(manifest.files.reduce((sum, f) => sum + f.bytes, 0));
    expect(manifest.runtime).toEqual({ 'onnxruntime-web': ORT_WEB_VERSION, licence: 'MIT' });
    expect(await readFile(path.join(to, PINNED_TEXTS.onnxruntimeNotices.path), 'utf8')).toBe(
      'Third party notices\n',
    );

    const notice = await readFile(path.join(to, 'NOTICE.md'), 'utf8');
    expect(notice).toContain('`licenses/onnxruntime-ThirdPartyNotices.txt`');
    expect(notice).toContain(`\`${PINNED_TEXTS.onnxruntime.commit}\``);
  });

  it('drops the licence files of an earlier install from the manifest before adding its own', async () => {
    const { deps, source, target } = await fixture();
    const manifestFile = path.join(source, 'test-pack', 'voice-pack.json');
    const converted = JSON.parse(await readFile(manifestFile, 'utf8')) as {
      files: { path: string; bytes: number; sha256: string }[];
    };
    converted.files.push(
      { path: 'licenses/old-LICENSE.txt', bytes: 1, sha256: '0' },
      { path: 'NOTICE.md', bytes: 1, sha256: '0' },
      { path: 'runtime/0.0.0/ort.wasm', bytes: 1, sha256: '0' },
    );
    await writeFile(manifestFile, JSON.stringify(converted));
    const texts = [
      { path: PINNED_TEXTS.onnxruntime.path, bytes: Buffer.from('MIT License\n') },
      { path: PINNED_TEXTS.onnxruntimeNotices.path, bytes: Buffer.from('Third party notices\n') },
    ];
    await install('test-pack', deps, texts, { source, target, log: () => undefined });
    const manifest = JSON.parse(
      await readFile(path.join(target, 'test-pack', 'voice-pack.json'), 'utf8'),
    ) as { files: { path: string }[] };
    const paths = manifest.files.map((f) => f.path);
    expect(paths).not.toContain('licenses/old-LICENSE.txt');
    expect(paths).not.toContain('runtime/0.0.0/ort.wasm');
    expect(paths.filter((p) => p === 'NOTICE.md')).toHaveLength(1);
  });
});
