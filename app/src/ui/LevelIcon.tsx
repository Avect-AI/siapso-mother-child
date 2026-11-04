// SPDX-License-Identifier: MIT
import type { Level } from '@siapso/engine';
import { useId, type ReactNode } from 'react';

interface Pictogram {
  /** The solid silhouette, drawn in currentColor. */
  silhouette: ReactNode;
  /** The glyph knocked out of the silhouette, drawn in black inside the mask. */
  glyph: ReactNode;
}

const STROKE = {
  fill: 'none',
  stroke: 'black',
  strokeWidth: 2.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/**
 * One drawing per level on a 24-unit grid, reused at every size. Each level
 * has its own silhouette, so the level reads without colour: an octagon with
 * an exclamation mark (danger sign), an eye (show before the next dose), a
 * speech bubble (mention at the next contact), a circle with a question mark
 * (we do not know).
 */
const PICTOGRAMS: Record<Level, Pictogram> = {
  danger: {
    silhouette: <path d="M7.45 1h9.1L23 7.45v9.1L16.55 23h-9.1L1 16.55v-9.1z" />,
    glyph: (
      <>
        <path d="M12 6.5V13" {...STROKE} />
        <circle cx="12" cy="17.6" r="1.75" fill="black" />
      </>
    ),
  },
  'before-next-dose': {
    silhouette: <path d="M1 12c3-5.5 7-8 11-8s8 2.5 11 8c-3 5.5-7 8-11 8s-8-2.5-11-8z" />,
    glyph: (
      <>
        <circle cx="12" cy="12" r="4.6" fill="black" />
        <circle cx="12" cy="12" r="2.1" fill="white" />
      </>
    ),
  },
  'next-contact': {
    silhouette: (
      <path d="M6 3h12a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-7l-5 4.5V17a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z" />
    ),
    glyph: (
      <>
        <circle cx="7.5" cy="10" r="1.6" fill="black" />
        <circle cx="12" cy="10" r="1.6" fill="black" />
        <circle cx="16.5" cy="10" r="1.6" fill="black" />
      </>
    ),
  },
  unknown: {
    silhouette: <circle cx="12" cy="12" r="11" />,
    glyph: (
      <>
        <path d="M9 9.4a3 3 0 1 1 4.3 2.7c-.8.4-1.3 1.1-1.3 2" {...STROKE} />
        <circle cx="12" cy="18.4" r="1.75" fill="black" />
      </>
    ),
  },
};

/**
 * The level's pictogram, decorative: the level name is always shown as text
 * beside it. Sizes by role: 24 inline, 32 in a finding, 48 as a headline. The
 * size is in CSS pixels at the default font size and grows with the user's
 * font size, so the pictogram keeps pace with its label.
 */
export function LevelIcon({ level, size = 24 }: { level: Level; size?: number }) {
  const maskId = `level-icon-${useId().replace(/[^\w-]/g, '')}`;
  const { silhouette, glyph } = PICTOGRAMS[level];
  const rem = `${String(size / 16)}rem`;
  return (
    <svg
      className="level-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ width: rem, height: rem }}
      aria-hidden="true"
      focusable="false"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" />
        {glyph}
      </mask>
      <g fill="currentColor" mask={`url(#${maskId})`}>
        {silhouette}
      </g>
    </svg>
  );
}
