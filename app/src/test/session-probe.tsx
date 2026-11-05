// SPDX-License-Identifier: MIT
// Reads the session from inside the app, for tests that drive it directly.
import { useEffect, type ReactElement } from 'react';
import { useSession, type Session } from '../state/session.js';

function SessionProbe({ onSession }: { onSession: (session: Session) => void }) {
  const session = useSession();
  useEffect(() => {
    onSession(session);
  }, [session, onSession]);
  return null;
}

/** An element to render inside the app, and the session as it last rendered. */
export function probeSession(): { element: ReactElement; current: () => Session } {
  let latest: Session | undefined;
  const onSession = (session: Session) => {
    latest = session;
  };
  return {
    element: <SessionProbe onSession={onSession} />,
    current: () => {
      if (latest === undefined) throw new Error('the session probe has not rendered');
      return latest;
    },
  };
}
