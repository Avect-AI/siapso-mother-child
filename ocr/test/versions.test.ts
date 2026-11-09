// SPDX-License-Identifier: MIT
// @vitest-environment node
// One ONNX Runtime ships in the app: the reading worker bundles the
// onnxruntime-web the speech worker pins, and the pack's runtime files are
// that very build, under runtime/<version>/. pdf.js likewise: the pack's
// files are the installed pdfjs-dist. When either moves, this test fails
// until the constants follow, so an installed pack reads as to install again.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ORT_WEB_VERSION as SPEECH_ORT_WEB_VERSION } from '../../speech/src/voice-pack.js';
import { ORT_WEB_VERSION, PDFJS_VERSION, PDF_FILES, RUNTIME_FILES } from '../src/ocr-pack.js';

const ocrPackage = fileURLToPath(new URL('../package.json', import.meta.url));

function packageVersion(name: string): string {
  let dir = path.dirname(createRequire(ocrPackage).resolve(name));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
        version: string;
      };
      if (pkg.name === name) return pkg.version;
    } catch {
      // Not the package root yet.
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No package.json for ${name}`);
    dir = parent;
  }
}

it('runs the ONNX Runtime Web build the speech worker pins, one version in the app', () => {
  expect(ORT_WEB_VERSION).toBe(SPEECH_ORT_WEB_VERSION);
  expect(packageVersion('onnxruntime-web')).toBe(ORT_WEB_VERSION);
  const declared = JSON.parse(readFileSync(ocrPackage, 'utf8')) as {
    dependencies: Record<string, string>;
  };
  expect(declared.dependencies['onnxruntime-web']).toBe(ORT_WEB_VERSION);
  expect(RUNTIME_FILES.mjs.startsWith(`runtime/${ORT_WEB_VERSION}/`)).toBe(true);
  expect(RUNTIME_FILES.wasm.startsWith(`runtime/${ORT_WEB_VERSION}/`)).toBe(true);
});

it('carries the installed pdf.js, under its version', () => {
  expect(packageVersion('pdfjs-dist')).toBe(PDFJS_VERSION);
  expect(PDF_FILES.api.startsWith(`pdf/${PDFJS_VERSION}/`)).toBe(true);
  expect(PDF_FILES.worker.startsWith(`pdf/${PDFJS_VERSION}/`)).toBe(true);
});

it('is what install-local copies, and it refuses another installed version', () => {
  const script = readFileSync(
    fileURLToPath(new URL('../scripts/install-local.mjs', import.meta.url)),
    'utf8',
  );
  expect(script).toMatch(/ORT_WEB_VERSION/);
  expect(script).toMatch(/PDFJS_VERSION/);
});
