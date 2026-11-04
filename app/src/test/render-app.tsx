// SPDX-License-Identifier: MIT
import type { DangerSign, Pack } from '@siapso/engine';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { App } from '../App.js';
import { storeSettings } from '../data/db.js';
import { PackLoadError, type LoadedPack } from '../data/pack-loader.js';
import type { Settings } from '../domain/types.js';
import { AppProvider } from '../state/app-state.js';

/** A pack with only what the shell reads; the loader is replaced, so parsePack never sees it. */
export function shellPack(dangerSigns: DangerSign[] = []): Pack {
  return { version: '0.1.0', date: '2026-11-05', dangerSigns } as unknown as Pack;
}

/** A loader that hands back `pack`, downloaded and stored unless `overrides` say otherwise. */
export function loaderOf(
  pack: Pack,
  overrides: Partial<Omit<LoadedPack, 'pack'>> = {},
): () => Promise<LoadedPack> {
  return () =>
    Promise.resolve({
      pack,
      source: 'network',
      fallbackReason: null,
      stored: Promise.resolve('stored'),
      ...overrides,
    });
}

export const noPack = () => Promise.reject(new PackLoadError('no pack in this test'));

/** A pack that is still loading for the whole test. */
export const pendingPack = () => new Promise<LoadedPack>(() => undefined);

/**
 * Renders the whole app as on a phone: stored settings first, then the route
 * in the hash. `children` render inside the app, after the screens (a probe
 * reading the app state).
 */
export async function renderApp({
  settings,
  hash = '',
  packLoader = loaderOf(shellPack()),
  storageTimeoutMs,
  children,
}: {
  settings?: Settings;
  hash?: string;
  packLoader?: () => Promise<LoadedPack>;
  storageTimeoutMs?: number;
  children?: ReactNode;
} = {}) {
  if (settings) await storeSettings(settings);
  window.location.hash = hash;
  return render(
    <AppProvider
      packLoader={packLoader}
      {...(storageTimeoutMs === undefined ? {} : { storageTimeoutMs })}
    >
      <App>{children}</App>
    </AppProvider>,
  );
}
