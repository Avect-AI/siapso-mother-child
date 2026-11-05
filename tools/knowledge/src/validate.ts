// SPDX-License-Identifier: MIT
import { PackError, parsePack } from '@siapso/engine';
import { assemble } from './assemble.js';
import { checkContent } from './checks.js';
import { provenanceProblems } from './provenance.js';
import { schemaProblems } from './schemas.js';
import { compareVersions, isVersion } from './version.js';
import type {
  AuthoredClass,
  AuthoredDangerSign,
  AuthoredMessage,
  AuthoredMeta,
  AuthoredPlant,
  AuthoredProduct,
  AuthoredRule,
  AuthoredSources,
  AuthoredSubstance,
  Content,
  Entry,
  Problem,
  RawContent,
  RawFile,
  SchemaName,
} from './types.js';

/** `file: path: message`, with `(file)` when the problem is about the whole file. */
export function formatProblem(p: Problem): string {
  return `${p.file}: ${p.path === '' ? '(file)' : p.path}: ${p.message}`;
}

/** A file holding one entry: the entry if it is schema-valid, otherwise its problems. */
function single<T>(
  raw: RawContent,
  schema: SchemaName,
  file: RawFile,
  problems: Problem[],
): Entry<T>[] {
  const found = schemaProblems(raw.schemas, schema, file.data, file.file);
  problems.push(...found);
  return found.length === 0 ? [{ file: file.file, at: '', data: file.data as T }] : [];
}

/** A file holding a list of entries, each checked on its own. */
function list<T>(
  raw: RawContent,
  schema: SchemaName,
  file: RawFile | undefined,
  problems: Problem[],
): Entry<T>[] {
  if (!file) return [];
  if (!Array.isArray(file.data)) {
    problems.push({ file: file.file, path: '', message: 'must be a list of entries' });
    return [];
  }
  const entries: Entry<T>[] = [];
  (file.data as unknown[]).forEach((data, index) => {
    const at = `[${String(index)}]`;
    const found = schemaProblems(raw.schemas, schema, data, file.file, at);
    problems.push(...found);
    if (found.length === 0) entries.push({ file: file.file, at, data: data as T });
  });
  return entries;
}

/**
 * A product file holds one product, or a list of products when it is
 * generated (registry/products/bdpm.yaml, written by the BDPM import).
 */
function products(raw: RawContent, file: RawFile, problems: Problem[]): Entry<AuthoredProduct>[] {
  return Array.isArray(file.data)
    ? list<AuthoredProduct>(raw, 'product', file, problems)
    : single<AuthoredProduct>(raw, 'product', file, problems);
}

/** Check 1: validates every file against its schema and keeps what is valid, typed. */
function collect(raw: RawContent): { content: Content; problems: Problem[] } {
  const problems: Problem[] = [];
  const content: Content = {
    rules: raw.rules.flatMap((f) => single<AuthoredRule>(raw, 'rule', f, problems)),
    messages: raw.messages.flatMap((f) => single<AuthoredMessage>(raw, 'message', f, problems)),
    products: raw.products.flatMap((f) => products(raw, f, problems)),
    plants: raw.plants.flatMap((f) => single<AuthoredPlant>(raw, 'plant', f, problems)),
    dangerSigns: list<AuthoredDangerSign>(raw, 'danger-sign', raw.dangerSigns, problems),
    substances: list<AuthoredSubstance>(raw, 'substance', raw.substances, problems),
    classes: list<AuthoredClass>(raw, 'class', raw.classes, problems),
  };
  const [meta] = raw.pack ? single<AuthoredMeta>(raw, 'pack-meta', raw.pack, problems) : [];
  if (meta) content.meta = meta;
  const [sources] = raw.sources
    ? single<AuthoredSources>(raw, 'sources', raw.sources, problems)
    : [];
  if (sources) content.sources = sources;
  const requiredFiles: [string, RawFile | undefined][] = [
    ['knowledge/pack.yaml', raw.pack],
    ['knowledge/sources.yaml', raw.sources],
    ['knowledge/danger-signs.yaml', raw.dangerSigns],
    ['registry/substances.yaml', raw.substances],
    ['registry/classes.yaml', raw.classes],
  ];
  for (const [file, found] of requiredFiles) {
    // A file that exists but cannot be read already has its own problem.
    if (!found && !raw.problems.some((p) => p.file === file)) {
      problems.push({ file, path: '', message: 'file is missing' });
    }
  }
  return { content, problems };
}

/** Where an engine error is about: the file of the rule, plant, product or list entry it names. */
function fileOfEngineError(message: string, raw: RawContent): string {
  const match = /^(rules|plants|products|substances|classes|dangerSigns) "([^"]+)"/.exec(message);
  const collection = match?.[1];
  const id = match?.[2];
  if (collection === undefined || id === undefined) return 'knowledge/pack.yaml';
  const folders: Record<string, RawFile[] | undefined> = {
    rules: raw.rules,
    plants: raw.plants,
    products: raw.products,
  };
  const files = folders[collection];
  if (files) {
    const isIt = (data: unknown): boolean => (data as { id?: unknown } | null)?.id === id;
    // A generated product file holds a list of products.
    const found = files.find((f) =>
      Array.isArray(f.data) ? (f.data as unknown[]).some(isIt) : isIt(f.data),
    );
    return found?.file ?? 'knowledge/pack.yaml';
  }
  const lists: Record<string, RawFile | undefined> = {
    substances: raw.substances,
    classes: raw.classes,
    dangerSigns: raw.dangerSigns,
  };
  return lists[collection]?.file ?? 'knowledge/pack.yaml';
}

/** Check 9: the built pack passes the engine's own validation. */
function engineProblems(content: Content, raw: RawContent): Problem[] {
  try {
    parsePack(JSON.parse(JSON.stringify(assemble(content))));
    return [];
  } catch (error) {
    if (!(error instanceof PackError)) throw error;
    return [{ file: fileOfEngineError(error.message, raw), path: '', message: error.message }];
  }
}

/**
 * Checks the content: schemas, ids, references, rule shape, evidence cap,
 * message text, builtin messages, and finally the engine's own validation of
 * the built pack. Returns every problem found; an empty list means the content
 * is valid.
 */
/** The minimum safe version of knowledge/pack.yaml may not be above its version. */
function metaProblems(content: Content): Problem[] {
  const meta = content.meta?.data;
  const minimum = meta?.['minimum-safe-version'];
  if (meta === undefined || minimum === undefined) return [];
  if (!isVersion(minimum) || !isVersion(meta.version)) return [];
  if (compareVersions(minimum, meta.version) <= 0) return [];
  return [
    {
      file: 'knowledge/pack.yaml',
      path: 'minimum-safe-version',
      message: `must not be above the version of the pack (${meta.version})`,
    },
  ];
}

export function validateContent(raw: RawContent): Problem[] {
  const { content, problems } = collect(raw);
  const all = [
    ...raw.problems,
    ...problems,
    ...metaProblems(content),
    ...checkContent(content, raw),
    ...provenanceProblems(content, raw),
  ];
  if (all.length === 0) all.push(...engineProblems(content, raw));
  return all;
}

/** The content as a typed tree, for the build; call only on content without problems. */
export function typedContent(raw: RawContent): Content {
  return collect(raw).content;
}
