// SPDX-License-Identifier: MIT
// What the result screen says, built from the engine's evaluation: pure, so
// every sentence can be tested in both modes and both languages (spec sections
// 2 and 10). The view never decides a level: it shows the engine's, with the
// pack's messages and the interface's fixed sentences.
//
// Woman mode: level, product, risk (no numbers), who to show and when, the
// term note, the dose note, the fixed sentences and the version. Accompanied
// mode adds the fact, the detailed risk, the evidence level with its wording,
// the sources (name and locator, never the quote, which is provenance and may
// hold a dose), the rule, the reminders and the contraception notes.
import {
  BUILTIN_MESSAGES,
  type CheckedItem,
  type Evaluation,
  type Evidence,
  type Finding,
  type Lang,
  type Level,
  type Message,
  type Note,
  type Pack,
  type Reminder,
  type SourceRef,
} from '@siapso/engine';
import type { MessageKey, Vars } from '../i18n/translate.js';
import { displayOf } from './search-index.js';
import type { Mode } from './types.js';

export type Translate = (key: MessageKey, vars?: Vars) => string;

export interface SourceView {
  name: string;
  locator: string;
  url?: string;
}

export interface FindingView {
  /** Stable among the findings of one view. */
  key: string;
  level: Level;
  levelLabel: string;
  /** The products or remedies concerned, as confirmed, joined in the language, or the danger sign's label. */
  title: string;
  /** The same names one by one, so a screen can set each product on its own line. */
  names: string[];
  /**
   * Read before the risk in both modes: the fact of a danger sign that has a
   * message of its own ("La fièvre pendant la grossesse peut être le
   * paludisme."), without which the risk would not follow from the sign.
   */
  lead?: string;
  /** Accompanied mode only (never with `lead`, never the standard danger sign's). */
  fact?: string;
  /**
   * Every distinct risk of the findings the card stands for, the highest
   * first (two pregnancy rules on one ibuprofen: both risks). No numbers,
   * except the version and date of "nothing found".
   */
  risks: string[];
  /** Accompanied mode only: every distinct detailed risk, in the same order. */
  riskDetails?: string[];
  /** Who to show and when, of the highest finding: its message's own, or the level's default. */
  orientation: string;
  /** "Terme estimé" or "terme inconnu", when a pregnancy window matched on a range. */
  termNote?: string;
  /** Accompanied mode only: every distinct evidence level, in the same order. */
  evidence?: EvidenceView[];
  /** Accompanied mode only: the sources of every finding of the card, each once. */
  sources?: SourceView[];
  /** Accompanied mode only: every rule of the card, in the same order. */
  ruleIds?: string[];
  /** Of the highest finding: its level was held down by weak evidence. */
  capped: boolean;
  /** Accompanied mode only, when capped. */
  cappedNote?: string;
}

export interface EvidenceView {
  level: Evidence;
  /** How the messages of that level are written ("peut provoquer"). */
  wording: string;
  text: string;
}

/** A reminder or a note: its sentences, then who to ask when it says so. */
export interface NoteView {
  /** Unique in its list: the kind and the rule. */
  key: string;
  text: string;
  orientation?: string;
}

export interface ResultView {
  level: Level;
  levelLabel: string;
  /**
   * When a finding is a danger, the banner's instruction: the orientation the
   * danger cards share, or "Allez au poste de santé maintenant." when they
   * differ. Otherwise the level name.
   */
  headline: string;
  /** A finding is a danger: the screen leads with the danger banner. */
  danger: boolean;
  /** One per item set and check, in engine order (shownFindings). */
  findings: FindingView[];
  /** Accompanied mode only. */
  reminders: NoteView[];
  /** Dose notes in both modes; contraception notes in accompanied mode only. */
  notes: NoteView[];
  fixedLines: string[];
  versionLine: string;
  notValidated: boolean;
  /** Set when the pack is not clinically validated. */
  notValidatedLine?: string;
  /** The last line. */
  closing: string;
}

function keyOf(finding: Finding): string {
  return `${finding.check}|${finding.items.join(',')}|${finding.sign ?? ''}`;
}

/**
 * The findings of each card: one group per item set, check and sign, in
 * engine order, each group in engine order too. Findings are sorted by level,
 * danger first, so a group's first finding is its highest (ties keep the
 * engine's order). Two pregnancy findings for one ibuprofen on a range of
 * weeks are one group. The evaluation is not changed.
 */
export function cardGroups(findings: readonly Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = keyOf(finding);
    const group = groups.get(key);
    if (group) group.push(finding);
    else groups.set(key, [finding]);
  }
  return [...groups.values()];
}

/** The finding each card is led by: the first, and highest, of its group. */
export function shownFindings(findings: readonly Finding[]): Finding[] {
  return cardGroups(findings).flatMap((group) => group.slice(0, 1));
}

