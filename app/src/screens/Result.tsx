// SPDX-License-Identifier: MIT
import {
  evaluate,
  TERM_LOOKAHEAD_DAYS,
  type CheckedItem,
  type ConditionId,
  type Evaluation,
} from '@siapso/engine';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Redirect, useLocation } from 'wouter';
import { historyEntryOf, latestHistoryAt, recordHistoryOnce } from '../data/history.js';
import { getProfile } from '../data/profiles.js';
import { contextFromProfile } from '../domain/context.js';
import { todayIso } from '../domain/dates.js';
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
import {
  babyMayBeBorn,
  latestDay,
  profileTermStatus,
  type ProfileTermStatus,
} from '../domain/term.js';
import type { Mode, Profile } from '../domain/types.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { inSession } from '../state/entry-state.js';
import { Button } from '../ui/Button.js';
import { DangerBanner } from '../ui/DangerBanner.js';
import { LevelIcon } from '../ui/LevelIcon.js';
import { Notice } from '../ui/Notice.js';
import { ResultCard } from '../ui/ResultCard.js';
import { backToCheck, flowState } from './check-flow.js';
import { OutdatedTerm } from './OutdatedTerm.js';
import { CALL_PATH } from './Referral.js';

type Loaded =
  | { status: 'loading' }
  /**
   * The profile, today on the phone's clock when it was read, and when her
   * last result was kept (a phone date before it is a clock set back).
   */
  | { status: 'ready'; profile: Profile; today: string; lastAt: string | undefined }
  | { status: 'missing' }
  | { status: 'failed' };

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

/** The words with a lower-case first letter, to sit inside a sentence ("Terme retenu : environ…"). */
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

/** The sources of a finding by source, in their order: each source named once, then its records. */
function bySource(sources: readonly SourceView[]): { name: string; records: SourceView[] }[] {
  const groups: { name: string; records: SourceView[] }[] = [];
  for (const source of sources) {
    const group = groups.find((g) => g.name === source.name);
    if (group) group.records.push(source);
    else groups.push({ name: source.name, records: [source] });
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
                <p className="result-card__source-name">{group.name}</p>
                <ul>
                  {group.records.map((record) => (
                    <li key={`${record.locator}|${record.url ?? ''}`}>
                      {record.url === undefined ? (
                        record.locator
                      ) : (
                        <a href={record.url} target="_blank" rel="noopener noreferrer">
                          {record.locator}
                          <span className="sr-only"> {t('result.newWindow')}</span>
                        </a>
                      )}
                    </li>
                  ))}
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
 * the next line, light; a comma between names is only said, not shown.
 */
function Names({ names }: { names: readonly string[] }) {
  const lang = useLang();
  if (names.length < 2) return <>{names[0]}</>;
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
        {part.value}
      </span>,
    );
    between = '';
  });
  return <>{lines}</>;
}

