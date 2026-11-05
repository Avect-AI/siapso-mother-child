// SPDX-License-Identifier: MIT
import type { DangerSign, Pack } from '@siapso/engine';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { App } from '../App.js';
import { codeOpened } from '../data/code-guard.js';
import { closeAppDb, getStoredVerifier, storeSettings, storeVerifier } from '../data/db.js';
import { PackLoadError, type LoadedPack } from '../data/pack-loader.js';
import type { Settings } from '../domain/types.js';
import { AppProvider } from '../state/app-state.js';
import { VoiceProvider } from '../voice/voice-context.js';
import type { VoiceService } from '../voice/voice-service.js';
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

/** No previous pack kept on the phone, so nothing to roll back to. */
export const noPrevious = () => Promise.resolve(null);

export const noRollback = () =>
  Promise.reject(new Error('There is no previous pack to roll back to'));

/**
 * Stores the verifier of TEST_CODE, as the welcome leaves it, then closes the
 * connection, so the app starts as on a phone, with none open.
 */
export async function storeTestCode(): Promise<void> {
  await storeVerifier(await verifierOf(TEST_CODE));
  closeAppDb();
}

/**
 * Stores `settings` as the tab that made the code stored left them (or the
 * welcome of a phone with no code): the mode and the welcome are written only
 * with the code a tab opened (data/code-guard.ts). The test tab then holds no
 * code, as a page just loaded.
 */
export async function seedSettings(settings: Settings): Promise<void> {
  codeOpened((await getStoredVerifier()) ?? null);
  try {
    await storeSettings(settings);
  } finally {
    codeOpened(null);
  }
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
  packRollback = noRollback,
  packPrevious = noPrevious,
  acceptsUnsigned = false,
  storageTimeoutMs,
  locked = false,
  open,
  entryState,
  voice,
  children,
}: {
  /** The state of the history entry of `hash`, as a screen leaves it. */
  entryState?: unknown;
  settings?: Settings;
  hash?: string;
  packLoader?: () => Promise<LoadedPack>;
  /** Restores the previous pack (none by default). */
  packRollback?: () => Promise<LoadedPack>;
  /** The version of the previous pack (none by default). */
  packPrevious?: () => Promise<string | null>;
  /** A build that accepts unsigned packs (a demo build); a release build by default. */
  acceptsUnsigned?: boolean;
  storageTimeoutMs?: number;
  locked?: boolean;
  /** Starts open whatever the settings (a storage that never answers, say). */
  open?: boolean;
  /** The voice service (test/voice.ts); by default the page's, which jsdom cannot use. */
  voice?: VoiceService;
  children?: ReactNode;
} = {}) {
  if (settings) await seedSettings(settings);
  if (settings?.onboarded) await storeTestCode();
  window.location.hash = hash;
  if (entryState !== undefined) window.history.replaceState(entryState, '');
  return render(
    <AppProvider
      packLoader={packLoader}
      packRollback={packRollback}
      packPrevious={packPrevious}
      acceptsUnsigned={acceptsUnsigned}
      // Open as if the code had just been given, on a phone past the welcome only.
      session={{ startUnlocked: open ?? (!locked && settings?.onboarded === true) }}
      {...(storageTimeoutMs === undefined ? {} : { storageTimeoutMs })}
    >
      {voice === undefined ? (
        <App>{children}</App>
      ) : (
        <VoiceProvider service={voice}>
          <App>{children}</App>
        </VoiceProvider>
      )}
    </AppProvider>,
  );
}
