// SPDX-License-Identifier: MIT
import { AppMark } from './AppMark.js';
import { Chevron } from './Chevron.js';
import { OfflineBadge } from './OfflineBadge.js';
import { QuickExit } from './QuickExit.js';

export type HeaderPage = 'home' | 'danger' | null;

/**
 * The shell band on every screen, the welcome included. Its first row holds
 * the app mark and name (back home; the mark alone on the welcome, which shows
 * the name itself) and the danger signs shortcut, which ends it, and nothing
 * else: the shortcut keeps one place at every width and in every state
 * (welcome, locked, open, offline, neutral), so a thumb that learned where it
 * is never meets "Quitter" there. The second row, only when there is something
 * to show, holds the offline badge and the quick exit when the caller gives
 * one (once the code is given, and before it on the danger signs and who to
 * call). On a narrow phone, or at large text, the name shows as the mark alone
 * (still the link's name) and the shortcut's words wrap inside it rather than
 * leave the first row. On a wide band (base.css) the two rows show as one, the
 * shortcut still ending it; the order of the markup, which screen readers and
 * the keyboard follow, stays this one. Takes its text from the caller.
 */
export function Header({
  appName,
  dangerLabel,
  offlineLabel,
  online,
  current,
  quickExit,
}: {
  /** The app's name, the way home; null where the screen shows the name itself (the welcome). */
  appName: string | null;
  dangerLabel: string;
  offlineLabel: string;
  online: boolean;
  /** The open page, announced with aria-current. */
  current: HeaderPage;
  /** The quick exit; null where the caller offers none (App.tsx decides where). */
  quickExit: { label: string; onExit: () => void } | null;
}) {
  return (
    <header className="header">
      <div className="header__inner">
        <div className="header__bar">
          {appName === null ? (
            // The welcome shows the name itself: only the mark here, so the
            // shortcut sits where it sits on every other screen.
            <span className="header__name" aria-hidden="true">
              <AppMark size={28} />
            </span>
          ) : (
            <a
              className="header__name"
              href="#/"
              aria-current={current === 'home' ? 'page' : undefined}
            >
              <AppMark size={28} />
              <span className="header__name-text">{appName}</span>
            </a>
          )}
          <a
            className="button button--secondary header__danger"
            href="#/danger"
            aria-current={current === 'danger' ? 'page' : undefined}
          >
            <span>{dangerLabel}</span>
            <Chevron />
          </a>
        </div>
        <div className="header__more">
          <OfflineBadge online={online} label={offlineLabel} />
          {quickExit === null ? null : (
            <QuickExit label={quickExit.label} onExit={quickExit.onExit} />
          )}
        </div>
      </div>
    </header>
  );
}
