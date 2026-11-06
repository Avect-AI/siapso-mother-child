// SPDX-License-Identifier: MIT
// SCRUM-42: the ONNX Runtime Web build that Transformers.js pins must support the
// 4-bit MatMulNBits operator in WebAssembly, or a `q4` voice pack cannot run in
// the browser. The check opens the pinned build's WebAssembly binaries and runs a
// one-node MatMulNBits fixture (fixtures/make_matmulnbits.py) on the WebAssembly
// backend, in Node. It is not a browser run.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface OrtTensor {
  readonly data: Float32Array;
}
interface Ort {
  env: { wasm: { numThreads: number } };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: {
    create(
      model: Uint8Array,
      options: { executionProviders: string[] },
    ): Promise<{ run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>> }>;
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const transformersRequire = createRequire(
  createRequire(import.meta.url).resolve('@huggingface/transformers'),
);
const ortEntry = transformersRequire.resolve('onnxruntime-web');
const ortDist = path.dirname(ortEntry);
const fixtures = path.join(here, 'fixtures');

describe('ONNX Runtime Web (the build pinned by Transformers.js) and 4-bit weights', () => {
  it('contains the MatMulNBits operator in every WebAssembly binary', () => {
    const binaries = readdirSync(ortDist).filter((name) => name.endsWith('.wasm'));
    expect(binaries.length).toBeGreaterThan(0);
    for (const name of binaries) {
      const bytes = readFileSync(path.join(ortDist, name));
      expect(bytes.includes('MatMulNBits'), name).toBe(true);
    }
  });

  it('runs a 4-bit MatMulNBits node on the WebAssembly backend and matches the numpy result', async () => {
    const ort = transformersRequire('onnxruntime-web') as Ort;
    ort.env.wasm.numThreads = 1;
    const fixture = JSON.parse(
      readFileSync(path.join(fixtures, 'matmulnbits-4bit.json'), 'utf8'),
    ) as {
      input: number[];
      expected: number[];
    };
    const session = await ort.InferenceSession.create(
      new Uint8Array(readFileSync(path.join(fixtures, 'matmulnbits-4bit.onnx'))),
      { executionProviders: ['wasm'] },
    );
    const output = await session.run({
      A: new ort.Tensor('float32', Float32Array.from(fixture.input), [1, fixture.input.length]),
    });
    const y = output['Y']?.data;
    expect(y).toBeDefined();
    expect(y?.length).toBe(fixture.expected.length);
    fixture.expected.forEach((value, i) => {
      expect(Math.abs((y?.[i] ?? Number.NaN) - value)).toBeLessThan(1e-4);
    });
  });
});

/**
 * Starting Python and running the gates takes about 3 s alone (a virtual
 * environment on a synced OneDrive folder), more under the load of the whole
 * suite: above the 5 s default of Vitest, so the test gets its own limit.
 */
const PYTHON_TIMEOUT_MS = 60_000;

describe('training data gates (speech/train/test_finetune.py)', () => {
  const python = ['python3', 'python', 'py'].find(
    (name) => spawnSync(name, ['--version']).status === 0,
  );
  it.skipIf(python === undefined)(
    'refuse Kallaama by default and accept the opt-in',
    () => {
      const result = spawnSync(
        python ?? 'python3',
        [path.join(here, '..', 'train', 'test_finetune.py')],
        { encoding: 'utf8' },
      );
      expect(result.stderr).toContain('OK');
      expect(result.status).toBe(0);
    },
    PYTHON_TIMEOUT_MS,
  );
});
