// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';

/**
 * How long a live region stays empty after its screen appears. Screen readers
 * often skip a region that is filled in the same moment it is added to the
 * page; one that is there, empty, then filled a moment later is read out.
 */
export const LIVE_REGION_DELAY_MS = 100;

/**
 * False when the screen appears, true a moment later (`delayMs`): a live
 * region renders empty first and says what it has to say once this is true,
 * so a message ready from the start (a contact just saved, a wait still
 * running after a reload) is announced too, and a loading line speaks only
 * when loading takes that long.
 */
export function useLiveRegionReady(delayMs: number = LIVE_REGION_DELAY_MS): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [delayMs]);
  return ready;
}