function Finding({ finding }: { finding: FindingView }) {
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
      title={<Names names={finding.names} />}
      headingLevel={2}
      orientation={typeof finding.orientation === 'string' ? finding.orientation : null}
      {...(details === undefined ? {} : { details })}
      {...(hasMeta(finding) ? { meta: <FindingMeta finding={finding} /> } : {})}
    >
      {(finding.written ?? []).map((line) => (
        <p key={line} className="meta">
          {line}
        </p>
      ))}
      {finding.possible === undefined ? null : (
        <p className="result-card__possible">{finding.possible}</p>
      )}
      {finding.lead === undefined ? null : <p>{finding.lead}</p>}
      {texts.map((text) => (
        <p key={text}>{text}</p>
      ))}
      {finding.termNote === undefined ? null : <p className="meta">{finding.termNote}</p>}
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
              <Names names={finding.names} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Notes or reminders under their heading: never a level, so never a level colour. */
function Notes({ heading, notes }: { heading: MessageKey; notes: ResultView['notes'] }) {
  const t = useT();
  const id = useId();
  if (notes.length === 0) return null;
  return (
    <section className="result__notes" aria-labelledby={id}>
      <h2 id={id}>{t(heading)}</h2>
      {notes.map((note) => (
        <div key={note.key} className="result__note">
          <p>{note.text}</p>
          {note.orientation === undefined ? null : (
            <p className="orientation">{note.orientation}</p>
          )}
        </div>
      ))}
    </section>
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
 * Result: what to do about each product, read aloud to the woman. When a
 * finding is a danger, the danger banner leads, with the screen's one
 * primary action (who to call). Then, when there are several findings, a
 * summary (level, then product, most urgent first), then the situations of
 * the profile that the base does not read yet (both modes), then one card per
 * item set and check (the highest level of each), then the notes and, in
 * accompanied mode, the reminders, then the fixed sentences, the knowledge
 * base version and "not clinically validated", then the way back to the
 * list, which keeps the check so a forgotten product can be added.
 *
 * Every evaluation is kept in the history on the phone. While the pack or
 * the profile loads, the screen says so; when either cannot be read, or the
 * check cannot be evaluated, it says so in words with the way back, never a
 * blank screen. Without a check in progress it goes to the check.
 */
export function Result() {
  const t = useT();
  const lang = useLang();
  const { settings, pack, packError, storageTimeoutMs } = useApp();
  const check = useCheck();
  const [, navigate] = useLocation();
  // Read once: how many history entries back the check is.
  const [entry] = useState(flowState);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const mode: Mode = settings.mode ?? 'woman';
  const { profileId, items, signs, signsGiven } = check;
  const recorded = useRef<Evaluation | null>(null);

  // Each reading of the profile and the phone's date; a new one when the app
  // comes back to the front (a result left open for days must not keep its term).
  const [reading, setReading] = useState(0);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') setReading((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (profileId === null) return;
    let live = true;
    const load = async () => {
      const profile = await getProfile(profileId);
      return { profile, lastAt: profile ? await latestHistoryAt(profileId) : undefined };
    };
    withTimeout(load(), storageTimeoutMs).then(
      ({ profile, lastAt }) => {
        // Today from the phone's clock, handed to pure code (the term and the context).
        const today = todayIso(new Date());
        if (!live) return;
        setLoaded(profile ? { status: 'ready', profile, today, lastAt } : { status: 'missing' });
      },
      (failure: unknown) => {
        console.warn('Profile not read on this device', failure);
        if (live) setLoaded({ status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [profileId, storageTimeoutMs, reading]);

  // A day the app has already seen: the knowledge pack's date, her last result.
  const notBefore = loaded.status === 'ready' ? latestDay(pack?.date, loaded.lastAt) : undefined;
  const term =
    loaded.status === 'ready' ? profileTermStatus(loaded.profile, loaded.today, notBefore) : null;
  const outdated = term?.status === 'outdated';

  const evaluated = useMemo((): Evaluated | null => {
    // An outdated term is updated first: no result is worked out on it.
    if (pack === null || loaded.status !== 'ready' || outdated) return null;
    try {
      const context = contextFromProfile(loaded.profile, { items, signs }, loaded.today, notBefore);
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
  }, [pack, loaded, outdated, notBefore, items, signs, check.declinedOf]);

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
        { possible: evaluated.possible, writtenOf: check.writtenOf },
      );
    } catch (failure) {
      console.warn('The result could not be shown', failure);
      return 'failed';
    }
  }, [evaluated, pack, mode, lang, t, check.writtenOf]);

  // Each check once in the history of this visit (not on every opening of the
  // screen), on the phone only; a failure to keep it never hides the result.
  useEffect(() => {
    if (evaluated?.status !== 'ready' || profileId === null || !signsGiven) return;
    if (recorded.current === evaluated.evaluation) return;
    recorded.current = evaluated.evaluation;
    const kept = historyEntryOf({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      profileId,
      evaluation: evaluated.evaluation,
      items: evaluated.checked,
      signs,
    });
    recordHistoryOnce(kept).catch((failure: unknown) => {
      console.warn('Evaluation not kept in the history on this device', failure);
    });
  }, [evaluated, profileId, signs, signsGiven]);

  if (profileId === null || items.length === 0) return <Redirect to="/check" replace />;
  // The signs present now are asked before any result (a typed address, an old entry).
  if (!signsGiven) return <Redirect to="/signs" replace />;
  // The guard on the result: an outdated term asks whether the baby is born instead.
  if (outdated && loaded.status === 'ready') {
    return (
      <main className="screen result">
        <OutdatedTerm mode={mode} profile={loaded.profile} />
      </main>
    );
  }

  const back = () => {
    backToCheck(navigate, entry.stepsToCheck);
  };

  let problem: MessageKey | null = null;
  if (pack === null && packError !== null) problem = 'home.packUnavailable';
  else if (loaded.status === 'failed') problem = 'profile.loadFailed';
  else if (loaded.status === 'missing') problem = 'result.profileMissing';
  else if (view === 'failed') problem = 'result.failed';
  const ready = problem === null && view !== null && view !== 'failed' ? view : null;

  const title =
    mode === 'accompanied' && loaded.status === 'ready'
      ? t('result.titleFor', { name: loaded.profile.pseudonym })
      : t('result.title');

  // What the result was worked out on: under the title, or under the danger
  // banner when there is one (the danger instruction comes first).
  const profileLines =
    loaded.status === 'ready' && term !== null && ready !== null ? (
      <ProfileLines profile={loaded.profile} today={loaded.today} term={term} mode={mode} />
    ) : null;

  return (
    <main className="screen result">
      <div className="result__intro">
        <h1 tabIndex={-1}>{title}</h1>
        {ready?.danger === true ? null : profileLines}
      </div>
      {problem === null ? null : <Notice>{t(problem)}</Notice>}
      {problem === null && ready === null ? (
        <p className="result__loading" role="status">
          {t('result.loading')}
        </p>
      ) : null}
      {ready === null ? null : (
        <>
          {ready.danger ? (
            <DangerBanner
              levelLabel={
                ready.levelNote === undefined
                  ? ready.levelLabel
                  : `${ready.levelLabel} (${ready.levelNote})`
              }
              title={ready.headline}
              action={t('result.dangerAction')}
              headingLevel={2}
              onAction={() => {
                // Who to call says the same instruction (which message says it, so it
                // is worded in the language of the moment), and the signs to say.
                navigate(CALL_PATH, {
                  state: inSession({ instruction: ready.headlineSource, signs }),
                });
              }}
            />
          ) : null}
          {ready.danger ? profileLines : null}
          {ready.findings.length > 1 ? <Summary view={ready} /> : null}
          {/* The situations the result leaves out, said before any card. */}
          <Notes heading="result.situations" notes={ready.situations} />
          <div className="result__findings">
            {ready.findings.map((finding) => (
              <Finding key={finding.key} finding={finding} />
            ))}
          </div>
          <Notes heading="result.notes" notes={ready.notes} />
          <Notes heading="result.reminders" notes={ready.reminders} />
          <Closing view={ready} />
        </>
      )}
      {problem === null && ready === null ? null : (
        <Button
          variant={ready?.danger === true ? 'secondary' : 'primary'}
          className="result__back"
          onClick={back}
        >
          {t('result.backToList')}
        </Button>
      )}
    </main>
  );
}
