// SPDX-License-Identifier: MIT

/**
 * Scrolls the least that brings `part` wholly into view, never past its top
 * (a part taller than the window shows from its top): on a small phone, the
 * code part of the welcome from its heading to its last row of keys. Does
 * nothing when it is in view already.
 */
export function bringIntoView(part: Element | null | undefined): void {
  if (!part) return;
  const box = part.getBoundingClientRect();
  const below = box.bottom - window.innerHeight;
  if (below <= 0) return;
  window.scrollBy({ top: Math.min(below, Math.max(box.top, 0)) });
}
