// SPDX-License-Identifier: MIT

/** A close mark: two strokes, a shape no level uses. */
function CloseMark() {
  return (
    <svg
      className="quick-exit__mark"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The quick exit, in the header of every screen once the code is given: one
 * tap, no question asked. The caller locks, forgets what is in memory and
 * shows the neutral screen. Takes its text from the caller.
 */
export function QuickExit({ label, onExit }: { label: string; onExit: () => void }) {
  return (
    <button type="button" className="button quick-exit" onClick={onExit}>
      <CloseMark />
      <span>{label}</span>
    </button>
  );
}
