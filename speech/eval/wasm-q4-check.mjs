// SPDX-License-Identifier: MIT
// SCRUM-42: runs the encoder and one first decoder step of an 8-bit pack and of
// its 4-bit twin on the ONNX Runtime Web WebAssembly build that Transformers.js
// pins (one thread, in Node, not in a browser), and records the time of each.
//
//   node speech/eval/wasm-q4-check.mjs --pack-dir <speech/convert/out> --q8 whisper-base-fr-q8 \
//     --q4 whisper-base-fr-q4 [--out eval/speech/results/2026-11-05-wasm-q4-check.json]
//
// The input is a synthetic signal (not speech), and each graph runs once: the
// times are indicative of the operators' cost on this machine, nothing more,
// and say nothing about a phone. The outputs of the two bit widths are not
// compared (different quantisation, synthetic input); the correctness check of
// the operator is speech/test/wasm-matmulnbits.test.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const packDir = arg('--pack-dir');
const q8 = arg('--q8', 'whisper-base-fr-q8');
const q4 = arg('--q4', 'whisper-base-fr-q4');
const out = arg('--out');
if (packDir === undefined) throw new Error('--pack-dir <folder with the packs> is required');

const require = createRequire(import.meta.url);
const transformersRequire = createRequire(require.resolve('@huggingface/transformers'));
const ort = transformersRequire('onnxruntime-web');
// The package's "exports" hide package.json: read it next to the dist folder.
const ortVersion = JSON.parse(
  readFileSync(
    path.join(path.dirname(transformersRequire.resolve('onnxruntime-web')), '..', 'package.json'),
    'utf8',
  ),
).version;
ort.env.wasm.numThreads = 1;

const features = new Float32Array(80 * 3000);
for (let i = 0; i < features.length; i += 1) features[i] = Math.sin(i * 0.01) * 0.5;
const input = new ort.Tensor('float32', features, [1, 80, 3000]);

async function encoder(file) {
  const session = await ort.InferenceSession.create(readFileSync(file), {
    executionProviders: ['wasm'],
  });
  const started = Date.now();
  const output = await session.run({ input_features: input });
  const hidden = Object.values(output)[0];
  return { hidden, ms: Date.now() - started };
}

async function decoderStep(file, hidden, config) {
  const session = await ort.InferenceSession.create(readFileSync(file), {
    executionProviders: ['wasm'],
  });
  const prompt = BigInt64Array.from([50258n, 50265n, 50359n, 50363n]);
  const feeds = {
    input_ids: new ort.Tensor('int64', prompt, [1, prompt.length]),
    encoder_hidden_states: hidden,
    use_cache_branch: new ort.Tensor('bool', [false], [1]),
  };
  const headDim = config.d_model / config.decoder_attention_heads;
  for (let i = 0; i < config.decoder_layers; i += 1)
    for (const kind of ['decoder', 'encoder'])
      for (const part of ['key', 'value'])
        feeds[`past_key_values.${i}.${kind}.${part}`] = new ort.Tensor(
          'float32',
          new Float32Array(0),
          [1, config.decoder_attention_heads, 0, headDim],
        );
  const started = Date.now();
  const logits = (await session.run(feeds)).logits;
  const last = logits.data.slice(-config.vocab_size);
  return { ms: Date.now() - started, finite: Array.from(last).every(Number.isFinite) };
}

const config = JSON.parse(readFileSync(path.join(packDir, q8, 'config.json'), 'utf8'));
const result = {
  note: 'Synthetic input, one run per graph, one thread, WebAssembly build of ONNX Runtime Web in Node (not a browser, not a phone). Indicative only.',
  onnxruntimeWeb: ortVersion,
  node: process.version,
  cpu: (os.cpus()[0]?.model ?? 'unknown').replace(/\s+/gu, ' ').trim(),
};
for (const [label, id, dtypeSuffix] of [
  ['q8', q8, '_quantized'],
  ['q4', q4, '_q4'],
]) {
  const onnx = path.join(packDir, id, 'onnx');
  const enc = await encoder(path.join(onnx, `encoder_model${dtypeSuffix}.onnx`));
  const dec = await decoderStep(
    path.join(onnx, `decoder_model_merged${dtypeSuffix}.onnx`),
    enc.hidden,
    config,
  );
  result[label] = {
    pack: id,
    encoderMs: enc.ms,
    encoderOutputFinite: Array.from(enc.hidden.data).every(Number.isFinite),
    decoderFirstStepMs: dec.ms,
    decoderOutputFinite: dec.finite,
  };
}
const text = `${JSON.stringify(result, null, 2)}\n`;
if (out !== undefined) writeFileSync(out, text);
process.stdout.write(text);
