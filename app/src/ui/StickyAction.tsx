// SPDX-License-Identifier: MIT
import { useEffect, useRef, type ReactNode } from 'react';

/** The page's room kept under a focused element for the bar (base.css). */
export const STICKY_HEIGHT = '--sticky-action-height';

/**
 * The primary action under a long list, held at the bottom of the screen
 * while the list scrolls. It writes its own height on the page (in
 * --sticky-action-height, again whenever the text size or the words change
 * it), so the page keeps that much room when it scrolls a focused element
 * into view: the bar never hides what has the focus.
 */
export function StickyAction({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (element === null) return;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty(STICKY_HEIGHT, `${String(element.getBoundingClientRect().height)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(STICKY_HEIGHT);
    };
  }, []);
  return (
    <div ref={bar} className="sticky-action">
      {children}
    </div>
  );
}