/** Each value once, in the order it first appears. */
function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * The pack date as the language writes it: "05/11/2026" in French, "5
 * November 2026" in English (a month name, so a day and a month are never
 * mixed up). Read as a calendar date, whatever the phone's time zone; a value
 * that is not a date is returned as it is.
 */
export function formatPackDate(iso: string, lang: Lang): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions =
    lang === 'fr'
      ? { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', options).format(date);
}

interface Scope {
  pack: Pack;
  items: readonly CheckedItem[];
  mode: Mode;
  lang: Lang;
  t: Translate;
  version: string;
  date: string;
}

function messageOf(scope: Scope, id: string): Message {
  const message = scope.pack.messages[scope.lang][id];
  if (message === undefined) {
    throw new Error(`The knowledge pack has no ${scope.lang} message "${id}"`);
  }
  return message;
}

/** The names a finding is about: its products and remedies as confirmed, or its danger sign. */
function namesOf(scope: Scope, finding: Finding): string[] {
  const { pack, lang, items } = scope;
  if (finding.sign !== undefined) {
    const sign = finding.sign;
    return [pack.dangerSigns.find((d) => d.id === sign)?.label[lang] ?? sign];
  }
  const names = finding.items.flatMap((index) => {
    const item = items[index];
    return item === undefined
      ? []
      : [displayOf(pack, item.ref, lang, item.strengthUnknown === true).name];
  });
  return names.length === 0 ? [scope.t(`level.${finding.level}`)] : names;
}

/** Names joined as the language says a list ("A et B", "A, B et C"). */
export function joinNames(names: readonly string[], lang: Lang): string {
  return new Intl.ListFormat(lang, { type: 'conjunction', style: 'long' }).format(names);
}

/**
 * The level's default orientation (spec section 10). For "we do not know" it
 * first says that there is no reliable information and that this does not
 * mean risk-free, leaving out a sentence the card has just said (`said`: what
 * is read before the orientation).
 */
function defaultOrientation(scope: Scope, finding: Finding, said: string): string {
  const { t } = scope;
  if (finding.level === 'before-next-dose' && finding.items.length > 1) {
    return t('result.orientationProducts');
  }
  if (finding.level !== 'unknown') return t(`result.orientation.${finding.level}`);
  const text = said.toLowerCase().replace(/[’]/g, "'");
  const lead: string[] = [];
  if (!text.includes(t('result.unknownSaid.noInformation')))
    lead.push(t('result.unknown.noInformation'));
  if (!text.includes(t('result.unknownSaid.notRiskFree')))
    lead.push(t('result.unknown.notRiskFree'));
  return [...lead, t('result.orientation.unknown')].join(' ');
}

/**
 * The banner's instruction when a finding is a danger: the orientation every
 * danger card gives when they give the same one, else the standard "go to the
 * health post now".
 */
function dangerInstruction(scope: Scope, cards: readonly FindingView[]): string {
  const orientations = distinct(
    cards.filter((card) => card.level === 'danger').map((card) => card.orientation),
  );
  const [only] = orientations;
  return orientations.length === 1 && only !== undefined
    ? only
    : scope.t('result.orientation.danger');
}

/** The risk as read: for "nothing found", its first sentence first, with the version and date. */
function riskOf(scope: Scope, finding: Finding, message: Message): string {
  if (finding.message !== BUILTIN_MESSAGES.nothingFound) return message.risk;
  const version = scope.t('result.versionInline', { version: scope.version, date: scope.date });
  return `${message.fact.replace(/\.\s*$/, '')} ${version}. ${message.risk}`;
}

/** The sources of a finding; a danger sign's finding carries none, so the sign's own. */
function refsOf(scope: Scope, finding: Finding): readonly SourceRef[] {
  const sign = finding.sign;
  return finding.sources.length === 0 && sign !== undefined
    ? (scope.pack.dangerSigns.find((d) => d.id === sign)?.sources ?? [])
    : finding.sources;
}

