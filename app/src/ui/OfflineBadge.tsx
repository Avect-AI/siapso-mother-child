// SPDX-License-Identifier: MIT
import { useId } from 'react';

/**
 * No signal: three rising bars, crossed out, the cross set apart from the bars
 * by a knocked-out gap. A shape no result level uses.
 */
function NoSignalMark() {
  const maskId = `no-signal-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      style={{ width: '1.25rem', height: '1.25rem' }}
      aria-hidden="true"
      focusable="false"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" />
        <path d="M3 3 21 21" stroke="black" strokeWidth="6.5" strokeLinecap="round" />
      </mask>
      <g fill="currentColor" mask={`url(#${maskId})`}>
        <rect x="2.5" y="15" width="4.5" height="6.5" rx="1" />
        <rect x="9.75" y="9.5" width="4.5" height="12" rx="1" />
        <rect x="17" y="3.5" width="4.5" height="18" rx="1" />
      </g>
      <path
        d="M3 3 21 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * "Offline" in words, shown while the phone has no connection. The live region
 * stays in the page when online, empty, so that losing the connection is
 * announced by screen readers.
 */
export function OfflineBadge({ online, label }: { online: boolean; label: string }) {
  return (
    <div className="offline-badge-region" role="status">
      {online ? null : (
        <span className="offline-badge">
          <NoSignalMark />
          <span>{label}</span>
        </span>
      )}
    </div>
  );
}
