// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CODE_MAX, easyToGuess, isCode, remainingLockMs } from '../domain/code.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { CodeInput } from '../ui/CodeInput.js';
import { Notice } from '../ui/Notice.js';
import { digitCount, waitTime } from './code-words.js';

export const CHANGE_CODE_PATH = '/settings/code';

/** Wrong codes allowed before the first wait (domain/code.ts): the screen says how many are left. */
const TRIES = 5;

/**
 * The current code, the new one (with the easy-code warning), the new one
 * again, then the code changed.
 */
type Step = 'current' | 'choose' | 'weak' | 'confirm' | 'done';

type Problem = 'invalid' | 'wrong' | 'locked' | 'same' | 'mismatch' | 'failed' | null;

/**
 * "Changer le code", behind the code (Réglages): someone may have seen it over
 * her shoulder, or guessed it. The current code first, then the new one twice,
 * with the same warning as when the first code was made for a code easy to
 * guess. Every data key is then wrapped again for the new code in one
 * transaction (session.tsx changeCode): the profiles, their history and the
 * contacts stay, the old code opens nothing any more, and the other tabs lock
 * and ask for the new one. A wrong current code is said and counted as at the
 * code screen; when the phone does not keep the change, the old code stays the
 * one. The codes typed stay in this screen's memory only.
 */
export function ChangeCode() {
  const t = useT();
  const { changeCode, lockout } = useSession();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>('current');
  const [current, setCurrent] = useState('');
  const [first, setFirst] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  // When the last answer came: a wait is said as it stood then.
  const [now, setNow] = useState(() => Date.now());
  const field = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step);

  // A new step: the field takes the focus, so the next digits go straight in;
  // the warning and the end take it on their heading, read from the top.
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    if (step === 'weak' || step === 'done') heading.current?.focus();
    else field.current?.focus();
  }, [step]);

  /** Back to the first step, every code typed forgotten, with the reason. */
  const startAgain = (reason: Problem) => {
    setCurrent('');
    setFirst('');
    setCode('');
    setProblem(reason);
    setNow(Date.now());
    setStep('current');
    field.current?.focus();
  };

  const submit = async () => {
    if (busy) return;
    if (!isCode(code)) {
      setProblem('invalid');
      field.current?.focus();
      return;
    }
    if (step === 'current') {
      setCurrent(code);
      setCode('');
      setProblem(null);
      setStep('choose');
      return;
    }
    if (step === 'choose') {
      if (code === current) {
        setCode('');
        setProblem('same');
        field.current?.focus();
        return;
      }
      setFirst(code);
      setCode('');
      setProblem(null);
      setStep(easyToGuess(code) ? 'weak' : 'confirm');
      return;
    }
    if (code !== first) {
      setFirst('');
      setCode('');
      setProblem('mismatch');
      setStep('choose');
      field.current?.focus();
      return;
    }
    setBusy(true);
    const changed = await changeCode(current, first);
    setBusy(false);
    if (changed === 'changed') {
      setCurrent('');
      setFirst('');
      setCode('');
      setProblem(null);
      setStep('done');
      return;
    }
    // Locked meanwhile: the code screen takes this one's place.
    if (changed === 'cancelled') return;
    startAgain(changed);
  };

  const remaining = TRIES - lockout.failures;
  const left = remainingLockMs(lockout, now);
  const messages: Record<Exclude<Problem, null>, string> = {
    invalid: t('code.invalid'),
    wrong:
      left > 0
        ? t('code.wait', { time: waitTime(t, left) })
        : remaining >= 2
          ? `${t('code.wrong')} ${t('code.triesLeft', { count: remaining })}`
          : remaining === 1
            ? `${t('code.wrong')} ${t('code.lastTry')}`
            : t('code.wrong'),
    locked: t('code.wait', { time: waitTime(t, left) }),
    same: t('changeCode.same'),
    mismatch: t('code.mismatch'),
    failed: t('changeCode.failed'),
  };
  const error = problem === null ? '' : messages[problem];

  if (step === 'done') {
    return (
      <main className="screen code-setup">
        <div className="code-setup__intro">
          <h1 ref={heading} tabIndex={-1}>
            {t('changeCode.doneTitle')}
          </h1>
          <p>{t('changeCode.doneLead')}</p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            navigate('/settings', { replace: true });
          }}
        >
          {t('changeCode.back')}
        </Button>
      </main>
    );
  }

  if (step === 'weak') {
    return (
      <main className="screen code-setup">
        <div className="code-setup__intro">
          <h1 ref={heading} tabIndex={-1}>
            {t('code.weakTitle')}
          </h1>
          <p>{t('code.weakLead')}</p>
        </div>
        <div className="code-setup__actions">
          <Button
            variant="primary"
            onClick={() => {
              setFirst('');
              setStep('choose');
            }}
          >
            {t('code.weakOther')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setStep('confirm');
            }}
          >
            {t('code.weakKeep')}
          </Button>
        </div>
      </main>
    );
  }

  const titles = {
    current: 'changeCode.title',
    choose: 'changeCode.newTitle',
    confirm: 'changeCode.confirmTitle',
  } as const;
  const labels = {
    current: 'changeCode.currentLabel',
    choose: 'changeCode.newLabel',
    confirm: 'code.confirmLabel',
  } as const;
  return (
    <main className="screen code-setup">
      <div className="code-setup__intro">
        <h1 tabIndex={-1}>{t(titles[step])}</h1>
        <p>{t(step === 'current' ? 'changeCode.currentLead' : 'changeCode.newLead')}</p>
      </div>
      <div role="alert">{problem === 'failed' ? <Notice>{error}</Notice> : null}</div>
      <form
        className="code-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CodeInput
          // A new field at each step: nothing of the code before is kept in it.
          key={step}
          inputRef={field}
          label={t(labels[step])}
          error={error === '' || problem === 'failed' ? undefined : error}
          value={code}
          maxLength={CODE_MAX}
          keypadLabel={t('code.keypad')}
          eraseLabel={t('code.erase')}
          eraseName={t('code.eraseName')}
          countLabel={digitCount(t)}
          onChange={(value) => {
            setCode(value);
            if (problem === 'invalid') setProblem(null);
          }}
        />
        <p className="sr-only" role="status">
          {busy ? t('changeCode.changing') : error}
        </p>
        <Button type="submit" variant="primary" className="code-form__submit" disabled={busy}>
          {t(step === 'confirm' ? 'code.save' : 'code.next')}
        </Button>
      </form>
      <Button
        variant="quiet"
        className="code-form__aside"
        onClick={() => {
          navigate('/settings', { replace: true });
        }}
      >
        {t('changeCode.cancel')}
      </Button>
    </main>
  );
}
