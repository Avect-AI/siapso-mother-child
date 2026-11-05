// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { todayIso } from '../domain/dates.js';
import { groupsForProfile, shownGroups, signsByGroup } from '../domain/signs.js';
import { latestDay } from '../domain/term.js';
import type { Mode, Profile } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { readCheckProfile } from '../state/check-profile.js';
import { useCheck } from '../state/check-state.js';
import { Button } from '../ui/Button.js';
import { SectionedCheckboxGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { StickyAction } from '../ui/StickyAction.js';
import { flowEntry, flowState, oneMoreStep } from './check-flow.js';

/** No answer yet, "none of these signs", or the signs present now. */
type Answer = null | 'none' | string[];

/**
 * Danger signs now (spec section 7.1, screen 8), between the check and its
 * result: asked once, so that a sign present now (a fever: case 2 and 10)
 * reaches the evaluation. "Aucun de ces signes" is the first answer, explicit:
 * a sign left unticked is never read as none. Then the signs in their groups,
 * those of the profile first (during pregnancy; after the birth and the baby
 * when she breastfeeds, or when the baby may be born: a possibly past term, a
 * phone clock set back), every group one tap away ("Voir tous les signes"),
 * and a chosen sign always keeps its group shown. An answer is needed to go
 * on to the result.
 *
 * The question is about now: it always opens with nothing ticked, never with
 * an earlier answer (a sign may have started since), even on Back from the
 * result. What is ticked goes into the check as it changes, so a sign ticked
 * after Back is in the result the browser's Forward opens; with nothing
 * ticked, that result asks this question again.
 */
export function SignsNow() {
  const t = useT();
  const lang = useLang();
  const { settings, pack, packError, storageTimeoutMs } = useApp();
  const check = useCheck();
  const [, navigate] = useLocation();
  // Read once: how many history entries back the check is.
  const [entry] = useState(flowState);
  const mode: Mode = settings.mode ?? 'woman';
  const { profileId, items, setSigns, clearSigns, quick } = check;
  const [answer, setAnswer] = useState<Answer>(null);
  // The profile (null when it cannot be read), the phone's date, her last result kept.
  const [loaded, setLoaded] = useState<{
    profile: Profile | null;
    today: string;
    lastAt: string | undefined;
  } | null>(null);
  const [all, setAll] = useState(false);
  // The groups shown when "Voir tous les signes" was pressed: the focus goes to the first new one.
  const revealedFrom = useRef<readonly string[] | null>(null);
  const [attempts, setAttempts] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  // A ref, not state: two taps in the same task both see it at once.
  const submitted = useRef(false);
  const titleId = useId();

  // The answer on screen is the check's answer, from the first render (none yet) on.
  useEffect(() => {
    if (answer === null) clearSigns();
    else setSigns(answer === 'none' ? [] : answer);
  }, [answer, clearSigns, setSigns]);

  // The profile says which groups come first, read as the check reads it (its
  // term today, the days the app has already seen); when it cannot be read,
  // every group.
  useEffect(() => {
    if (profileId === null) return;
    let live = true;
    // A passer-by's answers are in memory (accompanied mode only); a profile is read from the phone.
    const passerBy = mode === 'accompanied' ? quick : null;
    withTimeout(readCheckProfile(profileId, passerBy), storageTimeoutMs).then(
      ({ profile, lastAt }) => {
        // Today from the phone's clock, handed to pure code.
        if (live) setLoaded({ profile: profile ?? null, today: todayIso(new Date()), lastAt });
      },
      (failure: unknown) => {
        console.warn('Profile not read on this device', failure);
        if (live) setLoaded({ profile: null, today: todayIso(new Date()), lastAt: undefined });
      },
    );
    return () => {
      live = false;
    };
  }, [profileId, quick, mode, storageTimeoutMs]);

  // A failed attempt moves focus to the first answer, its question in view.
  useEffect(() => {
    if (attempts === 0) return;
    const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!target) return;
    target.focus({ preventScroll: true });
    // The whole question (its legend, hint and error), not the section of the first answer.
    const question = target.closest<HTMLElement>('.choice-group') ?? target;
    if (typeof question.scrollIntoView === 'function') question.scrollIntoView({ block: 'start' });
  }, [attempts]);

  // "Voir tous les signes" is gone once pressed: the focus goes to the first
  // sign it showed (in the order of the list, so a section shown before the
  // others too), never to the page, so the new signs are read next.
  useEffect(() => {
    const before = revealedFrom.current;
    if (!all || before === null) return;
    revealedFrom.current = null;
    const first = [
      ...(formRef.current?.querySelectorAll<HTMLElement>('[data-section]') ?? []),
    ].find((section) => !before.includes(section.dataset['section'] ?? ''));
    first?.querySelector<HTMLInputElement>('input')?.focus();
  }, [all]);

  if (profileId === null || items.length === 0) return <Redirect to="/check" replace />;

  // A day the app has already seen, as on the check: the knowledge pack's date, her last result.
  const relevant =
    loaded === null
      ? null
      : groupsForProfile(loaded.profile, loaded.today, latestDay(pack?.date, loaded.lastAt));
  const listed = pack?.dangerSigns ?? [];
  const chosen = Array.isArray(answer) ? answer : [];
  const groups = shownGroups(listed, relevant ?? [], chosen, all);
  const hidden = listed.some((sign) => !groups.includes(sign.group));
  // The list is ready once the pack and the profile's groups are; without a pack, nothing to list.
  const ready = pack !== null && relevant !== null;

  const toggle = (id: string, checked: boolean) => {
    setAnswer((current) => {
      const present = Array.isArray(current) ? current.filter((s) => s !== id) : [];
      const next = checked ? [...present, id] : present;
      return next.length === 0 ? null : next;
    });
  };

  const title = t(mode === 'accompanied' ? 'signs.titleAccompanied' : 'signs.titleWoman');
  const error = attempts > 0 && answer === null ? t('signs.error') : undefined;

  return (
    <main className="screen signs">
      <form
        ref={formRef}
        className="signs__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (submitted.current) return;
          // Without a pack there is no list to answer: the result says what is missing.
          if (pack !== null && answer === null) {
            setAttempts((n) => n + 1);
            return;
          }
          submitted.current = true;
          setSigns(Array.isArray(answer) ? answer : []);
          // One entry more to the check: the result's way back goes there (check-flow.ts).
          navigate('/result', {
            state: flowEntry({ stepsToCheck: oneMoreStep(entry.stepsToCheck) }),
          });
        }}
      >
        {/* One heading, in one place from the first render: it keeps the focus the
            new screen gave it while the list loads, and it names the question. */}
        <h1 id={titleId} tabIndex={-1}>
          {title}
        </h1>
        {ready ? (
          <SectionedCheckboxGroup
            labelledBy={titleId}
            hint={t('signs.hint')}
            error={error}
            none={{
              id: 'none',
              label: t('signs.none'),
              checked: answer === 'none',
              onChange: (checked) => {
                setAnswer(checked ? 'none' : null);
              },
            }}
            sections={signsByGroup(listed, groups).map(({ group, signs: inGroup }) => ({
              id: group,
              label: t(`danger.group.${group}`),
              options: inGroup.map((sign) => ({
                id: sign.id,
                label: sign.label[lang],
                checked: chosen.includes(sign.id),
                onChange: (checked: boolean) => {
                  toggle(sign.id, checked);
                },
              })),
            }))}
          />
        ) : null}
        {ready && hidden ? (
          <Button
            variant="secondary"
            className="signs__all"
            onClick={() => {
              revealedFrom.current = groups;
              setAll(true);
            }}
          >
            {t('signs.showAll')}
          </Button>
        ) : null}
        {!ready && packError === null ? (
          <p className="signs__loading" role="status">
            {t('signs.loading')}
          </p>
        ) : null}
        {packError === null ? null : <Notice>{t('danger.listUnavailable')}</Notice>}
        {/* Held at the bottom while the list scrolls, as on the danger signs screen. */}
        <StickyAction>
          <Button
            type="submit"
            variant="primary"
            className="signs__continue"
            disabled={!ready && packError === null}
          >
            {t('signs.seeResult')}
          </Button>
        </StickyAction>
      </form>
    </main>
  );
}
