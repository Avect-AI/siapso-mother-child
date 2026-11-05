// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useT } from '../i18n/index.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { UNLOCK_PATH } from './Neutral.js';

/** The route of the forgotten code, from the code screen. */
export const FORGOT_PATH = '/forgot';

type Step = 'explain' | 'confirm';

/** The word typed, compared without case, accents or spaces around it. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toUpperCase();
}

/**
 * A forgotten code, behind the lock: without the code, the only way is to
 * erase the profiles of this phone. The screen says so in plain words (the
 * profiles, their history and the saved contacts go; the language and the
 * product information stay), asks to type the word EFFACER (ERASE), then a
 * last yes, then erases and goes back to the welcome. Each step goes back to
 * the code instead. Nothing is red: it is not a danger sign.
 */
export function ForgotCode() {
  const t = useT();
  const { forgetCode } = useSession();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>('explain');
  const [word, setWord] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const shown = useRef(step);

  // The last yes is a new question: its heading takes the focus.
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    heading.current?.focus();
  }, [step]);

  const backToCode = () => {
    navigate(UNLOCK_PATH, { replace: true });
  };

  const goOn = () => {
    // The word of either language: the screen may have changed language meanwhile.
    if (plain(word) === 'EFFACER' || plain(word) === 'ERASE') {
      setWrong(false);
      setStep('confirm');
      return;
    }
    setWrong(true);
    field.current?.focus();
  };

  const erase = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await forgetCode();
      navigate('/', { replace: true });
    } catch (failure) {
      console.warn('Profiles not erased on this device', failure);
      setBusy(false);
      setFailed(true);
    }
  };

  if (step === 'confirm') {
    return (
      <main className="screen forgot">
        <div className="forgot__intro">
          <h1 ref={heading} tabIndex={-1}>
            {t('forgot.confirmTitle')}
          </h1>
          <p>{t('forgot.confirmLead')}</p>
        </div>
        {failed ? <Notice>{t('forgot.failed')}</Notice> : null}
        <p className="sr-only" role="status">
          {busy ? t('forgot.erasing') : ''}
        </p>
        <div className="forgot__actions">
          <Button
            variant="primary"
            aria-disabled={busy ? true : undefined}
            onClick={() => {
              void erase();
            }}
          >
            {t('forgot.erase')}
          </Button>
          <Button variant="secondary" onClick={backToCode}>
            {t('forgot.back')}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen forgot">
      <div className="forgot__intro">
        <h1 ref={heading} tabIndex={-1}>
          {t('forgot.title')}
        </h1>
        <p>{t('forgot.lead')}</p>
      </div>
      <form
        className="forgot__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          goOn();
        }}
      >
        <TextField
          ref={field}
          label={t('forgot.wordLabel')}
          error={wrong ? t('forgot.wordError') : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={word}
          onChange={(event) => {
            setWord(event.target.value);
          }}
        />
        <div className="forgot__actions">
          <Button type="submit" variant="primary">
            {t('forgot.next')}
          </Button>
          <Button variant="secondary" onClick={backToCode}>
            {t('forgot.back')}
          </Button>
        </div>
      </form>
    </main>
  );
}
