// SPDX-License-Identifier: MIT
import { useId, type InputHTMLAttributes, type Ref } from 'react';
import { WarningMark } from './WarningMark.js';

export type TextFieldProps = {
  label: string;
  hint?: string | undefined;
  /** The problem with the value, or undefined when there is none. */
  error?: string | undefined;
  /** The input itself, to give it the focus. */
  ref?: Ref<HTMLInputElement> | undefined;
} & InputHTMLAttributes<HTMLInputElement>;

/**
 * A text input with its visible label, an optional hint and an optional error.
 * Reading order follows the eye: label, hint, error, then the input. The hint
 * and the error describe the input for screen readers.
 */
export function TextField({
  label,
  hint,
  error,
  id,
  className,
  'aria-describedby': describedByProp,
  ref,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}input`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [describedByProp, hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;
  const classes = ['text-field', error ? 'text-field--invalid' : null, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <label className="text-field__label" htmlFor={inputId}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-field__error">
          <WarningMark />
          <span>{error}</span>
        </p>
      ) : null}
      <input
        {...rest}
        ref={ref}
        id={inputId}
        className="text-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
    </div>
  );
}
