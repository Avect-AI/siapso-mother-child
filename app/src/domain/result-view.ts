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
  TERM_LOOKAHEAD_DAYS,
  type CheckedItem,
  type ConditionId,
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
import { formatDate } from './dates.js';
import { bandedName } from './dose-band.js';
import type { PossibleMatch } from './possible-matches.js';
import { displayOf } from './search-index.js';
import { sourceWords } from './sources.js';
import type { Mode } from './types.js';

export type Translate = (key: MessageKey, vars?: Vars) => string;

export interface SourceView {
  /** In the language of the screen. */
  name: string;
  locator: string;
  url?: string;
  /**
   * The language of its documents, in words ("documents en anglais"), when it
   * is not the language of the screen: its locators keep their own titles.
   */
  documents?: string;
  /** The language code of its documents, with `documents`, so a screen reader reads its locators in it. */
  documentsLang?: Lang;
}

export interface FindingView {
  /** Stable among the findings of one view. */
  key: string;
  level: Level;
  levelLabel: string;
  /** The products or remedies concerned, as confirmed, joined in the language, or the danger sign's label. */
  title: string;
  /**
   * The same names one by one, so a screen can set each product on its own
   * line; a strength keeps its unit ("1000 mg", a no-break space).
   */
  names: string[];
  /**
   * The names that are text she typed (a name kept as not recognised, a
   * possible match named as typed): the screen quotes them under a label,
   * never as its own words.
   */
  typed?: string[];
  /**
   * Read first, in both modes, when the card is about a possible match of a
   * name typed as not recognised (possible-matches.ts): what the name looks
   * like, and that what follows holds if it is that product or remedy.
   */
  possible?: string;
  /** The Latin name inside `possible` (a remedy's), so the screen reads it in Latin. */
  possibleLatin?: string;
  /**
   * For a card about a possible match, said after its level wherever the
   * level is said alone (the summary): "ressemble à Huile de ricin".
   */
  resembles?: string;
  /**
   * The texts typed for the products of the card shown under another name
   * ("cytotec"): the screen quotes each under "Vous avez écrit".
   */
  written?: string[];
  /**
   * Of the texts above (`typed` and `written`), those the voice heard: the
   * screen labels them "Vous avez dit", never "Vous avez écrit".
   */
  said?: string[];
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
   * first (two pregnancy rules on one ibuprofen: both risks), each with what
   * belongs to it alone in accompanied mode.
   */
  risks: RiskView[];
  /**
   * Who to show and when, of the highest finding: its message's own, or the
   * level's default; `{ inBanner: true }` for a danger card whose orientation
   * is the instruction of the danger banner above it, said once there.
   */
  orientation: string | InBanner;
  /**
   * Below the danger level, an orientation that says to go now if something
   * happens ("si le bébé dort beaucoup ... allez au poste de santé
   * maintenant"), and a danger that comes from a product: the card offers who
   * to call too.
   */
  callNow?: true;
  /** "Terme estimé" or "terme inconnu", when a pregnancy window matched on a range. */
  termNote?: string;
  /**
   * When the card is reached only through the term look-ahead: when she
   * reaches its window ("Elle atteindra 20 semaines dans 4 semaines au plus").
   */
  ahead?: string;
  /** Accompanied mode only: the sources of every finding of the card, each once. */
  sources?: SourceView[];
  /** Accompanied mode only: every rule of the card, in the same order. */
  ruleIds?: string[];
  /** Of the highest finding: its level was held down by weak evidence. */
  capped: boolean;
}

/**
 * Where the danger banner's instruction comes from, so another screen (who
 * to call) can word it again in the language of the moment: the orientation
 * of a pack message, or the standard danger orientation of the interface.
 */
export type InstructionSource = { message: string } | { standard: true };

/** The orientation of a danger card that the danger banner says, above the cards. */
export interface InBanner {
  inBanner: true;
}

/**
 * One risk of a card with, in accompanied mode, its own detailed risk,
 * evidence level and capped note: from the same finding, so a merged card
 * never pairs a risk with another finding's evidence.
 */
