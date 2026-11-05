// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import type { Mode, Profile } from '../domain/types.js';
import { useT } from '../i18n/index.js';
import { Button } from '../ui/Button.js';
import { editEntry, PROFILE_EDIT_PATH } from './edit-route.js';

/**
 * The profile screen of this profile and the state to open it with: hers in
 * woman mode; in accompanied mode the edit screen, her id in the entry's
 * state, never in the address (edit-route.ts).
 */
function profileEdit(
  mode: Mode,
  profile: Pick<Profile, 'id'>,
): { path: string; state: Record<string, unknown> } {
  return mode === 'accompanied'
    ? { path: PROFILE_EDIT_PATH, state: editEntry(profile.id) }
    : { path: '/profile', state: {} };
}

/**
 * The step a check cannot go past while the profile's term is outdated (past
 * 42 weeks: the baby may be born, and breastfeeding warnings would be missed):
 * is the baby born? "Yes" opens her profile with the pregnancy set to no and
 * the breastfeeding and baby age questions to answer; "No" opens it with the
 * term to give again. Both come back to the check once saved. The two answers
 * weigh the same (neither is the primary action); the danger signs and who to
 * call stay in the header, one tap away.
 */
export function OutdatedTerm({ mode, profile }: { mode: Mode; profile: Profile }) {
  const t = useT();
  const [, navigate] = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const accompanied = mode === 'accompanied';

  // It takes the place of the screen's heading, which had the focus: the
  // question takes it, so a screen reader starts there.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const update = (answer: 'born' | 'term') => {
    // In place of this entry: once saved, the profile screen gives way to the
    // check, so Back never shows the same check twice.
    const { path, state } = profileEdit(mode, profile);
    navigate(path, { replace: true, state: { ...state, update: answer, next: '/check' } });
  };
  return (
    <div className="outdated">
      <div className="outdated__intro">
        <h1 ref={heading} tabIndex={-1}>
          {t(accompanied ? 'outdated.titleAccompanied' : 'outdated.titleWoman')}
        </h1>
        {accompanied ? (
          <p className="meta">{t('check.profile', { name: profile.pseudonym })}</p>
        ) : null}
        <p>{t(accompanied ? 'outdated.leadAccompanied' : 'outdated.leadWoman')}</p>
      </div>
      <div className="outdated__answers">
        <Button
          variant="secondary"
          onClick={() => {
            update('born');
          }}
        >
          {t('outdated.born')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            update('term');
          }}
        >
          {t('outdated.notBorn')}
        </Button>
      </div>
    </div>
  );
}
