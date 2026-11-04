// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../config.js';
import type { Mode } from '../domain/types.js';
import { translate, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { AppMark } from '../ui/AppMark.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';

type Step = 'language' | 'mode';

/**
 * A large two-line choice. Its name is everything it shows, label then hint
 * (visible text must be part of the name, for voice control). The space
 * between the lines is not rendered but keeps the words apart in the name.
 */
function Choice({ label, hint, onChoose }: { label: string; hint: string; onChoose: () => void }) {
  return (
    <Button variant="secondary" className="choice" onClick={onChoose}>
      <span className="choice__label">{label}</span> <span className="choice__hint">{hint}</span>
    </Button>
  );
}

/**
 * First launch: the language, asked in both languages, then who uses the app.
 * Both answers are stored; the second one ends the welcome and opens Home.
 */
export function Welcome() {
  const t = useT();
  const { setSettings, settingsUnavailable } = useApp();
  const [step, setStep] = useState<Step>('language');
  const question = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step);

  // The button just pressed disappears with its step: put focus on the new question.
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    question.current?.focus();
  }, [step]);

  // The screen follows each answer at once; storing it happens in the background.
  const chooseLanguage = (lang: Lang) => {
    void setSettings({ lang });
    setStep('mode');
  };
  const chooseMode = (mode: Mode) => {
    void setSettings({ mode, onboarded: true });
  };

  return (
    <main className="screen welcome">
      <div className="welcome__identity">
        <AppMark />
        <h1 tabIndex={-1}>{APP_NAME}</h1>
      </div>
      {settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
      {step === 'language' ? (
        <div className="welcome__step">
          <div className="welcome__question">
            <h2 id="welcome-language" ref={question} tabIndex={-1} lang="fr">
              {translate('fr', 'welcome.languageTitle')}
            </h2>
            <p lang="en">{translate('en', 'welcome.languageTitle')}</p>
          </div>
          <div className="choices" role="group" aria-labelledby="welcome-language">
            <Button
              variant="secondary"
              className="choice"
              lang="fr"
              onClick={() => {
                chooseLanguage('fr');
              }}
            >
              {t('language.fr')}
            </Button>
            <Button
              variant="secondary"
              className="choice"
              lang="en"
              onClick={() => {
                chooseLanguage('en');
              }}
            >
              {t('language.en')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="welcome__step">
          <div className="welcome__question">
            <h2 id="welcome-mode" ref={question} tabIndex={-1}>
              {t('welcome.modeTitle')}
            </h2>
          </div>
          <div className="choices" role="group" aria-labelledby="welcome-mode">
            <Choice
              label={t('welcome.modeWoman')}
              hint={t('welcome.modeWomanHint')}
              onChoose={() => {
                chooseMode('woman');
              }}
            />
            <Choice
              label={t('welcome.modeAccompanied')}
              hint={t('welcome.modeAccompaniedHint')}
              onChoose={() => {
                chooseMode('accompanied');
              }}
            />
          </div>
          <Button
            variant="quiet"
            className="welcome__back"
            onClick={() => {
              setStep('language');
            }}
          >
            {t('welcome.changeLanguage')}
          </Button>
        </div>
      )}
    </main>
  );
}
