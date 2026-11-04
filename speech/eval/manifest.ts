// SPDX-License-Identifier: MIT
// Validation of eval/speech/manifest.yaml against its JSON Schema, plus the
// rule that an audio file is listed once.
import { readFileSync } from 'node:fs';
import type { ErrorObject } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';

export type SpeechLang = 'fr' | 'wo' | 'mix';

export interface ManifestEntry {
  file: string;
  text: string;
  lang: SpeechLang;
  expect?: string;
  speaker: string;
  consent: string;
  licence: 'CC-BY-4.0';
}

const schema: unknown = JSON.parse(
  readFileSync(new URL('../../eval/speech/manifest.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({ allErrors: false, strict: true }).compile<ManifestEntry[]>(
  schema as object,
);

function describeError(error: ErrorObject | undefined): string {
  const [index, key] = (error?.instancePath ?? '').split('/').slice(1);
  if (error === undefined || index === undefined) return 'the manifest must be a list of entries';
  const where = `entry #${String(Number(index) + 1)}`;
  if (error.keyword === 'required') {
    return `${where}: "${(error.params as { missingProperty: string }).missingProperty}" is missing`;
  }
  if (error.keyword === 'additionalProperties') {
    return `${where}: unknown key "${(error.params as { additionalProperty: string }).additionalProperty}"`;
  }
  return `${where}: "${key ?? ''}" ${error.message ?? 'is not valid'}`;
}

/** Parses and validates the manifest text (YAML); throws a readable error naming the entry. */
export function parseManifest(text: string): ManifestEntry[] {
  const data: unknown = parse(text);
  if (!validate(data)) throw new Error(describeError(validate.errors?.[0]));
  const seen = new Set<string>();
  data.forEach((entry, position) => {
    if (seen.has(entry.file)) {
      throw new Error(`entry #${String(position + 1)}: "${entry.file}" is listed twice`);
    }
    seen.add(entry.file);
  });
  return data;
}
