// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { Mode } from '../domain/types.js';
import { translate, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { CHANGE_CODE_PATH } from './ChangeCode.js';

type Group = 'lang' | 'mode';

/**
 * Settings: the language, at any time, and, once the code is given, the mode.
 * The mode in use says who the phone is for, so it never shows behind the
 * code. Each question is a group of native radios, and a choice applies only
 * with the button that appears under its group once the answer differs from
 * the one in use ("Switch to English", said in the language it switches to;
 * "Changer de mode"): the arrow keys move through the answers and select them,
 * as WAI-ARIA and screen readers expect of radios, and selecting changes
 * nothing yet (WCAG 3.2.2, On Input), so exploring the answers never turns the
 * app into English or into the other mode. An applied choice is stored and
 * said ("Réglage enregistré."), and the focus goes back to the answer chosen;
 * changing the mode never deletes a profile, a check or a contact (woman mode
 * opens the first profile made, the others stay on the phone). It links to the
 * knowledge base status, the about screen and the voice screen (install the
 * voice at the health post), which need no code. The one primary action goes
 * back to the start.
 */
export function Settings() {
  const t = useT();
  const { settings, setSettings, settingsUnavailable } = useApp();
  const { unlocked } = useSession();
  const [, navigate] = useLocation();
  const [changed, setChanged] = useState(false);
  // The answers chosen and not applied yet (null: the one in use).
  const [pendingLang, setPendingLang] = useState<Lang | null>(null);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const langGroup = useRef<HTMLDivElement>(null);
  const modeGroup = useRef<HTMLDivElement>(null);
  // The group whose choice was just applied: its button is gone, the focus goes to its answer.
  const focusAfter = useRef<Group | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Started again by a lock (App.tsx keys it on the epoch), the screen it
  // replaced took the focus with it: the heading takes it, as a new screen's does.
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      heading.current?.focus();
    }
  }, []);

  const langToApply = pendingLang !== null && pendingLang !== settings.lang ? pendingLang : null;
  const modeToApply = pendingMode !== null && pendingMode !== settings.mode ? pendingMode : null;
  // While a choice waits, applying it is the screen's one primary action (the
  // first one when both wait): the way back, which would leave it, steps down.
  const primary: Group | 'done' =
    langToApply !== null ? 'lang' : modeToApply !== null ? 'mode' : 'done';
  const variantOf = (group: Group | 'done') => (primary === group ? 'primary' : 'secondary');

  // A new answer clears what the last choice said, so the next one is said again.
  const pickLang = (lang: Lang) => {
    setChanged(false);
    setPendingLang(lang);
  };
  const pickMode = (mode: Mode) => {
    setChanged(false);
    setPendingMode(mode);
  };

  useEffect(() => {
    const group = focusAfter.current;
    if (group === null) return;
    focusAfter.current = null;
    const container = group === 'lang' ? langGroup.current : modeGroup.current;
    container?.querySelector<HTMLInputElement>('input:checked')?.focus();
  });

  const apply = (patch: { lang: Lang } | { mode: Mode }, group: Group) => {
    setChanged(true);
    if (group === 'lang') setPendingLang(null);
    else setPendingMode(null);
    focusAfter.current = group;
    void setSettings(patch);
  };

  return (
    <main className="screen settings">
      <h1 ref={heading} tabIndex={-1}>
        {t('settings.title')}
      </h1>
      {settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
      <div ref={langGroup} className="settings__group">
        <RadioGroup<Lang>
          legend={t('settings.language')}
          // Each language named in itself, as on the welcome screen.
          options={[
            { value: 'fr', label: translate('fr', 'language.fr'), lang: 'fr' },
            { value: 'en', label: translate('en', 'language.en'), lang: 'en' },
          ]}
          value={pendingLang ?? settings.lang}
          onChange={pickLang}
        />
        {langToApply === null ? null : (
          <Button
            variant={variantOf('lang')}
            className="settings__apply"
            // Said in the language it switches to, which she can read.
            lang={langToApply}
            onClick={() => {
              apply({ lang: langToApply }, 'lang');
            }}
          >
            {translate(langToApply, 'settings.applyLanguage')}
          </Button>
        )}
      </div>
      {unlocked ? (
        <div ref={modeGroup} className="settings__group">
          <RadioGroup<Mode>
            legend={t('settings.mode')}
            hint={`${t('settings.modeHint')} ${t('settings.modeWomanNote')}`}
            options={[
              { value: 'woman', label: t('welcome.modeWoman') },
              { value: 'accompanied', label: t('welcome.modeAccompanied') },
            ]}
            value={pendingMode ?? settings.mode}
            onChange={pickMode}
          />
          {modeToApply === null ? null : (
            <Button
              variant={variantOf('mode')}
              className="settings__apply"
              onClick={() => {
                apply({ mode: modeToApply }, 'mode');
              }}
            >
              {t('settings.applyMode')}
            </Button>
          )}
        </div>
      ) : null}
      <p className="settings__status" role="status">
        {changed ? t('settings.changed') : ''}
      </p>
      <div className="settings__more">
        {/* Behind the code only: the current code is asked first. */}
        {unlocked ? (
          <a className="button button--secondary" href={`#${CHANGE_CODE_PATH}`}>
            {t('changeCode.link')}
          </a>
        ) : null}
        <a className="button button--secondary" href="#/status">
          {t('nav.status')}
        </a>
        <a className="button button--secondary" href="#/about">
          {t('nav.about')}
        </a>
        <a className="button button--secondary" href="#/voice">
          {t('nav.voice')}
        </a>
      </div>
      <Button
        variant={variantOf('done')}
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
