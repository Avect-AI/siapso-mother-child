// SPDX-License-Identifier: MIT
// Reads the check in progress from inside the app, for tests that assert what
// was added (the screen shows names, the check holds refs).
import { useEffect, type ReactElement } from 'react';
import { useCheck, type CheckState } from '../state/check-state.js';

function CheckProbe({ onCheck }: { onCheck: (check: CheckState) => void }) {
  const check = useCheck();
  useEffect(() => {
    onCheck(check);
  }, [check, onCheck]);
  return null;
}

/** An element to render inside the app, and the check as it last rendered. */
export function probeCheck(): { element: ReactElement; current: () => CheckState } {
  let latest: CheckState | undefined;
  const onCheck = (check: CheckState) => {
    latest = check;
  };
  return {
    element: <CheckProbe onCheck={onCheck} />,
    current: () => {
      if (latest === undefined) throw new Error('the check probe has not rendered');
      return latest;
    },
  };
}
