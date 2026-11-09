// SPDX-License-Identifier: MIT
// Authoring-level checks on schema-valid content: ids, references, rule
// shape, evidence cap and message text. What the engine already checks
// (partners, windows, subjects) is left to parsePack, which runs last.
import { BUILTIN_MESSAGES, capForEvidence, findForbiddenWording } from '@siapso/engine';
import type { Lang, Level, Subject } from '@siapso/engine';
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
  dangerSigns: Set<string>;
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
    dangerSigns: listIds(raw.dangerSigns?.data),
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
      } else if ('sign' in requirement && !known.dangerSigns.has(requirement.sign)) {
        // A sign the list does not have could never be ticked: the rule would never apply.
        problems.push(
          problem(
            rule,
            `when.requires[${String(index)}].sign`,
            `unknown danger sign "${requirement.sign}" (not in knowledge/danger-signs.yaml)`,
          ),
        );
      }
    });
    (when['unless-with'] ?? []).forEach((subject, index) => {
      problems.push(...unknownSubject(rule, `when.unless-with[${String(index)}]`, subject, known));
    });
    problems.push(...unknownMessage(rule, 'message', message, known));
    const possible = rule.data['possible-message'];
    if (possible !== undefined) {
      problems.push(...unknownMessage(rule, 'possible-message', possible, known));
    }
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
    // Only the informational kinds: a content mistake in a risk rule must not
    // silently switch the rule off when an unrelated item is present.
    if (when['unless-with'] !== undefined && kind !== 'reminder' && kind !== 'contraception-info') {
      problems.push(
        problem(
          rule,
          'when.unless-with',
          `is only allowed for a reminder or a contraception-info rule, not for a ${kind} rule (an exception must not silently disable a risk rule)`,
        ),
      );
    }
    // A max-dose rule has one threshold: above max-mg-per-day, or from
    // from-mg-per-day included (a toxic amount); no other rule has any.
    const thresholds = (['max-mg-per-day', 'from-mg-per-day'] as const).filter(
      (key) => when[key] !== undefined,
    );
    for (const key of thresholds) {
      if (kind !== 'max-dose') {
        problems.push(
          problem(
            rule,
            `when.${key}`,
            `is only allowed for a max-dose rule, not for a ${kind} rule`,
          ),
        );
      }
    }
    if (kind === 'max-dose' && thresholds.length === 0) {
      problems.push(
        problem(
          rule,
          'when.max-mg-per-day',
          'is required for a max-dose rule (or from-mg-per-day, for an amount from which it applies)',
        ),
      );
    }
    if (kind === 'max-dose' && thresholds.length > 1) {
      problems.push(
        problem(rule, 'when', 'must have one of max-mg-per-day or from-mg-per-day, not both'),
      );
    }
    if (rule.data['possible-message'] !== undefined && kind !== 'max-dose') {
      problems.push(
        problem(
          rule,
          'possible-message',
          `is only allowed for a max-dose rule, not for a ${kind} rule (it says an excess that depends on the box)`,
        ),
      );
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
  'milligrammes?',
  'milligrams?',
  'millilitres?',
  'milliliters?',
  'grammes?',
  'grams?',
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
  'fois\\s+par\\s+(?:jour|semaine)',
  'par\\s+(?:jour|semaine)',
  'times\\s+(?:a|per)\\s+(?:day|week)',
  'times\\s+(?:daily|weekly)',
  'per\\s+(?:day|week)',
];
/**
 * A number followed by a dose unit: "500 mg", "2 comprimés", "3 fois par jour",
 * "100mg", "2 times daily".
 */
const DOSE = new RegExp(
  `\\p{Nd}+(?:[.,]\\p{Nd}+)?\\s*(?:${DOSE_UNITS.join('|')})(?![\\p{L}\\p{N}])`,
  'iu',
);

