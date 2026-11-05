// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { useLocation } from 'wouter';
import { todayIso } from '../domain/dates.js';
import { afterBirth, emptyForm, formFromProfile, reenterTerm } from '../domain/profile-form.js';
import type { Profile } from '../domain/types.js';
import { useT } from '../i18n/index.js';
import { useCheck } from '../state/check-state.js';
import { QUICK_PATH } from './edit-route.js';
import { ProfileQuestions } from './ProfileEdit.js';

export { QUICK_PATH };

/** What the outdated-term step asks for a passer-by: the baby is born, or the term again. */
function updateAsked(): 'born' | 'term' | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null || !('update' in state)) return null;
  return state.update === 'born' || state.update === 'term' ? state.update : null;
}

/**
 * "Regarder sans enregistrer" (accompanied mode): a passer-by, at a sale at
 * the depot, looked up without a profile. The questions of a profile without
 * a pseudonym: pregnant (yes, no, "Je ne sais pas"), the term, breastfeeding
 * with the baby's age, the situations, read with the same rules as a profile
 * (an unknown or uncertain answer takes the riskiest windows). Her answers
 * stay in memory only (check-state `quick`): no profile and no history are
 * stored, and she is let go as soon as another woman or passer-by is looked
 * at, at every lock, at a change of mode, at the quick exit and at a reload.
 * "Regarder ses produits" opens the check in place of this screen, so Back
 * from the check goes to the list of profiles.
 *
 * Opened from the outdated-term step of her check (her term past 42 weeks),
 * it starts from her answers, the baby born or the term to give again, and
 * gives the check back with her list.
 */
export function QuickCheck() {
  const t = useT();
  const { quick, profileId, startQuick, updateQuick } = useCheck();
  const [, navigate] = useLocation();
  // Today from the phone's clock, once, handed to pure code.
  const [today] = useState(() => todayIso(new Date()));
  // Read once: the passer-by being updated, when the outdated-term step sent her here.
  const [update] = useState(() => {
    const asked = updateAsked();
    return asked !== null && quick !== null && quick.id === profileId
      ? { asked, base: quick }
      : null;
  });
  // Read once: a change of language rewords the screen, the answers stay.
  const [initial] = useState(() => {
    if (update === null) return emptyForm(t('quick.title'), today);
    const form = formFromProfile(update.base, today, 'accompanied');
    return update.asked === 'born' ? afterBirth(form) : reenterTerm(form);
  });

  const lead = () => {
    if (update === null) return null;
    return (
      <p className="profile__why">
        {t(update.asked === 'born' ? 'quick.leadBorn' : 'profile.leadTerm')}
      </p>
    );
  };

  return (
    <main className="screen profile quick">
      <div className="profile__intro">
        <h1 tabIndex={-1}>{t('quick.title')}</h1>
        {lead()}
        <p>{t('quick.lead')}</p>
      </div>
      <ProfileQuestions
        quick
        mode="accompanied"
        today={today}
        base={update?.base}
        self={false}
        taken={[]}
        initial={initial}
        onSaved={(profile: Profile) => {
          if (update === null) startQuick(profile);
          else updateQuick(profile);
          navigate('/check', { replace: true });
        }}
      />
    </main>
  );
}
