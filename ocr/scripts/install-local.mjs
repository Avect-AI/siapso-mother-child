// SPDX-License-Identifier: MIT
// pnpm ocr:install-local --models <dir>   (or OCR_MODELS_DIR=<dir>)
// pnpm ocr:install-local --download
//
// Builds the prescription reading pack in app/public/ocr/<id>/ (git-ignored)
// for local preview, the bench and phone tests; a deployment serves the same
// folder. Nothing here is committed: no model, no WebAssembly file.
//
// - The models: PaddleOCR PP-OCRv5 mobile detection and Latin recognition,
//   PaddlePaddle's own ONNX exports on Hugging Face (no conversion here),
//   taken from a local folder (<dir>/det/ and <dir>/latin/, each with
//   inference.onnx and inference.yml) or, with --download only, from the
//   pinned revisions; every file is checked against its pinned SHA-256.
// - models/dict-latin.json: the 836 characters of the recognition model,
//   read from its inference.yml (PostProcess.character_dict).
// - runtime/<version>/: the plain ONNX Runtime Web build (ort-wasm-simd-
//   threaded.{mjs,wasm}) of the installed onnxruntime-web, which must be
//   ORT_WEB_VERSION of ocr/src/ocr-pack.ts (the speech worker's version).
// - pdf/<version>/: pdf.js (pdf.min.mjs, pdf.worker.min.mjs) of the installed
//   pdfjs-dist, which must be PDFJS_VERSION.
// - licenses/ and NOTICE.md; ocr-pack.json with every file's size and SHA-256.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const ocrPackage = path.join(root, 'ocr', 'package.json');

/** The model files, at the revisions and hashes the pack was measured with (docs/ocr.md). */
export const PINNED_MODELS = {
  detection: {
    repo: 'PaddlePaddle/PP-OCRv5_mobile_det_onnx',
    revision: 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d',
    licence: 'Apache-2.0',
    folder: 'det',
    onnx: {
      bytes: 4826518,
      sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d',
    },
    yml: { bytes: 903, sha256: '98069072e1b6b37d727fd9d9f11725faa46d6ea0de012f2ed26caea011c37699' },
  },
  recognition: {
    repo: 'PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx',
    revision: '89d3a50e2c27e2e7cceeab0e944c25c807d5db4f',
    licence: 'Apache-2.0',
    folder: 'latin',
    onnx: {
      bytes: 8042023,
      sha256: '7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498',
    },
    yml: {
      bytes: 6817,
      sha256: '0bbe984570f597af3638e50bdf2e8276f3ab26a61966096538b3b0d1849f5c84',
    },
  },
};

/** The characters of the recognition model, from its inference.yml. */
export function dictionaryOf(ymlText) {
  const doc = YAML.parse(ymlText);
  const characters = doc?.PostProcess?.character_dict;
  if (!Array.isArray(characters) || characters.length === 0) {
    throw new Error('The recognition inference.yml has no PostProcess.character_dict');
  }
  return characters.map(String);
}

