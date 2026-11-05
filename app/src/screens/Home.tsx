// SPDX-License-Identifier: MIT
import { useLocation } from 'wouter';
import { useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { useSavedNote } from './saved-note.js';

/**
 * Home in woman mode (accompanied mode opens on the list of profiles): what
 * the app is for and its one primary action, held together, then the way to
 * her profile, the settings, the knowledge base status and the about screen.
 * The primary action opens the check for her profile (the check screen opens
 * the profile screen first when there is none). After a save it says the
 * profile was saved, once.
 */
export function Home() {
  const t = useT();
  const { packError, settingsUnavailable } = useApp();
  const [, navigate] = useLocation();
  const saved = useSavedNote();

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
        <Button
          variant="primary"
          className="home__check"
          onClick={() => {
            navigate('/check');
          }}
        >
          {t('home.check')}
        </Button>
        <a className="button button--secondary home__profile" href="#/profile">
          {t('home.profileMine')}
        </a>
      </div>
      <div className="home__closing">
        <a className="button button--quiet home__settings" href="#/settings">
          {t('home.settings')}
        </a>
        <a className="button button--quiet home__settings" href="#/status">
          {t('nav.status')}
        </a>
        <a className="button button--quiet home__settings" href="#/about">
          {t('nav.about')}
        </a>
        <p className="meta">{t('home.closing')}</p>
      </div>
    </main>
  );
}
