// SPDX-License-Identifier: MIT
// pnpm voice:install-local [pack id ...]
//
// Copies each converted voice pack (speech/convert/out/<id>/, written by
// pnpm voice:convert) to app/public/voice/<id>/ for local preview and phone
// tests, adds the ONNX Runtime Web files that the app's Transformers.js
// version loads (runtime/<version>/, the version ORT_WEB_VERSION of
// speech/src/voice-pack.ts names; another installed version stops the
// script) and the licence texts of everything the voice
// pack and the speech worker ship (licenses/, NOTICE.md), and records them
// in the pack's voice-pack.json. A deployment serves the same folder.
// Nothing here is committed: app/public/voice/ is git-ignored.
//
// ONNX Runtime's LICENSE and ThirdPartyNotices.txt come from its own
// repository at the commit the installed onnxruntime-web was built from (its
// __commit.txt; another commit stops the script), checked by size and SHA-256
// (PINNED_TEXTS). Each is read once for every pack: from licenses/ in the
// installed pack (app/public/voice/<id>/, an earlier run) or in the converted
// one (speech/convert/out/<id>/) when one has it, downloaded otherwise.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'speech', 'convert', 'out');
const target = path.join(root, 'app', 'public', 'voice');

/** The file names of RUNTIME_FILES in speech/src/voice-pack.ts, under runtime/<version>/. */
const RUNTIME = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

/**
 * ONNX Runtime's LICENSE and ThirdPartyNotices.txt at the commit the installed
 * onnxruntime-web was built from (its __commit.txt), each checked by size and
 * SHA-256 (speech/LICENSES.md): the npm package carries neither file, and the
 * WebAssembly build links third-party code whose notices are there. The
 * prescription reading pack pins the same texts (pull request #69), since
 * both packs serve the same build.
 */
export const PINNED_TEXTS = Object.fromEntries(
  Object.entries({
    onnxruntime: {
      repo: 'microsoft/onnxruntime',
      commit: '8d85527a010e294a26b274749f74294b2a32cec5',
      file: 'LICENSE',
      path: 'licenses/onnxruntime-web-LICENSE.txt',
      bytes: 1073,
      sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
    },
    onnxruntimeNotices: {
      repo: 'microsoft/onnxruntime',
      commit: '8d85527a010e294a26b274749f74294b2a32cec5',
      file: 'ThirdPartyNotices.txt',
      path: 'licenses/onnxruntime-ThirdPartyNotices.txt',
      bytes: 338088,
      sha256: '143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3',
    },
  }).map(([name, text]) => [
    name,
    { ...text, url: `https://raw.githubusercontent.com/${text.repo}/${text.commit}/${text.file}` },
  ]),
);

/** Refuses an onnxruntime-web built from another commit than the one its texts are pinned at. */
export function checkOrtCommit(built) {
  const pinned = PINNED_TEXTS.onnxruntime.commit;
  if (built !== pinned) {
    throw new Error(
      `onnxruntime-web was built from ${built}, its licence texts are pinned at ${pinned} (PINNED_TEXTS in speech/scripts/install-local.mjs).`,
    );
  }
}

/**
 * The bytes of a pinned text: `<dir>/<path>` when the local folder has it,
 * else downloaded from its pinned commit with `download`; refused unless
 * its size and SHA-256 are the pinned ones.
 */
