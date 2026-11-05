// SPDX-License-Identifier: MIT
// Voice evaluation: runs the voice pack's ONNX graphs with Transformers.js in
// Node (same files, same decoder prompt, greedy decoding, at most 96 new
// tokens as the browser worker), on the FLEURS baseline subsets and on the
// consented volunteer recordings of eval/speech/manifest.yaml when there are
// some. Writes eval/speech/results/<date>-<pack>.json and <date>-summary.md.
//
//   pnpm eval:speech --data-dir <folder outside the repository>
//
// Options: --pack-dir (default app/public/voice, else speech/convert/out),
// --pack <id> (repeatable), --count (FLEURS utterances per language, 100),
// --date, --out-dir, --no-fleurs, --dtype (q8 by default; q4 for the 4-bit
// experiment of speech/convert/quantize_q4.py, packs named `*-q4`).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';
import { buildPack, loadContent } from '@siapso/pack-tools';
import { buildIndex, entriesFromPack, search } from '@siapso/resolver';
import type { ResolverIndex } from '@siapso/resolver';
import { evaluateVolunteers, transcribeAll } from './evaluate.js';
import { cachedSubsetUsable } from './fleurs.js';
import { parseManifest } from './manifest.js';
import { renderMarkdown, summariseSet, withoutReference } from './report.js';
import type { NameRow, SummaryRow } from './report.js';
import { decodeWav } from './wav.js';

/** As MAX_NEW_TOKENS in speech/src/worker.ts. */
const MAX_NEW_TOKENS = 96;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_PACKS = ['whisper-small-wolof-q8', 'whisper-base-fr-q8'];

interface FleursSet {
  repo: string;
  revision: string;
  config: string;
  split: string;
  licence: string;
  lang: 'fr' | 'wo';
  utterances: { id: string; file: string; path: string; text: string }[];
}

interface PackInfo {
  id: string;
  languages: string[];
  prompts: Record<string, number[]>;
  source: Record<string, string>;
  tools: Record<string, string>;
  files: { path: string; bytes: number; sha256: string }[];
}

type Transcriber = (
  audio: Float32Array,
  options: { decoder_input_ids: number[]; max_new_tokens: number },
) => Promise<unknown>;

function argValues(args: string[], name: string): string[] {
  const values: string[] = [];
  args.forEach((arg, i) => {
    if (arg === name && args[i + 1] !== undefined) values.push(args[i + 1] as string);
  });
  return values;
}

function textOf(output: unknown): string {
  const first: unknown = Array.isArray(output) ? output[0] : output;
  if (typeof first === 'object' && first !== null && 'text' in first) {
    return String(first.text).trim();
  }
  throw new Error('The speech model returned no text.');
}

/** The CPU name without the padding some systems add. */
function cpuModel(): string {
  return (os.cpus()[0]?.model ?? 'unknown CPU').replace(/\s+/gu, ' ').trim();
}

function load16k(file: string): Float32Array {
  const wav = decodeWav(new Uint8Array(readFileSync(file)));
  if (wav.sampleRate !== 16000) {
    throw new Error(`${file} is ${String(wav.sampleRate)} Hz: record or convert to 16 kHz`);
  }
  return wav.samples;
}

function fetchFleurs(dataDir: string, count: number): void {
  const venv = path.join(ROOT, 'speech', 'convert', '.venv');
  const python = [path.join(venv, 'Scripts', 'python.exe'), path.join(venv, 'bin', 'python')].find(
    existsSync,
  );
  if (python === undefined) {
    throw new Error(
      'FLEURS subsets are missing and the conversion venv does not exist: run `pnpm voice:convert` once, or `sh tools/hygiene/py.sh -m venv speech/convert/.venv` and install speech/convert/requirements.txt.',
    );
  }
  const done = spawnSync(
    python,
    [
      path.join(ROOT, 'speech', 'eval', 'fetch_fleurs.py'),
      '--data-dir',
      dataDir,
      '--count',
      String(count),
    ],
    { stdio: 'inherit' },
  );
  if (done.status !== 0) throw new Error('Downloading the FLEURS subsets failed');
}

