// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef, useState } from 'react';
import { groupsForProfile, shownGroups, signsAnswerKey, signsByGroup } from '../domain/signs.js';
import type { Mode, Profile } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { Button } from '../ui/Button.js';
import { SectionedCheckboxGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { StickyAction } from '../ui/StickyAction.js';

/** A sign's words inside a list: "fièvre", "saignement par le vagin". */
function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase() + text.slice(1);
}

/** The words of a list, the first one capitalised: "Fièvre, saignement par le vagin, ...". */
function upperFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/**
 * The danger signs present now, asked on the check screen just before the
 * result (SCRUM-56, S13), once at least one product is listed: the question,
 * then the signs of her groups in words (pregnancy; after the birth and the
 * baby when she breastfeeds or the baby may be born; every group when her
 * profile could not be read), "Voir tous les signes" for the others, then two
 * answers. "Non, aucun de ces signes" is one tap. "Oui, au moins un" clears
 * any answer and opens the list to tick in place (her groups first, nothing
 * ticked, every sign one tap away), then "Voir le résultat" with the signs
 * ticked. Never preselected, never read from an earlier answer: a box left
 * unticked is never read as none, and the list needs at least one sign.
 *
 * The answer given stays for this check (S14): a line in its place says it
 * ("Signes de danger maintenant : aucun"), with "Changer", which clears it
 * (the result is hidden) and asks the question again with nothing chosen.
 * The check forgets it when it is left, when her answers change and at every
 * lock (check-state.ts).
 */
