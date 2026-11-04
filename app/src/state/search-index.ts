// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import type { ResolverIndex } from '@siapso/resolver';
import { useEffect, useMemo } from 'react';
import { searchIndexOf } from '../domain/search-index.js';
import { useApp } from './app-state.js';

/** How long a browser without idle callbacks waits before building the index. */
const WARM_DELAY_MS = 300;

/**
 * Builds the index of `pack` while the phone is idle (the check screen calls
 * it while its list is read), so that the first search answers at once: on
 * an entry-level phone the build is a long task of a few hundred ms.
 */
export function useWarmSearchIndex(pack: Pack | null): void {
  useEffect(() => {
    if (pack === null) return;
    const build = () => {
      searchIndexOf(pack);
    };
    const idle = (window as Partial<Window>).requestIdleCallback;
    if (idle) {
      const handle = idle(build, { timeout: 2000 });
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(build, WARM_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pack]);
}

/**
 * The resolver index of the loaded pack, built once per pack (entriesFromPack
 * then buildIndex); null while no pack is loaded.
 */
export function useSearchIndex(): ResolverIndex | null {
  const { pack } = useApp();
  return useMemo(() => (pack === null ? null : searchIndexOf(pack)), [pack]);
}
