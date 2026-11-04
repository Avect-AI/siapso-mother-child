// SPDX-License-Identifier: MIT
import { useEffect, useRef } from 'react';
import { Button } from './Button.js';

/** The custom property base.css turns into the page's bottom scroll padding. */
const BAND_HEIGHT = '--update-band-height';

/**
 * A new version of the app is installed and waiting: say so and offer to
 * reload. The app never reloads by itself, so nobody loses a check half done.
 * The live region stays in the page, empty, until a version is ready.
 *
 * The band is held at the bottom of the screen. While it shows, its height is
 * reserved as the page's bottom scroll padding, so a control that takes the
 * focus is scrolled clear of it, never hidden under it (WCAG 2.4.11).
 */
export function UpdatePrompt({
  open,
  message,
  action,
  onReload,
}: {
  open: boolean;
  message: string;
  action: string;
  onReload: () => void;
}) {
  const band = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = band.current;
    if (!open || element === null) return;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty(BAND_HEIGHT, `${String(element.offsetHeight)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(BAND_HEIGHT);
    };
  }, [open]);

  return (
    <div className="update-region" role="status">
      {open ? (
        <div className="update-prompt" ref={band}>
          <p className="update-prompt__message">{message}</p>
          <Button variant="secondary" onClick={onReload}>
            {action}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
