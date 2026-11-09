// SPDX-License-Identifier: MIT
import {
  evaluate,
  TERM_LOOKAHEAD_DAYS,
  type CheckedItem,
  type ConditionId,
  type Evaluation,
} from '@siapso/engine';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { contextFromProfile } from '../domain/context.js';
import { isStale } from '../domain/staleness.js';
import { babyLine } from '../domain/profile-summary.js';
import {
  cappedEvaluation,
  withPossibleMatches,
  type PossibleMatch,
} from '../domain/possible-matches.js';
import {
  buildResultView,
  type FindingView,
  type ResultView,
  type RiskView,
  type SourceView,
} from '../domain/result-view.js';
import { babyMayBeBorn, profileTermStatus, type ProfileTermStatus } from '../domain/term.js';
import type { Mode, Profile } from '../domain/types.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { inSession } from '../state/entry-state.js';
import { Button } from '../ui/Button.js';
import { Concealed } from '../ui/Concealed.js';
import { DangerBanner } from '../ui/DangerBanner.js';
import { LevelIcon } from '../ui/LevelIcon.js';
import { Notice } from '../ui/Notice.js';
import { ResultCard } from '../ui/ResultCard.js';
import { Typed } from './Typed.js';
import { CALL_PATH } from './Referral.js';

/**
 * Under the title, what the result was worked out on: the term used (and the
 * coming weeks the engine looks ahead to), why it is unknown when the phone's
 * clock is behind a day the app has seen, that a pregnancy is only possible,
 * or that the baby may be born (breastfeeding taken into account too); then
 * the baby's age when she breastfeeds.
 */
function ProfileLines({
  profile,
  today,
  term,
  mode,
}: {
  profile: Profile;
  today: string;
  term: ProfileTermStatus;
  mode: Mode;
}) {
  const t = useT();
  const lines: string[] = [];
  const read = term.status === 'ok' || term.status === 'possibly-past' ? term : null;
  if (read?.unsure === true) lines.push(t('profileStatus.maybePregnant'));
  if (read !== null && !read.unsure) {
    const words = t(read.term.label.key, read.term.label.vars);
    lines.push(t('result.termUsed', { term: lowerFirst(words) }));
    // An unknown term already covers every week: nothing more to look ahead to.
    if (read.term.precision !== 'unknown') {
      lines.push(t('result.lookahead', { weeks: TERM_LOOKAHEAD_DAYS / 7 }));
    }
  }
  if (term.status === 'possibly-past') {
    lines.push(t(mode === 'accompanied' ? 'result.mayBeBornAccompanied' : 'result.mayBeBornWoman'));
  }
  // The baby's age is not what the result used when the baby may be born (any age).
  if (profile.breastfeeding && !babyMayBeBorn(term)) {
    const baby = babyLine(profile, today);
    lines.push(t(baby.key, baby.vars));
  }
  if (lines.length === 0 && term.status !== 'clock') return null;
  return (
    <div className="result__profile">
      {/* A problem she can act on (the phone's date): ink with the triangle. */}
      {term.status === 'clock' ? (
        <Notice>
          {t(mode === 'accompanied' ? 'result.termClockAccompanied' : 'result.termClockWoman')}
        </Notice>
      ) : null}
      {lines.map((line) => (
        <p key={line} className="meta">
          {line}
        </p>
      ))}
    </div>
  );
}

/** The words with a lower-case first letter, to sit inside a sentence ("Terme utilisé pour ce résultat : environ…"). */
function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase() + text.slice(1);
}

/**
 * The evaluation of the check, with the items it read: the items of the
 * context (the profile's long-term ones included), then the possible matches
 * of the names typed as not recognised (`possible`), and the profile's
 * situations. `checked` are the items of the context alone, as the history
 * keeps them.
 */
type Evaluated =
  | {
      status: 'ready';
      evaluation: Evaluation;
      items: CheckedItem[];
      checked: CheckedItem[];
      possible: Map<number, PossibleMatch>;
      conditions: ConditionId[];
    }
  | { status: 'failed' };

/** Whether a finding has source or rule lines: in accompanied mode only. */
function hasMeta({ sources, ruleIds }: FindingView): boolean {
  return sources !== undefined || ruleIds !== undefined;
}

