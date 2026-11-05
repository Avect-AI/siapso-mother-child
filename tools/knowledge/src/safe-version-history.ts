// SPDX-License-Identifier: MIT
// Once set, minimum-safe-version in knowledge/pack.yaml never decreases and
// is never removed: lowering it would let phones roll back to a pack the team
// withdrew. `siapso-pack check` compares it with its value on origin/main
// (CI fetches it), and skips the comparison when that revision or git is not
// available.
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import type { Problem } from './types.js';
import { compareVersions, isVersion } from './version.js';

/** The revision the minimum safe version is compared with by default. */
export const BASE_REF = 'origin/main';

/**
 * The text of knowledge/pack.yaml at git revision `ref`, the path taken
 * relative to `root`; null when git, the repository, the revision or the
 * file is not available.
 */
export function packYamlAt(root: string, ref: string): string | null {
  const result = spawnSync('git', ['show', `${ref}:./knowledge/pack.yaml`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) return null;
  return result.stdout;
}

/** The minimum-safe-version of a pack.yaml text, when it has a valid one. */
export function minimumSafeVersionIn(text: string): string | undefined {
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    return undefined;
  }
  const minimum = (data as { 'minimum-safe-version'?: unknown } | null)?.['minimum-safe-version'];
  return isVersion(minimum) ? minimum : undefined;
}

/** The problem when `current` is below or without the value `base` had at `ref`. */
export function safeVersionHistoryProblems(
  current: string | undefined,
  base: string | undefined,
  ref: string,
): Problem[] {
  if (base === undefined) return [];
  const where = { file: 'knowledge/pack.yaml', path: 'minimum-safe-version' };
  if (current === undefined) {
    return [{ ...where, message: `must not be removed: it is ${base} on ${ref}` }];
  }
  if (isVersion(current) && compareVersions(current, base) < 0) {
    return [
      { ...where, message: `must not go below ${base}, its value on ${ref}: it never decreases` },
    ];
  }
  return [];
}
