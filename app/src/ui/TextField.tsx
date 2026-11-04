// SPDX-License-Identifier: MIT
import { useId, type InputHTMLAttributes } from 'react';

export type TextFieldProps = {
  label: string;
  hint?: string;
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>;

/** The form error mark: a triangle, a shape no result level uses. */
function ErrorMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      style={{ width: '1.25rem', height: '1.25rem' }}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 2 23 21.5H1zM10.7 9.5a1.3 1.3 0 0 1 2.6 0v4.6a1.3 1.3 0 0 1-2.6 0zM12 16.4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3z"
      />
    </svg>
  );
}

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
          <ErrorMark />
          <span>{error}</span>
        </p>
      ) : null}
      <input
        {...rest}
        id={inputId}
        className="text-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
    </div>
  );
}
