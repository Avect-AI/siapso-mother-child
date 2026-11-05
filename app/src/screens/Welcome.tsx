// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../config.js';
import type { Mode } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { inVisit, visitState } from '../state/entry-state.js';
import { AppMark } from '../ui/AppMark.js';
import { bringIntoView } from '../ui/bring-into-view.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { CodeSetup } from './CodeSetup.js';

/** Who uses the app is asked, or answered and the code part shows under it. */
type Step = 'mode' | 'code';

/** Where the welcome's history entry keeps the step reached. */
const WELCOME_STEP = 'welcomeStep';

/**
 * The step reached on this history entry in this visit (Back from the danger
 * signs, opened from the band during the welcome), else the question. The
 * code part needs the mode answered.
 */
function reachedStep(modeKnown: boolean): Step {
  return visitState()[WELCOME_STEP] === 'code' && modeKnown ? 'code' : 'mode';
}

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
 * First launch, on one screen (SCRUM-56, S1 and S2): the app speaks the
 * language of the phone, the other language one tap away; it asks who uses
 * the app; once answered, the answer folds into one line with "Changer" and
 * the code part shows under it (CodeSetup): hers in woman mode, the
 * accompanying person's in accompanied mode. Each answer is stored; the code
 * ends the welcome and opens Home (woman mode) or the list of profiles
 * (accompanied mode). The band keeps "Signes de danger" one tap away.
 *
 * `modeOnly`: the end of a welcome cut short (the code was made, then the app
 * closed before a mode was kept): once the code is given, who uses the app,
 * and that answer ends the welcome.
 */
export function Welcome({ modeOnly = false }: { modeOnly?: boolean }) {
  const t = useT();
  const lang = useLang();
  const { settings, setSettings, settingsUnavailable } = useApp();
  const [step, setStep] = useState<Step>(() =>
    modeOnly ? 'mode' : reachedStep(settings.mode !== null),
  );
  const question = useRef<HTMLHeadingElement>(null);
  const codeHeading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step);

  // The button just pressed disappears with its step: the focus goes to the
  // part that comes (the code's heading, or the question again). The step is
  // kept on the history entry (in memory, as every screen's values), so Back
  // from the danger signs comes back to it.
  useEffect(() => {
    if (!modeOnly) window.history.replaceState(inVisit({ [WELCOME_STEP]: step }), '');
    if (shown.current === step) return;
    shown.current = step;
    if (step === 'mode') {
      question.current?.focus();
      return;
    }
    // The code part comes wholly into view on a small phone: her keys too.
    const heading = codeHeading.current;
    heading?.focus({ preventScroll: true });
    bringIntoView(heading?.closest('.code-setup'));
  }, [modeOnly, step]);

  // The screen follows each answer at once; storing it happens in the background.
  const chooseMode = (mode: Mode) => {
    if (modeOnly) {
      void setSettings({ mode, onboarded: true });
      return;
    }
    void setSettings({ mode });
    setStep('code');
  };
  const other: Lang = lang === 'fr' ? 'en' : 'fr';

  return (
    <main className={step === 'code' ? 'screen welcome welcome--code' : 'screen welcome'}>
      <div className="welcome__identity">
        <AppMark size={step === 'code' ? 48 : 96} />
        <h1 tabIndex={-1}>{APP_NAME}</h1>
        {/* The other language, named in itself: one tap, kept in the settings. */}
        <Button
          variant="quiet"
          className="welcome__language"
          lang={other}
          onClick={() => {
            void setSettings({ lang: other });
          }}
        >
          {t(other === 'en' ? 'language.en' : 'language.fr')}
        </Button>
      </div>
      {settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
      <div className="welcome__step">
        <div className="welcome__question">
          <h2 id="welcome-mode" ref={question} tabIndex={-1}>
            {t('welcome.modeTitle')}
          </h2>
        </div>
        {step === 'code' ? (
          <p className="welcome__chosen">
            <span className="welcome__answer">
              {t(settings.mode === 'accompanied' ? 'welcome.modeAccompanied' : 'welcome.modeWoman')}
            </span>{' '}
            <Button
              variant="quiet"
              className="welcome__change"
              aria-label={t('code.changeMode')}
              onClick={() => {
                setStep('mode');
              }}
            >
              {t('welcome.change')}
            </Button>
          </p>
        ) : (
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
        )}
      </div>
      {step === 'code' ? (
        <CodeSetup
          embedded
          mode={settings.mode ?? 'woman'}
          headingRef={codeHeading}
          onCreated={() => {
            // The start of the mode opens at the top, the band in sight.
            if (window.scrollY > 0) window.scrollTo({ top: 0 });
            void setSettings({ onboarded: true });
          }}
        />
      ) : null}
    </main>
  );
}
