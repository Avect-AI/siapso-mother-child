// SPDX-License-Identifier: MIT
// Provenance checks: nothing may enter the open knowledge base from a source
// that is not authorised by knowledge/sources.yaml.
//
// 1. Every rule cites at least one allowed source.
// 2. Fact-only sources never stand alone in a rule.
// 3. Forbidden sources: no reference to their ids, no URL under their domains
//    and none of their names, anywhere in the content (sources.yaml excepted).
// 4. Every cited source id is declared in sources.yaml.
// 5. Danger signs and plants may cite allowed or fact-only sources.
import type { SourceRef } from '@siapso/engine';
import type { AuthoredSource, Content, Entry, Problem, RawContent, RawFile } from './types.js';

/** Between the letters of a name: nothing, or a space, hyphen, dot or underscore. */
const SEP = '[\\s._-]*';
/** A name does not start or end inside a word; digits and symbols are no part of a word. */
const START = '(?<![a-z])';
const END = '(?![a-z])';

/**
 * The names that must not appear in the content, as patterns over text
 * normalised by `normalise` (lowercase, no accents). Every name is tolerant
 * to a separator between its letters and to a digit or symbol next to it,
 * and does not match inside an ordinary word.
 */
const FORBIDDEN_NAMES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'DDInter', pattern: new RegExp(`${START}d${SEP}d${SEP}inter`) },
  { name: 'LEDIAM', pattern: new RegExp(`${START}l${SEP}e${SEP}d${SEP}i${SEP}a${SEP}m${END}`) },
  { name: 'e-lactancia', pattern: new RegExp(`${START}e${SEP}lactancia`) },
  { name: 'CRAT', pattern: new RegExp(`${START}(?:l${SEP}e${SEP})?c${SEP}r${SEP}a${SEP}t${END}`) },
  { name: 'Theriaque', pattern: new RegExp(`${START}theriaque`) },
  { name: 'Vidal', pattern: new RegExp(`${START}vidal${END}`) },
  { name: 'DrugBank', pattern: new RegExp(`${START}drug${SEP}bank`) },
];

/** Domains that are forbidden even if sources.yaml cannot be read. */
const BUILTIN_FORBIDDEN_DOMAINS: readonly string[] = [
  'ddinter.scbdd.com',
  'e-lactancia.org',
  'lecrat.fr',
  'theriaque.org',
  'vidal.fr',
  'drugbank.com',
];

/**
 * Lowercase, without accents, ignoring compatibility forms (full-width
 * letters) and invisible characters, so that a name cannot be disguised.
 */
function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase();
}

/** The text with percent-encoding undone when it is well formed. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function domainPattern(domain: string): RegExp {
  return new RegExp(`(?<![a-z0-9-])(?:[a-z0-9-]+\\.)*${escapeRegExp(domain)}(?![a-z0-9-])`);
}

/** The forbidden domains: the built-in ones and those of sources.yaml, as read. */
function forbiddenDomains(raw: RawContent): string[] {
  const domains = new Set(BUILTIN_FORBIDDEN_DOMAINS);
  const entries = (raw.sources?.data as { forbidden?: unknown } | null | undefined)?.forbidden;
  if (Array.isArray(entries)) {
    for (const entry of entries as unknown[]) {
      const found = (entry as { domains?: unknown } | null)?.domains;
      if (!Array.isArray(found)) continue;
      for (const domain of found as unknown[]) {
        if (typeof domain === 'string') domains.add(normalise(domain));
      }
    }
  }
  return [...domains];
}

function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

/** Every string of a parsed YAML value, keys included, with its path. */
function* strings(value: unknown, path: string): Generator<{ path: string; text: string }> {
  if (typeof value === 'string') {
    yield { path, text: value };
  } else if (Array.isArray(value)) {
    for (const [index, item] of (value as unknown[]).entries()) {
      yield* strings(item, `${path}[${String(index)}]`);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const here = joinPath(path, key);
      yield { path: here, text: key };
      yield* strings(item, here);
    }
  }
}

/** The part of each line after a YAML comment mark. */
function comments(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /(?:^|\s)#(.*)$/.exec(line);
    if (match?.[1] !== undefined) found.push(match[1]);
  }
  return found;
}

function nameHits(text: string): string[] {
  const plain = normalise(text);
  return FORBIDDEN_NAMES.filter(({ pattern }) => pattern.test(plain)).map(({ name }) => name);
}

function domainHits(text: string, domains: readonly string[]): string[] {
  const plain = normalise(decoded(text));
  return domains.filter((domain) => domainPattern(domain).test(plain));
}

/** Check 3, names and domains: the content files other than the sources policy. */
function scanProblems(raw: RawContent): Problem[] {
  const domains = forbiddenDomains(raw);
  const problems: Problem[] = [];
  const files: RawFile[] = [
    ...(raw.pack ? [raw.pack] : []),
    ...raw.rules,
    ...raw.messages,
    ...(raw.dangerSigns ? [raw.dangerSigns] : []),
    ...(raw.substances ? [raw.substances] : []),
    ...(raw.classes ? [raw.classes] : []),
    ...raw.products,
    ...raw.plants,
    ...raw.extra,
    ...raw.texts,
  ];
  const scanned: { file: RawFile; data: unknown }[] = files.map((file) => ({
    file,
    data: file.data,
  }));
  if (raw.sources) {
    // The sources policy names the forbidden sources to forbid them: its
    // forbidden list is the one exception.
    const rest: Record<string, unknown> = { ...(raw.sources.data as Record<string, unknown>) };
    delete rest.forbidden;
    scanned.push({ file: raw.sources, data: rest });
  }
  for (const { file, data } of scanned) {
    for (const { path, text } of strings(data, '')) {
      const hosts = domainHits(text, domains);
      for (const domain of hosts) {
        problems.push({
          file: file.file,
          path,
          message: `URL under the forbidden domain ${domain}`,
        });
      }
      if (hosts.length > 0) continue;
      for (const name of nameHits(decoded(text))) {
        problems.push({
          file: file.file,
          path,
          message: `mentions the forbidden source name "${name}"`,
        });
      }
    }
    for (const comment of file.text === undefined ? [] : comments(file.text)) {
      for (const domain of domainHits(comment, domains)) {
        problems.push({
          file: file.file,
          path: '',
          message: `a comment has a URL under the forbidden domain ${domain}`,
        });
      }
      for (const name of nameHits(comment)) {
        problems.push({
          file: file.file,
          path: '',
          message: `a comment mentions the forbidden source name "${name}"`,
        });
      }
    }
  }
  return problems;
}

