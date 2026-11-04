// SPDX-License-Identifier: MIT
// WCAG 2.x contrast for the design tokens in tokens.css. Reading text is held
// at 7:1 (WCAG AAA) rather than 4.5:1: the app is read outdoors, often in
// direct sun on low-cost screens, where ambient light eats contrast. Non-text
// boundaries (contours, input borders, focus rings) are held at 3:1.

/** Relative luminance of a 6-digit hex colour (WCAG 2.x definition). */
function luminance(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

/** Contrast ratio between two 6-digit hex colours, from 1 to 21, in either order. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const READING = 7;
const NON_TEXT = 3;

const LEVEL_NAMES = ['danger', 'before-next-dose', 'next-contact', 'unknown'] as const;

interface Pair {
  fg: string;
  bg: string;
  min: number;
}

/**
 * Each level: its text on its field, its contour on the page and on white.
 * The danger contour is also the danger banner action's text, on white at
 * rest and on the page colour on hover, so both of its pairs are reading text.
 */
function levelPairs(level: (typeof LEVEL_NAMES)[number]): Pair[] {
  const contour = level === 'danger' ? READING : NON_TEXT;
  return [
    { fg: `--level-${level}-fg`, bg: `--level-${level}-bg`, min: READING },
    { fg: `--level-${level}-border`, bg: '--color-bg', min: contour },
    { fg: `--level-${level}-border`, bg: '--color-surface', min: contour },
  ];
}

/** Every foreground and background pair the components use, by custom property name. */
export const CONTRAST_PAIRS: Pair[] = [
  // Body text (also form errors) and muted text on the page and on white reserves.
  { fg: '--color-text', bg: '--color-bg', min: READING },
  { fg: '--color-text', bg: '--color-surface', min: READING },
  { fg: '--color-text-muted', bg: '--color-bg', min: READING },
  { fg: '--color-text-muted', bg: '--color-surface', min: READING },
  { fg: '--color-text', bg: '--color-selection', min: READING },
  // Buttons: primary text on ultramarine, ultramarine text on white and tint.
  { fg: '--color-primary-text', bg: '--color-primary', min: READING },
  { fg: '--color-primary-text', bg: '--color-primary-hover', min: READING },
  { fg: '--color-primary', bg: '--color-surface', min: READING },
  { fg: '--color-primary', bg: '--color-bg', min: READING },
  { fg: '--color-primary', bg: '--color-primary-tint', min: READING },
  ...LEVEL_NAMES.flatMap(levelPairs),
  // The unknown field is hatched: its text holds on both stripes.
  { fg: '--level-unknown-fg', bg: '--level-unknown-hatch', min: READING },
  // Input borders and the focus ring on the page and on white.
  { fg: '--color-border', bg: '--color-bg', min: NON_TEXT },
  { fg: '--color-border', bg: '--color-surface', min: NON_TEXT },
  { fg: '--color-focus', bg: '--color-bg', min: NON_TEXT },
  { fg: '--color-focus', bg: '--color-surface', min: NON_TEXT },
];
