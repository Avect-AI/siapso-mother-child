// SPDX-License-Identifier: MIT
import path from 'node:path';
import type { Pack } from '@siapso/engine';
import { buildPack, PackBuildError } from './build.js';
import { loadContent } from './load.js';
import { formatProblem } from './validate.js';
import { writePack } from './write.js';

export interface CliIo {
  /** The directory the command runs in; the default content root. */
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = [
  'usage: siapso-pack <command> [options]',
  '',
  'commands:',
  '  check   validate knowledge/ and registry/ (problems are printed as file: path: message)',
  '  build   validate, then write the pack fragments, pack.json and manifest.json',
  '',
  'options:',
  '  --root <dir>      repository root holding knowledge/ and registry/ (default: current directory)',
  '  --schemas <dir>   directory holding the schemas (default: the root)',
  '  --out <dir>       build output directory (default: <root>/app/public/pack)',
];

interface Options {
  command: 'check' | 'build';
  root: string;
  schemas: string;
  out: string;
}

/** Parses the arguments; a string is a usage error message. */
function parseArguments(argv: string[], cwd: string): Options | string {
  const [command, ...rest] = argv;
  if (command !== 'check' && command !== 'build') {
    return command === undefined ? 'missing command' : `unknown command "${command}"`;
  }
  const values: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (flag !== '--root' && flag !== '--schemas' && flag !== '--out') {
      return `unknown option "${String(flag)}"`;
    }
    if (value === undefined) return `${flag} needs a value`;
    values[flag] = path.resolve(cwd, value);
  }
  const root = values['--root'] ?? cwd;
  return {
    command,
    root,
    schemas: values['--schemas'] ?? root,
    out: values['--out'] ?? path.join(root, 'app', 'public', 'pack'),
  };
}

/** Runs the command line and returns the exit code: 0 ok, 1 problems found, 2 wrong usage. */
export async function main(
  argv: string[],
  io: CliIo = {
    cwd: process.cwd(),
    out: (line) => {
      console.log(line);
    },
    err: (line) => {
      console.error(line);
    },
  },
): Promise<number> {
  const options = parseArguments(argv, io.cwd);
  if (typeof options === 'string') {
    io.err(`error: ${options}`);
    for (const line of USAGE) io.err(line);
    return 2;
  }
  try {
    const raw = await loadContent(options.root, options.schemas);
    // buildPack validates the content; its error carries the problems.
    let pack: Pack;
    try {
      pack = buildPack(raw);
    } catch (error) {
      if (!(error instanceof PackBuildError)) throw error;
      for (const problem of error.problems) io.err(formatProblem(problem));
      io.err(`${String(error.problems.length)} problem(s) found`);
      return 1;
    }
    if (options.command === 'build') await writePack(pack, options.out);
    io.out(
      `${options.command === 'build' ? 'built' : 'ok'}: ${String(pack.rules.length)} rules, ` +
        `${String(pack.products.length)} products, ${String(pack.plants.length)} plants, ` +
        `${String(pack.substances.length)} substances, ${String(Object.keys(pack.messages.fr).length)} messages`,
    );
    return 0;
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
