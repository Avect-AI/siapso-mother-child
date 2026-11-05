// SPDX-License-Identifier: MIT
// @vitest-environment node
// The ONNX Runtime Web files of a voice pack must be the build whose
// JavaScript the speech worker bundles: install-local copies them from that
// very package, and the pack keeps them under runtime/<version>/. When
// Transformers.js moves to another ONNX Runtime, this test fails until
// ORT_WEB_VERSION follows, so an installed pack reads as to install again
// instead of loading a WebAssembly file that does not match its JavaScript.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { ORT_WEB_VERSION, RUNTIME_FILES } from '../src/voice-pack.js';

function packageVersion(name: string, from: string): string {
  let dir = path.dirname(createRequire(from).resolve(name));
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

it('names the ONNX Runtime Web build the speech worker bundles, in the runtime path of the pack', () => {
  const speechPackage = fileURLToPath(new URL('../package.json', import.meta.url));
  const transformers = createRequire(speechPackage).resolve('@huggingface/transformers');
  expect(packageVersion('onnxruntime-web', transformers)).toBe(ORT_WEB_VERSION);
  expect(RUNTIME_FILES.mjs.startsWith(`runtime/${ORT_WEB_VERSION}/`)).toBe(true);
  expect(RUNTIME_FILES.wasm.startsWith(`runtime/${ORT_WEB_VERSION}/`)).toBe(true);
});

it('is the version install-local copies the runtime files under', () => {
  const script = readFileSync(
    fileURLToPath(new URL('../scripts/install-local.mjs', import.meta.url)),
    'utf8',
  );
  // install-local reads ORT_WEB_VERSION from voice-pack.ts and refuses another package version.
  expect(script).toMatch(/ORT_WEB_VERSION/);
  expect(script).toMatch(/runtime\/\$\{/);
});
