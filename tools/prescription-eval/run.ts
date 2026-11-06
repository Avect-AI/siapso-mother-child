// SPDX-License-Identifier: MIT
// pnpm eval:prescription: the evaluation of the prescription reading
// (evaluate.ts) on eval/prescription/, with the pack built from the
// repository. Exit code 1 when a bar of eval/prescription/baseline.json fails.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './evaluate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
main(root).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
