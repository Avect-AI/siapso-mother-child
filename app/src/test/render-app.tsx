// SPDX-License-Identifier: MIT
import type { DangerSign, Pack } from '@siapso/engine';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { App } from '../App.js';
import { storeSettings, storeVerifier } from '../data/db.js';
import { PackLoadError, type LoadedPack } from '../data/pack-loader.js';
import type { Settings } from '../domain/types.js';
import { AppProvider } from '../state/app-state.js';
import { verifierOf } from './verifier.js';

/** The code of the phone in tests. */
export const TEST_CODE = '2468';

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

/** Stores the verifier of TEST_CODE, as the welcome leaves it. */
export async function storeTestCode(): Promise<void> {
  await storeVerifier(await verifierOf(TEST_CODE));
}

/**
 * Renders the whole app as on a phone: stored settings first (with the code
 * TEST_CODE when onboarded), then the route in the hash. The session starts
 * open unless `locked`, as if the code had just been given. `children` render
 * inside the app, after the screens (a probe reading the app state).
 */
export async function renderApp({
  settings,
  hash = '',
  packLoader = loaderOf(shellPack()),
  storageTimeoutMs,
  locked = false,
  entryState,
  children,
}: {
  /** The state of the history entry of `hash`, as a screen leaves it. */
  entryState?: unknown;
  settings?: Settings;
  hash?: string;
  packLoader?: () => Promise<LoadedPack>;
  storageTimeoutMs?: number;
  locked?: boolean;
  children?: ReactNode;
} = {}) {
  if (settings) await storeSettings(settings);
  if (settings?.onboarded) await storeTestCode();
  window.location.hash = hash;
  if (entryState !== undefined) window.history.replaceState(entryState, '');
  return render(
    <AppProvider
      packLoader={packLoader}
      session={{ startUnlocked: !locked }}
      {...(storageTimeoutMs === undefined ? {} : { storageTimeoutMs })}
    >
      <App>{children}</App>
    </AppProvider>,
  );
}