interface Catalog {
  allowed: Set<string>;
  factOnly: Set<string>;
  forbidden: Set<string>;
}

/** Check 4 groundwork: the ids of sources.yaml, and ids declared twice. */
function catalogOf(content: Content, problems: Problem[]): Catalog | undefined {
  const entry = content.sources;
  if (!entry) return undefined;
  const lists = [
    ['allowed', entry.data.allowed],
    ['fact-only', entry.data['fact-only']],
    ['forbidden', entry.data.forbidden],
  ] as const;
  const first = new Map<string, string>();
  for (const [name, items] of lists) {
    items.forEach((item, index) => {
      const earlier = first.get(item.id);
      if (earlier === undefined) first.set(item.id, name);
      else {
        problems.push({
          file: entry.file,
          path: `${name}[${String(index)}].id`,
          message: `source "${item.id}" is declared twice (already in ${earlier})`,
        });
      }
    });
  }
  return {
    allowed: new Set(entry.data.allowed.map((s) => s.id)),
    factOnly: new Set(entry.data['fact-only'].map((s) => s.id)),
    forbidden: new Set(entry.data.forbidden.map((s) => s.id)),
  };
}

function at(entry: Entry<unknown>, rest: string): string {
  if (entry.at === '') return rest;
  return rest.startsWith('[') ? `${entry.at}${rest}` : `${entry.at}.${rest}`;
}

/** Checks 1 to 5 for the sources of one rule, danger sign or plant. */
function citationProblems(
  entry: Entry<unknown>,
  sources: readonly SourceRef[],
  catalog: Catalog,
  kind: 'rule' | 'danger-sign' | 'plant',
): Problem[] {
  const problems: Problem[] = [];
  let allowed = 0;
  let factOnly = 0;
  sources.forEach((ref, index) => {
    const path = at(entry, `sources[${String(index)}].source`);
    if (catalog.forbidden.has(ref.source)) {
      problems.push({
        file: entry.file,
        path,
        message: `source "${ref.source}" is forbidden: it must never be cited`,
      });
    } else if (catalog.allowed.has(ref.source)) allowed += 1;
    else if (catalog.factOnly.has(ref.source)) factOnly += 1;
    else {
      problems.push({
        file: entry.file,
        path,
        message: `source "${ref.source}" is not declared in knowledge/sources.yaml`,
      });
    }
  });
  if (kind === 'danger-sign' && allowed + factOnly === 0) {
    problems.push({
      file: entry.file,
      path: at(entry, 'sources'),
      message: 'must cite at least one allowed or fact-only source',
    });
  }
  if (kind === 'rule' && allowed === 0) {
    problems.push({
      file: entry.file,
      path: at(entry, 'sources'),
      message:
        factOnly > 0
          ? 'cites only fact-only sources: also cite at least one allowed source'
          : 'must cite at least one allowed source',
    });
  }
  return problems;
}

/** The ids of the sources the content cites, without duplicates, sorted. */
export function citedSourceIds(content: Content): string[] {
  const ids = new Set<string>();
  const refs = [
    ...content.rules.flatMap((e) => e.data.sources),
    ...content.dangerSigns.flatMap((e) => e.data.sources),
    ...content.plants.flatMap((e) => e.data.sources),
  ];
  for (const ref of refs) ids.add(ref.source);
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The declared sources the content cites, by kind, sorted by id. */
export function citedSources(content: Content): {
  allowed: AuthoredSource[];
  factOnly: AuthoredSource[];
} {
  const catalog = content.sources?.data;
  const cited = new Set(citedSourceIds(content));
  const pick = (list: AuthoredSource[] | undefined): AuthoredSource[] =>
    (list ?? [])
      .filter((s) => cited.has(s.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { allowed: pick(catalog?.allowed), factOnly: pick(catalog?.['fact-only']) };
}

/**
 * Runs the provenance checks on schema-valid content (`content`) and on the
 * files as read (`raw`, for the scan of names and URLs).
 */
export function provenanceProblems(content: Content, raw: RawContent): Problem[] {
  const problems: Problem[] = [];
  const catalog = catalogOf(content, problems);
  if (catalog) {
    for (const rule of content.rules) {
      problems.push(...citationProblems(rule, rule.data.sources, catalog, 'rule'));
    }
    for (const sign of content.dangerSigns) {
      problems.push(...citationProblems(sign, sign.data.sources, catalog, 'danger-sign'));
    }
    for (const plant of content.plants) {
      problems.push(...citationProblems(plant, plant.data.sources, catalog, 'plant'));
    }
  }
  const scan = scanProblems(raw);
  // A forbidden id already has its own problem at the same place.
  const reported = new Set(problems.map((p) => `${p.file}\n${p.path}`));
  problems.push(...scan.filter((p) => !reported.has(`${p.file}\n${p.path}`)));
  return problems;
}
