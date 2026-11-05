// SPDX-License-Identifier: MIT
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pack } from '@siapso/engine';
import { buildPack, minimumSafeVersionOf, PackBuildError } from './build.js';
import { importBdpm, renderProducts } from './import-bdpm.js';
import { loadContent } from './load.js';
import { readKeyFile, writeKeyFile } from './keygen.js';
import {
  BASE_REF,
  minimumSafeVersionIn,
  packYamlAt,
  safeVersionHistoryProblems,
} from './safe-version-history.js';
import { generateNotice, NOTICE_FILE } from './notice.js';
import {
  listedPublicKeys,
  PACK_KEYS_FILE,
  parseSigningKey,
  publicEntryOf,
  SIGNATURE_FILE,
  signPack,
  type PublicKeyEntry,
  type SigningKey,
} from './sign.js';
import type { Problem, RawContent } from './types.js';
import { formatProblem } from './validate.js';
import { writePack } from './write.js';

export interface CliIo {
  /** The directory the command runs in; the default content root. */
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  /** The environment (PACK_SIGNING_KEY); the process environment by default. */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * check: the text of knowledge/pack.yaml at a git revision, or null when
   * it cannot be read (git show, by default).
   */
  readBasePackYaml?: (root: string, ref: string) => string | null;
}

const USAGE = [
  'usage: siapso-pack <command> [options]',
  '',
  'commands:',
  '  check              validate knowledge/ and registry/ and that NOTICE is up to date',
  '                     (problems are printed as file: path: message)',
  '  build              validate, then write the pack fragments, pack.json, manifest.json and NOTICE',
  '                     (the manifest is not signed)',
  '  sign               add the key id to manifest.json and write manifest.sig, signed with',
  '                     the key file of --key or the PACK_SIGNING_KEY environment variable',
  '  keygen --out <file>  write a new signing key pair to <file>, outside every repository,',
  '                     and print the public key to add to app/src/config/pack-keys.ts',
  '  import-bdpm <dir>  read CIS_bdpm.txt and CIS_COMPO_bdpm.txt in <dir> and write',
  '                     registry/products/bdpm.yaml',
  '',
  'options:',
  '  --root <dir>      repository root holding knowledge/ and registry/ (default: current directory)',
  '  --schemas <dir>   directory holding the schemas (default: the root)',
  '  --out <dir>       build and sign: the pack directory (default: <root>/app/public/pack);',
  '                    keygen: the private key file to write',
  '  --key <file>      sign: the private key file (default: PACK_SIGNING_KEY)',
  '  --key-id <id>     keygen: the key id (default: derived from the public key)',
  '  --base <ref>      check: the git revision whose minimum-safe-version must not be',
  '                    lowered or removed (default: origin/main; skipped when unavailable)',
  '',
  'See docs/pack-signing.md: a private key never goes into the repository.',
];

/** The generated product file written by import-bdpm, relative to the root. */
export const BDPM_PRODUCTS_FILE = 'registry/products/bdpm.yaml';

const COMMANDS = ['check', 'build', 'import-bdpm', 'sign', 'keygen'] as const;
type Command = (typeof COMMANDS)[number];

/** The options each command takes; every value is a path, except --key-id and --base. */
const FLAGS: Record<Command, readonly string[]> = {
  check: ['--root', '--schemas', '--out', '--base'],
  build: ['--root', '--schemas', '--out'],
  'import-bdpm': ['--root', '--schemas', '--out'],
  sign: ['--root', '--out', '--key'],
  keygen: ['--root', '--out', '--key-id'],
};

interface Options {
  command: Command;
  root: string;
  schemas: string;
  out: string;
  /** import-bdpm: the folder holding the BDPM files. */
  bdpm?: string;
  /** sign: the private key file. */
  key?: string;
  /** keygen: the key id. */
  keyId?: string;
  /** check: the git revision to compare the minimum safe version with. */
  base: string;
}

function isCommand(value: string | undefined): value is Command {
  return (COMMANDS as readonly (string | undefined)[]).includes(value);
}

