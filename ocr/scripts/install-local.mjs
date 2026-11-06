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
//   pdfjs-dist, which must be PDFJS_VERSION, and its WebAssembly decoders of
//   scanned images (wasm/jbig2.wasm for JBIG2 and CCITT, wasm/openjpeg.wasm
//   for JPEG 2000), with their licences.
// - licenses/ and NOTICE.md: the licence texts of each component, taken
//   from its own project at a pinned commit and checked by SHA-256
//   (PINNED_TEXTS: PaddleOCR's LICENSE, ONNX Runtime's LICENSE and
//   ThirdPartyNotices.txt, read from <dir>/licenses/ when they are there,
//   downloaded otherwise), and those pdf.js ships in pdfjs-dist;
// - ocr-pack.json with every file's size and SHA-256.
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

/**
 * Licence texts the pack ships from the projects themselves, each at a
 * pinned commit, checked by size and SHA-256 (ocr/LICENSES.md):
 * - PaddleOCR's LICENSE at the commit of its v3.7.0 tag (2026-06-11), the
 *   release of the models' revisions: the Apache License 2.0 with the
 *   project's copyright line; the repository has no NOTICE file there (the
 *   only one in its tree is deploy/ios_demo/NOTICE, for that demo app);
 * - ONNX Runtime's LICENSE and ThirdPartyNotices.txt at the commit the
 *   installed onnxruntime-web was built from (its __commit.txt): the
 *   WebAssembly build links third-party code whose notices are there; the
 *   npm package carries neither file.
 */
