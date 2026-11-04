// SPDX-License-Identifier: MIT
// Authoring-level checks on schema-valid content: ids, references, rule
// shape, evidence cap and message text. What the engine already checks
// (partners, windows, subjects) is left to parsePack, which runs last.
import { BUILTIN_MESSAGES, capForEvidence, findForbiddenWording } from '@siapso/engine';
import type { Lang, Subject } from '@siapso/engine';
import type {
  AuthoredDangerSign,
  AuthoredMessage,
  Content,
  Entry,
  Problem,
  RawContent,
} from './types.js';

/** The messages the app and the engine need, besides those of rules, plants and signs. */
export const BUILTIN_MESSAGE_IDS: readonly string[] = [
  ...Object.values(BUILTIN_MESSAGES),
  'evidence-0',
];

function stem(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1).replace(/\.yaml$/, '');
}

function at(entry: Entry<unknown>, rest: string): string {
  if (entry.at === '') return rest;
  return rest.startsWith('[') ? `${entry.at}${rest}` : `${entry.at}.${rest}`;
}

function problem(entry: Entry<unknown>, rest: string, message: string): Problem {
  return { file: entry.file, path: at(entry, rest), message };
}

/**
 * Check 2: ids are unique per collection and equal to the file name in
 * one-file-per-entry folders. The entries of a list file (a generated product
 * file) are named by their own ids, not by the file name.
 */
function checkIds(content: Content): Problem[] {
  const problems: Problem[] = [];
  const folders = [content.rules, content.messages, content.products, content.plants];
  for (const entries of folders) {
    const first = new Map<string, string>();
    for (const entry of entries) {
      const { id } = entry.data;
      if (entry.at === '' && id !== stem(entry.file)) {
        problems.push(
          problem(entry, 'id', `id "${id}" must equal the file name "${stem(entry.file)}"`),
        );
      }
      const earlier = first.get(id);
      if (earlier === undefined) first.set(id, entry.file);
      else problems.push(problem(entry, 'id', `duplicate id "${id}" (already used in ${earlier})`));
    }
  }
  const lists = [content.substances, content.classes, content.dangerSigns];
  for (const entries of lists) {
    const first = new Map<string, string>();
    for (const entry of entries) {
      const { id } = entry.data;
      const earlier = first.get(id);
      if (earlier === undefined) first.set(id, entry.at);
      else
        problems.push(problem(entry, 'id', `duplicate id "${id}" (first defined at ${earlier})`));
    }
  }
  return problems;
}

interface Known {
  substances: Set<string>;
  classes: Set<string>;
  plants: Set<string>;
  messages: Set<string>;
}

/**
 * Ids that references may resolve to. They come from the files as read, so
 * that an entry with another fault does not also produce unknown references.
 */
function knownIds(raw: RawContent): Known {
  const listIds = (data: unknown): Set<string> => {
    const ids = new Set<string>();
    if (Array.isArray(data)) {
      for (const item of data as unknown[]) {
        const id = (item as { id?: unknown } | null)?.id;
        if (typeof id === 'string') ids.add(id);
      }
    }
    return ids;
  };
  const stems = (files: { file: string }[]): Set<string> => new Set(files.map((f) => stem(f.file)));
  return {
    substances: listIds(raw.substances?.data),
    classes: listIds(raw.classes?.data),
    plants: stems(raw.plants),
    messages: stems(raw.messages),
  };
}

type Kind = 'substance' | 'class' | 'plant';

function unknownSubject(
  entry: Entry<unknown>,
  where: string,
  subject: Subject,
  known: Known,
): Problem[] {
  const checks: [Kind, string | undefined, Set<string>][] = [
    ['substance', 'substance' in subject ? subject.substance : undefined, known.substances],
    ['class', 'class' in subject ? subject.class : undefined, known.classes],
    ['plant', 'plant' in subject ? subject.plant : undefined, known.plants],
  ];
  return checks.flatMap(([kind, id, ids]) =>
    id !== undefined && !ids.has(id)
      ? [problem(entry, `${where}.${kind}`, `unknown ${kind} "${id}"`)]
      : [],
  );
}