/** Parses the arguments; a string is a usage error message. */
function parseArguments(argv: string[], cwd: string): Options | string {
  const [command, ...given] = argv;
  if (!isCommand(command)) {
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
    if (flag === undefined || !FLAGS[command].includes(flag)) {
      return `unknown option "${String(flag)}"`;
    }
    if (value === undefined) return `${flag} needs a value`;
    values[flag] = flag === '--key-id' || flag === '--base' ? value : path.resolve(cwd, value);
  }
  if (command === 'keygen' && values['--out'] === undefined) {
    return 'keygen needs --out <file>, a path outside the repository';
  }
  const root = values['--root'] ?? cwd;
  const options: Options = {
    command,
    root,
    schemas: values['--schemas'] ?? root,
    out: values['--out'] ?? path.join(root, 'app', 'public', 'pack'),
    base: values['--base'] ?? BASE_REF,
  };
  if (bdpm !== undefined) options.bdpm = bdpm;
  if (values['--key'] !== undefined) options.key = values['--key'];
  if (values['--key-id'] !== undefined) options.keyId = values['--key-id'];
  return options;
}

/** sign: signs the built pack with the key of --key or of PACK_SIGNING_KEY. */
async function signCommand(options: Options, io: CliIo): Promise<number> {
  const secret = (io.env ?? process.env)['PACK_SIGNING_KEY'];
  let key: SigningKey;
  if (options.key !== undefined) {
    key = await readKeyFile(options.key, options.root);
  } else if (secret !== undefined && secret !== '') {
    key = parseSigningKey(secret);
  } else {
    io.err(
      'error: sign needs a private key: --key <file> or the PACK_SIGNING_KEY environment variable',
    );
    return 1;
  }
  const manifest = await signPack(options.out, key);
  io.out(
    `signed: pack ${manifest.version} with key ${key.keyId}, ${SIGNATURE_FILE} written in ${options.out}`,
  );
  const warning = await unlistedKeyWarning(options.root, publicEntryOf(key));
  if (warning !== null) io.err(`warning: ${warning}`);
  return 0;
}

/**
 * Why the app would refuse a pack signed with `key`, judging from
 * app/src/config/pack-keys.ts under `root`, or null when it lists the key.
 */
async function unlistedKeyWarning(root: string, key: PublicKeyEntry): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, PACK_KEYS_FILE), 'utf8');
  } catch {
    return `${PACK_KEYS_FILE} cannot be read under ${root}: check that it lists key "${key.keyId}"`;
  }
  const listed = listedPublicKeys(text).get(key.keyId);
  if (listed === undefined) {
    return `key "${key.keyId}" is not listed in ${PACK_KEYS_FILE}: a release build and the app refuse this pack until its public key is added there (docs/pack-signing.md)`;
  }
  if (listed !== key.publicKey) {
    return `key "${key.keyId}" is listed in ${PACK_KEYS_FILE} with another public key: a release build and the app refuse this pack`;
  }
  return null;
}

/** keygen: writes a new key pair outside the repository and prints its public entry. */
async function keygenCommand(options: Options, io: CliIo): Promise<number> {
  const entry = await writeKeyFile(options.out, options.root, options.keyId);
  io.out(
    `private key written to ${options.out}: keep it offline, never in a repository, never sent (docs/pack-signing.md)`,
  );
  io.out(
    'never in a synced folder (OneDrive, Google Drive, Dropbox); on Windows the file is not made private to you: keep it on an encrypted drive',
  );
  io.out('add this entry to PACK_PUBLIC_KEYS in app/src/config/pack-keys.ts:');
  io.out(`  { keyId: '${entry.keyId}', publicKey: '${entry.publicKey}' },`);
  return 0;
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
    if (options.command === 'sign') return await signCommand(options, io);
    if (options.command === 'keygen') return await keygenCommand(options, io);
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
      const minimumSafeVersion = minimumSafeVersionOf(raw);
      await writePack(
        pack,
        options.out,
        minimumSafeVersion === undefined ? {} : { minimumSafeVersion },
      );
      await writeFile(noticePath, notice);
    } else {
      const problem = await noticeProblem(noticePath, notice);
      const readBase = io.readBasePackYaml ?? packYamlAt;
      const baseText = readBase(options.root, options.base);
      const problems = [
        ...(problem ? [problem] : []),
        ...safeVersionHistoryProblems(
          minimumSafeVersionOf(raw),
          baseText === null ? undefined : minimumSafeVersionIn(baseText),
          options.base,
        ),
      ];
      if (problems.length > 0) {
        for (const found of problems) io.err(formatProblem(found));
        io.err(`${String(problems.length)} problem(s) found`);
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
