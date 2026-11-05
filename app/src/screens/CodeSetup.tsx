// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, type Ref } from 'react';
import { CODE_MAX, isCode } from '../domain/code.js';
import type { Mode } from '../domain/types.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { CodeInput } from '../ui/CodeInput.js';
import { digitCount } from './code-words.js';

type Step = 'choose' | 'confirm';

/**
 * Makes the code, typed twice: in woman mode it opens her profile, in
 * accompanied mode the profiles of the women she follows. Only its verifier is
 * stored, and the session opens. Two different codes start again from the
 * first. During the welcome, `onBack` goes back to the choice of mode; once
 * the code is made, `onCreated` goes on.
 */
export function CodeSetup({
  mode,
  onCreated,
  onBack,
  headingRef,
}: {
  mode: Mode;
  onCreated?: () => void;
  onBack?: () => void;
  /** The heading, for the welcome to give it the focus when this step opens. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const t = useT();
  const { createCode } = useSession();
  const [step, setStep] = useState<Step>('choose');
  const [first, setFirst] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<'invalid' | 'mismatch' | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const shown = useRef(step);

  // A new step: the field takes the focus, so the next digits go straight in.
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    field.current?.focus();
  }, [step]);

  const submit = async () => {
    if (busy) return;
    if (!isCode(code)) {
      setProblem('invalid');
      field.current?.focus();
      return;
    }
    if (step === 'choose') {
      setFirst(code);
      setCode('');
      setProblem(null);
      setStep('confirm');
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
    await createCode(first);
    onCreated?.();
  };

  const error =
    problem === 'invalid' ? t('code.invalid') : problem === 'mismatch' ? t('code.mismatch') : '';
  return (
    <main className="screen code-setup">
      <div className="code-setup__intro">
        <h1 ref={headingRef} tabIndex={-1}>
          {t(step === 'choose' ? 'code.createTitle' : 'code.confirmTitle')}
        </h1>
        <p>{t(mode === 'accompanied' ? 'code.createLeadAccompanied' : 'code.createLeadWoman')}</p>
      </div>
      <form
        className="code-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CodeInput
          // A new field for the second typing: nothing of the first one is kept in it.
          key={step}
          inputRef={field}
          // The second typing says so where the focus lands.
          label={t(step === 'choose' ? 'code.label' : 'code.confirmLabel')}
          hint={t(mode === 'accompanied' ? 'code.createHintAccompanied' : 'code.createHintWoman')}
          error={error === '' ? undefined : error}
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
          {busy ? t('code.saving') : error}
        </p>
        <Button type="submit" variant="primary" className="code-form__submit" disabled={busy}>
          {t(step === 'choose' ? 'code.next' : 'code.save')}
        </Button>
      </form>
      {onBack === undefined ? null : (
        <Button variant="quiet" className="code-form__aside" onClick={onBack}>
          {t('code.changeMode')}
        </Button>
      )}
    </main>
  );
}
