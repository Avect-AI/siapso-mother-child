// SPDX-License-Identifier: MIT
// pnpm release:build --key <file>: the release build (docs/pack-signing.md).
// It builds the knowledge pack, signs it with the private key file of the
// maintainer (kept outside every repository), makes the production build of
// the app (which refuses a pack that is not signed by a key of
// app/src/config/pack-keys.ts), then checks the build marker
// app/dist/build-info.json and the app size budget. The key is only passed
// to `siapso-pack sign`; nothing here reads or prints it.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAppSize } from '../budget/check-app-size.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = path.join(ROOT, 'app', 'dist');

const USAGE =
  'usage: pnpm release:build --key <file> (the private key file, outside the repository)';

/** The options, or a usage error message. */
export function parseArguments(argv, cwd) {
  const [flag, value, ...rest] = argv;
  if (flag !== '--key' || value === undefined || value.startsWith('--')) {
    return `release:build needs --key <file>. ${USAGE}`;
  }
  if (rest.length > 0) return `unknown option "${String(rest[0])}". ${USAGE}`;
  return { key: path.resolve(cwd, value) };
}

/** What is wrong with the build marker for a release; empty when it is one. */
export function buildInfoProblems(info) {
  if (typeof info !== 'object' || info === null) {
    return ['app/dist/build-info.json is missing or unreadable'];
  }
  const problems = [];
  if (info.mode !== 'production') problems.push(`it was built in mode "${String(info.mode)}"`);
  if (info.acceptsUnsignedPack !== false) problems.push('it accepts unsigned packs');
  if (typeof info.packKeyId !== 'string' || info.packKeyId === '') {
    problems.push('its pack is not signed');
  }
  return problems;
}

/** Runs `pnpm <args>` at the repository root, without a shell, and returns its exit code. */
function runPnpm(args) {
  const pnpm = process.env['npm_execpath'];
  if (pnpm === undefined || pnpm === '') {
    throw new Error('run it through pnpm: pnpm release:build --key <file>');
  }
  const [command, prefix] = /\.[cm]?js$/.test(pnpm) ? [process.execPath, [pnpm]] : [pnpm, []];
  const result = spawnSync(command, [...prefix, ...args], { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function readBuildInfo() {
  try {
    return JSON.parse(await readFile(path.join(DIST, 'build-info.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** The release build; returns the exit code (0 ready, 1 failed, 2 wrong usage). */
export async function releaseBuild(
  argv,
  {
    run = runPnpm,
    readInfo = readBuildInfo,
    checkSize = () => checkAppSize(DIST),
    log = console.log,
    error = console.error,
    env = process.env,
    // pnpm runs the script at the repository root; INIT_CWD is the folder
    // where the maintainer typed the command, against which a relative
    // --key path is meant.
    cwd = env['INIT_CWD'] || process.cwd(),
  } = {},
) {
  const options = parseArguments(argv, cwd);
  if (typeof options === 'string') {
    error(`error: ${options}`);
    return 2;
  }
  const steps = [
    ['knowledge:build'],
    ['knowledge:sign', '--key', options.key],
    ['--filter', '@siapso/app', 'build'],
  ];
  for (const step of steps) {
    if (run(step) !== 0) {
      error(`error: pnpm ${step[0] === '--filter' ? 'build of the app' : step[0]} failed`);
      return 1;
    }
  }
  const info = await readInfo();
  const problems = buildInfoProblems(info);
  if (problems.length > 0) {
    error(`error: app/dist is not a release: ${problems.join('; ')}`);
    return 1;
  }
  if ((await checkSize()) !== 0) return 1;
  log(
    `release build ready in app/dist: pack ${String(info.packVersion)}, key ${String(info.packKeyId)}`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await releaseBuild(process.argv.slice(2));
}
