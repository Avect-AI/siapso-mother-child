// SPDX-License-Identifier: MIT
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { SCHEMA_NAMES } from './types.js';
import type { Problem, RawContent, RawFile, SchemaName } from './types.js';

/** The licence line every content file starts with (the licence of the content). */
export const LICENCE_LINE = '# SPDX-License-Identifier: CC-BY-4.0';

/** Where each JSON Schema lives, relative to the schema root. */
export const SCHEMA_FILES: Readonly<Record<SchemaName, string>> = {
  rule: 'knowledge/schema/rule.schema.json',
  message: 'knowledge/schema/message.schema.json',
  'danger-sign': 'knowledge/schema/danger-sign.schema.json',
  'pack-meta': 'knowledge/schema/pack-meta.schema.json',
  sources: 'knowledge/schema/sources.schema.json',
  substance: 'registry/schema/substance.schema.json',
  class: 'registry/schema/class.schema.json',
  product: 'registry/schema/product.schema.json',
  plant: 'registry/schema/plant.schema.json',
};

function isMissing(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadSchemas(schemaRoot: string): Promise<Record<SchemaName, object>> {
  const schemas: Partial<Record<SchemaName, object>> = {};
  for (const name of SCHEMA_NAMES) {
    const file = path.join(schemaRoot, SCHEMA_FILES[name]);
    try {
      schemas[name] = JSON.parse(await readFile(file, 'utf8')) as object;
    } catch (error) {
      throw new Error(`Cannot read the schema ${file}: ${describe(error)}`, { cause: error });
    }
  }
  return schemas as Record<SchemaName, object>;
}

/** Reads and parses one YAML file; a problem is recorded instead of throwing. */
async function readYaml(root: string, file: string, problems: Problem[]): Promise<RawFile | null> {
  let text: string;
  try {
    text = await readFile(path.join(root, file), 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const withoutBom = text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text;
  const firstLine = withoutBom.split(/\r?\n/, 1)[0];
  if (firstLine !== LICENCE_LINE) {
    problems.push({ file, path: '', message: `the first line must be "${LICENCE_LINE}"` });
  }
  const document = parseDocument(text, { uniqueKeys: true });
  const [error] = document.errors;
  if (error) {
    problems.push({ file, path: '', message: `YAML error: ${error.message}` });
    return null;
  }
  return { file, data: document.toJS() as unknown, text };
}

/** The entries of a folder in name order, without `.gitkeep`; a missing folder holds none. */
async function entriesOf(root: string, folder: string): Promise<Dirent[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(path.join(root, folder), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.name !== '.gitkeep')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const AUDIO = /\.(wav|flac|ogg|opus|webm|mp3)$/;
const TEXT = /\.(md|json)$/;

/** A text file, kept whole so that its names and URLs can be scanned. */
async function readText(root: string, file: string): Promise<RawFile> {
  const text = await readFile(path.join(root, file), 'utf8');
  return { file, data: text };
}

/**
 * Every `.yaml` file of a folder, in name order. With `texts` the walk goes
 * below the folder, `.md` and `.json` files are read as text into `texts` and
 * audio files are skipped. Any other file, and a folder without `texts`, is a
 * problem.
 */
async function readFolder(
  root: string,
  folder: string,
  problems: Problem[],
  texts?: RawFile[],
): Promise<RawFile[]> {
  const files: RawFile[] = [];
  for (const entry of await entriesOf(root, folder)) {
    const file = `${folder}/${entry.name}`;
    if (texts && entry.isDirectory()) {
      files.push(...(await readFolder(root, file, problems, texts)));
    } else if (texts && entry.isFile() && AUDIO.test(entry.name)) {
      // Audio is accepted without a scan.
    } else if (texts && entry.isFile() && TEXT.test(entry.name)) {
      texts.push(await readText(root, file));
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      const parsed = await readYaml(root, file, problems);
      if (parsed) files.push(parsed);
    } else {
      problems.push({
        file,
        path: '',
        message: 'unexpected file: content files must be .yaml files',
      });
    }
  }
  return files;
}

/** What each content root may hold at its top level; anything else escapes the checks. */
const KNOWN_TOP_LEVEL: Readonly<Record<string, readonly string[]>> = {
  knowledge: [
    'pack.yaml',
    'sources.yaml',
    'danger-signs.yaml',
    'README.md',
    'schema',
    'rules',
    'messages',
  ],
  registry: ['substances.yaml', 'classes.yaml', 'README.md', 'schema', 'products', 'plants'],
};

/** Reports what the top level of `knowledge/` and `registry/` holds beyond the known files. */
async function checkTopLevel(root: string, problems: Problem[], texts: RawFile[]): Promise<void> {
  for (const [folder, known] of Object.entries(KNOWN_TOP_LEVEL)) {
    for (const entry of await entriesOf(root, folder)) {
      if (entry.name === 'README.md' && entry.isFile()) {
        texts.push(await readText(root, `${folder}/README.md`));
      } else if (!known.includes(entry.name)) {
        problems.push({
          file: `${folder}/${entry.name}`,
          path: '',
          message: 'unexpected file: it is not part of the content layout and would not be checked',
        });
      }
    }
  }
}

/**
 * Reads the content under `root` (`knowledge/` and `registry/`): every YAML
 * file parsed, with its path relative to `root`, plus the JSON Schemas read
 * from `schemaRoot` (the content root by default). Problems that are not
 * about one value (unreadable YAML, unexpected files, missing licence line)
 * are kept in `problems`. Throws only when a schema cannot be read.
 */
export async function loadContent(root: string, schemaRoot: string = root): Promise<RawContent> {
  const schemas = await loadSchemas(schemaRoot);
  const problems: Problem[] = [];
  const raw: RawContent = {
    schemas,
    rules: await readFolder(root, 'knowledge/rules', problems),
    messages: await readFolder(root, 'knowledge/messages', problems),
    products: await readFolder(root, 'registry/products', problems),
    plants: await readFolder(root, 'registry/plants', problems),
    extra: [],
    texts: [],
    problems,
  };
  raw.extra = await readFolder(root, 'eval', problems, raw.texts);
  await checkTopLevel(root, problems, raw.texts);
  const single = async (file: string): Promise<RawFile | undefined> =>
    (await readYaml(root, file, problems)) ?? undefined;
  const pack = await single('knowledge/pack.yaml');
  const dangerSigns = await single('knowledge/danger-signs.yaml');
  const substances = await single('registry/substances.yaml');
  const classes = await single('registry/classes.yaml');
  const sources = await single('knowledge/sources.yaml');
  if (sources) raw.sources = sources;
  if (pack) raw.pack = pack;
  if (dangerSigns) raw.dangerSigns = dangerSigns;
  if (substances) raw.substances = substances;
  if (classes) raw.classes = classes;
  return raw;
}
