// SPDX-License-Identifier: MIT
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pack } from '@siapso/engine';
import { buildPack, PackBuildError } from './build.js';
import { importBdpm, renderProducts } from './import-bdpm.js';
import { loadContent } from './load.js';
import { generateNotice, NOTICE_FILE } from './notice.js';
import type { Problem, RawContent } from './types.js';
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
  '  check              validate knowledge/ and registry/ and that NOTICE is up to date',
  '                     (problems are printed as file: path: message)',
  '  build              validate, then write the pack fragments, pack.json, manifest.json and NOTICE',
  '  import-bdpm <dir>  read CIS_bdpm.txt and CIS_COMPO_bdpm.txt in <dir> and write',
  '                     registry/products/bdpm.yaml',
  '',
  'options:',
  '  --root <dir>      repository root holding knowledge/ and registry/ (default: current directory)',
  '  --schemas <dir>   directory holding the schemas (default: the root)',
  '  --out <dir>       build output directory (default: <root>/app/public/pack)',
];

/** The generated product file written by import-bdpm, relative to the root. */
export const BDPM_PRODUCTS_FILE = 'registry/products/bdpm.yaml';

interface Options {
  command: 'check' | 'build' | 'import-bdpm';
  root: string;
  schemas: string;
  out: string;
  /** import-bdpm: the folder holding the BDPM files. */
  bdpm?: string;
}

/** Parses the arguments; a string is a usage error message. */
function parseArguments(argv: string[], cwd: string): Options | string {
  const [command, ...given] = argv;
  if (command !== 'check' && command !== 'build' && command !== 'import-bdpm') {
    return command === undefined ? 'missing command' : `unknown command "${command}"`;
  }
  let rest = given;
  let bdpm: string | undefined;
  if (command === 'import-bdpm') {
    const [dir, ...after] = given;
    if (dir === undefined || dir.startsWith('--')) {
      return 'import-bdpm needs the folder holding the BDPM files';
    }
    bdpm = path.resolve(cwd, dir);
    rest = after;
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
  const options: Options = {
    command,
    root,
    schemas: values['--schemas'] ?? root,
    out: values['--out'] ?? path.join(root, 'app', 'public', 'pack'),
  };
  if (bdpm !== undefined) options.bdpm = bdpm;
  return options;
}

/** The ids of registry/substances.yaml, as read. */
function substanceIds(raw: RawContent): Set<string> {
  const ids = new Set<string>();
  const data: unknown = raw.substances?.data;
  if (Array.isArray(data)) {
    for (const item of data as unknown[]) {
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

/** import-bdpm: writes registry/products/bdpm.yaml and prints a summary. */
async function importCommand(options: Options, bdpm: string, io: CliIo): Promise<number> {
  const raw = await loadContent(options.root, options.schemas);
  const substances = substanceIds(raw);
  if (substances.size === 0) {
    io.err('error: registry/substances.yaml lists no substance: nothing can be imported');
    return 1;
  }
  const { products, perSubstance, inputs } = await importBdpm(bdpm, substances);
  await writeFile(path.join(options.root, BDPM_PRODUCTS_FILE), renderProducts(products));
  // Record these in the bdpm entry of knowledge/sources.yaml.
  for (const input of inputs) {
    io.out(`input: ${input.file}, ${String(input.bytes)} bytes, sha256 ${input.sha256}`);
  }
  io.out(`imported: ${String(products.length)} products into ${BDPM_PRODUCTS_FILE}`);
  for (const [substance, count] of Object.entries(perSubstance)) {
    io.out(`  ${substance}: ${String(count)}`);
  }
  return 0;
}

/** The problem with the committed NOTICE, if it is missing or differs from the generated one. */
async function noticeProblem(file: string, expected: string): Promise<Problem | null> {
  let actual: string;
  try {
    actual = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      file: NOTICE_FILE,
      path: '',
      message: 'missing: run "pnpm knowledge:build" to generate it',
    };
  }
  if (actual.replaceAll('\r\n', '\n') === expected) return null;
  return {
    file: NOTICE_FILE,
    path: '',
    message: 'out of date: run "pnpm knowledge:build" to regenerate it',
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
    if (options.command === 'import-bdpm' && options.bdpm !== undefined) {
      return await importCommand(options, options.bdpm, io);
    }
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
    const notice = generateNotice(raw);
    const noticePath = path.join(options.root, NOTICE_FILE);
    if (options.command === 'build') {
      await writePack(pack, options.out);
      await writeFile(noticePath, notice);
    } else {
      const problem = await noticeProblem(noticePath, notice);
      if (problem) {
        io.err(formatProblem(problem));
        io.err('1 problem(s) found');
        return 1;
      }
    }
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
