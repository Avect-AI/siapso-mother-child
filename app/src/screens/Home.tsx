// SPDX-License-Identifier: MIT
import { useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';

/**
 * Home: what the app is for and its one primary action, held together. The
 * status and about links arrive with their screens (Task 15, SCRUM-28).
 */
export function Home() {
  const t = useT();
  const { packError, settingsUnavailable } = useApp();
  return (
    <main className="screen home">
      <div className="home__task">
        <div className="home__intro">
          <h1 tabIndex={-1}>{t('home.title')}</h1>
          <p>{t('home.lead')}</p>
        </div>
        {settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
        {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}
        {/* Task 11 (SCRUM-24) opens the check screen from here. */}
        <Button variant="primary" className="home__check">
          {t('home.check')}
        </Button>
      </div>
      <p className="meta home__closing">{t('home.closing')}</p>
    </main>
  );
}
