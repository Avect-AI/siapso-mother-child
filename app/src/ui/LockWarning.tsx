// SPDX-License-Identifier: MIT
import { Button } from './Button.js';

/**
 * The auto-lock comes in a few seconds while a form has answers not saved: a
 * band held at the bottom of the screen says so, read out once as it appears
 * (an alert is announced when it is added with its words), with one way to
 * stay (a touch anywhere does it too). WCAG 2.2.1: a time limit is warned
 * about, and extended with a simple action.
 */
export function LockWarning({
  open,
  message,
  action,
  onStay,
}: {
  open: boolean;
  message: string;
  action: string;
  onStay: () => void;
}) {
  if (!open) return null;
  return (
    <div className="update-region" role="alert">
      <div className="update-prompt lock-warning">
        <p className="update-prompt__message">{message}</p>
        <Button variant="secondary" onClick={onStay}>
          {action}
        </Button>
      </div>
    </div>
  );
}