/**
 * A text as the wording checks read it: lowercase, without accents, with one
 * straight apostrophe and single spaces (no-break spaces included), so that
 * "comprimes", "aujourd’hui" and "prochains jours" (a no-break space) are read as written
 * with accents, a straight apostrophe or a plain space.
 */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘ʼ´`]/g, "'")
    .replace(/\s+/gu, ' ');
}

/** What a drink is measured in: a cup, a glass, a bowl (unaccented). */
const DRINK_UNITS = 'tasses?|verres?|bols?|cups?|glass(?:es)?|bowls?|mugs?';
/** Units a count in words makes an amount of (unaccented). */
const AMOUNT_UNITS = `prises?|doses?|comprimes?|tablets?|gelules?|capsules?|cuillerees?|cuilleres?|spoons?|spoonfuls?|teaspoons?|sachets?|gouttes?|drops?|cachets?|pilules?|pills?|suppositoires?|suppositor(?:y|ies)|grammes?|grams?|milligrammes?|milligrams?|millilitres?|milliliters?|${DRINK_UNITS}|fois par (?:jour|semaine)|times (?:(?:a|per) (?:day|week)|daily|weekly)|par (?:jour|semaine)|per (?:day|week)`;
/**
 * An amount unit, but not "prises de sang" (blood tests): "deux prises de
 * sang" and "une seule prise de sang" are not doses.
 */
const AMOUNT = `(?!prises? de sang)(?:${AMOUNT_UNITS})`;
/**
 * Units whose singular after an article is always an amount ("un comprimé",
 * "a tablet", "un verre", "a cup"), unlike "une dose" or "une prise" ("à une
 * dose plus forte").
 */
const UNIT_OBJECTS = `comprimes?|gelules?|sachets?|cuillerees?|cuilleres?|gouttes?|tablets?|capsules?|spoons?|spoonfuls?|teaspoons?|drops?|cachets?|pilules?|pills?|suppositoires?|suppositor(?:y|ies)|grammes?|grams?|milligrammes?|milligrams?|millilitres?|milliliters?|${DRINK_UNITS}|fois par (?:jour|semaine)`;
/**
 * The times of day a dose is taken at: "matin et soir", "morning and
 * evening". Read sentence by sentence: in a sentence that describes a study
 * ("des volontaires en prenaient matin et soir") they say how it was given,
 * not a dose to take (`timesOfDayDose`).
 */
const TIMES_OF_DAY =
  /(?<![\p{L}\p{N}])(?:(?:le )?matin(?:,? (?:le )?midi)? et (?:le )?soir|morning and (?:evening|night)|(?:evening|night) and morning)(?![\p{L}\p{N}])/u;
/** The words of a sentence that describes a study (plain text). */
const STUDY =
  /(?<![\p{L}\p{N}])(?:etudes?|essais?|volontaires|studies|study|trials?|volunteers)(?![\p{L}\p{N}])/u;
/**
 * Number words from two up (unaccented), and "one". "Un" and "une" are
 * articles too ("une dose plus forte"), so they only count inside a number.
 */
const NUMBER_WORDS =
  'deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille|one|two|three|four|five|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?';
/**
 * A number in words: number words joined by a space, a hyphen, "et" or "and"
 * are one number ("vingt et une", "quatre-vingt-dix", "one hundred and
 * twenty"), so that the dose quoted is the whole number.
 */
const NUMBER = `(?:${NUMBER_WORDS})(?:(?: et | and |-et-| |-)(?:${NUMBER_WORDS}|un|une))*`;
const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';
/**
 * The time between two doses: "toutes les six heures", "toutes les quatre à
 * six heures", "every 6 hours". Only with "toutes les" or "every": "pendant
 * six heures" is a duration, not a dose.
 */
const INTERVAL_NUMBER = `(?:${NUMBER}|\\p{Nd}+(?:[.,]\\p{Nd}+)?)`;
const INTERVAL = `(?:toutes les|every) ${INTERVAL_NUMBER}(?:(?: (?:a|ou|to|or) | ?[-–] ?)${INTERVAL_NUMBER})? ?(?:heures?|hours?|h)`;
/**
 * An article and a unit that are not an amount: "a drop in blood pressure" or
 * "in the amount of fluid" is a fall, "un sachet de poudre" a form, "une
 * pilule contraceptive" a method. "A drop in each eye" is still an amount,
 * and so is a count of sachets ("deux sachets de poudre").
 */
const NOT_AN_AMOUNT =
  `a drop in (?:(?:the|her|his|their) )?(?:blood|pressure|heart|sugar|glucose|levels?|rate|count|temperature|weight|milk|amount|volume|number|fluid)${WORD_END}` +
  `|(?:un|une|a|an) sachets? (?:de |d'|of )(?:poudres?|granules?|powders?)${WORD_END}` +
  `|(?:un|une) pilules? (?:contraceptives?|du lendemain)${WORD_END}` +
  // A dish the remedy is mixed into, not a measure of the remedy.
  `|(?:un|une|a|an) (?:bols?|bowls?) (?:de |d'|of )(?:sauces?|soupes?|riz|soups?|rice)${WORD_END}`;
/**
 * A dose in words, read on the plain text: "une seule prise", "a single dose";
 * a single dose with "unique" ("une prise unique", "en prise unique", "à dose
 * unique"); a number in words and a unit ("deux comprimés", "vingt et une
 * gouttes", "twelve tablets"); an article and a unit that is always an amount
 * ("un comprimé", "une fois par jour", "a drop"); "once a day", "twice daily",
 * "trois fois par semaine", "once a week"; half a unit ("un demi-comprimé",
 * "half a tablet"); the time between doses ("toutes les six heures", "every 6
 * hours"); a drink measured in cups, glasses or bowls ("deux tasses par jour",
 * "un verre", "a cup of tea"); a dose at bedtime ("le soir au coucher", "at
 * bedtime"); the times of day are read apart (`timesOfDayDose`). The digit
 * check cannot see them. "Une dose plus forte", "une seule fois", "deux à
 * trois fois plus", "deux prises de sang" and "un bol de sauce" are not doses.
 */
const WORD_DOSE = new RegExp(
  WORD_START +
    '(?:' +
    [
      `(?:un|une|a|an|one) (?:seul|seule|single|unique) ${AMOUNT}`,
      `(?:un|une|des|le|la|les|en|a) ${AMOUNT} uniques?`,
      `${NUMBER} ${AMOUNT}`,
      `(?!${NOT_AN_AMOUNT})(?:un|une|a|an) (?:${UNIT_OBJECTS})`,
      '(?:once|twice) (?:(?:a|per) (?:day|week)|daily|weekly)',
      `(?:demi|half)(?:[ -](?:a|an|une?))?[ -]${AMOUNT}`,
      INTERVAL,
      // A dose taken at bedtime: "le soir au coucher", "at bedtime".
      '(?:le soir )?au coucher|at bedtime',
    ].join('|') +
    ')' +
    WORD_END,
  'u',
);
/**
 * The number of doses of a preventive schedule, which a reminder may state
 * ("au moins trois doses de SP", "at least three doses of SP"): the one
 * exception to the dose-in-words check, for the messages of reminders only.
 */
const REMINDER_SCHEDULE = new RegExp(
  `${WORD_START}(?:(?:au\\s+moins|at\\s+least)\\s+)?(?:${NUMBER}|\\p{Nd}+)\\s+doses?\\s+(?:de|of)\\s+(?:la\\s+)?sp${WORD_END}`,
  'giu',
);

/**
 * The times of day of a dose ("matin et soir", "morning and evening") in a
 * plain text, unless their sentence describes a study, where they say how it
 * was given ("des volontaires en prenaient matin et soir").
 */
function timesOfDayDose(text: string): RegExpExecArray | null {
  for (const sentence of text.split(/[.!?;]/)) {
    const found = TIMES_OF_DAY.exec(sentence);
    if (found !== null && !STUDY.test(sentence)) return found;
  }
  return null;
}

const LANGS: readonly Lang[] = ['fr', 'en'];
const FIELDS = ['fact', 'risk', 'risk-detail', 'orientation', 'orientation-accompanied'] as const;
/** The fields a result reads as who to show and when. */
const ORIENTATIONS = ['orientation', 'orientation-accompanied'] as const;
/** Fields that may hold a number (never a dose); the others hold no digit at all. */
const NUMBER_FIELDS: ReadonlySet<string> = new Set(['fact', 'risk-detail']);

/**
 * The words an accompanied orientation never says (plain text): it speaks to
 * the person helping, about the woman ("elle", "sa prochaine visite"), never
 * as if the reader were the patient.
 */
const NOT_ABOUT_HER: Readonly<Record<Lang, { pattern: RegExp; say: string }[]>> = {
  fr: [
    {
      pattern: /(?<![\p{L}\p{N}])(?:vous|votre|vos)(?![\p{L}\p{N}])/u,
      say: 'speaks of her in accompanied mode: no "vous", "votre" or "vos"',
    },
    {
      pattern: /(?<![\p{L}\p{N}])la prochaine visite(?![\p{L}\p{N}])/u,
      say: 'speaks of her in accompanied mode: write "à sa prochaine visite" (her next visit, never another\'s)',
    },
  ],
  en: [
    {
      pattern: /(?<![\p{L}\p{N}])(?:you|your|yours)(?![\p{L}\p{N}])/u,
      say: 'speaks of her in accompanied mode: no "you" or "your"',
    },
    {
      pattern: /(?<![\p{L}\p{N}])the next visit(?![\p{L}\p{N}])/u,
      say: 'speaks of her in accompanied mode: write "at her next visit"',
    },
  ],
};

/** "This screen": a result nobody keeps (a passer-by) cannot be shown later (plain text). */
const THIS_SCREEN: Readonly<Record<Lang, RegExp>> = {
  fr: /(?<![\p{L}\p{N}])cet ecran(?![\p{L}\p{N}])/u,
  en: /(?<![\p{L}\p{N}])this screen(?![\p{L}\p{N}])/u,
};

/**
 * The orientation checks: an accompanied orientation only beside an
 * orientation, speaking of her, and no orientation that points to "this
 * screen" (the screen of a passer-by is gone once the next one starts).
 */
function checkOrientations(message: Entry<AuthoredMessage>): Problem[] {
  const problems: Problem[] = [];
  for (const lang of LANGS) {
    const text = message.data[lang];
    const accompanied = text['orientation-accompanied'];
    const where = `${lang}.orientation-accompanied`;
    if (accompanied !== undefined && text.orientation === undefined) {
      problems.push(
        problem(
          message,
          where,
          'is only allowed with an orientation (it replaces it in accompanied mode)',
        ),
      );
    }
    if (accompanied !== undefined) {
      for (const { pattern, say } of NOT_ABOUT_HER[lang]) {
        if (pattern.test(plain(accompanied))) problems.push(problem(message, where, say));
      }
    }
    for (const field of ORIENTATIONS) {
      const written = text[field];
      if (written !== undefined && THIS_SCREEN[lang].test(plain(written))) {
        problems.push(
          problem(
            message,
            `${lang}.${field}`,
            'points to this screen ("cet écran"): nothing is kept for a passer-by, name the product instead',
          ),
        );
      }
    }
  }
  return problems;
}

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

/**
 * The message text checks. `reminder`: every rule that uses the message is a
 * reminder, which may state the number of doses of a preventive schedule.
 */
function checkMessageText(message: Entry<AuthoredMessage>, reminder: boolean): Problem[] {
  const problems: Problem[] = [];
  for (const lang of LANGS) {
    for (const field of FIELDS) {
      const written = message.data[lang][field];
      if (written === undefined) continue;
      const where = `${lang}.${field}`;
      if (!NUMBER_FIELDS.has(field) && DIGIT.test(written)) {
        problems.push(
          problem(message, where, 'must not contain digits (put numbers in risk-detail)'),
        );
      }
      // The words and the wording are checked on the whole text; the doses
      // without the schedule a reminder may give.
      const text = reminder ? written.replace(REMINDER_SCHEDULE, ' ') : written;
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
      const wordDose = WORD_DOSE.exec(plain(text)) ?? timesOfDayDose(plain(text));
      if (wordDose) {
        problems.push(
          problem(
            message,
            where,
            `gives a dose in words ("${wordDose[0]}"): messages never state a dose, even as a count of units`,
          ),
        );
      }
      problems.push(...checkWording(message, where, written, lang));
    }
  }
  return problems;
}

/** French imperatives that are never another form of the verb (plain text). */
const FR_IMPERATIVES =
  'allez|montrez|arretez|parlez|demandez|appelez|prenez|donnez|evitez|consultez|attendez|venez|cessez|gardez|continuez|prevenez|signalez|surveillez|retournez';
/** A pronoun joined to an imperative by a hyphen: "dites-le", "parlez-en". */
const FR_PRONOUN = '-(?:le|la|les|lui|leur|en|y)';
/** The start of a sentence or of a clause (plain text): the text start, or a punctuation mark. */
const CLAUSE_START = '(?:^|[.:;!?,] )';
/**
 * An instruction, read on the plain text. French: an imperative ("allez",
 * "montrez", "prévenez", "surveillez", "parlez-en"); "dites" and "faites" only
 * at the start of a clause or with a pronoun ("dites-le"), since "les crèmes
 * dites éclaircissantes" and "des études faites chez l'animal" are not orders;
 * a negative order ("ne le donnez pas", "n'attendez pas", "ne changez rien");
 * an obligation ("il faut", "elle doit aller", "le médecin doit être vu");
 * "à montrer". English: an imperative at the start of a sentence or after a
 * colon or a comma ("tell the midwife", "if she bleeds, go to the health
 * post", "do not give", "watch the baby"), "never give", and "should",
 * "please" or "make sure" anywhere; "Never studied" and "Keep" at the start of
 * a sentence state a fact, and so does a quoted English title
 * (`EN_QUOTATION`). What a label or a test says is not one: "la notice ne la
 * recommande pas", "only a test can tell".
 */
const INSTRUCTION: Readonly<Record<Lang, RegExp>> = {
  fr: new RegExp(
    WORD_START +
      '(?:' +
      [
        `(?:${FR_IMPERATIVES})(?:${FR_PRONOUN})?`,
        `(?:dites|faites)${FR_PRONOUN}`,
        `(?:ne (?:le |la |les |l'|lui |leur |en |y )?|n')\\p{L}+ez (?:pas|rien|jamais|plus)`,
        'il faut',
        'doi(?:t|vent) (?:etre (?:vue?s?|examinee?s?)|aller|consulter|voir|montrer|dire|prevenir|appeler|parler|venir|revenir|retourner)',
        "(?<![\\p{L}'-])a montrer",
      ].join('|') +
      ')' +
      WORD_END +
      `|${CLAUSE_START}(?:dites|faites)${WORD_END}`,
    'u',
  ),
  en: new RegExp(
    `${CLAUSE_START}(?:tell|go|show|ask|call|talk|stop|take|give|avoid|bring|come|watch|do not|don't)${WORD_END}` +
      `|${WORD_START}(?:should|please|make sure|never (?:give|take|stop|use|leave))${WORD_END}`,
    'u',
  ),
};

/**
 * A quotation in an English text, between straight or curly double quotes:
 * a quoted title names a source ("Medicines in pregnancy. Never give up on the
 * data", "Keep, watch and wait") and gives no order, so the English check
 * reads the text without it. The French check reads quotations too: no French
 * title has needed it, and a guillemet may quote an order.
 */
const EN_QUOTATION = /"[^"]*"|“[^”]*”/gu;