/** Refuses a detection model whose settings are not those the worker uses (src/raster.ts, src/boxes.ts). */
export function checkDetectionSettings(ymlText) {
  const doc = YAML.parse(ymlText);
  const post = doc?.PostProcess ?? {};
  const resize = (doc?.PreProcess?.transform_ops ?? []).find(
    (op) => op?.DetResizeForTest,
  )?.DetResizeForTest;
  const expected = [
    ['resize_long', resize?.resize_long, 960],
    ['thresh', post.thresh, 0.3],
    ['box_thresh', post.box_thresh, 0.6],
    ['unclip_ratio', post.unclip_ratio, 1.5],
  ];
  for (const [name, found, wanted] of expected) {
    if (found !== wanted) {
      throw new Error(
        `The detection model sets ${name} to ${String(found)}; the reading worker uses ${String(wanted)}`,
      );
    }
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A constant of ocr/src/ocr-pack.ts. */
async function constantOf(name) {
  const code = await readFile(path.join(root, 'ocr', 'src', 'ocr-pack.ts'), 'utf8');
  const found = new RegExp(`export const ${name} = '([^']+)'`).exec(code)?.[1];
  if (found === undefined) throw new Error(`${name} not found in ocr/src/ocr-pack.ts`);
  return found;
}

/** The folder holding package.json of `name`, as @siapso/ocr resolves it. */
async function packageDir(name) {
  let dir = path.dirname(createRequire(ocrPackage).resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name === name) return { dir, version: pkg.version, licence: pkg.license };
    } catch {
      // Not the package root yet.
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No package.json for ${name}`);
    dir = parent;
  }
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

/** One model's two files: from the local folder, or downloaded at the pinned revision. */
async function modelFiles(model, source) {
  const files = {};
  for (const kind of ['onnx', 'yml']) {
    const name = `inference.${kind}`;
    let bytes;
    if (source.download) {
      const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${name}`;
      console.log(`downloading ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      bytes = await readFile(path.join(source.dir, model.folder, name));
    }
    const pinned = model[kind];
    const hash = sha256(bytes);
    if (bytes.length !== pinned.bytes || hash !== pinned.sha256) {
      throw new Error(
        `${model.repo} ${name} is not the pinned file (sha256 ${hash}, expected ${pinned.sha256})`,
      );
    }
    files[kind] = bytes;
  }
  return files;
}

function parseArguments(argv, env) {
  const download = argv.includes('--download');
  const at = argv.indexOf('--models');
  const dir = at >= 0 ? argv[at + 1] : env['OCR_MODELS_DIR'];
  if (!download && (dir === undefined || dir === '')) return undefined;
  return { download, dir: dir === undefined ? undefined : path.resolve(dir) };
}

async function main() {
  const source = parseArguments(process.argv.slice(2), process.env);
  if (source === undefined) {
    console.error(
      'usage: pnpm ocr:install-local --models <dir>   (dir/det/ and dir/latin/ with inference.onnx and inference.yml)\n' +
        '       pnpm ocr:install-local --download       (from Hugging Face, at the pinned revisions)',
    );
    process.exitCode = 2;
    return;
  }
  const id = await constantOf('OCR_PACK_ID');
  const ortVersion = await constantOf('ORT_WEB_VERSION');
  const pdfVersion = await constantOf('PDFJS_VERSION');
  const ort = await packageDir('onnxruntime-web');
  const pdfjs = await packageDir('pdfjs-dist');
  if (ort.version !== ortVersion) {
    throw new Error(
      `onnxruntime-web ${ort.version} is installed, the reading worker expects ${ortVersion} (ORT_WEB_VERSION in ocr/src/ocr-pack.ts).`,
    );
  }
  if (pdfjs.version !== pdfVersion) {
    throw new Error(
      `pdfjs-dist ${pdfjs.version} is installed, the pack expects ${pdfVersion} (PDFJS_VERSION in ocr/src/ocr-pack.ts).`,
    );
  }
  const detection = await modelFiles(PINNED_MODELS.detection, source);
  const recognition = await modelFiles(PINNED_MODELS.recognition, source);
  checkDetectionSettings(detection.yml.toString('utf8'));
  const dictionary = dictionaryOf(recognition.yml.toString('utf8'));

  const target = path.join(root, 'app', 'public', 'ocr', id);
  await rm(target, { recursive: true, force: true });
  const written = new Map();
  const put = async (relative, bytes) => {
    await mkdir(path.dirname(path.join(target, relative)), { recursive: true });
    await writeFile(path.join(target, relative), bytes);
    written.set(relative, bytes);
  };
  const copy = async (relative, from) => put(relative, await readFile(from));

  await put('models/det.onnx', detection.onnx);
  await put('models/rec-latin.onnx', recognition.onnx);
  await put('models/dict-latin.json', JSON.stringify(dictionary));
  for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    await copy(`runtime/${ortVersion}/${name}`, path.join(ort.dir, 'dist', name));
  }
  for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    await copy(`pdf/${pdfVersion}/${name}`, path.join(pdfjs.dir, 'build', name));
  }
  const apache = await readFile(path.join(root, 'LICENSES', 'Apache-2.0.txt'), 'utf8');
  await put('licenses/paddleocr-models-LICENSE.txt', apache);
  await copy('licenses/pdfjs-dist-LICENSE.txt', path.join(pdfjs.dir, 'LICENSE'));
  // The npm package carries no licence file; its package.json says MIT, as
  // github.com/microsoft/onnxruntime/blob/main/LICENSE.
  await put('licenses/onnxruntime-web-LICENSE.txt', mitLicence('Microsoft Corporation'));
  const { detection: det, recognition: rec } = PINNED_MODELS;
  await put(
    'NOTICE.md',
    `# Reading pack ${id}: notices

- Text detection model: \`${det.repo}\` (revision \`${det.revision}\`), PaddleOCR PP-OCRv5 mobile detection, ${det.licence} (declared on its Hugging Face card; PaddleOCR, Copyright (c) 2016 PaddlePaddle Authors): \`licenses/paddleocr-models-LICENSE.txt\`. PaddlePaddle's own ONNX export, unchanged (\`models/det.onnx\`).
- Text recognition model: \`${rec.repo}\` (revision \`${rec.revision}\`), PaddleOCR PP-OCRv5 mobile Latin recognition, ${rec.licence} (declared on its Hugging Face card): \`licenses/paddleocr-models-LICENSE.txt\`. PaddlePaddle's own ONNX export, unchanged (\`models/rec-latin.onnx\`); \`models/dict-latin.json\` lists the characters of its \`inference.yml\`.
- ONNX Runtime Web ${ort.version} (\`runtime/\`), ${ort.licence}, Copyright (c) Microsoft Corporation: \`licenses/onnxruntime-web-LICENSE.txt\`. The reading worker of the app bundles its JavaScript.
- pdf.js (pdfjs-dist ${pdfjs.version}, \`pdf/\`), ${pdfjs.licence}, Mozilla Foundation and the pdf.js contributors: \`licenses/pdfjs-dist-LICENSE.txt\`.
`,
  );

  const files = [...written.entries()]
    .map(([relative, bytes]) => ({
      path: relative,
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    id,
    licence: 'Apache-2.0 AND MIT',
    models: {
      detection: { repo: det.repo, revision: det.revision, licence: det.licence },
      recognition: { repo: rec.repo, revision: rec.revision, licence: rec.licence },
    },
    runtime: { 'onnxruntime-web': ort.version, 'pdfjs-dist': pdfjs.version },
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
  await writeFile(path.join(target, 'ocr-pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  let gzipTotal = 0;
  console.log(`${id}: ${String(manifest.totalBytes)} bytes in ${target}`);
  for (const file of files) {
    const gzipped = gzipSync(written.get(file.path), { level: 9 }).length;
    gzipTotal += gzipped;
    console.log(
      `  ${String(file.bytes).padStart(10)}  ${String(gzipped).padStart(10)} gzip  ${file.path}`,
    );
  }
  console.log(
    `  total ${(manifest.totalBytes / 1e6).toFixed(2)} MB, ${(gzipTotal / 1e6).toFixed(2)} MB with gzip`,
  );
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await stat(ocrPackage);
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
