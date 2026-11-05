// SPDX-License-Identifier: MIT
import { useEffect, useRef, type ReactNode } from 'react';

/** The page's room kept under a focused element for the bar (base.css). */
export const STICKY_HEIGHT = '--sticky-action-height';

/** Marks a bar taller than its share of the screen: back in the flow (base.css). */
const OFF = 'sticky-action--off';

/**
 * The primary action under a long list, held at the bottom of the screen
 * while the list scrolls. It writes its own height on the page (in
 * --sticky-action-height, again whenever the text size or the words change
 * it), so the page keeps that much room when it scrolls a focused element
 * into view: the bar never hides what has the focus.
 *
 * With `maxShare`, the bar is held only while it takes that share of the
 * screen's height or less: taller (large text on a small phone), it goes back
 * into the flow, the same box, and keeps no room, rather than cover the list.
 */
export function StickyAction({
  children,
  className,
  maxShare,
}: {
  children: ReactNode;
  className?: string;
  /** The largest share of the screen's height the held bar may take (1/3: a third). */
  maxShare?: number;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (element === null) return;
    const root = document.documentElement;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      const held = maxShare === undefined || height <= window.innerHeight * maxShare;
      element.classList.toggle(OFF, !held);
      if (held) root.style.setProperty(STICKY_HEIGHT, `${String(height)}px`);
      else root.style.removeProperty(STICKY_HEIGHT);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    // A turned phone changes the screen's height, not the bar's.
    if (maxShare !== undefined) window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty(STICKY_HEIGHT);
    };
  }, [maxShare, className]);
  return (
    <div
      ref={bar}
      className={className === undefined ? 'sticky-action' : `sticky-action ${className}`}
    >
      {children}
    </div>
  );
}
