// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { useState } from 'react';
import { useLocation } from 'wouter';
import type { Mode } from '../domain/types.js';
import { translate, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';

/**
 * Settings: the language, at any time, and, once the code is given, the mode.
 * The mode in use says who the phone is for, so it never shows behind the
 * code. A choice applies at once and is stored; changing the mode never
 * deletes a profile, a check or a contact (woman mode opens the first profile
 * made, the others stay on the phone). It links to the knowledge base status
 * and to the about screen, which need no code. The one primary action goes
 * back to the start.
 */
export function Settings() {
  const t = useT();
  const { settings, setSettings, settingsUnavailable } = useApp();
  const { unlocked } = useSession();
  const [, navigate] = useLocation();
  const [changed, setChanged] = useState(false);

  const choose = (patch: { lang: Lang } | { mode: Mode }) => {
    setChanged(true);
    void setSettings(patch);
  };

  return (
    <main className="screen settings">
      <h1 tabIndex={-1}>{t('settings.title')}</h1>
      {settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
      <RadioGroup<Lang>
        legend={t('settings.language')}
        // Each language named in itself, as on the welcome screen.
        options={[
          { value: 'fr', label: translate('fr', 'language.fr'), lang: 'fr' },
          { value: 'en', label: translate('en', 'language.en'), lang: 'en' },
        ]}
        value={settings.lang}
        onChange={(lang) => {
          choose({ lang });
        }}
      />
      {unlocked ? (
        <RadioGroup<Mode>
          legend={t('settings.mode')}
          hint={`${t('settings.modeHint')} ${t('settings.modeWomanNote')}`}
          options={[
            { value: 'woman', label: t('welcome.modeWoman') },
            { value: 'accompanied', label: t('welcome.modeAccompanied') },
          ]}
          value={settings.mode}
          onChange={(mode) => {
            choose({ mode });
          }}
        />
      ) : null}
      <p className="settings__status" role="status">
        {changed ? t('settings.changed') : ''}
      </p>
      <div className="settings__more">
        <a className="button button--secondary" href="#/status">
          {t('nav.status')}
        </a>
        <a className="button button--secondary" href="#/about">
          {t('nav.about')}
        </a>
      </div>
      <Button
        variant="primary"
        className="settings__done"
        onClick={() => {
          navigate('/');
        }}
      >
        {t('settings.done')}
      </Button>
    </main>
  );
}