export const PINNED_TEXTS = Object.fromEntries(
  Object.entries({
    paddleocr: {
      repo: 'PaddlePaddle/PaddleOCR',
      commit: 'b03f46425e8ff4442b268ce449e3eef758146cd4',
      file: 'LICENSE',
      path: 'licenses/paddleocr-LICENSE.txt',
      bytes: 11376,
      sha256: '3840c5c0c61c294264d2dd77b8777be6ddd90121ef4e0e64abcd22edea581d6e',
    },
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
  const hash = sha256(bytes);
  if (bytes.length !== text.bytes || hash !== text.sha256) {
    throw new Error(
      `${text.repo} ${text.file} is not the pinned file (sha256 ${hash}, expected ${text.sha256})`,
    );
  }
  return bytes;
}

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

/**
 * The files of the installed pdfjs-dist the pack carries: [path in the pack,
 * path in the package]. The two decoders come with the licences pdf.js ships
 * for them (PDFium's JBIG2 decoder, OpenJPEG, and pdf.js's own wrappers).
 */
export function pdfjsCopies(version) {
  return [
    [`pdf/${version}/pdf.min.mjs`, 'build/pdf.min.mjs'],
    [`pdf/${version}/pdf.worker.min.mjs`, 'build/pdf.worker.min.mjs'],
    [`pdf/${version}/wasm/jbig2.wasm`, 'wasm/jbig2.wasm'],
    [`pdf/${version}/wasm/openjpeg.wasm`, 'wasm/openjpeg.wasm'],
    ['licenses/pdfjs-dist-LICENSE.txt', 'LICENSE'],
    ['licenses/pdfjs-dist-wasm-LICENSE_JBIG2.txt', 'wasm/LICENSE_JBIG2'],
    ['licenses/pdfjs-dist-wasm-LICENSE_PDFJS_JBIG2.txt', 'wasm/LICENSE_PDFJS_JBIG2'],
    ['licenses/pdfjs-dist-wasm-LICENSE_OPENJPEG.txt', 'wasm/LICENSE_OPENJPEG'],
    ['licenses/pdfjs-dist-wasm-LICENSE_PDFJS_OPENJPEG.txt', 'wasm/LICENSE_PDFJS_OPENJPEG'],
  ];
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
  const ortCommit = (await readFile(path.join(ort.dir, '__commit.txt'), 'utf8')).trim();
  if (ortCommit !== PINNED_TEXTS.onnxruntime.commit) {
    throw new Error(
      `onnxruntime-web was built from ${ortCommit}, its licence texts are pinned at ${PINNED_TEXTS.onnxruntime.commit} (PINNED_TEXTS in ocr/scripts/install-local.mjs).`,
    );
  }
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
  for (const [to, from] of pdfjsCopies(pdfVersion)) await copy(to, path.join(pdfjs.dir, from));
  for (const text of Object.values(PINNED_TEXTS)) {
    await put(text.path, await pinnedText(text, source.dir));
  }
  const { detection: det, recognition: rec } = PINNED_MODELS;
  const { paddleocr, onnxruntime } = PINNED_TEXTS;
  await put(
    'NOTICE.md',
    `# Reading pack ${id}: notices

- Text detection model: \`${det.repo}\` (revision \`${det.revision}\`), PaddleOCR PP-OCRv5 mobile detection, ${det.licence} (declared on its Hugging Face card, which names no copyright holder). PaddlePaddle's own ONNX export, unchanged (\`models/det.onnx\`).
- Text recognition model: \`${rec.repo}\` (revision \`${rec.revision}\`), PaddleOCR PP-OCRv5 mobile Latin recognition, ${rec.licence} (declared on its Hugging Face card, which names no copyright holder). PaddlePaddle's own ONNX export, unchanged (\`models/rec-latin.onnx\`); \`models/dict-latin.json\` lists the characters of its \`inference.yml\`.
- Both models come from the PaddleOCR project (\`${paddleocr.repo}\` on GitHub, Apache License 2.0): \`licenses/paddleocr-LICENSE.txt\` is its own \`LICENSE\` at commit \`${paddleocr.commit}\` (tag v3.7.0), whose copyright line, "Copyright (c) 2016 PaddlePaddle Authors. All Rights Reserved.", comes from the GitHub project, not from the model repositories. The project has no NOTICE file at that commit.
- ONNX Runtime Web ${ort.version} (\`runtime/\`), ${ort.licence}, Copyright (c) Microsoft Corporation: \`licenses/onnxruntime-web-LICENSE.txt\`, the \`LICENSE\` of \`${onnxruntime.repo}\` at commit \`${onnxruntime.commit}\`, which the package was built from. Its WebAssembly links third-party code: their notices are \`licenses/onnxruntime-ThirdPartyNotices.txt\` (\`ThirdPartyNotices.txt\` at the same commit). The reading worker of the app bundles its JavaScript.
- pdf.js (pdfjs-dist ${pdfjs.version}, \`pdf/\`), ${pdfjs.licence}, Mozilla Foundation and the pdf.js contributors: \`licenses/pdfjs-dist-LICENSE.txt\`.
- pdf.js's decoders of scanned images, from the same package: \`pdf/${pdfVersion}/wasm/jbig2.wasm\` (JBIG2 and CCITT fax, the JBIG2 decoder of PDFium, BSD-3-Clause and Apache-2.0, Copyright 2014 The PDFium Authors: \`licenses/pdfjs-dist-wasm-LICENSE_JBIG2.txt\`; pdf.js's build of it, Apache-2.0, Mozilla Foundation: \`licenses/pdfjs-dist-wasm-LICENSE_PDFJS_JBIG2.txt\`) and \`pdf/${pdfVersion}/wasm/openjpeg.wasm\` (JPEG 2000, OpenJPEG, BSD-2-Clause, Universite catholique de Louvain and the OpenJPEG authors: \`licenses/pdfjs-dist-wasm-LICENSE_OPENJPEG.txt\`; pdf.js's build of it, BSD-2-Clause, Mozilla Foundation: \`licenses/pdfjs-dist-wasm-LICENSE_PDFJS_OPENJPEG.txt\`).
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
    licence: 'Apache-2.0 AND MIT AND BSD-3-Clause AND BSD-2-Clause',
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
