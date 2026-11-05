// SPDX-License-Identifier: MIT
import { useState, type Ref } from 'react';
import { TextField } from './TextField.js';

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
] as const;

/**
 * A code of a few digits: the field, a password field (assistive
 * technologies never read the digits) that opens the phone's numeric keypad
 * (inputmode numeric) for those who type, then large keys on the screen, laid
 * out as on a phone, for those who tap. The field is a one-time code with no
 * name and the password managers' ignore marks, so no browser offers to keep
 * it. The keys never take the field's focus, so the phone's keyboard does not
 * cover them; a screen reader hears how many digits are typed as they are
 * tapped, never which. "Effacer" with nothing to erase is aria-disabled: it
 * keeps the focus when tapped. Takes its text from the caller.
 */
export function CodeInput({
  label,
  hint,
  error,
  value,
  maxLength,
  onChange,
  keypadLabel,
  eraseLabel,
  countLabel,
  inputRef,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  keypadLabel: string;
  eraseLabel: string;
  /** How many digits are typed, in words ("3 chiffres"). */
  countLabel: (count: number) => string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [spoken, setSpoken] = useState('');
  const change = (next: string) => {
    onChange(next);
    setSpoken(countLabel(next.length));
  };
  const key = (digit: string) => (
    <button
      key={digit}
      type="button"
      className="keypad__key"
      onClick={() => {
        if (value.length < maxLength) change(value + digit);
      }}
    >
      {digit}
    </button>
  );
  const empty = value === '';
  return (
    <div className="code-input">
      <TextField
        ref={inputRef}
        label={label}
        hint={hint}
        error={error}
        className="code-input__field"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        data-bwignore=""
        data-form-type="other"
        maxLength={maxLength}
        value={value}
        onChange={(event) => {
          // Digits only: a letter typed on a full keyboard is left out.
          onChange(event.target.value.replace(/[^0-9]/g, '').slice(0, maxLength));
        }}
      />
      <div className="keypad" role="group" aria-label={keypadLabel}>
        {ROWS.flat().map(key)}
        <span className="keypad__gap" aria-hidden="true" />
        {key('0')}
        <button
          type="button"
          className="keypad__key keypad__erase"
          aria-disabled={empty ? true : undefined}
          onClick={() => {
            if (!empty) change(value.slice(0, -1));
          }}
        >
          {eraseLabel}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {spoken}
      </p>
    </div>
  );
}
