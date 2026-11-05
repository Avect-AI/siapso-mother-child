// SPDX-License-Identifier: MIT
import { useLocation } from 'wouter';
import { APP_NAME } from '../config.js';
import { useT } from '../i18n/index.js';
import { AppMark } from '../ui/AppMark.js';
import { Button } from '../ui/Button.js';

/** The route of the code screen asked for from the neutral screen or who to call. */
export const UNLOCK_PATH = '/unlock';

/**
 * What the quick exit leaves on the screen: the app's neutral name and mark,
 * and one button, "Ouvrir", that asks for the code. Nothing else: on a shared
 * phone, it says nothing about a pregnancy or about anyone. The header keeps
 * the danger signs one tap away.
 */
export function Neutral() {
  const t = useT();
  const [, navigate] = useLocation();
  return (
    <main className="screen neutral">
      <div className="neutral__identity">
        <AppMark />
        <h1 tabIndex={-1}>{APP_NAME}</h1>
      </div>
      <Button
        variant="primary"
        className="neutral__open"
        onClick={() => {
          // Once the code is given, the app comes back to this entry (App.tsx).
          navigate(UNLOCK_PATH, { state: { back: true } });
        }}
      >
        {t('code.open')}
      </Button>
    </main>
  );
}