/** The text the instruction check reads (plain text): an English one without its quotations. */
function instructionText(written: string, lang: Lang): string {
  const text = plain(written);
  return lang === 'en' ? text.replace(EN_QUOTATION, '""') : text;
}

/**
 * The fields a result keeps behind "Pourquoi ?", in accompanied mode only:
 * the detailed risk of every message, and the fact of a message of a rule
 * that gives findings or of a remedy. The fact of "nothing found", "nothing
 * applies" and "not recognised" is read with the risk, and a danger sign's
 * fact leads its card: both are read in both modes.
 */
function hiddenFields(content: Content): Map<string, Set<'fact' | 'risk-detail'>> {
  const shown = new Set<string>([
    BUILTIN_MESSAGES.nothingFound,
    BUILTIN_MESSAGES.nothingApplies,
    BUILTIN_MESSAGES.notRecognised,
    ...content.dangerSigns.flatMap((s) => (s.data.message === undefined ? [] : [s.data.message])),
  ]);
  const withFact = new Set<string>([
    ...content.rules
      .filter((r) => r.data.kind !== 'reminder' && r.data.kind !== 'contraception-info')
      .flatMap((r) => {
        const possible = r.data['possible-message'];
        return possible === undefined ? [r.data.message] : [r.data.message, possible];
      }),
    ...content.plants.map((p) => p.data.message),
  ]);
  const hidden = new Map<string, Set<'fact' | 'risk-detail'>>();
  for (const message of content.messages) {
    const id = message.data.id;
    const fields = new Set<'fact' | 'risk-detail'>(['risk-detail']);
    if (withFact.has(id) && !shown.has(id)) fields.add('fact');
    hidden.set(id, fields);
  }
  return hidden;
}

