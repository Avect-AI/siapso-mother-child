// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import type { Mode, Profile } from '../domain/types.js';
import { useT } from '../i18n/index.js';
import { inSession } from '../state/entry-state.js';
import { Button } from '../ui/Button.js';
import { PROFILE_EDIT_PATH, QUICK_PATH } from './edit-route.js';

/**
 * What the profile screen is opened to do from the question "Le bébé est-il
 * né ?": the baby is born; still pregnant with a term to give again; still
 * pregnant past 42 weeks (read as 42 weeks and over, with the advice to be
 * seen today); or the question itself first ('ask', from "Mettre à jour").
 */
export type ProfileUpdate = 'born' | 'term' | 'post-term' | 'ask';

/**
 * "Non, toujours enceinte" on an outdated term: past 42 weeks when the term
 * was known (a last period, weeks, months or past 42 weeks already); a term
 * unknown, or a pregnancy not known, says nothing of 42 weeks: given again.
 */
export function stillPregnantUpdate(
  profile: Pick<Profile, 'term' | 'pregnancyUnsure'>,
): ProfileUpdate {
  const known = profile.pregnancyUnsure !== true && profile.term !== undefined;
  return known && profile.term?.kind !== 'unknown' ? 'post-term' : 'term';
}

/**
 * The profile screen of this profile and what to open it with: hers in woman
 * mode; in accompanied mode the edit screen, her id kept in memory, never in
 * the address (edit-route.ts).
 */
function profileEdit(
  mode: Mode,
  profile: Pick<Profile, 'id'>,
): { path: string; values: Record<string, unknown> } {
  return mode === 'accompanied'
    ? { path: PROFILE_EDIT_PATH, values: { editId: profile.id } }
    : { path: '/profile', values: {} };
}

/**
 * "Le bébé est-il né ?", with its two answers of the same weight (neither is
 * the primary action); the danger signs and who to call stay in the header,
 * one tap away. `maybe`: the term may only be past 42 weeks (the profile says
 * "À confirmer"), asked from "Mettre à jour". The question takes the focus, so
 * a screen reader starts there.
 */
export function BirthQuestion({
  mode,
  profile,
  passerBy = false,
  maybe = false,
  onAnswer,
}: {
  mode: Mode;
  profile: Profile;
  passerBy?: boolean;
  maybe?: boolean;
  onAnswer: (born: boolean) => void;
}) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  const accompanied = mode === 'accompanied';

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const title = maybe
    ? accompanied
      ? 'outdated.titleMaybeAccompanied'
      : 'outdated.titleMaybeWoman'
    : accompanied
      ? 'outdated.titleAccompanied'
      : 'outdated.titleWoman';
  const lead = passerBy
    ? 'outdated.leadPasserBy'
    : maybe
      ? accompanied
        ? 'outdated.leadMaybeAccompanied'
        : 'outdated.leadMaybeWoman'
      : accompanied
        ? 'outdated.leadAccompanied'
        : 'outdated.leadWoman';
  return (
    <div className="outdated">
      <div className="outdated__intro">
        <h1 ref={heading} tabIndex={-1}>
          {t(title)}
        </h1>
        {accompanied ? (
          <p className="meta">
            {passerBy ? t('check.quick') : t('check.profile', { name: profile.pseudonym })}
          </p>
        ) : null}
        <p>{t(lead)}</p>
      </div>
      <div className="outdated__answers">
        <Button
          variant="secondary"
          onClick={() => {
            onAnswer(true);
          }}
        >
          {t('outdated.born')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onAnswer(false);
          }}
        >
          {t('outdated.notBorn')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The step a check cannot go past while the profile's term is outdated (past
 * 42 weeks: the baby may be born, and breastfeeding warnings would be missed):
 * is the baby born? "Yes" opens her profile with the pregnancy set to no and
 * the breastfeeding and baby age questions to answer; "No" opens it with the
 * term read as past 42 weeks (with the advice to be seen at the health post
 * today), or, when the term was not known, with the term to give again. Both
 * come back to the check once saved. A passer-by looked up without saving has
 * no profile: both answers open her questions again ("Regarder sans
 * enregistrer"), her list kept.
 */
export function OutdatedTerm({
  mode,
  profile,
  passerBy = false,
}: {
  mode: Mode;
  profile: Profile;
  /** The check is a passer-by's, in memory: no profile to open. */
  passerBy?: boolean;
}) {
  const [, navigate] = useLocation();

  const update = (born: boolean) => {
    const answer: ProfileUpdate = born ? 'born' : stillPregnantUpdate(profile);
    // In place of this entry: once saved, the profile screen (or a passer-by's
    // questions) gives way to the check, so Back never shows the same check twice.
    // Marks only on the entry: what the answer says of her stays in memory (entry-state.ts).
    if (passerBy) {
      navigate(QUICK_PATH, { replace: true, state: inSession({ update: answer }) });
      return;
    }
    const { path, values } = profileEdit(mode, profile);
    navigate(path, {
      replace: true,
      state: inSession({ ...values, update: answer, next: '/check' }),
    });
  };
  return <BirthQuestion mode={mode} profile={profile} passerBy={passerBy} onAnswer={update} />;
}
