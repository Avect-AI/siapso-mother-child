// SPDX-License-Identifier: MIT

const SIZE = { width: '1.75rem', height: '1.75rem' };

/** The microphone: say the name instead of typing it. No level uses this shape. */
export function MicMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      style={SIZE}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8.5" y="2" width="7" height="12" rx="3.5" fill="currentColor" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21.5M8.5 21.5h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The end of a recording: a square, as on any recorder. */
export function FinishMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      style={SIZE}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}