export async function pinnedText(text, dir, download = fetch) {
  let bytes;
  const local = dir === undefined ? undefined : path.join(dir, text.path);
  try {
    bytes = local === undefined ? undefined : await readFile(local);
  } catch {
    bytes = undefined;
  }
  if (bytes === undefined) {
    console.log(`downloading ${text.url}`);
    const response = await download(text.url);
    if (!response.ok) throw new Error(`${text.url}: HTTP ${String(response.status)}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== text.bytes || hash !== text.sha256) {
    throw new Error(
      `${text.repo} ${text.file} is not the pinned file (sha256 ${hash}, expected ${text.sha256})`,
    );
  }
  return bytes;
}

/**
 * The pinned texts, read once for every pack: each from the first of `dirs`
 * that has it, else downloaded. Returns their paths in the pack and bytes.
 */
export async function pinnedTexts(dirs, download = fetch, texts = Object.values(PINNED_TEXTS)) {
  const found = [];
  for (const text of texts) {
    const dir = dirs.find((candidate) => existsSync(path.join(candidate, text.path)));
    found.push({ path: text.path, bytes: await pinnedText(text, dir, download) });
  }
  return found;
}

/** ORT_WEB_VERSION of speech/src/voice-pack.ts: the runtime the app's worker expects. */
async function expectedOrtVersion() {
  const code = await readFile(path.join(root, 'speech', 'src', 'voice-pack.ts'), 'utf8');
  const found = /export const ORT_WEB_VERSION = '([^']+)'/.exec(code)?.[1];
  if (found === undefined) throw new Error('ORT_WEB_VERSION not found in speech/src/voice-pack.ts');
  return found;
}

function mitLicence(holder) {
  return `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** The folder holding package.json of `name`, resolved from the file `from`. */
async function packageDir(from, name) {
  let dir = path.dirname(createRequire(from).resolve(name));
  while (!(await stat(path.join(dir, 'package.json')).catch(() => null))) dir = path.dirname(dir);
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  return { dir, version: pkg.version, licence: pkg.license };
}

/** onnxruntime-web and the Hugging Face libraries the speech worker bundles. */
async function dependencies() {
  const transformersEntry = createRequire(path.join(root, 'speech', 'package.json')).resolve(
    '@huggingface/transformers',
  );
  return {
    transformers: await packageDir(
      path.join(root, 'speech', 'package.json'),
      '@huggingface/transformers',
    ),
    tokenizers: await packageDir(transformersEntry, '@huggingface/tokenizers'),
    jinja: await packageDir(transformersEntry, '@huggingface/jinja'),
    ort: await packageDir(transformersEntry, 'onnxruntime-web'),
  };
}

/**
 * Writes licenses/ and NOTICE.md into the pack folder `to`; returns their
 * paths. `pinned`: the texts of PINNED_TEXTS, as pinnedTexts reads them.
 */
async function writeLicences(to, manifest, deps, pinned) {
  await mkdir(path.join(to, 'licenses'), { recursive: true });
  const pinnedBytes = (text) => {
    const found = pinned.find((candidate) => candidate.path === text.path);
    if (found === undefined) throw new Error(`${text.path} was not read (PINNED_TEXTS)`);
    return found.bytes;
  };
  const { onnxruntime, onnxruntimeNotices } = PINNED_TEXTS;
  const texts = [
    [
      'licenses/transformers.js-LICENSE.txt',
      await readFile(path.join(deps.transformers.dir, 'LICENSE'), 'utf8'),
    ],
    [
      'licenses/huggingface-tokenizers-LICENSE.txt',
      await readFile(path.join(deps.tokenizers.dir, 'LICENSE'), 'utf8'),
    ],
    [
      'licenses/huggingface-jinja-LICENSE.txt',
      await readFile(path.join(deps.jinja.dir, 'LICENSE'), 'utf8'),
    ],
    // The npm package carries neither file: both come from the repository.
    [onnxruntime.path, pinnedBytes(onnxruntime)],
    [onnxruntimeNotices.path, pinnedBytes(onnxruntimeNotices)],
    // github.com/openai/whisper/blob/main/LICENSE.
    ['licenses/openai-whisper-LICENSE.txt', mitLicence('2022 OpenAI')],
  ];
  for (const [relative, text] of texts) await writeFile(path.join(to, relative), text);

  const source = manifest.source;
  const base = source.base
    ? `\n- Base model: \`${source.base}\` (revision \`${source.baseRevision}\`), ${source.baseLicence}: \`licenses/openai-whisper-LICENSE.txt\`.`
    : '';
  const notice = `# Voice pack ${manifest.id}: notices

- Model: \`${source.repo}\` (revision \`${source.revision}\`), ${source.licence}${source.base ? ' (licence declared on its Hugging Face card)' : ': `licenses/openai-whisper-LICENSE.txt`'}, converted to ONNX and quantised to 8 bits by SIAPSO (\`speech/convert/convert.py\`).${base}
- ${manifest.licenceNote}
- ONNX Runtime Web ${deps.ort.version} (\`runtime/\`), ${deps.ort.licence}, Copyright (c) Microsoft Corporation: \`${onnxruntime.path}\`, the \`${onnxruntime.file}\` of \`${onnxruntime.repo}\` at commit \`${onnxruntime.commit}\`, which the package was built from. Its WebAssembly links third-party code: their notices are \`${onnxruntimeNotices.path}\` (\`${onnxruntimeNotices.file}\` at the same commit).
- The speech worker of the app bundles Transformers.js ${deps.transformers.version} (${deps.transformers.licence}, Copyright Hugging Face): \`licenses/transformers.js-LICENSE.txt\`; @huggingface/tokenizers ${deps.tokenizers.version} (${deps.tokenizers.licence}): \`licenses/huggingface-tokenizers-LICENSE.txt\`; @huggingface/jinja ${deps.jinja.version} (${deps.jinja.licence}): \`licenses/huggingface-jinja-LICENSE.txt\`.
`;
  await writeFile(path.join(to, 'NOTICE.md'), notice);
  return ['NOTICE.md', ...texts.map(([relative]) => relative)];
}

/**
 * Installs the converted pack `<dirs.source>/<id>/` into `<dirs.target>/<id>/`:
 * the runtime files of `deps.ort`, the licence texts (`pinned`, from
 * pinnedTexts) and voice-pack.json with every file's size and SHA-256.
 */
export async function install(id, deps, pinned, dirs = { source, target }) {
  const log = dirs.log ?? console.log;
  const from = path.join(dirs.source, id);
  const to = path.join(dirs.target, id);
  const manifest = JSON.parse(await readFile(path.join(from, 'voice-pack.json'), 'utf8'));
  await rm(to, { recursive: true, force: true });
  await mkdir(dirs.target, { recursive: true });
  await cp(from, to, { recursive: true });
  await mkdir(path.join(to, 'runtime'), { recursive: true });

  manifest.files = manifest.files.filter(
    (file) =>
      !file.path.startsWith('runtime/') &&
      !file.path.startsWith('licenses/') &&
      file.path !== 'NOTICE.md',
  );
  const added = [];
  // Under the version: a pack built for another ONNX Runtime reads as to install again.
  await mkdir(path.join(to, 'runtime', deps.ort.version), { recursive: true });
  for (const name of RUNTIME) {
    const relative = `runtime/${deps.ort.version}/${name}`;
    await copyFile(path.join(deps.ort.dir, 'dist', name), path.join(to, relative));
    added.push(relative);
  }
  added.push(...(await writeLicences(to, manifest, deps, pinned)));
  for (const relative of added) {
    const file = path.join(to, relative);
    manifest.files.push({
      path: relative,
      bytes: (await stat(file)).size,
      sha256: await sha256(file),
    });
  }
  manifest.runtime = { 'onnxruntime-web': deps.ort.version, licence: deps.ort.licence };
  manifest.totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  await writeFile(path.join(to, 'voice-pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  log(
    `${id}: ${String(manifest.totalBytes)} bytes (${(manifest.totalBytes / 1e6).toFixed(1)} MB) in ${to}`,
  );
  for (const file of manifest.files) log(`  ${String(file.bytes).padStart(12)}  ${file.path}`);
}

async function main(requested) {
  let ids = requested;
  if (ids.length === 0) {
    const entries = await readdir(source, { withFileTypes: true }).catch(() => []);
    ids = [];
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (await stat(path.join(source, entry.name, 'voice-pack.json')).catch(() => null))
      ) {
        ids.push(entry.name);
      }
    }
  }
  if (ids.length === 0) {
    console.error(`No voice pack in ${source}: run pnpm voice:convert first.`);
    process.exitCode = 1;
    return;
  }
  const deps = await dependencies();
  const expected = await expectedOrtVersion();
  if (deps.ort.version !== expected) {
    console.error(
      `onnxruntime-web ${deps.ort.version} is installed, the speech worker expects ${expected} (ORT_WEB_VERSION in speech/src/voice-pack.ts).`,
    );
    process.exitCode = 1;
    return;
  }
  checkOrtCommit((await readFile(path.join(deps.ort.dir, '__commit.txt'), 'utf8')).trim());
  // An earlier install first, then the converted pack: a text checked once is not downloaded again.
  const pinned = await pinnedTexts(
    ids.flatMap((id) => [path.join(target, id), path.join(source, id)]),
  );
  for (const id of ids) await install(id, deps, pinned);
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
