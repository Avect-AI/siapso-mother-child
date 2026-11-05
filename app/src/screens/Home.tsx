// SPDX-License-Identifier: MIT
import { useLocation } from 'wouter';
import { todayIso } from '../domain/dates.js';
import { isStale } from '../domain/staleness.js';
import { useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { OfflineReadiness } from './OfflineReadiness.js';
import { profileNoteText, useProfileNote } from './saved-note.js';

/**
 * Home in woman mode (accompanied mode opens on the list of profiles): what
 * the app is for and its one primary action, held together (with, before the
 * action, a notice when the knowledge base is out of date), then the way to
 * her profile and whether the phone opens the app without the Internet yet,
 * then the settings, the knowledge base status and the about screen.
 * The primary action opens the check for her profile (the check screen opens
 * the profile screen first when there is none). After a save or a deletion it
 * says so, once.
 */
export function Home() {
  const t = useT();
  const { pack, packError, settingsUnavailable, online } = useApp();
  const [, navigate] = useLocation();
  const note = useProfileNote();

  return (
    <main className="screen home">
      <div className="home__task">
        <div className="home__intro">
          <h1 tabIndex={-1}>{t('home.title')}</h1>
          <p>{t('home.lead')}</p>
        </div>
        {note === null ? null : (
          <p className="home__saved" role="status">
            {profileNoteText(note, t)}
          </p>
        )}
        {settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
        {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}
        {/* An old base is said before she looks at a product, not only on the status screen. */}
        {pack !== null && isStale(pack.date, todayIso(new Date())) ? (
          <Notice>{t('status.stale')}</Notice>
        ) : null}
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
        {/* After the actions, so the primary one follows the question. */}
        <OfflineReadiness online={online} />
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