function unknownMessage(entry: Entry<unknown>, where: string, id: string, known: Known): Problem[] {
  return known.messages.has(id)
    ? []
    : [problem(entry, where, `unknown message "${id}" (no file knowledge/messages/${id}.yaml)`)];
}

/** Check 3: every reference resolves. Conditions and window ids are enums of the schema. */
function checkReferences(content: Content, known: Known): Problem[] {
  const problems: Problem[] = [];
  for (const rule of content.rules) {
    const { when, message } = rule.data;
    if (when.subject) problems.push(...unknownSubject(rule, 'when.subject', when.subject, known));
    (when.requires ?? []).forEach((requirement, index) => {
      if ('with' in requirement) {
        const where = `when.requires[${String(index)}].with`;
        problems.push(...unknownSubject(rule, where, requirement.with, known));
      }
    });
    problems.push(...unknownMessage(rule, 'message', message, known));
  }
  for (const plant of content.plants) {
    problems.push(...unknownMessage(plant, 'message', plant.data.message, known));
  }
  for (const sign of content.dangerSigns) {
    if (sign.data.message !== undefined) {
      problems.push(...unknownMessage(sign, 'message', sign.data.message, known));
    }
  }
  for (const product of content.products) {
    product.data.components.forEach((component, index) => {
      if (!known.substances.has(component.substance)) {
        const where = `components[${String(index)}].substance`;
        problems.push(problem(product, where, `unknown substance "${component.substance}"`));
      }
    });
  }
  for (const substance of content.substances) {
    substance.data.classes.forEach((id, index) => {
      if (!known.classes.has(id)) {
        problems.push(problem(substance, `classes[${String(index)}]`, `unknown class "${id}"`));
      }
    });
  }
  for (const cls of content.classes) {
    cls.data.excludes.forEach((id, index) => {
      if (!known.substances.has(id)) {
        problems.push(problem(cls, `excludes[${String(index)}]`, `unknown substance "${id}"`));
      }
    });
  }
  return problems;
}

/** Checks 4, 5 and 6: danger rationale, evidence cap, shape of the conditions. */
function checkRules(content: Content): Problem[] {
  const problems: Problem[] = [];
  for (const rule of content.rules) {
    const { kind, level, evidence, when } = rule.data;
    const rationale = rule.data['danger-rationale'];
    if (level === 'danger' && rationale === undefined) {
      problems.push(
        problem(
          rule,
          'danger-rationale',
          'is required for a danger rule (explain why the risk is immediate)',
        ),
      );
    }
    if (level !== 'danger' && rationale !== undefined) {
      problems.push(
        problem(
          rule,
          'danger-rationale',
          `is only allowed for a danger rule, not for level ${level}`,
        ),
      );
    }
    if (capForEvidence(level, evidence, kind).capped) {
      problems.push(
        problem(
          rule,
          'level',
          `level ${level} is above next-contact for evidence ${evidence} (evidence cap): lower the level or justify better evidence`,
        ),
      );
    }
    if (when['strength-above-mg'] !== undefined && (kind === 'max-dose' || kind === 'duplicate')) {
      problems.push(
        problem(
          rule,
          'when.strength-above-mg',
          `is not allowed for a ${kind} rule (it would drop items from the sum or the count)`,
        ),
      );
    } else if (
      when['strength-above-mg'] !== undefined &&
      !(when.subject && 'substance' in when.subject)
    ) {
      problems.push(
        problem(rule, 'when.strength-above-mg', 'is only allowed with a substance subject'),
      );
    }
    if (when['max-mg-per-day'] !== undefined && kind !== 'max-dose') {
      problems.push(
        problem(
          rule,
          'when.max-mg-per-day',
          `is only allowed for a max-dose rule, not for a ${kind} rule`,
        ),
      );
    }
    if (kind === 'max-dose' && when['max-mg-per-day'] === undefined) {
      problems.push(problem(rule, 'when.max-mg-per-day', 'is required for a max-dose rule'));
    }
    if (kind !== 'reminder' && when.subject === undefined) {
      problems.push(problem(rule, 'when.subject', `is required for a ${kind} rule`));
    }
  }
  return problems;
}