/**
 * Check 7 (instructions): who to show and when is said in the orientation,
 * the line both modes read. An instruction in a field kept behind "Pourquoi ?"
 * would be read by a health worker who opens it, and never by the woman.
 */
function checkHiddenInstructions(content: Content): Problem[] {
  const problems: Problem[] = [];
  const hidden = hiddenFields(content);
  for (const message of content.messages) {
    for (const field of hidden.get(message.data.id) ?? []) {
      for (const lang of LANGS) {
        const written = message.data[lang][field];
        if (written === undefined) continue;
        const found = INSTRUCTION[lang].exec(instructionText(written, lang));
        if (found === null) continue;
        problems.push(
          problem(
            message,
            `${lang}.${field}`,
            `gives an instruction ("${found[0].replace(/^[.:;!?,] /, '')}") in a field kept behind "Pourquoi ?": put it in the orientation, the line both modes read`,
          ),
        );
      }
    }
  }
  return problems;
}

/** Later than before the next dose, so later than a danger too (plain text). */
const LATER: Readonly<Record<Lang, readonly string[]>> = {
  fr: [
    'prochains jours',
    'prochaine visite',
    'prochain contact',
    'demain',
    'semaine',
    'rendez-vous',
    'consultation',
    'plus tard',
  ],
  en: [
    'coming days',
    'next visit',
    'next contact',
    'tomorrow',
    'week',
    'appointment',
    'consultation',
    'later',
  ],
};

