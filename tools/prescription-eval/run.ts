// SPDX-License-Identifier: MIT
// pnpm eval:prescription: the evaluation of the prescription reading
// (evaluate.ts) on eval/prescription/, with the pack built from the
// repository. Exit code 1 when a bar of eval/prescription/baseline.json fails.
// With --fresh (pnpm eval:prescription:fresh): the measure of the fresh
// held-out set (eval/prescription/fresh/), which has no bar.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, mainFresh } from './evaluate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
(process.argv.includes('--fresh') ? mainFresh(root) : main(root)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
