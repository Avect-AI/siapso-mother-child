// SPDX-License-Identifier: MIT
import type { Lang, Message, Pack, Plant, Product, Rule, Source } from '@siapso/engine';
import { citedSources } from './provenance.js';
import type { AuthoredPlant, AuthoredProduct, Content, Entry } from './types.js';

/** Code unit order: the same on every machine, whatever its locale. */
function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function byId(a: { id: string }, b: { id: string }): number {
  return compare(a.id, b.id);
}

function camel(key: string): string {
  return key.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/** Copies a JSON value with its object keys turned from kebab-case to camelCase. */
function camelKeys(value: unknown): unknown {
  if (Array.isArray(value)) return (value as unknown[]).map(camelKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [camel(key), camelKeys(item)]),
    );
  }
  return value;
}

// Product `source` (BDPM code or demo marker) and plant `parts` are authoring
// metadata: the schemas validate them, but the runtime pack does not carry them.
function product({ data }: Entry<AuthoredProduct>): Product {
  return {
    id: data.id,
    names: data.names,
    brands: data.brands,
    localNames: data['local-names'],
    components: data.components.map((c) =>
      c['strength-mg'] === undefined
        ? { substance: c.substance }
        : { substance: c.substance, strengthMg: c['strength-mg'] },
    ),
    form: data.form,
    route: data.route,
    demo: data.demo,
  };
}

function plant({ data }: Entry<AuthoredPlant>): Plant {
  return {
    id: data.id,
    latinName: data['latin-name'],
    names: data.names,
    localNames: data['local-names'],
    evidence: data.evidence,
    message: data.message,
    sources: data.sources,
  };
}

/** The sources actually cited (allowed and fact-only), sorted by id. */
function sources(content: Content): Source[] {
  const { allowed, factOnly } = citedSources(content);
  return [...allowed, ...factOnly]
    .sort((a, b) => compare(a.id, b.id))
    .map((s) => {
      const version = s.version ?? s.accessed;
      const base = { id: s.id, name: s.name, licence: s.licence, url: s.url };
      return version === undefined ? base : { ...base, version };
    });
}

function messages(content: Content, lang: Lang): Record<string, Message> {
  const result: Record<string, Message> = {};
  for (const { data } of [...content.messages].sort((a, b) => byId(a.data, b.data))) {
    result[data.id] = camelKeys(data[lang]) as Message;
  }
  return result;
}

/**
 * Builds the engine pack from schema-valid content: kebab-case keys become
 * camelCase, every array is sorted by id, nothing depends on the clock.
 * Throws if the content has no pack.yaml.
 */
export function assemble(content: Content): Pack {
  const meta = content.meta?.data;
  if (!meta) throw new Error('knowledge/pack.yaml is missing');
  const sorted = <T extends { id: string }>(entries: { data: T }[]): T[] =>
    entries.map((e) => e.data).sort(byId);
  return {
    schema: 1,
    version: meta.version,
    date: meta.date,
    clinicallyValidated: meta['clinically-validated'],
    substances: sorted(content.substances),
    classes: sorted(content.classes),
    products: [...content.products].sort((a, b) => byId(a.data, b.data)).map(product),
    plants: [...content.plants].sort((a, b) => byId(a.data, b.data)).map(plant),
    rules: sorted(content.rules).map((rule) => camelKeys(rule) as Rule),
    dangerSigns: sorted(content.dangerSigns).map(
      (sign) => camelKeys(sign) as Pack['dangerSigns'][number],
    ),
    sources: sources(content),
    messages: { fr: messages(content, 'fr'), en: messages(content, 'en') },
  };
}
