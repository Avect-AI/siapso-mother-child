// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';

/** The pseudonym of the profile just saved (the profile screen leaves it in the history entry), or null. */
function justSaved(): string | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null || !('profileSaved' in state)) return null;
  return typeof state.profileSaved === 'string' ? state.profileSaved : null;
}

/**
 * Home: what the app is for and its one primary action, held together, then
 * the way to the profile (hers in woman mode, a new one in accompanied mode).
 * After a save it says the profile was saved, once: the note is taken off the
 * history entry, so a reload does not repeat it. The status and about links
 * arrive with their screens (Task 15, SCRUM-28).
 */
export function Home() {
  const t = useT();
  const { packError, settingsUnavailable, settings } = useApp();
  const [saved] = useState(justSaved);

  useEffect(() => {
    if (saved !== null) window.history.replaceState(null, '', window.location.href);
  }, [saved]);

  const accompanied = settings.mode === 'accompanied';
  return (
    <main className="screen home">
      <div className="home__task">
        <div className="home__intro">
          <h1 tabIndex={-1}>{t('home.title')}</h1>
          <p>{t('home.lead')}</p>
        </div>
        {saved === null ? null : (
          <p className="home__saved" role="status">
            {t('home.profileSaved', { name: saved })}
          </p>
        )}
        {settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
        {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}
        {/* Task 11 (SCRUM-24) opens the check screen from here. */}
        <Button variant="primary" className="home__check">
          {t('home.check')}
        </Button>
        <a
          className="button button--secondary home__profile"
          href={accompanied ? '#/profile/new' : '#/profile'}
        >
          {t(accompanied ? 'home.profileNew' : 'home.profileMine')}
        </a>
      </div>
      <p className="meta home__closing">{t('home.closing')}</p>
    </main>
  );
}
