// SPDX-License-Identifier: MIT
import { useId, type ReactNode } from 'react';
import { WarningMark } from './WarningMark.js';

/** What every answer of an invalid group carries: aria-invalid and the error as its description. */
interface AnswerState {
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

/**
 * A question with native radios or checkboxes: legend, hint, error, then the
 * answers (the reading order of a text field). Each answer is a whole-width
 * label at least 56 px tall, so the target is the words, not the small circle.
 * The hint and the error describe the group; the error also describes each
 * answer (some screen readers skip a fieldset's description), which is marked
 * aria-invalid so the first one can take focus.
 */
function Fieldset({
  legend,
  hint,
  error,
  question,
  children,
}: {
  legend: string;
  hint: string | undefined;
  error: string | undefined;
  /** A main question of the screen (title size) rather than a detail of one. */
  question: boolean;
  children: (answer: AnswerState) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}hint`;
  const errorId = `${id}error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const classes = [
    'choice-group',
    question ? 'choice-group--question' : null,
    error ? 'choice-group--invalid' : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <fieldset className={classes} aria-describedby={describedBy || undefined}>
      <legend className="choice-group__legend">{legend}</legend>
      <div className="choice-group__body">
        {hint ? (
          <p id={hintId} className="choice-group__hint">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="choice-group__error">
            <WarningMark />
            <span>{error}</span>
          </p>
        ) : null}
        {children({
          'aria-invalid': error ? true : undefined,
          'aria-describedby': error ? errorId : undefined,
        })}
      </div>
    </fieldset>
  );
}

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  /** An answer of its own after the list ("I do not know"), set apart by a hairline. */
  apart?: boolean;
}

/** One answer of several. `row` sets short answers (yes, no) side by side when they fit. */
export function RadioGroup<T extends string>({
  legend,
  hint,
  error,
  options,
  value,
  onChange,
  row = false,
  question = false,
}: {
  legend: string;
  hint?: string | undefined;
  error?: string | undefined;
  options: readonly RadioOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  row?: boolean;
  question?: boolean;
}) {
  const name = useId();
  return (
    <Fieldset legend={legend} hint={hint} error={error} question={question}>
      {(answer) => (
        <div className={row ? 'options options--row' : 'options'}>
          {options.map((option) => {
            const checked = option.value === value;
            const classes = [
              'option',
              checked ? 'option--checked' : null,
              option.apart ? 'option--none' : null,
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <label key={option.value} className={classes}>
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={checked}
                  {...answer}
                  onChange={() => {
                    onChange(option.value);
                  }}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </Fieldset>
  );
}

export interface CheckboxOption {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Any number of answers, then an optional exclusive one set apart ("none of these"). */
export function CheckboxGroup({
  legend,
  hint,
  error,
  options,
  none,
  question = false,
}: {
  legend: string;
  hint?: string | undefined;
  error?: string | undefined;
  options: readonly CheckboxOption[];
  none?: CheckboxOption;
  question?: boolean;
}) {
  const box = (option: CheckboxOption, answer: AnswerState, extra?: string) => (
    <label
      key={option.id}
      className={['option', option.checked ? 'option--checked' : null, extra]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        type="checkbox"
        checked={option.checked}
        {...answer}
        onChange={(event) => {
          option.onChange(event.target.checked);
        }}
      />
      <span>{option.label}</span>
    </label>
  );
  return (
    <Fieldset legend={legend} hint={hint} error={error} question={question}>
      {(answer) => (
        <div className="options">
          {options.map((option) => box(option, answer))}
          {none ? box(none, answer, 'option--none') : null}
        </div>
      )}
    </Fieldset>
  );
}