export interface RiskView {
  /** No numbers, except the version and date of "nothing found". */
  text: string;
  /** Accompanied mode only: the detailed risk of its message, when it has one. */
  detail?: string;
  /** Accompanied mode only: the evidence level of its finding, when it has one. */
  evidence?: EvidenceView;
  /** Accompanied mode only: its finding's level was held down by weak evidence. */
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
  /**
   * Shown only at an explicit tap: a note on contraception can say a secret
   * to whoever sees the screen (the result screen hides the situations and
   * the reminders as whole sections).
   */
  concealed?: true;
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
  /** When a finding is a danger, where the headline comes from (for who to call). */
  headlineSource?: InstructionSource;
  /**
   * When the danger comes only from possible matches, what it resembles, said
   * after the level in the banner: "ressemble à Huile de ricin".
   */
  levelNote?: string;
  /** A finding is a danger: the screen leads with the danger banner. */
  danger: boolean;
  /**
   * The danger comes from a product rule alone, no danger sign: who to call
   * names it "Danger : à montrer maintenant", never "Signe de danger".
   */
  productDanger: boolean;
  /**
   * The items (indexes into the evaluated items) of the danger findings that
   * come from a product rule: who to call says them too ("Dites aussi ce
   * qu'elle prend").
   */
  dangerItems: number[];
  /** One per item set and check, in engine order (shownFindings). */
  findings: FindingView[];
  /** Accompanied mode only. */
  reminders: NoteView[];
  /** Dose notes in both modes, each text once; contraception notes in accompanied mode only. */
  notes: NoteView[];
  /**
   * Both modes: one note per situation of the profile that no rule of the pack
   * reads, said before the cards, since the whole result leaves it out.
   */
  situations: NoteView[];
  /**
   * The situations are shown at a tap only: one of them could say her HIV
   * status to whoever sees the screen. The knowledge pack always reads that
   * situation, so it is never listed and the notes show in clear; a pack that
   * stopped reading it would hide them again.
   */
  situationsConcealed: boolean;
  fixedLines: string[];
  versionLine: string;
  notValidated: boolean;
  /** Set when the pack is not clinically validated. */
  notValidatedLine?: string;
  /** The same, short, said near the top of the result with the version line. */
  notValidatedShortLine?: string;
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
 * A strength held to its unit, so a line never breaks between "1000" and
 * "mg" in a product name ("DOLIPRANE 1000 mg, comprimé").
 */
export function keepUnits(name: string): string {
  return name.replace(/(\d) (mg|g|ml|µg|mcg|UI|%)(?![\p{L}\p{N}])/gu, '$1 $2');
}

/** What the result knows of the items besides the evaluation. */
export interface ResultExtras {
  /** The items added as possible matches of names typed as not recognised, by index. */
  possible?: ReadonlyMap<number, PossibleMatch>;
  /** The name typed for an item shown under another name, if any. */
  writtenOf?: (item: CheckedItem) => string | undefined;
  /** Whether the voice heard the name of an item (its written text, or its unrecognised text). */
  saidOf?: (item: CheckedItem) => boolean;
}

interface Scope extends ResultExtras {
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

/** A name of a card, whether it is text she typed, and whether the voice heard it. */
interface Named {
  name: string;
  typed: boolean;
  said?: boolean;
}

/**
 * The names a finding is about: its products and remedies as confirmed, a
 * strength held to its unit, or its danger sign. Text she typed stays as typed.
 */
function namesOf(scope: Scope, finding: Finding): Named[] {
  const { pack, lang, items } = scope;
  if (finding.sign !== undefined) {
    const sign = finding.sign;
    return [
      { name: pack.dangerSigns.find((d) => d.id === sign)?.label[lang] ?? sign, typed: false },
    ];
  }
  const names = finding.items.flatMap((index): Named[] => {
    const item = items[index];
    // A possible match is named as she typed it: the card says what it looks like.
    const possible = scope.possible?.get(index);
    if (possible !== undefined) {
      const from = items[possible.forItem];
      return [{ name: possible.typed, typed: true, said: saidItem(scope, from) }];
    }
    if (item === undefined) return [];
    if (item.ref.kind === 'unrecognised') {
      return [{ name: item.ref.text, typed: true, said: saidItem(scope, item) }];
    }
    // A box whose dose is asked by a range says it: why an aspirin card applies or not.
    const shown = displayOf(pack, item.ref, lang, item.strengthUnknown === true).name;
    return [{ name: keepUnits(bandedName(pack, item, shown, lang, scope.t)), typed: false }];
  });
  return names.length === 0 ? [{ name: scope.t(`level.${finding.level}`), typed: false }] : names;
}

/**
 * "Ce nom ressemble à ADVIL 400 mg (Ibuprofène 400 mg). Si c'est ce produit :",
 * for a card about a possible match, with the Latin name of a remedy apart.
 */
function possibleOf(scope: Scope, finding: Finding): { text: string; latin?: string } | undefined {
  const index = finding.items.find((i) => scope.possible?.has(i) === true);
  const item = index === undefined ? undefined : scope.items[index];
  if (item !== undefined && item.ref.kind !== 'unrecognised') {
    const shown = displayOf(scope.pack, item.ref, scope.lang, item.strengthUnknown === true);
    const banded = bandedName(scope.pack, item, shown.name, scope.lang, scope.t);
    const name = shown.detail === undefined ? banded : `${banded} (${shown.detail})`;
    const key = item.ref.kind === 'plant' ? 'result.possiblePlant' : 'result.possibleProduct';
    const text = scope.t(key, { name });
    return shown.detailLang === 'la' && shown.detail !== undefined
      ? { text, latin: shown.detail }
      : { text };
  }
  // The grey card of the name typed itself, read after its possible match: "Si ce n'est pas ce produit :".
  for (const [added, { forItem }] of scope.possible ?? []) {
    const ref = scope.items[added]?.ref;
    if (!finding.items.includes(forItem) || ref === undefined) continue;
    const key = ref.kind === 'plant' ? 'result.possibleNotPlant' : 'result.possibleNotProduct';
    return { text: scope.t(key) };
  }
  return undefined;
}

/** "ressemble à Huile de ricin", for a finding about a possible match: said after its level. */
function resemblesOf(scope: Scope, finding: Finding): string | undefined {
  const index = finding.items.find((i) => scope.possible?.has(i) === true);
  const item = index === undefined ? undefined : scope.items[index];
  if (item === undefined || item.ref.kind === 'unrecognised') return undefined;
  const shown = displayOf(scope.pack, item.ref, scope.lang, item.strengthUnknown === true).name;
  const name = bandedName(scope.pack, item, shown, scope.lang, scope.t);
  return scope.t('result.resembles', { name });
}

/** Whether the voice heard the name of an item. */
function saidItem(scope: Scope, item: CheckedItem | undefined): boolean {
  return item !== undefined && scope.saidOf?.(item) === true;
}

/** The text typed ("cytotec") for each product of a card shown under another name, and whether it was heard. */
function writtenOf(scope: Scope, finding: Finding): { text: string; said: boolean }[] {
  const texts = finding.items.flatMap((index) => {
    const item = scope.items[index];
    if (item === undefined || scope.possible?.has(index) === true) return [];
    const text = scope.writtenOf?.(item);
    return text === undefined ? [] : [{ text, said: saidItem(scope, item) }];
  });
  return texts.filter((entry, at) => texts.findIndex((other) => other.text === entry.text) === at);
}

/** Names joined as the language says a list ("A et B", "A, B et C"). */
export function joinNames(names: readonly string[], lang: Lang): string {
  return new Intl.ListFormat(lang, { type: 'conjunction', style: 'long' }).format(names);
}

/**
 * The level's default orientation (spec section 10): in accompanied mode,
 * worded for the person helping, at a visit or at a sale, about her (before
 * she takes any, to a health worker; at her next visit), as the accompanied
 * orientations of the pack messages, so the cards of one result name the same
 * people and timing in each mode. For "we do not know" it first says that
 * there is no reliable information and that nobody knows whether the product
 * can harm, leaving out what the card has just said (`said`: what is read
 * before the orientation).
 */
function defaultOrientation(scope: Scope, finding: Finding, said: string): string {
  const { t, mode } = scope;
  const accompanied = mode === 'accompanied';
  if (finding.level === 'before-next-dose') {
    const several = finding.items.length > 1;
    if (accompanied) {
      return t(several ? 'result.orientationProductsAccompanied' : 'result.orientationAccompanied');
    }
    return t(several ? 'result.orientationProducts' : 'result.orientation.before-next-dose');
  }
  const orientation =
    accompanied && finding.level !== 'danger'
      ? t(`result.orientationAccompaniedLevel.${finding.level}`)
      : t(`result.orientation.${finding.level}`);
  if (finding.level !== 'unknown') return orientation;
  const text = said.toLowerCase().replace(/[’]/g, "'");
  const says = (...keys: MessageKey[]) => keys.some((key) => text.includes(t(key)));
  const lead: string[] = [];
  if (!says('result.unknownSaid.noInformation', 'result.unknownSaid.unknown')) {
    lead.push(t('result.unknown.noInformation'));
  }
  if (!says('result.unknownSaid.mayHarm', 'result.unknownSaid.notRiskFree')) {
    lead.push(t('result.unknown.mayHarm'));
  }
  return [...lead, orientation].join(' ');
}

/**
 * For a danger held at "before the next dose" because the name typed only
 * looks like its product or remedy (possible-matches.ts: its rule is a danger
 * rule and it reads a possible match), the kind of what it looks like.
 */
function heldDanger(scope: Scope, finding: Finding): 'product' | 'plant' | undefined {
  if (finding.level === 'danger' || finding.ruleId === undefined) return undefined;
  // A daily maximum that depends on the box, and a window still ahead, are held
  // by the engine, not for a resemblance.
  if (finding.check === 'C7' || finding.windowStart !== undefined) return undefined;
  if (scope.pack.rules.find((r) => r.id === finding.ruleId)?.level !== 'danger') return undefined;
  const index = finding.items.find((i) => scope.possible?.has(i) === true);
  const kind = index === undefined ? undefined : scope.items[index]?.ref.kind;
  return kind === 'product' || kind === 'plant' ? kind : undefined;
}

/** The level the pack's rule of a finding declares, when the finding is a rule's. */
function declaredLevel(scope: Scope, finding: Finding): Level | undefined {
  return finding.ruleId === undefined
    ? undefined
    : scope.pack.rules.find((r) => r.id === finding.ruleId)?.level;
}

/**
 * A danger rule the engine held at a lower level because its window is still
 * ahead (reached only through the term look-ahead): its "go now" waits.
 */
function dangerAhead(scope: Scope, finding: Finding): boolean {
  return (
    finding.windowStart !== undefined &&
    finding.level !== 'danger' &&
    declaredLevel(scope, finding) === 'danger'
  );
}

/**
 * A possible toxic amount: a daily maximum of a danger rule reached only with
 * the highest strength of a box of unknown strength, held at before the next
 * dose (committee question R-2), which still says today and who to call.
 */
function possibleOverdose(scope: Scope, finding: Finding): boolean {
  return (
    finding.check === 'C7' &&
    finding.level !== 'danger' &&
    finding.windowStart === undefined &&
    declaredLevel(scope, finding) === 'danger'
  );
}

/**
 * The finding whose message says who to show and when on a card: among the
 * findings of the card's level, a possible toxic amount first, else the first
 * that is not a danger still ahead; none (the level's default) when every one
 * is a danger still ahead.
 */
function orientationFinding(scope: Scope, group: readonly Finding[]): Finding | undefined {
  const level = group[0]?.level;
  const same = group.filter((f) => f.level === level);
  return same.find((f) => possibleOverdose(scope, f)) ?? same.find((f) => !dangerAhead(scope, f));
}

/** The words that say now in an orientation (whole words, any case). */
const NOW: Readonly<Record<Lang, RegExp>> = {
  fr: /(?<![\p{L}\p{N}])(?:maintenant|immédiatement)(?![\p{L}\p{N}])/iu,
  en: /(?<![\p{L}\p{N}])(?:now|immediately)(?![\p{L}\p{N}])/iu,
};

/** A card as built, before the banner takes over the danger instruction. */
type CardView = FindingView & { orientation: string };

/**
 * The banner's instruction when a finding is a danger: the orientation every
 * danger card gives when they give the same one, else the standard "go to the
 * health post now".
 */
function dangerInstruction(
  scope: Scope,
  cards: readonly CardView[],
  groups: readonly (readonly Finding[])[],
): { text: string; source: InstructionSource } {
  const danger = cards.flatMap((card, index) => {
    const first = groups[index]?.[0];
    return card.level === 'danger' && first !== undefined ? [{ card, first }] : [];
  });
  const orientations = distinct(danger.map(({ card }) => card.orientation));
  const [only] = danger;
  if (orientations.length !== 1 || only === undefined) {
    return { text: scope.t('result.orientation.danger'), source: { standard: true } };
  }
  // The message's own orientation, or the level's default (the standard one).
  const own = messageOf(scope, only.first.message).orientation !== undefined;
  return {
    text: only.card.orientation,
    source: own ? { message: only.first.message } : { standard: true },
  };
}

/**
 * A card under a danger banner leaves who to call to the banner's action,
 * except a danger that comes from a product: its card says its instruction
 * and who to call too, so a card read aloud on its own says what to do.
 */
function withoutCall(card: FindingView, productDanger: boolean): FindingView {
  if (card.callNow === undefined || productDanger) return card;
  const rest: FindingView = { ...card };
  delete rest.callNow;
  return rest;
}

/**
 * A danger sign card whose orientation is the banner's instruction leaves it
 * to the banner (said once); a product danger card keeps it.
 */
function saidInBanner(card: CardView, instruction: string, productDanger: boolean): FindingView {
  return card.level === 'danger' && !productDanger && card.orientation === instruction
    ? { ...card, orientation: { inBanner: true } }
    : card;
}

/**
 * "Nothing found" (no rule reads the product), "nothing applies" (no rule
 * applies to this situation) and "not recognised" (a name typed as it is):
 * their fact is said in the risk, in both modes, since it is what she must
 * know first, never behind "Pourquoi ?".
 */
function aboutTheBase(finding: Finding): boolean {
  return (
    finding.message === BUILTIN_MESSAGES.nothingFound ||
    finding.message === BUILTIN_MESSAGES.nothingApplies ||
    finding.message === BUILTIN_MESSAGES.notRecognised
  );
}

/**
 * The name of a level: in accompanied mode, the next visit is hers ("À dire à
 * sa prochaine visite"), the words of the accompanied orientations.
 */
function levelName(t: Translate, level: Level, mode: Mode): string {
  return mode === 'accompanied' && level === 'next-contact'
    ? t('result.levelAccompanied.next-contact')
    : t(`level.${level}`);
}

/**
 * The level name of a finding: a danger that comes from a product rule is
 * never called a danger sign (DESIGN.md, Levels).
 */
function levelLabelOf(t: Translate, finding: Finding, mode: Mode): string {
  return finding.level === 'danger' && finding.sign === undefined
    ? t('result.dangerProductLevel')
    : levelName(t, finding.level, mode);
}

/**
 * The risk as read: for a message about the base, its fact first. The version
 * and date are not put inside her sentence: the result says them at the top
 * and at the end.
 */
function riskOf(finding: Finding, message: Message): string {
  return aboutTheBase(finding) ? `${message.fact} ${message.risk}` : message.risk;
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
    const source = scope.pack.sources.find((s) => s.id === ref.source);
    const words = source === undefined ? undefined : sourceWords(source, scope.lang);
    const name = words?.name ?? ref.source;
    const key = `${name}|${ref.locator}|${ref.url ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Never the quote: it is provenance, and some quotes give a dose.
    const view: SourceView = { name, locator: ref.locator };
    if (ref.url !== undefined) view.url = ref.url;
    if (words?.documents !== undefined) {
      view.documents = scope.t(`sourceDocuments.${words.documents}`);
      view.documentsLang = words.documents;
    }
    sources.push(view);
  }
  return sources;
}

/**
 * One risk of a card: its sentence and, in accompanied mode, the detailed
 * risk, evidence level and capped note of the same finding.
 */
function riskView(scope: Scope, finding: Finding, message: Message): RiskView {
  const { t } = scope;
  const risk: RiskView = { text: riskOf(finding, message) };
  if (scope.mode === 'woman') return risk;
  if (message.riskDetail !== undefined) risk.detail = message.riskDetail;
  const level = finding.evidence;
  if (level !== undefined) {
    const wording = t(`result.evidenceWording.${level}`);
    risk.evidence = { level, wording, text: t('result.evidence', { level, wording }) };
  }
  if (finding.capped) risk.cappedNote = t('result.capped');
  return risk;
}

/**
 * One card: the level, names, orientation, term and fact of its highest
 * finding, and every distinct risk of the group (in accompanied mode each
 * with its own detailed risk, evidence level and capped note, and every rule
 * and source), so a merge never hides what a lower finding says.
 */
function findingView(scope: Scope, group: readonly Finding[]): CardView {
  const { t, mode } = scope;
  const [finding] = group;
  if (finding === undefined) throw new Error('A card needs at least one finding');
  const message = messageOf(scope, finding.message);
  const names = namesOf(scope, finding);
  // A sign with its own message explains itself first (fever, then malaria);
  // the standard one's fact is the level again, so it is not said at all.
  const sign = finding.sign !== undefined;
  const signFact = sign && finding.message !== BUILTIN_MESSAGES.dangerSign;
  // Each risk once, with what is its own (two rules of one message and level: one risk).
  const all = group.map((f) => riskView(scope, f, messageOf(scope, f.message)));
  const risks = all.filter(
    (risk, index) =>
      all.findIndex((other) => JSON.stringify(other) === JSON.stringify(risk)) === index,
  );
  const said = [signFact ? message.fact : '', ...distinct(risks.map((r) => r.text))].join(' ');
  const shown = names.map((n) => n.name);
  // A danger held down to "before the next dose" for a resemblance branches on
  // intake: go now if it was taken, else show it first to find out whether it
  // is the product (committee question N-3). Its urgency is never lowered.
  const held = heldDanger(scope, finding);
  const accompanied = scope.mode === 'accompanied';
  // Who to show and when comes from the finding of the card's level that
  // says it best: a possible toxic amount first (today, with who to call),
  // never a danger still ahead (its "go now" waits for its window).
  const voice = orientationFinding(scope, group);
  const spoken = voice === undefined ? undefined : messageOf(scope, voice.message);
  // In accompanied mode, the message's own words for the person helping, about her.
  const own = (accompanied ? spoken?.orientationAccompanied : undefined) ?? spoken?.orientation;
  const orientation =
    held === undefined
      ? (own ?? defaultOrientation(scope, finding, said))
      : t(
          accompanied
            ? `result.orientationHeld.${held}Accompanied`
            : `result.orientationHeld.${held}`,
        );
  const view: CardView = {
    key: `${keyOf(finding)}|${finding.ruleId ?? finding.message}`,
    level: finding.level,
    levelLabel: levelLabelOf(t, finding, scope.mode),
    title: joinNames(shown, scope.lang),
    names: shown,
    risks,
    orientation,
    capped: finding.capped,
  };
  const typed = names.filter((n) => n.typed).map((n) => n.name);
  if (typed.length > 0) view.typed = typed;
  const heard = names.filter((n) => n.typed && n.said === true).map((n) => n.name);
  // A product danger offers who to call on its card; below the danger level, a
  // card whose orientation says to go now if something happens does too.
  const productDanger = finding.level === 'danger' && !sign;
  const possibleToxic = voice !== undefined && possibleOverdose(scope, voice);
  if (
    productDanger ||
    possibleToxic ||
    (finding.level !== 'danger' && NOW[scope.lang].test(orientation))
  ) {
    view.callNow = true;
  }
  if (signFact) view.lead = message.fact;
  const possible = possibleOf(scope, finding);
  if (possible !== undefined) {
    view.possible = possible.text;
    if (possible.latin !== undefined) view.possibleLatin = possible.latin;
  }
  const resembles = resemblesOf(scope, finding);
  if (resembles !== undefined) view.resembles = resembles;
  const written = writtenOf(scope, finding);
  if (written.length > 0) view.written = written.map((entry) => entry.text);
  const voiced = distinct([
    ...heard,
    ...written.filter((entry) => entry.said).map((entry) => entry.text),
  ]);
  if (voiced.length > 0) view.said = voiced;
  if (finding.term === 'estimated' || finding.term === 'unknown') {
    view.termNote = t(`result.term.${finding.term}`);
  }
  // When she reaches the window of a finding of the card reached only through
  // the look-ahead; "perhaps" for a term only estimated.
  const ahead = group.find((f) => f.windowStart !== undefined);
  if (ahead?.windowStart !== undefined) {
    const estimated = ahead.term === 'estimated' || ahead.term === 'unknown';
    const key = accompanied
      ? estimated
        ? 'result.aheadAccompaniedEstimated'
        : 'result.aheadAccompanied'
      : estimated
        ? 'result.aheadWomanEstimated'
        : 'result.aheadWoman';
    view.ahead = t(key, { week: ahead.windowStart, within: TERM_LOOKAHEAD_DAYS / 7 });
  }
  if (mode === 'woman') return view;

  // A message about the base reads its fact in the risk; a sign's fact is the lead or nothing.
  if (!aboutTheBase(finding) && !sign) view.fact = message.fact;
  const sources = sourcesOf(scope, group);
  if (sources.length > 0) view.sources = sources;
  const ruleIds = distinct(group.flatMap((f) => (f.ruleId === undefined ? [] : [f.ruleId])));
  if (ruleIds.length > 0) view.ruleIds = ruleIds;
  return view;
}

function noteView(scope: Scope, note: Reminder, kind: Note['kind'] | 'reminder'): NoteView {
  const message = messageOf(scope, note.message);
  const view: NoteView = { key: `${kind}:${note.ruleId}`, text: `${message.fact} ${message.risk}` };
  const orientation =
    (scope.mode === 'accompanied' ? message.orientationAccompanied : undefined) ??
    message.orientation;
  if (orientation !== undefined) view.orientation = orientation;
  if (kind === 'contraception') view.concealed = true;
  return view;
}

/**
 * The notes a mode shows, each message once: two daily maximums of one
 * substance (paracetamol-max-daily, paracetamol-overdose) give the same dose
 * note, said once.
 */
function shownNotes(notes: readonly Note[], mode: Mode): Note[] {
  const seen = new Set<string>();
  return notes.filter((note) => {
    if (note.kind !== 'dose' && mode !== 'accompanied') return false;
    const key = `${note.kind}|${note.message}`;
    if (note.kind === 'dose' && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whether a rule of the pack reads a situation, as a requirement or as an exception. */
function readByARule(pack: Pack, condition: ConditionId): boolean {
  return pack.rules.some(
    (rule) =>
      (rule.when.requires ?? []).some((r) => 'condition' in r && r.condition === condition) ||
      (rule.when.unlessConditions ?? []).includes(condition),
  );
}

/**
 * The situations whose mere mention can say a secret to whoever sees the
 * screen (docs/privacy.md): a note about one of them hides the whole section.
 */
const SENSITIVE_CONDITIONS: readonly ConditionId[] = ['hiv-cotrimoxazole'];

/**
 * One note, in both modes, for each situation of the profile that no rule of
 * the pack reads: the result says plainly that it does not take it into
 * account, rather than staying silent about a question the profile asked.
 */
function conditionNotes(scope: Scope, conditions: readonly ConditionId[]): NoteView[] {
  const { pack, t, mode } = scope;
  return distinct(conditions)
    .filter((condition) => !readByARule(pack, condition))
    .map((condition) => ({
      key: `condition:${condition}`,
      text: t('result.conditionNote', { situation: t(`profile.condition.${condition}`) }),
      orientation: t(
        mode === 'accompanied'
          ? 'result.conditionOrientationAccompanied'
          : 'result.conditionOrientation',
      ),
    }));
}

/**
 * The level name of the result, said first in the danger banner: a danger
 * sign's when a sign is present, else the product danger's.
 */
function resultLevelLabel(t: Translate, evaluation: Evaluation, mode: Mode): string {
  if (evaluation.level !== 'danger') return levelName(t, evaluation.level, mode);
  const sign = evaluation.findings.some((f) => f.level === 'danger' && f.sign !== undefined);
  return sign ? t('level.danger') : t('result.dangerProductLevel');
}

/**
 * The fixed line that ends every result (spec section 2): "change nothing in
 * the treatment without a professional", to her or about her. Beside a daily
 * maximum or a danger that comes from a product it would contradict the card
 * ("before the next dose", "go now"), so it says not to take more instead.
 */
function fixedLine(t: Translate, evaluation: Evaluation, mode: Mode): string {
  const more = evaluation.findings.some(
    (f) => f.check === 'C7' || (f.level === 'danger' && f.sign === undefined),
  );
  const accompanied = mode === 'accompanied';
  if (more) return t(accompanied ? 'result.noMoreAccompanied' : 'result.noMore');
  return t(accompanied ? 'result.noChangeAccompanied' : 'result.noChange');
}

/**
 * The result screen's content for an evaluation. `items` are the items of the
 * evaluation context (findings point into them by index), possible matches
 * included (`extras.possible`), `conditions` its situations. Throws when the
 * pack lacks a message the evaluation names.
 */
export function buildResultView(
  evaluation: Evaluation,
  pack: Pack,
  items: readonly CheckedItem[],
  mode: Mode,
  lang: Lang,
  t: Translate,
  conditions: readonly ConditionId[] = [],
  extras: ResultExtras = {},
): ResultView {
  const scope: Scope = {
    ...extras,
    pack,
    items,
    mode,
    lang,
    t,
    version: evaluation.pack.version,
    date: formatDate(evaluation.pack.date, lang),
  };
  const levelLabel = resultLevelLabel(t, evaluation, mode);
  const danger = evaluation.level === 'danger';
  const groups = cardGroups(evaluation.findings);
  const cards = groups.map((group) => findingView(scope, group));
  const instruction = danger ? dangerInstruction(scope, cards, groups) : null;
  const headline = instruction?.text ?? levelLabel;
  // Whether each card is a danger that comes from a product (not a danger sign).
  const fromProduct = groups.map((group) => {
    const first = group[0];
    return first?.level === 'danger' && first.sign === undefined;
  });
  const productFindings = evaluation.findings.filter(
    (f) => f.level === 'danger' && f.sign === undefined,
  );
  const situations = conditionNotes(scope, conditions);
  const view: ResultView = {
    level: evaluation.level,
    levelLabel,
    headline,
    danger,
    productDanger:
      danger &&
      productFindings.length > 0 &&
      evaluation.findings.every((f) => f.sign === undefined),
    dangerItems: [...new Set(productFindings.flatMap((f) => f.items))].sort((a, b) => a - b),
    // A danger sign's instruction is said once, in the banner, and who to call
    // is the banner's action: it carries the danger and the signs. A product
    // danger card says its own instruction and offers who to call too.
    findings: danger
      ? cards.map((card, index) => {
          const product = fromProduct[index] === true;
          return withoutCall(saidInBanner(card, headline, product), product);
        })
      : cards,
    reminders:
      mode === 'accompanied'
        ? evaluation.reminders.map((reminder) => noteView(scope, reminder, 'reminder'))
        : [],
    notes: shownNotes(evaluation.notes, mode).map((note) => noteView(scope, note, note.kind)),
    situations,
    situationsConcealed: situations.some((note) =>
      SENSITIVE_CONDITIONS.some((condition) => note.key === `condition:${condition}`),
    ),
    fixedLines: [fixedLine(t, evaluation, mode)],
    versionLine: t('result.version', { version: scope.version, date: scope.date }),
    notValidated: !evaluation.pack.clinicallyValidated,
    closing: t('result.closing'),
  };
  if (view.notValidated) {
    view.notValidatedLine = t('result.notValidated');
    view.notValidatedShortLine = t('result.notValidatedShort');
  }
  if (instruction !== null) view.headlineSource = instruction.source;
  // A danger that only a resemblance gives says so next to its level.
  const dangers = cards.filter((card) => card.level === 'danger');
  const notes = distinct(dangers.map((card) => card.resembles));
  const [note] = notes;
  if (danger && notes.length === 1 && note !== undefined) view.levelNote = note;
  return view;
}
