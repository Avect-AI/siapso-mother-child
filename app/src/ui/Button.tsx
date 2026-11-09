// SPDX-License-Identifier: MIT
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export type ButtonProps = {
  /** Required on purpose: no default, so a screen never gets an extra primary by accident. */
  variant: ButtonVariant;
  children: ReactNode;
  /** For a screen that gives this button the focus. */
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * A button at least 48 px in both directions. One primary button per screen;
 * secondary and quiet buttons for everything else. Defaults to type="button"
 * so it never submits a form by accident.
 */
export function Button({ variant, type = 'button', className, children, ...rest }: ButtonProps) {
  const classes = ['button', `button--${variant}`, className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