/**
 * Timing words that give more time than a level allows, read on the plain
 * text as whole words (a final "s" included): a danger is now, never today,
 * soon or at the next dose, and before the next dose is never in the coming
 * days, at the next visit, tomorrow, within a week or later.
 */
const LATER_THAN: Readonly<Partial<Record<Level, Record<Lang, readonly string[]>>>> = {
  danger: {
    fr: [...LATER.fr, "aujourd'hui", 'prochaine prise', 'rapidement', 'des que possible'],
    en: [...LATER.en, 'today', 'next dose', 'soon'],
  },
  'before-next-dose': LATER,
};

/** An appointment word followed, within two words, by `deadline` (plain text). */
function boundedAppointment(deadline: string): RegExp {
  return new RegExp(
    `${WORD_START}(?:consultation|rendez-vous|appointment)s?(?=(?:[ ,]+[\\p{L}'-]+){0,2}[ ,]+${deadline}${WORD_END})`,
    'gu',
  );
}

/**
 * An appointment that the level's own deadline bounds is not later: before
 * the next dose, "en consultation prénatale avant la prochaine prise" keeps
 * the deadline. Within two words only, so that "à la consultation de la
 * maternité avant la prochaine prise" stays later. Only the appointment word
 * is set aside: another later word in the same text still counts. A danger
 * has no such deadline: a consultation is always later than now.
 */