/** What a risk has for the health worker: its detailed risk, evidence level or capped note. */
function hasDetail({ detail, evidence, cappedNote }: RiskView): boolean {
  return detail !== undefined || evidence !== undefined || cappedNote !== undefined;
}

interface SourceGroup {
  name: string;
  /** The language of its documents, in words, when it is not the screen's. */
  documents: string | undefined;
  records: SourceView[];
}

/** The sources of a finding by source, in their order: each source named once, then its records. */
function bySource(sources: readonly SourceView[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const source of sources) {
    const group = groups.find((g) => g.name === source.name);
    if (group) group.records.push(source);
    else groups.push({ name: source.name, documents: source.documents, records: [source] });
  }
  return groups;
}

/** Sources and rules of a finding. */
function FindingMeta({ finding }: { finding: FindingView }) {
  const t = useT();
  const { sources, ruleIds } = finding;
  return (
    <>
      {sources === undefined ? null : (
        <div className="result-card__sources">
          <p>{t('result.sources')}</p>
          {/* Offline, a link opens the browser's error page: say so before. */}
          {sources.some((source) => source.url !== undefined) ? (
            <p>{t('offline.linksNeedInternet')}</p>
          ) : null}
          <ul>
            {bySource(sources).map((group) => (
              <li key={group.name}>
                <p className="result-card__source-name">
                  {group.name}
                  {/* Its records keep their own titles: a French screen says they are in English. */}
                  {group.documents === undefined ? null : (
                    <span className="result-card__documents">, {group.documents}</span>
                  )}
                </p>
                <ul>
                  {group.records.map((record) => {
                    // A record in the other language is read in it by a screen reader.
                    const locator =
                      record.documentsLang === undefined ? (
                        record.locator
                      ) : (
                        <span lang={record.documentsLang}>{record.locator}</span>
                      );
                    return (
                      <li key={`${record.locator}|${record.url ?? ''}`}>
                        {record.url === undefined ? (
                          locator
                        ) : (
                          <a href={record.url} target="_blank" rel="noopener noreferrer">
                            {locator}
                            <span className="sr-only"> {t('result.newWindow')}</span>
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ruleIds === undefined ? null : (
        <p>
          {ruleIds.length === 1
            ? t('result.rule', { id: ruleIds[0] ?? '' })
            : t('result.rules', { ids: ruleIds.join(', ') })}
        </p>
      )}
    </>
  );
}

/**
 * The names of a finding, each product on its own line so that one product is
 * never read as two, nor two as one: the language's list words ("et") start
 * the next line, light; a comma between names is only said, not shown. A name
 * she typed (`typed`) is quoted (Typed): under its label when `labelled` (the
 * card), with the label for a screen reader alone otherwise (the summary);
 * "Vous avez dit" for one the voice heard (`said`).
 */
function Names({
  names,
  typed = [],
  said = [],
  labelled = false,
}: {
  names: readonly string[];
  typed?: readonly string[] | undefined;
  said?: readonly string[] | undefined;
  labelled?: boolean;
}) {
  const lang = useLang();
  const shown = (name: string): ReactNode =>
    typed.includes(name) ? (
      <Typed text={name} label={labelled ? 'shown' : 'hidden'} said={said.includes(name)} />
    ) : (
      name
    );
  if (names.length < 2) return <>{shown(names[0] ?? '')}</>;
  const parts = new Intl.ListFormat(lang, { type: 'conjunction', style: 'long' }).formatToParts(
    names,
  );
  const lines: ReactNode[] = [];
  let between = '';
  parts.forEach((part, index) => {
    if (part.type === 'literal') {
      between = part.value;
      return;
    }
    // " et " gives the word "et"; ", " gives a comma that is only said.
    const [, comma = '', word = ''] = /^\s*(,?)\s*(.*?)\s*$/.exec(between) ?? [];
    // Spaces as plain text between the lines, so a screen reader says the names apart.
    if (lines.length > 0) {
      if (comma !== '') {
        lines.push(
          <span key={`${String(index)}c`} className="sr-only">
            {comma}
          </span>,
        );
      }
      lines.push(' ');
    }
    lines.push(
      <span key={index} className="result__name">
        {word === '' ? null : <span className="result__and">{word}</span>}
        {word === '' ? null : ' '}
        {shown(part.value)}
      </span>,
    );
    between = '';
  });
  return <>{lines}</>;
}

/**
 * Under a card whose orientation says to go now if something happens: who to
 * call, one tap away, quiet (the screen keeps its one primary action). Under a
 * product danger card, the same way as the danger banner's action (`onCall`),
 * which tells who to call the instruction, the signs and what she takes.
 */
function CallNow({ onCall }: { onCall?: (() => void) | undefined }) {
  const t = useT();
  if (onCall !== undefined) {
    return (
      <Button variant="quiet" onClick={onCall}>
        {t('result.callNow')}
      </Button>
    );
  }
  return (
    <a className="button button--quiet" href={`#${CALL_PATH}`}>
      {t('result.callNow')}
    </a>
  );
}

/**
 * What a name typed looks like ("Ce nom ressemble à Huile de ricin (Ricinus
 * communis). Si c'est ce remède :"), its Latin name read in Latin.
 */
function Possible({ text, latin }: { text: string; latin: string | undefined }) {
  const at = latin === undefined ? -1 : text.indexOf(latin);
  if (latin === undefined || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span lang="la">{latin}</span>
      {text.slice(at + latin.length)}
    </>
  );
}

function Finding({ finding, onCall }: { finding: FindingView; onCall?: () => void }) {
  const t = useT();
  // Accompanied mode: the fact, then each risk's detailed risk with its own
  // evidence level and capped note, after who to show and when, so both modes
  // say the same lines first. In a card of several risks each of these blocks
  // starts with its risk, so a detail or a level is never read as another's.
  const several = finding.risks.length > 1;
  const detailed = finding.risks.filter(hasDetail);
  const details =
    finding.fact === undefined && detailed.length === 0 ? undefined : (
      <>
        {finding.fact === undefined ? null : <p>{finding.fact}</p>}
        {detailed.map((risk, index) => (
          <div key={`${String(index)}:${risk.text}`} className="result-card__risk">
            {several ? <p className="result-card__risk-name">{risk.text}</p> : null}
            {risk.detail === undefined ? null : <p>{risk.detail}</p>}
            {risk.evidence === undefined ? null : <p className="meta">{risk.evidence.text}</p>}
            {risk.cappedNote === undefined ? null : <p className="meta">{risk.cappedNote}</p>}
          </div>
        ))}
      </>
    );
  // The risk sentences, each once (the same sentence with two evidence levels is read once).
  const texts = [...new Set(finding.risks.map((risk) => risk.text))];
  return (
    <ResultCard
      level={finding.level}
      levelLabel={finding.levelLabel}
      title={<Names names={finding.names} typed={finding.typed} said={finding.said} labelled />}
      headingLevel={3}
      orientation={typeof finding.orientation === 'string' ? finding.orientation : null}
      {...(finding.callNow === true
        ? { action: <CallNow onCall={finding.level === 'danger' ? onCall : undefined} /> }
        : {})}
      {...(details === undefined ? {} : { details })}
      {...(hasMeta(finding) ? { meta: <FindingMeta finding={finding} /> } : {})}
      whyLabel={t('result.why')}
    >
      {(finding.written ?? []).map((text) => (
        <p key={text} className="meta">
          <Typed text={text} label="shown" said={finding.said?.includes(text) === true} />
        </p>
      ))}
      {finding.possible === undefined ? null : (
        <p className="result-card__possible">
          <Possible text={finding.possible} latin={finding.possibleLatin} />
        </p>
      )}
      {finding.lead === undefined ? null : <p>{finding.lead}</p>}
      {texts.map((text) => (
        <p key={text}>{text}</p>
      ))}
      {finding.termNote === undefined ? null : <p className="meta">{finding.termNote}</p>}
      {finding.ahead === undefined ? null : <p className="meta">{finding.ahead}</p>}
    </ResultCard>
  );
}

/**
 * Every level and product of the cards in one row each, most urgent first, in
 * the order of the cards: an index read before the details. Two cards for the
 * same products at the same level (a duplicate and a daily maximum) are one row.
 */
function Summary({ view }: { view: ResultView }) {
  const t = useT();
  const rows = view.findings.filter(
    (finding, index) =>
      view.findings.findIndex((f) => f.level === finding.level && f.title === finding.title) ===
      index,
  );
  return (
    <ul className="result-summary" aria-label={t('result.summary')}>
      {rows.map((finding) => (
        <li key={finding.key} className={`result-summary__row level--${finding.level}`}>
          <span className="result-summary__mark">
            <LevelIcon level={finding.level} />
          </span>
          <span className="result-summary__text">
            <strong>{finding.levelLabel}</strong>
            {finding.resembles === undefined ? null : ` (${finding.resembles})`}
            <span className="sr-only">.</span>{' '}
            <span>
              <Names names={finding.names} typed={finding.typed} said={finding.said} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Notes or reminders under their heading: never a level, so never a level
 * colour. A note on contraception shows only at an explicit tap. With
 * `concealAll`, the whole section is one button whatever it holds (the
 * reminders, whose absence could say HIV; the situations, should one of them
 * say it), labelled `concealLabel` ("Rappels : touchez pour les afficher"),
 * and with `empty` it shows even with nothing in it, so that its presence
 * says nothing either.
 */
function Notes({
  heading,
  notes,
  concealAll = false,
  concealLabel = 'conceal.note',
  empty,
}: {
  heading: MessageKey;
  notes: ResultView['notes'];
  concealAll?: boolean;
  concealLabel?: MessageKey;
  /** Said when there is no note; the section then shows anyway. */
  empty?: string;
}) {
  const t = useT();
  const id = useId();
  if (notes.length === 0 && empty === undefined) return null;
  const items =
    notes.length === 0 ? (
      <p className="result__note">{empty}</p>
    ) : (
      notes.map((note) => {
        const words = (
          <div className="result__note">
            <p>{note.text}</p>
            {note.orientation === undefined ? null : (
              <p className="orientation">{note.orientation}</p>
            )}
          </div>
        );
        return note.concealed && !concealAll ? (
          <Concealed key={note.key} label={t('conceal.note')}>
            {words}
          </Concealed>
        ) : (
          <Fragment key={note.key}>{words}</Fragment>
        );
      })
    );
  return (
    <section className="result__notes" aria-labelledby={id}>
      <h3 id={id}>{t(heading)}</h3>
      {concealAll ? <Concealed label={t(concealLabel)}>{items}</Concealed> : items}
    </section>
  );
}

/**
 * Near the top, under the banner or the summary: the knowledge base version
 * and "not clinically validated", short, so a reader who stops at the first
 * screen still sees them (the closing lines say them in full).
 */
function Basis({ view }: { view: ResultView }) {
  return (
    <div className="result__basis">
      <p className="meta">{view.versionLine}</p>
      {view.notValidatedShortLine === undefined ? null : (
        <p className="result__not-validated">{view.notValidatedShortLine}</p>
      )}
    </div>
  );
}

function Closing({ view }: { view: ResultView }) {
  return (
    <div className="result__closing">
      {view.fixedLines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p className="meta">{view.versionLine}</p>
      {view.notValidatedLine === undefined ? null : (
        <p className="result__not-validated">{view.notValidatedLine}</p>
      )}
      <p>{view.closing}</p>
    </div>
  );
}

/**
 * What a check shows of the evaluation, for the history (SCRUM-56, S15): the
 * evaluation, the items of the context (as the history keeps them) and the
 * signs it was worked out with.
 */
export interface ShownResult {
  evaluation: Evaluation;
  checked: CheckedItem[];
  signs: string[];
}

/** The live line of the result: the level now, said once when it changes. */
function levelOf(view: ResultView): string {
  return view.levelNote === undefined ? view.levelLabel : `${view.levelLabel} (${view.levelNote})`;
}

/**
 * The result of the check, on the check screen under the danger signs
 * answer (SCRUM-56, S15): what to do about each product, read aloud to the
 * woman, worked out again whenever the list, her answers, the signs or the day
 * change (the engine is pure and fast). Its heading "Résultat" (h2). When a
 * finding is a danger, the danger banner leads, with who to call; a result
 * that is a danger when it first shows, and a level that becomes a danger,
 * take the focus to the banner, which comes into view; any other result takes
 * the focus to its heading when it first shows (the answer was a button
 * press); a later change of level is said once by a live line. Then what the
 * result was worked out on, then, when the base is more than 90 days old, a
 * notice; when there are several findings, a summary (level, then product,
 * most urgent first); then the version and "not clinically validated", short,
 * so the first screen says them; then the situations of the profile that the
 * base does not read yet (both modes), then one card per item set and check
 * (the highest level of each; in accompanied mode its details, evidence,
 * sources and rules behind "Pourquoi ?"), then the notes and, in accompanied
 * mode, the reminders, then the fixed sentences, the knowledge base version
 * and "not clinically validated" in full. The list is above: no way back.
 * Text she typed is always quoted, never said as the app's own words.
 *
 * `onShown` hands each evaluation shown to the check, which keeps one
 * history entry per check (never for a passer-by). When the pack cannot be
 * read or the check cannot be evaluated, it says so in words, never a blank.
 */
export function CheckResult({
  profile,
  today,
  notBefore,
  passerBy,
  onShown,
}: {
  profile: Profile;
  today: string;
  /** A day the app has already seen (the check's), for where her term stands. */
  notBefore: string | undefined;
  /** A passer-by looked up without saving: her result is shown, never kept. */
  passerBy: boolean;
  onShown: (shown: ShownResult) => void;
}) {
  const t = useT();
  const lang = useLang();
  const { settings, pack, packError } = useApp();
  const check = useCheck();
  const [, navigate] = useLocation();
  const mode: Mode = settings.mode ?? 'woman';
  const { items, signs } = check;
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  // The level shown last, to say a change once and to bring a new danger into view.
  const lastLevel = useRef<string | null>(null);
  const lastDanger = useRef(false);
  const [levelSaid, setLevelSaid] = useState('');

  const term = profileTermStatus(profile, today, notBefore);

  const evaluated = useMemo((): Evaluated | null => {
    // The check shows the outdated-term step instead: no result on such a term.
    if (pack === null || term.status === 'outdated') return null;
    try {
      const context = contextFromProfile(profile, { items, signs }, today, notBefore);
      // A name typed as not recognised is evaluated as what it clearly names
      // too; a resemblance short of a clear name is not kept after she said
      // "none of these", and never makes the result a danger.
      const net = withPossibleMatches(pack, context.items, { declined: check.declinedOf });
      return {
        status: 'ready',
        evaluation: cappedEvaluation(
          evaluate(pack, { ...context, items: net.items }),
          net.possible,
        ),
        items: net.items,
        checked: context.items,
        possible: net.possible,
        conditions: context.conditions,
      };
    } catch (failure) {
      console.warn('The check could not be evaluated', failure);
      return { status: 'failed' };
    }
  }, [pack, profile, today, notBefore, term.status, items, signs, check.declinedOf]);

  const view = useMemo((): ResultView | 'failed' | null => {
    if (evaluated === null || pack === null) return null;
    if (evaluated.status === 'failed') return 'failed';
    try {
      return buildResultView(
        evaluated.evaluation,
        pack,
        evaluated.items,
        mode,
        lang,
        t,
        evaluated.conditions,
        {
          possible: evaluated.possible,
          writtenOf: check.writtenOf,
          saidOf: check.saidOf,
          aboveOf: check.aboveOf,
        },
      );
    } catch (failure) {
      console.warn('The result could not be shown', failure);
      return 'failed';
    }
  }, [evaluated, pack, mode, lang, t, check.writtenOf, check.saidOf, check.aboveOf]);

  let problem: MessageKey | null = null;
  if (pack === null && packError !== null) problem = 'home.packUnavailable';
  else if (view === 'failed') problem = 'result.failed';
  const ready = problem === null && view !== null && view !== 'failed' ? view : null;

  // Each evaluation shown goes to the check, which keeps the history entry.
  useEffect(() => {
    if (evaluated?.status !== 'ready' || ready === null || passerBy) return;
    onShown({ evaluation: evaluated.evaluation, checked: evaluated.checked, signs });
  }, [evaluated, ready, passerBy, signs, onShown]);

  // The focus at the first showing and at a change of level (WCAG 3.2.2: it
  // follows a button press or a product added or taken off).
  useEffect(() => {
    if (ready === null) return;
    const level = levelOf(ready);
    const first = lastLevel.current === null;
    const becameDanger = ready.danger && !lastDanger.current;
    lastDanger.current = ready.danger;
    if (!first && level !== lastLevel.current && !becameDanger) {
      // Said once by the live line; the focus stays where she is.
      setLevelSaid(t('result.levelNow', { level }));
    }
    lastLevel.current = level;
    const target = ready.danger && (first || becameDanger) ? bannerRef.current : null;
    const focused = target ?? (first ? headingRef.current : null);
    if (focused === null) return;
    focused.focus({ preventScroll: true });
    if (typeof focused.scrollIntoView === 'function') focused.scrollIntoView({ block: 'start' });
  }, [ready, t]);

  let title = t('result.title');
  if (passerBy) title = t('result.titleQuick');
  else if (mode === 'accompanied') title = t('result.titleFor', { name: profile.pseudonym });

  // What the result was worked out on: under the title, or under the danger
  // banner when there is one (the danger instruction comes first).
  const profileLines =
    ready === null ? null : (
      <ProfileLines profile={profile} today={today} term={term} mode={mode} />
    );
  // A knowledge base out of date is said where the decision is read: at the
  // top of the result, after the danger banner when there is one.
  const stale = ready !== null && pack !== null && isStale(pack.date, today);
  const staleNotice = stale ? <Notice>{t('status.stale')}</Notice> : null;

  // Who to call from a danger: the banner's action and a product danger card's
  // link say the same instruction (which message says it, so it is worded in
  // the language of the moment), the signs, and the products of the danger.
  const callFromDanger =
    ready?.danger === true && evaluated?.status === 'ready'
      ? () => {
          const products = ready.dangerItems.flatMap((index) => {
            const item = evaluated.items[index];
            if (item === undefined || item.ref.kind === 'unrecognised') return [];
            return [
              {
                kind: item.ref.kind,
                id: item.ref.id,
                ...(item.strengthUnknown === true ? { strengthUnknown: true } : {}),
                ...(item.strengthAtMostMg === undefined
                  ? {}
                  : { strengthAtMostMg: item.strengthAtMostMg }),
                ...(check.aboveOf(item) ? { doseAbove: true } : {}),
              },
            ];
          });
          navigate(CALL_PATH, {
            state: inSession({
              instruction: ready.headlineSource,
              signs,
              products,
              productDanger: ready.productDanger,
            }),
          });
        }
      : undefined;

  return (
    <section className="result check__result" aria-labelledby={titleId}>
      <div className="result__intro">
        <h2 id={titleId} ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        {ready?.danger === true ? null : profileLines}
      </div>
      {/* A change of level after the first showing, said once. */}
      <p className="sr-only" role="status">
        {levelSaid}
      </p>
      {ready?.danger === true ? null : staleNotice}
      {problem === null ? null : <Notice>{t(problem)}</Notice>}
      {problem === null && ready === null ? (
        <p className="result__loading" role="status">
          {t('result.loading')}
        </p>
      ) : null}
      {ready === null ? null : (
        <>
          {ready.danger ? (
            <div ref={bannerRef} className="check__danger" tabIndex={-1}>
              <DangerBanner
                levelLabel={levelOf(ready)}
                title={ready.headline}
                action={t('result.dangerAction')}
                headingLevel={3}
                onAction={() => {
                  callFromDanger?.();
                }}
              />
            </div>
          ) : null}
          {ready.danger ? profileLines : null}
          {ready.danger ? staleNotice : null}
          {ready.findings.length > 1 ? <Summary view={ready} /> : null}
          <Basis view={ready} />
          {/* The situations the result leaves out, said before any card, in
              clear: hidden only if one could say HIV (the pack always reads it). */}
          <Notes
            heading="result.situations"
            notes={ready.situations}
            concealAll={ready.situationsConcealed}
          />
          <div className="result__findings">
            {ready.findings.map((finding) => (
              <Finding
                key={finding.key}
                finding={finding}
                {...(callFromDanger === undefined ? {} : { onCall: callFromDanger })}
              />
            ))}
          </div>
          <Notes heading="result.notes" notes={ready.notes} />
          {/* Accompanied mode: always there, always hidden, so that a reminder
              left out (the IPTp reminder, for HIV with cotrimoxazole) says nothing;
              the button says what it holds (docs/privacy.md). */}
          {mode === 'accompanied' ? (
            <Notes
              heading="result.reminders"
              notes={ready.reminders}
              concealAll
              concealLabel="conceal.reminders"
              empty={t('result.noReminder')}
            />
          ) : null}
          <Closing view={ready} />
        </>
      )}
    </section>
  );
}
