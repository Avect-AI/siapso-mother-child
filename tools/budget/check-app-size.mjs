// SPDX-License-Identifier: MIT
// App size budget (implementation design, section 7.2): everything the phone
// downloads to run the app (HTML, JavaScript, CSS, fonts, icons, web app
// manifest, service worker) stays at or under 1.5 MB uncompressed. The
// knowledge pack (pack/) and the voice files (voice/) have budgets of their
// own and are left out. Run after `pnpm build` (app/dist-demo) or a release build (app/dist):
//   node tools/budget/check-app-size.mjs [dist directory, default app/dist]
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMIT_BYTES = 1_572_864;

/** Top-level folders of the build that the app budget does not count. */
export const EXCLUDED = new Set(['pack', 'voice']);

const DEFAULT_DIST = fileURLToPath(new URL('../../app/dist/', import.meta.url));

/** Every counted file under `dir` (forward-slash paths), largest first, and their total. */
export async function measure(dir) {
  const files = [];
  async function walk(relative) {
    for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (relative === '' && EXCLUDED.has(entry.name)) continue;
        await walk(child);
      } else if (entry.isFile()) {
        files.push({ path: child, bytes: (await stat(path.join(dir, child))).size });
      }
    }
  }
  await walk('');
  files.sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  return { total: files.reduce((sum, f) => sum + f.bytes, 0), files };
}

function kilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Measures `dir`, reports through `log` and returns the exit code: 0 within budget, 1 otherwise. */
export async function checkAppSize(dir, log = console.log) {
  let result;
  try {
    result = await measure(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      log(`No build in ${dir}: run pnpm build (or pnpm release:build for a release) first.`);
      return 1;
    }
    throw error;
  }
  const { total, files } = result;
  if (files.length === 0) {
    log(`No app file in ${dir} (pack/ and voice/ are not counted): the build looks broken.`);
    return 1;
  }
  for (const f of files.slice(0, 8)) log(`  ${kilobytes(f.bytes).padStart(10)}  ${f.path}`);
  if (files.length > 8) log(`  ... and ${String(files.length - 8)} smaller files`);
  const summary = `App size: ${String(total)} bytes (${kilobytes(total)}) in ${String(files.length)} files, budget ${String(LIMIT_BYTES)} bytes (1.5 MB), pack/ and voice/ excluded.`;
  log(summary);
  if (total > LIMIT_BYTES) {
    const over = total - LIMIT_BYTES;
    log(
      `The app is over the ${String(LIMIT_BYTES)} byte budget by ${String(over)} byte${over === 1 ? '' : 's'}.`,
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await checkAppSize(path.resolve(process.argv[2] ?? DEFAULT_DIST));
}
