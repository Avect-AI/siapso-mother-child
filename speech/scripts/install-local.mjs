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
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(root, 'speech', 'convert', 'out');
const target = path.join(root, 'app', 'public', 'voice');

/** The file names of RUNTIME_FILES in speech/src/voice-pack.ts, under runtime/<version>/. */
const RUNTIME = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

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

/** Writes licenses/ and NOTICE.md into the pack folder `to`; returns their paths. */
async function writeLicences(to, manifest, deps) {
  const dir = path.join(to, 'licenses');
  await mkdir(dir, { recursive: true });
  const texts = [
    [
      'transformers.js-LICENSE.txt',
      await readFile(path.join(deps.transformers.dir, 'LICENSE'), 'utf8'),
    ],
    [
      'huggingface-tokenizers-LICENSE.txt',
      await readFile(path.join(deps.tokenizers.dir, 'LICENSE'), 'utf8'),
    ],
    ['huggingface-jinja-LICENSE.txt', await readFile(path.join(deps.jinja.dir, 'LICENSE'), 'utf8')],
    // The npm package carries no licence file; its package.json says MIT, as
    // github.com/microsoft/onnxruntime/blob/main/LICENSE.
    ['onnxruntime-web-LICENSE.txt', mitLicence('Microsoft Corporation')],
    // github.com/openai/whisper/blob/main/LICENSE.
    ['openai-whisper-LICENSE.txt', mitLicence('2022 OpenAI')],
  ];
  for (const [name, text] of texts) await writeFile(path.join(dir, name), text);

  const source = manifest.source;
  const base = source.base
    ? `\n- Base model: \`${source.base}\` (revision \`${source.baseRevision}\`), ${source.baseLicence}: \`licenses/openai-whisper-LICENSE.txt\`.`
    : '';
  const notice = `# Voice pack ${manifest.id}: notices

- Model: \`${source.repo}\` (revision \`${source.revision}\`), ${source.licence}${source.base ? ' (licence declared on its Hugging Face card)' : ': `licenses/openai-whisper-LICENSE.txt`'}, converted to ONNX and quantised to 8 bits by SIAPSO (\`speech/convert/convert.py\`).${base}
- ${manifest.licenceNote}
- ONNX Runtime Web ${deps.ort.version} (\`runtime/\`), ${deps.ort.licence}, Copyright Microsoft Corporation: \`licenses/onnxruntime-web-LICENSE.txt\`.
- The speech worker of the app bundles Transformers.js ${deps.transformers.version} (${deps.transformers.licence}, Copyright Hugging Face): \`licenses/transformers.js-LICENSE.txt\`; @huggingface/tokenizers ${deps.tokenizers.version} (${deps.tokenizers.licence}): \`licenses/huggingface-tokenizers-LICENSE.txt\`; @huggingface/jinja ${deps.jinja.version} (${deps.jinja.licence}): \`licenses/huggingface-jinja-LICENSE.txt\`.
`;
  await writeFile(path.join(to, 'NOTICE.md'), notice);
  return ['NOTICE.md', ...texts.map(([name]) => `licenses/${name}`)];
}

async function install(id, deps) {
  const from = path.join(source, id);
  const to = path.join(target, id);
  const manifest = JSON.parse(await readFile(path.join(from, 'voice-pack.json'), 'utf8'));
  await rm(to, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
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
  added.push(...(await writeLicences(to, manifest, deps)));
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

  console.log(
    `${id}: ${String(manifest.totalBytes)} bytes (${(manifest.totalBytes / 1e6).toFixed(1)} MB) in ${to}`,
  );
  for (const file of manifest.files)
    console.log(`  ${String(file.bytes).padStart(12)}  ${file.path}`);
}

const requested = process.argv.slice(2);
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
} else {
  const deps = await dependencies();
  const expected = await expectedOrtVersion();
  if (deps.ort.version !== expected) {
    console.error(
      `onnxruntime-web ${deps.ort.version} is installed, the speech worker expects ${expected} (ORT_WEB_VERSION in speech/src/voice-pack.ts).`,
    );
    process.exitCode = 1;
  } else {
    for (const id of ids) await install(id, deps);
  }
}
