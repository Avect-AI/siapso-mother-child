// SPDX-License-Identifier: MIT
// `siapso-pack keygen`: a new key pair to sign the knowledge pack
// (docs/pack-signing.md). The private key file is written outside every
// repository, never over an existing file, and readable by its owner only;
// `siapso-pack sign` refuses to read one from inside a repository too. Links
// (symlinks, Windows junctions) are resolved first, so a link cannot lead the
// key into the repository. The file mode is not applied on Windows: keep the
// file on an encrypted drive, never in a synced folder (OneDrive and the like).
import { existsSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  generateSigningKey,
  keyFileOf,
  parseSigningKey,
  publicEntryOf,
  type PublicKeyEntry,
  type SigningKey,
} from './sign.js';

/** Whether `child` is `parent` or below it (another drive is never below). */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** `dir` with every link resolved, or `dir` itself when it does not exist. */
function realOrSame(dir: string): string {
  try {
    return realpathSync.native(dir);
  } catch {
    return dir;
  }
}

/**
 * The real path of `target`: the file itself with every link resolved when
 * it exists (it may be a link), otherwise its folder resolved (the folder
 * must exist) and its own name.
 */
function realTarget(target: string): string {
  const resolved = path.resolve(target);
  if (existsSync(resolved)) return realpathSync.native(resolved);
  const folder = path.dirname(resolved);
  let real: string;
  try {
    real = realpathSync.native(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`the folder ${folder} does not exist: create it first, on an offline drive`, {
        cause: error,
      });
    }
    throw error;
  }
  return folder === resolved ? real : path.join(real, path.basename(resolved));
}

/**
 * The repository that holds `target`, or null: `root` (the repository the
 * command runs in) when `target` is under it, or the nearest folder above
 * `target` that has a .git entry (any other git work tree). Links in the
 * folder of `target` and in `root` are resolved first; a folder that does
 * not exist is refused.
 */
export function repositoryOf(target: string, root: string): string | null {
  const resolved = realTarget(target);
  const base = realOrSame(path.resolve(root));
  if (isInside(resolved, base)) return base;
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

function refuseInsideRepository(file: string, root: string, action: string): void {
  const repository = repositoryOf(file, root);
  if (repository !== null) {
    throw new Error(
      `refusing to ${action} a private key inside the repository ${repository}: keep it outside every repository, on an offline drive`,
    );
  }
}

/**
 * Writes a new key pair to `file` (outside every repository, never over an
 * existing file, mode 600) and returns the public entry to add to
 * app/src/config/pack-keys.ts.
 */
export async function writeKeyFile(
  file: string,
  root: string,
  keyId?: string,
): Promise<PublicKeyEntry> {
  refuseInsideRepository(file, root, 'write');
  const key = generateSigningKey(keyId);
  try {
    await writeFile(file, `${JSON.stringify(keyFileOf(key), null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`${file} already exists: a key file is never overwritten`, { cause: error });
    }
    throw error;
  }
  return publicEntryOf(key);
}

/** Reads the key file given to `siapso-pack sign --key`, refused inside a repository. */
export async function readKeyFile(file: string, root: string): Promise<SigningKey> {
  refuseInsideRepository(file, root, 'read');
  return parseSigningKey(await readFile(file, 'utf8'));
}