/** The sources of every finding of a card, each once, never the quote. */
function sourcesOf(scope: Scope, group: readonly Finding[]): SourceView[] {
  const refs = group.flatMap((finding) => refsOf(scope, finding));
  const seen = new Set<string>();
  const sources: SourceView[] = [];
  for (const ref of refs) {
    const name = scope.pack.sources.find((s) => s.id === ref.source)?.name ?? ref.source;
    const key = `${name}|${ref.locator}|${ref.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Never the quote: it is provenance, and some quotes give a dose.
    sources.push(
      ref.url === undefined
        ? { name, locator: ref.locator }
        : { name, locator: ref.locator, url: ref.url },
    );
  }
  return sources;
}

/**
 * One card: the level, names, orientation, term and fact of its highest
 * finding, and every distinct risk of the group (in accompanied mode also
 * every detailed risk, evidence level, rule and source), so a merge never
 * hides what a lower finding says.
 */
function findingView(scope: Scope, group: readonly Finding[]): FindingView {
  const { t, mode } = scope;
  const [finding] = group;
  if (finding === undefined) throw new Error('A card needs at least one finding');
  const message = messageOf(scope, finding.message);
  const messages = group.map((f) => messageOf(scope, f.message));
  const names = namesOf(scope, finding);
  // A sign with its own message explains itself first (fever, then malaria);
  // the standard one's fact is the level again, so it is not said at all.
  const sign = finding.sign !== undefined;
  const signFact = sign && finding.message !== BUILTIN_MESSAGES.dangerSign;
  const risks = distinct(group.map((f, i) => riskOf(scope, f, messages[i] ?? message)));
  const said = [signFact ? message.fact : '', ...risks].join(' ');
  const view: FindingView = {
    key: `${keyOf(finding)}|${finding.ruleId ?? finding.message}`,
    level: finding.level,
    levelLabel: t(`level.${finding.level}`),
    title: joinNames(names, scope.lang),
    names,
    risks,
    orientation: message.orientation ?? defaultOrientation(scope, finding, said),
    capped: finding.capped,
  };
  if (signFact) view.lead = message.fact;
  if (finding.term === 'estimated' || finding.term === 'unknown') {
    view.termNote = t(`result.term.${finding.term}`);
  }
  if (mode === 'woman') return view;

  // "Nothing found" reads its fact in the risk, with the version; a sign's fact is the lead or nothing.
  if (finding.message !== BUILTIN_MESSAGES.nothingFound && !sign) view.fact = message.fact;
  const riskDetails = distinct(
    messages.flatMap((m) => (m.riskDetail === undefined ? [] : [m.riskDetail])),
  );
  if (riskDetails.length > 0) view.riskDetails = riskDetails;
  const levels = distinct(group.flatMap((f) => (f.evidence === undefined ? [] : [f.evidence])));
  if (levels.length > 0) {
    view.evidence = levels.map((level) => {
      const wording = t(`result.evidenceWording.${level}`);
      return { level, wording, text: t('result.evidence', { level, wording }) };
    });
  }
  if (finding.capped) view.cappedNote = t('result.capped');
  const sources = sourcesOf(scope, group);
  if (sources.length > 0) view.sources = sources;
  const ruleIds = distinct(group.flatMap((f) => (f.ruleId === undefined ? [] : [f.ruleId])));
  if (ruleIds.length > 0) view.ruleIds = ruleIds;
  return view;
}

function noteView(scope: Scope, note: Reminder, kind: Note['kind'] | 'reminder'): NoteView {
  const message = messageOf(scope, note.message);
  const view: NoteView = { key: `${kind}:${note.ruleId}`, text: `${message.fact} ${message.risk}` };
  if (message.orientation !== undefined) view.orientation = message.orientation;
  return view;
}

function shownNotes(notes: readonly Note[], mode: Mode): Note[] {
  return notes.filter((note) => note.kind === 'dose' || mode === 'accompanied');
}

/**
 * The result screen's content for an evaluation. `items` are the items of the
 * evaluation context (findings point into them by index). Throws when the
 * pack lacks a message the evaluation names.
 */
export function buildResultView(
  evaluation: Evaluation,
  pack: Pack,
  items: readonly CheckedItem[],
  mode: Mode,
  lang: Lang,
  t: Translate,
): ResultView {
  const scope: Scope = {
    pack,
    items,
    mode,
    lang,
    t,
    version: evaluation.pack.version,
    date: formatPackDate(evaluation.pack.date, lang),
  };
  const levelLabel = t(`level.${evaluation.level}`);
  const danger = evaluation.level === 'danger';
  const findings = cardGroups(evaluation.findings).map((group) => findingView(scope, group));
  const view: ResultView = {
    level: evaluation.level,
    levelLabel,
    headline: danger ? dangerInstruction(scope, findings) : levelLabel,
    danger,
    findings,
    reminders:
      mode === 'accompanied'
        ? evaluation.reminders.map((reminder) => noteView(scope, reminder, 'reminder'))
        : [],
    notes: shownNotes(evaluation.notes, mode).map((note) => noteView(scope, note, note.kind)),
    fixedLines: [t('result.noChange')],
    versionLine: t('result.version', { version: scope.version, date: scope.date }),
    notValidated: !evaluation.pack.clinicallyValidated,
    closing: t('result.closing'),
  };
  if (view.notValidated) view.notValidatedLine = t('result.notValidated');
  return view;
}