export function CheckSigns({
  profile,
  today,
  notBefore,
  mode,
}: {
  /** Her profile as the check reads it; null when it could not be read (every group). */
  profile: Profile | null;
  today: string;
  /** A day the app has already seen (the check's), for where her term stands. */
  notBefore: string | undefined;
  mode: Mode;
}) {
  const t = useT();
  const lang = useLang();
  const { pack, packError } = useApp();
  const { signs, signsGivenFor, setSigns, clearSigns } = useCheck();
  // The answer counts only for what it was given for: her answers as saved,
  // the day and the signs asked (S14, 8.5); otherwise the question is asked.
  const answerKey = signsAnswerKey(profile, today, notBefore);
  const signsGiven = signsGivenFor(answerKey);
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // "Oui, au moins un": the list to tick is open.
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  // The groups shown when "Voir tous les signes" was pressed: the focus goes to the first new one.
  const revealedFrom = useRef<readonly string[] | null>(null);
  const [attempts, setAttempts] = useState(0);
  // A ref, not state: two taps in the same task give one answer.
  const answered = useRef(false);
  // "Changer" pressed: the question takes the focus once it is back.
  const askAgain = useRef(false);

  // Asked again for any reason (Changer, her answers saved elsewhere, a new
  // day, other signs to ask): the next tap answers again, never a dead end.
  useEffect(() => {
    if (!signsGiven) answered.current = false;
  }, [signsGiven]);

  // The question back after "Changer": its heading takes the focus.
  useEffect(() => {
    if (signsGiven || !askAgain.current) return;
    askAgain.current = false;
    headingRef.current?.focus();
  }, [signsGiven]);

  // "Oui, au moins un" (a button press: WCAG 3.2.2) gives the focus to the first sign of the list.
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
  }, [open]);

  // A refused "Voir le résultat": the focus goes to the first sign, the question in view.
  useEffect(() => {
    if (attempts === 0) return;
    const target = listRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!target) return;
    target.focus({ preventScroll: true });
    const question = target.closest<HTMLElement>('.choice-group') ?? target;
    if (typeof question.scrollIntoView === 'function') question.scrollIntoView({ block: 'start' });
  }, [attempts]);

  // "Voir tous les signes" pressed: the focus goes to what it showed (the
  // first new sign of the list, or the words), never to the page.
  useEffect(() => {
    const before = revealedFrom.current;
    if (!all || before === null) return;
    revealedFrom.current = null;
    if (!open) {
      wordsRef.current?.focus();
      return;
    }
    const first = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[data-section]') ?? []),
    ].find((section) => !before.includes(section.dataset['section'] ?? ''));
    first?.querySelector<HTMLInputElement>('input')?.focus();
  }, [all, open]);

  const listed = pack?.dangerSigns ?? [];
  const groups = shownGroups(listed, groupsForProfile(profile, today, notBefore), ticked, all);
  const hidden = listed.some((sign) => !groups.includes(sign.group));
  const byGroup = signsByGroup(listed, groups);
  const title = t(mode === 'accompanied' ? 'signs.titleAccompanied' : 'signs.titleWoman');

  const answerNone = () => {
    if (answered.current) return;
    answered.current = true;
    setSigns([], answerKey);
  };

  const seeAll = () => {
    revealedFrom.current = groups;
    setAll(true);
  };

  // The answer given, kept for this check: said in a line with "Changer".
  if (signsGiven) {
    const words = signs.flatMap((id) => {
      const sign = listed.find((s) => s.id === id);
      return sign === undefined ? [] : [lowerFirst(sign.label[lang])];
    });
    return (
      <div className="check__signs check__signs--answered">
        <p className="check__signs-answer">
          {words.length === 0
            ? t('signs.answeredNone')
            : t('signs.answeredSome', { signs: words.join(', ') })}
        </p>
        <Button
          variant="quiet"
          className="check__signs-change"
          aria-label={t('signs.changeNamed')}
          onClick={() => {
            // Asked again, nothing chosen: the result is hidden until a new answer.
            answered.current = false;
            askAgain.current = true;
            setOpen(false);
            setTicked([]);
            setAttempts(0);
            clearSigns();
          }}
        >
          {t('signs.change')}
        </Button>
      </div>
    );
  }

  // Without a pack there is no list to answer: the result says what is missing.
  if (pack === null) {
    return (
      <section className="check__signs" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {packError === null ? (
          <p className="signs__loading" role="status">
            {t('signs.loading')}
          </p>
        ) : (
          <>
            <Notice>{t('danger.listUnavailable')}</Notice>
            <Button variant="secondary" className="check__signs-result" onClick={answerNone}>
              {t('signs.seeResult')}
            </Button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="check__signs" aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      {open ? null : (
        // The signs in words, right above the answer that says none of them.
        <div ref={wordsRef} className="check__sign-words" tabIndex={-1}>
          {byGroup.map(({ group, signs }) => {
            const words = upperFirst(signs.map((sign) => lowerFirst(sign.label[lang])).join(', '));
            return (
              <p key={group}>
                {byGroup.length === 1
                  ? `${words}.`
                  : t('signs.groupWords', {
                      group: t(`danger.group.${group}`),
                      signs: `${words}.`,
                    })}
              </p>
            );
          })}
        </div>
      )}
      {!open && hidden ? (
        <Button variant="quiet" className="check__signs-all" onClick={seeAll}>
          {t('signs.showAll')}
        </Button>
      ) : null}
      <div className="check__signs-answers">
        <Button variant="secondary" onClick={answerNone}>
          {t('signs.noneNow')}
        </Button>
        <Button
          variant="secondary"
          aria-expanded={open}
          onClick={() => {
            if (open) return;
            // Any answer given is cleared: the list starts with nothing ticked.
            setTicked([]);
            setAttempts(0);
            clearSigns();
            setOpen(true);
          }}
        >
          {t('signs.someNow')}
        </Button>
      </div>
      {open ? (
        <div ref={listRef} className="check__signs-list">
          <SectionedCheckboxGroup
            labelledBy={titleId}
            hint={t('signs.listHint')}
            error={attempts > 0 && ticked.length === 0 ? t('signs.listError') : undefined}
            sections={byGroup.map(({ group, signs }) => ({
              id: group,
              label: t(`danger.group.${group}`),
              options: signs.map((sign) => ({
                id: sign.id,
                label: sign.label[lang],
                checked: ticked.includes(sign.id),
                onChange: (checked: boolean) => {
                  setTicked((current) => {
                    const others = current.filter((id) => id !== sign.id);
                    return checked ? [...others, sign.id] : others;
                  });
                },
              })),
            }))}
          />
          {hidden ? (
            <Button variant="secondary" className="signs__all" onClick={seeAll}>
              {t('signs.showAll')}
            </Button>
          ) : null}
          {/* Held at the bottom while the list scrolls, as on the danger signs screen. */}
          <StickyAction>
            <Button
              variant="primary"
              className="check__signs-result"
              onClick={() => {
                if (answered.current) return;
                if (ticked.length === 0) {
                  setAttempts((n) => n + 1);
                  return;
                }
                answered.current = true;
                setSigns(ticked, answerKey);
              }}
            >
              {t('signs.seeResult')}
            </Button>
          </StickyAction>
        </div>
      ) : null}
    </section>
  );
}