const EM_DASH = String.fromCodePoint(0x2014);
const EMOJI = new RegExp(
  '[\\p{Extended_Pictographic}\\p{Regional_Indicator}' + String.fromCodePoint(0xfe0f, 0x20e3) + ']',
  'u',
);
const DIGIT = /\p{Nd}/u;

/** Units and frequencies that make a number a dose (French and English). */
const DOSE_UNITS: readonly string[] = [
  'mg',
  'g',
  'ml',
  '[µμ]g',
  'mcg',
  'ui',
  'iu',
  'comprimés?',
  'tablets?',
  'gélules?',
  'capsules?',
  'cuillères?',
  'spoons?',
  'sachets?',
  'gouttes?',
  'drops?',
  'prises?',
  'doses?',
  'fois\\s+par\\s+jour',
  'par\\s+jour',
  'times\\s+a\\s+day',
  'per\\s+day',
];
/** A number followed by a dose unit: "500 mg", "2 comprimés", "3 fois par jour", "100mg". */
const DOSE = new RegExp(
  `\\p{Nd}+(?:[.,]\\p{Nd}+)?\\s*(?:${DOSE_UNITS.join('|')})(?![\\p{L}\\p{N}])`,
  'iu',
);

const LANGS: readonly Lang[] = ['fr', 'en'];
const FIELDS = ['fact', 'risk', 'risk-detail', 'orientation'] as const;
/** Fields that may hold a number (never a dose); the others hold no digit at all. */
const NUMBER_FIELDS: ReadonlySet<string> = new Set(['fact', 'risk-detail']);

/** Forbidden wording, em dash and emoji: the checks for any text the interface shows. */
function checkWording(entry: Entry<unknown>, where: string, text: string, lang: Lang): Problem[] {
  const problems: Problem[] = [];
  const forbidden = findForbiddenWording(text, lang);
  if (forbidden.length > 0) {
    const list = forbidden.map((w) => `"${w}"`).join(', ');
    problems.push(problem(entry, where, `forbidden wording: ${list}`));
  }
  if (text.includes(EM_DASH)) {
    problems.push(problem(entry, where, 'contains an em dash (use a comma or a colon)'));
  }
  if (EMOJI.test(text)) problems.push(problem(entry, where, 'contains an emoji'));
  return problems;
}

function checkMessageText(message: Entry<AuthoredMessage>): Problem[] {
  const problems: Problem[] = [];
  for (const lang of LANGS) {
    for (const field of FIELDS) {
      const text = message.data[lang][field];
      if (text === undefined) continue;
      const where = `${lang}.${field}`;
      if (!NUMBER_FIELDS.has(field) && DIGIT.test(text)) {
        problems.push(
          problem(message, where, 'must not contain digits (put numbers in risk-detail)'),
        );
      }
      const dose = NUMBER_FIELDS.has(field) ? DOSE.exec(text) : null;
      if (dose) {
        problems.push(
          problem(
            message,
            where,
            `gives a dose ("${dose[0]}"): messages never state a dose (keep thresholds in the rule)`,
          ),
        );
      }
      problems.push(...checkWording(message, where, text, lang));
    }
  }
  return problems;
}

/** Danger sign labels are interface strings too. */
function checkLabels(sign: Entry<AuthoredDangerSign>): Problem[] {
  return LANGS.flatMap((lang) => checkWording(sign, `label.${lang}`, sign.data.label[lang], lang));
}
/** Check 7 (message and label text) and check 8 (builtin messages exist). */
function checkMessages(content: Content, raw: RawContent): Problem[] {
  const problems = [
    ...content.messages.flatMap(checkMessageText),
    ...content.dangerSigns.flatMap(checkLabels),
  ];
  const present = new Set(raw.messages.map((f) => stem(f.file)));
  for (const id of BUILTIN_MESSAGE_IDS) {
    if (!present.has(id)) {
      problems.push({
        file: `knowledge/messages/${id}.yaml`,
        path: '',
        message: `builtin message "${id}" is missing (the app and the engine need it)`,
      });
    }
  }
  return problems;
}

/** Checks 2 to 8 on the schema-valid content. */
export function checkContent(content: Content, raw: RawContent): Problem[] {
  return [
    ...checkIds(content),
    ...checkReferences(content, knownIds(raw)),
    ...checkRules(content),
    ...checkMessages(content, raw),
  ];
}
