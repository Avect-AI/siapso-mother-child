// SPDX-License-Identifier: MIT

/**
 * The entry-point mark, "go there": the danger signs shortcut and the search
 * candidates (each opens its confirm screen). No level uses it: the octagon
 * belongs to the danger level alone.
 */
export function Chevron() {
  return (
    <svg
      className="chevron"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      style={{ width: '1.25rem', height: '1.25rem' }}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9 4.5 16.5 12 9 19.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
