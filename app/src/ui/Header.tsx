// SPDX-License-Identifier: MIT
import { AppMark } from './AppMark.js';
import { Chevron } from './Chevron.js';
import { OfflineBadge } from './OfflineBadge.js';
import { QuickExit } from './QuickExit.js';

export type HeaderPage = 'home' | 'danger' | null;

/**
 * The shell band on every screen after the welcome questions: the app mark
 * and name (back home), the danger signs shortcut, always in the same place,
 * locked or not, then, once the code is given, the quick exit, and the
 * offline badge. Takes its text from the caller.
 */
export function Header({
  appName,
  dangerLabel,
  offlineLabel,
  online,
  current,
  quickExit,
}: {
  appName: string;
  dangerLabel: string;
  offlineLabel: string;
  online: boolean;
  /** The open page, announced with aria-current. */
  current: HeaderPage;
  /** The quick exit, shown while the session is open; null while locked. */
  quickExit: { label: string; onExit: () => void } | null;
}) {
  return (
    <header className="header">
      <div className="header__inner">
        <div className="header__bar">
          <a
            className="header__name"
            href="#/"
            aria-current={current === 'home' ? 'page' : undefined}
          >
            <AppMark size={28} />
            <span>{appName}</span>
          </a>
          <a
            className="button button--secondary header__danger"
            href="#/danger"
            aria-current={current === 'danger' ? 'page' : undefined}
          >
            <span>{dangerLabel}</span>
            <Chevron />
          </a>
          {quickExit === null ? null : (
            <QuickExit label={quickExit.label} onExit={quickExit.onExit} />
          )}
        </div>
        <OfflineBadge online={online} label={offlineLabel} />
      </div>
    </header>
  );
}