const BOUNDED_APPOINTMENT: Readonly<Partial<Record<Level, Record<Lang, RegExp>>>> = {
  'before-next-dose': {
    fr: boundedAppointment('avant la prochaine prise'),
    en: boundedAppointment('before the next dose'),
  },
};

/** A danger orientation says one of these (plain text). */
const NOW: Readonly<Record<Lang, readonly string[]>> = {
  fr: ['maintenant', 'immediatement'],
  en: ['now', 'immediately'],
};

function sayWord(text: string, word: string): boolean {
  const source = word.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
  return new RegExp(`${WORD_START}${source}s?${WORD_END}`, 'u').test(text);
}

/**
 * Check 7 (timing): the orientation of the message of a rule, of a danger sign
 * or of the built-in danger sign message never gives more time than its level
 * (a danger sign is a danger), and a danger orientation says now. Notes and
 * reminders have no level. Read on the plain text: any apostrophe, any space.
 */
function checkTiming(content: Content): Problem[] {
  const users: { message: string; level: Level; who: string }[] = [
    ...content.rules
      .filter((r) => r.data.kind !== 'reminder' && r.data.kind !== 'contraception-info')
      .map((r) => ({ message: r.data.message, level: r.data.level, who: `rule ${r.data.id}` })),
    // An excess that depends on the box is said before the next dose, whatever the rule's level.
    ...content.rules.flatMap((r) => {
      const possible = r.data['possible-message'];
      return possible === undefined
        ? []
        : [
            {
              message: possible,
              level: 'before-next-dose' as const,
              who: `the possible excess of rule ${r.data.id}`,
            },
          ];
    }),
    ...content.dangerSigns.flatMap((s) =>
      s.data.message === undefined
        ? []
        : [{ message: s.data.message, level: 'danger' as const, who: `danger sign ${s.data.id}` }],
    ),
    {
      message: BUILTIN_MESSAGES.dangerSign,
      level: 'danger',
      who: 'the built-in danger sign message',
    },
    // A daily maximum that depends on the box, and the total that cannot be
    // computed: both are said before the next dose.
    {
      message: BUILTIN_MESSAGES.maxDoseMayExceed,
      level: 'before-next-dose',
      who: 'the built-in max-dose-may-exceed finding',
    },
    {
      message: BUILTIN_MESSAGES.maxDoseNotComputable,
      level: 'before-next-dose',
      who: 'the built-in max-dose-not-computable note',
    },
  ];
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const { message: id, level, who } of users) {
    const later = LATER_THAN[level];
    const message = content.messages.find((m) => m.data.id === id);
    if (later === undefined || message === undefined || seen.has(`${id}|${level}`)) continue;
    seen.add(`${id}|${level}`);
    for (const [lang, field] of LANGS.flatMap((l) => ORIENTATIONS.map((f) => [l, f] as const))) {
      const orientation = message.data[lang][field];
      if (orientation === undefined) continue;
      const bounded = BOUNDED_APPOINTMENT[level]?.[lang];
      const text = bounded ? plain(orientation).replace(bounded, ' ') : plain(orientation);
      const where = `${lang}.${field}`;
      const word = later[lang].find((w) => sayWord(text, w));
      if (word !== undefined) {
        problems.push(
          problem(
            message,
            where,
            `says "${word}", which gives more time than the level ${level} of ${who}`,
          ),
        );
      }
      if (level === 'danger' && !NOW[lang].some((w) => sayWord(text, w))) {
        problems.push(
          problem(
            message,
            where,
            `does not say now (${NOW[lang].map((w) => `"${w}"`).join(' or ')}), as a danger of ${who} must`,
          ),
        );
      }
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
  // Messages that only reminders use: they may state a preventive schedule.
  const kinds = new Map<string, Set<string>>();
  for (const rule of content.rules) {
    const set = kinds.get(rule.data.message) ?? new Set<string>();
    set.add(rule.data.kind);
    kinds.set(rule.data.message, set);
  }
  const reminderOnly = (id: string): boolean => {
    const used = kinds.get(id);
    return used !== undefined && [...used].every((kind) => kind === 'reminder');
  };
  const problems = [
    ...content.messages.flatMap((m) => checkMessageText(m, reminderOnly(m.data.id))),
    ...content.messages.flatMap(checkOrientations),
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

/**
 * A citation link a reader can open on a phone: never an API answer, a bulk
 * archive or a raw record (JSON, XML), which show code or start a download
 * over mobile data. A readable page of the same record, or no link.
 */
function unreadable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // The schema refuses a URL that is not one.
  }
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  return (
    /^(?:api|eutils|ftp)\./.test(host) ||
    /\.(?:tar\.gz|tgz|gz|zip|json|xml)$/.test(pathname) ||
    // A repository's file or API (WHO IRIS bitstreams): its handle page is readable.
    /\/server\/api\/|\/bitstreams?\//.test(pathname) ||
    /(?:^|&)retmode=(?:xml|json)(?:&|$)/i.test(parsed.search.slice(1))
  );
}

/** The host of a URL, lowercase; undefined when it is not a URL. */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Check 9: every citation link (rules, remedies, danger signs) opens a
 * readable page, and a source that declares the hosts of its links (openFDA:
 * DailyMed) is linked on them only.
 */
function checkLinks(content: Content): Problem[] {
  const declared = new Map<string, string[]>();
  const policy = content.sources?.data;
  for (const source of [...(policy?.allowed ?? []), ...(policy?.['fact-only'] ?? [])]) {
    const hosts = source['link-hosts'];
    if (hosts !== undefined) declared.set(source.id, hosts);
  }
  const cited: { entry: Entry<unknown>; sources: { source: string; url?: string }[] }[] = [
    ...content.rules.map((entry) => ({ entry, sources: entry.data.sources })),
    ...content.plants.map((entry) => ({ entry, sources: entry.data.sources })),
    ...content.dangerSigns.map((entry) => ({ entry, sources: entry.data.sources })),
  ];
  return cited.flatMap(({ entry, sources }) =>
    sources.flatMap((source, index) => {
      if (source.url === undefined) return [];
      const where = `sources[${String(index)}].url`;
      if (unreadable(source.url)) {
        return [
          problem(
            entry,
            where,
            `links to an API, an archive or a raw record ("${source.url}"): link a readable page of the record (the BDPM page, PubMed, the LactMed Bookshelf page, DailyMed, a WHO IRIS handle page), or no link`,
          ),
        ];
      }
      const hosts = declared.get(source.source);
      const host = hostOf(source.url);
      if (hosts !== undefined && (host === undefined || !hosts.includes(host))) {
        return [
          problem(
            entry,
            where,
            `links "${source.url}" for a ${source.source} citation: knowledge/sources.yaml links its documents on ${hosts.join(', ')} only`,
          ),
        ];
      }
      return [];
    }),
  );
}

/** Checks 2 to 9 on the schema-valid content. */
export function checkContent(content: Content, raw: RawContent): Problem[] {
  return [
    ...checkIds(content),
    ...checkReferences(content, knownIds(raw)),
    ...checkRules(content),
    ...checkMessages(content, raw),
    ...checkHiddenInstructions(content),
    ...checkTiming(content),
    ...checkLinks(content),
  ];
}
