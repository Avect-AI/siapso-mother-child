// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CODE_MAX, isCode, lockoutDelayMs, remainingLockMs } from '../domain/code.js';
import { useT, type MessageKey, type Vars } from '../i18n/index.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { CodeInput } from '../ui/CodeInput.js';
import { Notice } from '../ui/Notice.js';
import { digitCount } from './code-words.js';
import { FORGOT_PATH } from './ForgotCode.js';

/** Wrong codes allowed before the first wait (domain/code.ts): the screen says how many are left. */
const TRIES = 5;

/** A wait in the largest unit that keeps it readable: seconds, then minutes, then hours (rounded up). */
function waitMessage(ms: number): [MessageKey, Vars] {
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 120) return ['code.waitSeconds', { count: seconds }];
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 120) return ['code.waitMinutes', { count: minutes }];
  return ['code.waitHours', { count: Math.ceil(minutes / 60) }];
}

/**
 * The code, asked whenever the session is locked (at start, after two minutes
 * without interaction, from the neutral screen): the field with the phone's
 * numeric keypad and large keys on the screen, and the one primary action,
 * "Ouvrir". A wrong code says so and how many tries are left before a wait;
 * during a wait the screen counts it down and "Ouvrir" waits too. A screen
 * reader hears each outcome once (the countdown itself is not read out).
 * Nothing here says anything about a profile.
 */
export function Unlock() {
  const t = useT();
  const { unlock, lockout, codeUnavailable, codeRefused } = useSession();
  const [, navigate] = useLocation();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<'wrong' | 'invalid' | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const field = useRef<HTMLInputElement>(null);
  const left = remainingLockMs(lockout, now);
  const waiting = left > 0;

  // The countdown: the clock read again every second while a wait runs.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [waiting]);

  const remaining = TRIES - lockout.failures;
  const wrong =
    remaining >= 2
      ? `${t('code.wrong')} ${t('code.triesLeft', { count: remaining })}`
      : remaining === 1
        ? `${t('code.wrong')} ${t('code.lastTry')}`
        : t('code.wrong');
  let shown: string | undefined;
  let said = '';
  if (waiting) {
    shown = t(...waitMessage(left));
    said = t(...waitMessage(lockoutDelayMs(lockout.failures)));
  } else if (problem === 'invalid') {
    shown = t('code.invalid');
    said = shown;
  } else if (problem === 'wrong' && lockout.lockedUntil === null) {
    shown = wrong;
    said = shown;
  } else if (problem === 'wrong') {
    // A wait is over: nothing shown, and a screen reader hears it once.
    said = t('code.tryAgain');
  }

  const submit = async () => {
    if (busy || waiting) return;
    if (!isCode(code)) {
      setProblem('invalid');
      field.current?.focus();
      return;
    }
    setBusy(true);
    const result = await unlock(code);
    // Open: this screen is gone. Otherwise the next try starts from an empty field.
    if (result === 'ok') return;
    setBusy(false);
    // The stored code could not be read: the notice says so, the try was not counted.
    if (result === 'unavailable') return;
    setCode('');
    setProblem('wrong');
    setNow(Date.now());
  };

  return (
    <main className="screen unlock">
      <h1 tabIndex={-1}>{t('code.title')}</h1>
      {codeUnavailable ? <Notice>{t('code.unavailable')}</Notice> : null}
      {/* A code made in this tab was refused: the one on the phone is asked. */}
      {codeRefused ? <Notice>{t('code.exists')}</Notice> : null}
      <form
        className="code-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CodeInput
          inputRef={field}
          label={t('code.label')}
          error={shown}
          value={code}
          maxLength={CODE_MAX}
          keypadLabel={t('code.keypad')}
          eraseLabel={t('code.erase')}
          countLabel={digitCount(t)}
          onChange={(value) => {
            setCode(value);
            if (problem === 'invalid') setProblem(null);
          }}
        />
        <p className="sr-only" role="status">
          {busy ? t('code.opening') : said}
        </p>
        {/* aria-disabled, not disabled: the focus stays on it while the wait runs. */}
        <Button
          type="submit"
          variant="primary"
          className="code-form__submit"
          aria-disabled={waiting ? true : undefined}
        >
          {t('code.open')}
        </Button>
      </form>
      <div className="code-form__asides">
        <Button
          variant="quiet"
          className="code-form__aside"
          onClick={() => {
            navigate(FORGOT_PATH);
          }}
        >
          {t('forgot.link')}
        </Button>
        <a className="button button--quiet code-form__aside" href="#/settings">
          {t('home.settings')}
        </a>
      </div>
    </main>
  );
}
