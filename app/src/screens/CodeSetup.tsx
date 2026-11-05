// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, type Ref } from 'react';
import { CODE_MAX, CODE_MIN, easyToGuess } from '../domain/code.js';
import type { Mode } from '../domain/types.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../state/session.js';
import { bringIntoView } from '../ui/bring-into-view.js';
import { Button } from '../ui/Button.js';
import { RadioGroup } from '../ui/ChoiceGroup.js';
import { CodeInput } from '../ui/CodeInput.js';
import { digitCount } from './code-words.js';

/** Choose the code, then (a code easy to guess) the warning, then type it again. */
type Step = 'choose' | 'weak' | 'confirm';

type Length = '4' | '5' | '6';
const LENGTHS: readonly Length[] = ['4', '5', '6'];

/**
 * The length a new code is offered with (SCRUM-56): 4 digits for her own
 * profile, 6 in accompanied mode, where one code opens the profiles of many
 * women. The choice stays on screen, before the first digit.
 */
export function defaultCodeLength(mode: Mode): number {
  return mode === 'accompanied' ? CODE_MAX : CODE_MIN;
}

/**
 * Makes the code, typed twice: in woman mode it opens her profile, in
 * accompanied mode the profiles of the women she follows. Its length is
 * chosen first (defaultCodeLength, the other lengths one tap away); the last
 * digit moves on to the second typing ("Tapez-le encore"), and the second
 * typing keeps the code once both match: no button to press. Only its
 * verifier is stored, and the session opens. Two different codes start again
 * from the first. A code among the first ones tried (0000, 1234, a year) is
 * not refused: a plain warning in place of the field says why, with "Choisir
 * un autre code" (the primary action) and "Garder ce code", a second yes.
 *
 * `embedded`: the code part of the welcome, under the choice of mode (its
 * heading a level below the screen's); otherwise a screen of its own (a phone
 * whose welcome ended before codes existed).
 */
export function CodeSetup({
  mode,
  onCreated,
  headingRef,
  embedded = false,
}: {
  mode: Mode;
  onCreated?: () => void;
  /** The heading, for the welcome to give it the focus when this part opens. */
  headingRef?: Ref<HTMLHeadingElement>;
  embedded?: boolean;
}) {
  const t = useT();
  const { createCode } = useSession();
  const [length, setLength] = useState(() => defaultCodeLength(mode));
  const [step, setStep] = useState<Step>('choose');
  const [first, setFirst] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<'invalid' | 'mismatch' | 'exists' | 'unsaved' | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const warning = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step);

  // A new step: the field takes the focus, so the next digits go straight in;
  // the warning's heading, so it is read from the top. On a small phone the
  // whole part comes back into view, a message about the code included.
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    (step === 'weak' ? warning : field).current?.focus({ preventScroll: true });
    bringIntoView(root.current);
  }, [step]);

  /** Back to an empty first typing (the field then takes the focus), with the reason said on it. */
  const startAgain = (reason: typeof problem) => {
    setFirst('');
    setCode('');
    setStep('choose');
    setProblem(reason);
  };

  const make = async (typed: string) => {
    setBusy(true);
    const made = await createCode(typed);
    if (made === 'made') {
      onCreated?.();
      return;
    }
    // Locked meanwhile (an exit): the code is kept, and the code screen asks for it.
    if (made === 'cancelled') return;
    // Not made: a code was already there (the code screen comes and asks for it),
    // or the phone did not keep it. Either way, a new start, with the reason.
    setBusy(false);
    startAgain(made);
  };

  /** Every digit is in: on to the second typing, or the code kept once both match. */
  const complete = (typed: string) => {
    if (step === 'choose') {
      setFirst(typed);
      setCode('');
      setProblem(null);
      setStep(easyToGuess(typed) ? 'weak' : 'confirm');
      return;
    }
    if (typed !== first) {
      startAgain('mismatch');
      return;
    }
    setCode(typed);
    setProblem(null);
    void make(typed);
  };

  const change = (value: string) => {
    if (busy) return;
    if (value.length === length) {
      complete(value);
      return;
    }
    setCode(value);
    if (problem === 'invalid') setProblem(null);
  };

  /** Enter before the last digit: the field says how many are needed. */
  const submit = () => {
    if (busy) return;
    if (code.length !== length) {
      setProblem('invalid');
      field.current?.focus();
      return;
    }
    complete(code);
  };

  const error =
    problem === 'invalid'
      ? t('code.invalidCount', { count: length })
      : problem === 'mismatch'
        ? t('code.mismatch')
        : problem === 'exists'
          ? t('code.exists')
          : problem === 'unsaved'
            ? t('code.notSaved')
            : '';

  const Heading = embedded ? 'h2' : 'h1';
  const WarningHeading = embedded ? 'h3' : 'h2';
  const body = (
    <>
      <div className="code-setup__intro">
        <Heading ref={headingRef} tabIndex={-1}>
          {t('code.createTitleCount', { count: length })}
        </Heading>
        <p>{t(mode === 'accompanied' ? 'code.createLeadAccompanied' : 'code.createLeadWoman')}</p>
      </div>
      <RadioGroup<Length>
        legend={t('code.lengthLegend')}
        hint={mode === 'accompanied' ? t('code.lengthHintAccompanied') : undefined}
        options={LENGTHS.map((value) => ({ value, label: value }))}
        value={String(length) as Length}
        row
        onChange={(value) => {
          if (busy) return;
          setLength(Number(value));
          setFirst('');
          setCode('');
          setProblem(null);
          setStep('choose');
        }}
      />
      {step === 'weak' ? (
        <div className="code-setup__weak">
          <WarningHeading ref={warning} tabIndex={-1}>
            {t('code.weakTitle')}
          </WarningHeading>
          <p>{t('code.weakLead')}</p>
          <div className="code-setup__actions">
            <Button
              variant="primary"
              onClick={() => {
                startAgain(null);
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
        </div>
      ) : (
        <form
          className="code-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <CodeInput
            // A new field for the second typing: nothing of the first one is kept in it.
            key={`${step}-${String(length)}`}
            inputRef={field}
            // The second typing says so where the focus lands.
            label={t(step === 'choose' ? 'code.label' : 'code.confirmLabel')}
            error={error === '' ? undefined : error}
            value={code}
            maxLength={length}
            keypadLabel={t('code.keypad')}
            eraseLabel={t('code.erase')}
            eraseName={t('code.eraseName')}
            countLabel={digitCount(t)}
            onChange={change}
          />
        </form>
      )}
      <p className="sr-only" role="status">
        {busy ? t('code.saving') : error}
      </p>
    </>
  );

  return embedded ? (
    <section ref={root} className="code-setup code-setup--embedded">
      {body}
    </section>
  ) : (
    <main ref={root} className="screen code-setup">
      {body}
    </main>
  );
}