async function loadFleurs(dataDir: string, lang: 'fr' | 'wo', count: number): Promise<FleursSet> {
  const file = path.join(dataDir, `fleurs-${lang}.json`);
  const read = async (): Promise<FleursSet> =>
    JSON.parse(await readFile(file, 'utf8')) as FleursSet;
  const cached = existsSync(file) ? await read() : undefined;
  // Another revision of the dataset is not the pinned one: fetch it again.
  let set: FleursSet;
  if (cached !== undefined && cachedSubsetUsable(cached, count)) {
    set = cached;
  } else {
    fetchFleurs(dataDir, count);
    set = await read();
  }
  return { ...set, utterances: set.utterances.slice(0, count) };
}

let resolverIndex: ResolverIndex | undefined;
async function resolver(): Promise<ResolverIndex> {
  resolverIndex ??= buildIndex(entriesFromPack(buildPack(await loadContent(ROOT))));
  return resolverIndex;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dataDir = argValues(args, '--data-dir')[0] ?? process.env['SPEECH_EVAL_DATA'];
  const noFleurs = args.includes('--no-fleurs');
  if (!noFleurs && dataDir === undefined) {
    throw new Error(
      '--data-dir <folder outside the repository> is required for the FLEURS subsets',
    );
  }
  const count = Number(argValues(args, '--count')[0] ?? 100);
  const date = argValues(args, '--date')[0] ?? new Date().toISOString().slice(0, 10);
  const outDir = argValues(args, '--out-dir')[0] ?? path.join(ROOT, 'eval', 'speech', 'results');
  const packDirArg = argValues(args, '--pack-dir')[0];
  const packDir =
    packDirArg ??
    [path.join(ROOT, 'app', 'public', 'voice'), path.join(ROOT, 'speech', 'convert', 'out')].find(
      (dir) => existsSync(path.join(dir, 'whisper-small-wolof-q8')),
    );
  if (packDir === undefined) throw new Error('No voice pack found: run `pnpm voice:convert`');
  const packs = argValues(args, '--pack').length > 0 ? argValues(args, '--pack') : DEFAULT_PACKS;
  // q8 (default, the shipped packs) or q4 (the 4-bit experiment, speech/convert/quantize_q4.py).
  const dtype = argValues(args, '--dtype')[0] ?? 'q8';
  if (dtype !== 'q8' && dtype !== 'q4') throw new Error('--dtype must be q8 or q4');

  const manifestFile = path.join(ROOT, 'eval', 'speech', 'manifest.yaml');
  const manifest = parseManifest(await readFile(manifestFile, 'utf8'));

  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${packDir}${path.sep}`;

  const rows: SummaryRow[] = [];
  const datasets: string[] = [];
  const names: NameRow[] = [];
  const fleursSets: FleursSet[] = [];
  if (!noFleurs && dataDir !== undefined) {
    for (const lang of ['wo', 'fr'] as const)
      fleursSets.push(await loadFleurs(dataDir, lang, count));
  }
  for (const set of fleursSets) {
    datasets.push(
      `FLEURS \`${set.config}\` ${set.split} split, first ${String(set.utterances.length)} distinct sentences, one reading each (${set.repo}, revision \`${set.revision}\`, ${set.licence}); downloaded at run time, not committed.`,
    );
  }
  datasets.push(
    manifest.length === 0
      ? 'Volunteer recordings (`eval/speech/manifest.yaml`): none yet, pending recordings.'
      : `Volunteer recordings (\`eval/speech/manifest.yaml\`): ${String(manifest.length)} entries.`,
  );

  let transformersVersion = '';
  for (const id of packs) {
    const info = JSON.parse(
      await readFile(path.join(packDir, id, 'voice-pack.json'), 'utf8'),
    ) as PackInfo;
    const transcriber = (await pipeline('automatic-speech-recognition', id, {
      dtype,
      device: 'cpu',
      local_files_only: true,
    })) as unknown as Transcriber;
    transformersVersion = (env as unknown as { version: string }).version;

    const sets: Record<string, unknown> = {};
    for (const lang of info.languages) {
      const prompt = info.prompts[lang];
      if (prompt === undefined) continue;
      const transcribe = async (samples: Float32Array): Promise<string> =>
        textOf(
          await transcriber(samples, { decoder_input_ids: prompt, max_new_tokens: MAX_NEW_TOKENS }),
        );
      const progress = (label: string) => (done: number, total: number) =>
        process.stdout.write(
          `\r${id} ${label} ${String(done)}/${String(total)}${done === total ? '\n' : ''}`,
        );
      const fleurs = fleursSets.find((s) => s.lang === lang);
      if (fleurs !== undefined) {
        const items = fleurs.utterances.map((u) => ({
          id: u.id,
          text: u.text,
          samples: load16k(u.path),
        }));
        const results = await transcribeAll(transcribe, items, progress(`fleurs ${lang}`));
        const label = `FLEURS ${fleurs.config}`;
        const summary = summariseSet(results);
        rows.push({ pack: id, set: label, summary });
        // FLEURS references derive from FLoRes (licence to be checked): not committed.
        // The ids and the pinned revision let anyone re-fetch them and recompute.
        sets[label] = {
          dataset: { ...fleurs, utterances: undefined },
          summary,
          results: withoutReference(results),
        };
      }
      if (manifest.some((e) => e.lang === lang || e.lang === 'mix')) {
        const index = await resolver();
        const volunteers = await evaluateVolunteers({
          entries: manifest,
          packLanguage: lang,
          load: (file) => load16k(path.join(ROOT, 'eval', 'speech', 'audio', file)),
          transcribe,
          lookup: (text) => search(index, text).map((c) => c.id),
          onProgress: (set, done, total) => progress(set)(done, total),
        });
        for (const v of volunteers) {
          rows.push({ pack: id, set: v.set, summary: v.summary });
          names.push({ pack: id, set: v.set, ...v.name });
          sets[v.set] = { summary: v.summary, name: v.name, results: v.results };
        }
      }
    }

    await mkdir(outDir, { recursive: true });
    const file = path.join(outDir, `${date}-${id}.json`);
    await writeFile(
      file,
      `${JSON.stringify(
        {
          date,
          pack: id,
          source: info.source,
          convertTools: info.tools,
          graphs: info.files.filter((f) => f.path.startsWith('onnx/')),
          decoding: { maxNewTokens: MAX_NEW_TOKENS, strategy: 'greedy', prompts: info.prompts },
          runtime: {
            transformersJs: transformersVersion,
            node: process.version,
            device: 'cpu (onnxruntime-node)',
            platform: `${os.platform()} ${os.arch()}`,
            cpu: cpuModel(),
            logicalCores: os.cpus().length,
          },
          sets,
        },
        null,
        1,
      )}\n`,
    );
    console.log(`Wrote ${path.relative(ROOT, file)}`);
  }

  const environment = [
    `Packs: ${packs.map((p) => `\`${p}\``).join(', ')}, the ${dtype === 'q4' ? '4-bit (MatMulNBits)' : '8-bit'} ONNX graphs of the voice packs (\`speech/convert/\`), read from \`${path.basename(packDir)}\`.`,
    `Decoding: greedy, at most ${String(MAX_NEW_TOKENS)} new tokens, the decoder prompt recorded in each pack (Wolof: \`<|startoftranscript|>\` alone; French: \`<|startoftranscript|><|fr|><|transcribe|><|notimestamps|>\`), as the browser worker.`,
    `Runtime: Transformers.js ${transformersVersion} in Node ${process.version} with onnxruntime-node (CPU), ${os.platform()} ${os.arch()}, ${cpuModel()}, ${String(os.cpus().length)} logical cores. The browser uses ONNX Runtime Web (WebAssembly): same graphs, same decoding, but another ONNX Runtime build, so a word or two may differ.`,
    'Times are from this machine, not from a phone: see `docs/voice.md` for phone timings.',
    'Wolof honesty note: the training data of the Wolof fine-tune lists FLEURS `wo_sn` among its sources (splits not stated), so the FLEURS Wolof figure may be optimistic. Only recordings never used in training measure the model fairly.',
    'Sample size: 100 sentences per language is small; read the figures as indications, not as precise rates. Wolof spelling varies, and each variant counts as an error.',
  ];
  const summary = renderMarkdown({
    date,
    rows,
    names,
    environment,
    datasets,
  });
  const summaryFile = path.join(outDir, `${date}-summary.md`);
  await writeFile(summaryFile, summary);
  console.log(`Wrote ${path.relative(ROOT, summaryFile)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
