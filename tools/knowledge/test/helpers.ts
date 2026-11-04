// SPDX-License-Identifier: MIT
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { loadContent } from '../src/index.js';
import type { Problem, RawContent, RawFile } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ROOT = path.join(HERE, 'fixtures', 'valid');
/** The repository root: the schemas under test are the real ones. */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export type Dict = Record<string, unknown>;

export async function loadValid(): Promise<RawContent> {
  return loadContent(FIXTURE_ROOT, REPO_ROOT);
}

/** A deep copy that tests may change freely. */
export function copyOf(raw: RawContent): RawContent {
  return structuredClone(raw);
}

export function dict(value: unknown): Dict {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  return value as Dict;
}

export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected a list');
  return value;
}

export function sub(value: Dict, key: string): Dict {
  return dict(value[key]);
}

export type Folder = 'rules' | 'messages' | 'products' | 'plants';

export function fileOf(raw: RawContent, folder: Folder, name: string): RawFile {
  const found = raw[folder].find((f) => f.file.endsWith(`/${name}.yaml`));
  if (!found) throw new Error(`No fixture file ${folder}/${name}`);
  return found;
}

/** Changes the data of one one-file-per-entry fixture file. */
export function patch(raw: RawContent, folder: Folder, name: string, change: (d: Dict) => void) {
  change(dict(fileOf(raw, folder, name).data));
  return raw;
}

/** Changes the entry `id` of one of the list files (substances, classes, danger signs). */
export function patchEntry(
  raw: RawContent,
  key: 'substances' | 'classes' | 'dangerSigns',
  id: string,
  change: (d: Dict) => void,
) {
  const file = raw[key];
  if (!file) throw new Error(`No ${key} file`);
  const entry = list(file.data).find((e) => dict(e).id === id);
  change(dict(entry));
  return raw;
}

export function expectProblem(
  problems: Problem[],
  expected: { file: string; path?: string; message?: RegExp },
): void {
  const found = problems.filter(
    (p) =>
      p.file === expected.file &&
      (expected.path === undefined || p.path === expected.path) &&
      (expected.message?.test(p.message) ?? true),
  );
  expect(found, JSON.stringify(problems, null, 1)).not.toHaveLength(0);
}

/** Copies the valid fixture tree to a temporary directory. */
export async function tempCopy(): Promise<{ root: string; remove: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'siapso-pack-'));
  await cp(FIXTURE_ROOT, root, { recursive: true });
  return { root, remove: () => rm(root, { recursive: true, force: true }) };
}
