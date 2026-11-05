// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAppDb, getStoredSettings, storeSettings } from '../data/db.js';
import { PackLoadError, type LoadedPack } from '../data/pack-loader.js';
import { breakIndexedDB, hangIndexedDB } from '../test/idb.js';
import { loaderOf } from '../test/render-app.js';
import { AppProvider, STORAGE_TIMEOUT_MS, useApp } from './app-state.js';

const pack = { version: '0.1.0', dangerSigns: [] } as unknown as Pack;
const loaded = loaderOf(pack);
const failing = () => Promise.reject(new PackLoadError('no pack anywhere'));

let latest: ReturnType<typeof useApp> | undefined;

function Probe() {
  const app = useApp();
  useEffect(() => {
    latest = app;
  });
  return (
    <dl>
      <dt>settings</dt>
      <dd>{JSON.stringify(app.settings)}</dd>
      <dt>ready</dt>
      <dd>ready: {String(app.settingsReady)}</dd>
      <dt>unavailable</dt>
      <dd>unavailable: {String(app.settingsUnavailable)}</dd>
      <dt>pack</dt>
      <dd>pack: {app.pack?.version ?? 'none'}</dd>
      <dt>source</dt>
      <dd>source: {app.packSource ?? 'none'}</dd>
      <dt>fallback</dt>
      <dd>fallback: {app.packFallbackReason ?? 'none'}</dd>
      <dt>error</dt>
      <dd>error: {app.packError ?? 'none'}</dd>
      <dt>store</dt>
      <dd>store: {app.packStoreError ?? 'none'}</dd>
      <dt>online</dt>
      <dd>online: {String(app.online)}</dd>
      <dt>kind</dt>
      <dd>kind: {app.packFallback ?? 'none'}</dd>
      <dt>origin</dt>
      <dd>
        origin: {app.packOrigin === null ? 'none' : app.packOrigin.signed ? 'signed' : 'unsigned'}
      </dd>
    </dl>
  );
}

function renderProbe(
  packLoader: () => Promise<LoadedPack> = loaded,
  storageTimeoutMs?: number,
  rollback: {
    packRollback?: () => Promise<LoadedPack>;
    packPrevious?: () => Promise<string | null>;
  } = {},
) {
  return render(
    <AppProvider
      packLoader={packLoader}
      {...(storageTimeoutMs === undefined ? {} : { storageTimeoutMs })}
      {...rollback}
    >
      <Probe />
    </AppProvider>,
  );
}

describe('AppProvider rollback of the pack', () => {
  const older = { version: '0.0.9', dangerSigns: [] } as unknown as Pack;
  const restored: LoadedPack = {
    pack: older,
    source: 'cache',
    fallbackReason: null,
    fallback: 'rolled-back',
    stored: Promise.resolve('stored'),
    origin: { signed: true, keyId: 'team-1' },
  };

  it('never reads the previous pack on its own: only a screen that asks for it does', async () => {
    const packPrevious = vi.fn(() => Promise.resolve('0.0.9'));

    renderProbe(loaded, undefined, { packPrevious });
    await screen.findByText('pack: 0.1.0');
    await act(async () => {
      await Promise.resolve();
    });

    expect(packPrevious).not.toHaveBeenCalled();
    await expect(latest?.readPackPrevious()).resolves.toBe('0.0.9');
    expect(packPrevious).toHaveBeenCalledTimes(1);
  });

  it('activates the restored pack at once, without a reload', async () => {
    const packRollback = vi.fn(() => Promise.resolve(restored));
    renderProbe(loaded, undefined, { packRollback });
    await screen.findByText('pack: 0.1.0');

    await act(async () => {
      await latest?.rollbackPack();
    });

    expect(packRollback).toHaveBeenCalledTimes(1);
    expect(screen.getByText('pack: 0.0.9')).toBeInTheDocument();
    expect(screen.getByText('source: cache')).toBeInTheDocument();
    expect(screen.getByText('kind: rolled-back')).toBeInTheDocument();
  });

  it('changes nothing when the rollback fails, and says why to the caller', async () => {
    renderProbe(loaded, undefined, {
      packRollback: () => Promise.reject(new Error('There is no previous pack to roll back to')),
    });
    await screen.findByText('pack: 0.1.0');

    await act(async () => {
      await expect(latest?.rollbackPack()).rejects.toThrow(/no previous pack/);
    });

    expect(screen.getByText('pack: 0.1.0')).toBeInTheDocument();
  });

  it('keeps the origin and the reason for the stored copy of the loaded pack', async () => {
    renderProbe(
      loaderOf(pack, {
        source: 'cache',
        fallback: 'refused',
        fallbackReason: 'manifest.sig: the signature does not match',
        origin: { signed: false, reason: 'the pack is not signed' },
      }),
    );

    expect(await screen.findByText('origin: unsigned')).toBeInTheDocument();
    expect(screen.getByText('kind: refused')).toBeInTheDocument();
  });
});

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

afterEach(() => {
  latest = undefined;
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'storage');
});

describe('AppProvider settings', () => {
  it('renders at once, then says when the stored settings are known', async () => {
    await storeSettings({ lang: 'en', mode: 'woman', onboarded: true });
    renderProbe();

    expect(screen.getByText('ready: false')).toBeInTheDocument();
    expect(await screen.findByText('ready: true')).toBeInTheDocument();
    expect(screen.getByText('{"lang":"en","mode":"woman","onboarded":true}')).toBeInTheDocument();
    expect(screen.getByText('unavailable: false')).toBeInTheDocument();
  });

  it('starts with French, no mode and no onboarding when nothing is stored', async () => {
    renderProbe();
    expect(await screen.findByText('ready: true')).toBeInTheDocument();
    expect(screen.getByText('{"lang":"fr","mode":null,"onboarded":false}')).toBeInTheDocument();
  });

  it('stops waiting for blocked storage: default settings, flagged, after the timeout', async () => {
    hangIndexedDB();
    renderProbe(loaded, 50);

    expect(screen.getByText('ready: false')).toBeInTheDocument();
    expect(await screen.findByText('ready: true')).toBeInTheDocument();
    expect(screen.getByText('unavailable: true')).toBeInTheDocument();
    expect(screen.getByText('{"lang":"fr","mode":null,"onboarded":false}')).toBeInTheDocument();
  });

  it('flags settings it cannot read', async () => {
    breakIndexedDB('SecurityError');
    renderProbe();

    expect(await screen.findByText('unavailable: true')).toBeInTheDocument();
    expect(screen.getByText('ready: true')).toBeInTheDocument();
  });

  it('stores changed settings in IndexedDB', async () => {
    renderProbe();
    await screen.findByText('ready: true');

    await act(() => latest?.setSettings({ lang: 'en' }));

    expect(screen.getByText('{"lang":"en","mode":null,"onboarded":false}')).toBeInTheDocument();
    expect(await getStoredSettings()).toEqual({ lang: 'en', mode: null, onboarded: false });
  });

  it('changes the settings at once even when storage cannot finish, and flags it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The first read has the usual time (a short timeout would also cut it on
    // a loaded machine); only the save that never finishes runs on fake timers.
    renderProbe(loaded, STORAGE_TIMEOUT_MS);
    await screen.findByText('ready: true');
    expect(screen.getByText('unavailable: false')).toBeInTheDocument();
    closeAppDb();
    hangIndexedDB();
    vi.useFakeTimers();
    try {
      let saving: Promise<void> | undefined;
      act(() => {
        saving = latest?.setSettings({ lang: 'en' });
      });
      expect(screen.getByText('{"lang":"en","mode":null,"onboarded":false}')).toBeInTheDocument();
      expect(screen.getByText('unavailable: false')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS);
        await saving;
      });
      expect(screen.getByText('unavailable: true')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks once for persistent storage when onboarding completes, and ignores a refusal', async () => {
    const persist = vi.fn(() => Promise.reject(new Error('refused')));
    Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
    renderProbe();
    await screen.findByText('ready: true');

    await act(() => latest?.setSettings({ lang: 'en' }));
    expect(persist).not.toHaveBeenCalled();
    await act(() => latest?.setSettings({ mode: 'accompanied', onboarded: true }));
    await act(() => latest?.setSettings({ lang: 'fr' }));

    expect(persist).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/"onboarded":true/)).toBeInTheDocument();
  });
});

describe('AppProvider pack', () => {
  it('gives the loaded pack and where it came from', async () => {
    renderProbe();
    expect(await screen.findByText('pack: 0.1.0')).toBeInTheDocument();
    expect(screen.getByText('source: network')).toBeInTheDocument();
    expect(screen.getByText('fallback: none')).toBeInTheDocument();
    expect(screen.getByText('store: none')).toBeInTheDocument();
  });

  it('keeps the source and the reason when the pack came from the device', async () => {
    renderProbe(loaderOf(pack, { source: 'cache', fallbackReason: 'Failed to fetch' }));
    expect(await screen.findByText('source: cache')).toBeInTheDocument();
    expect(screen.getByText('fallback: Failed to fetch')).toBeInTheDocument();
  });

  it('reports a pack the device could not store, and keeps using it', async () => {
    const stored = Promise.reject(new Error('QuotaExceededError'));
    stored.catch(() => undefined);
    renderProbe(loaderOf(pack, { stored }));

    expect(await screen.findByText('store: QuotaExceededError')).toBeInTheDocument();
    expect(screen.getByText('pack: 0.1.0')).toBeInTheDocument();
  });

  it('gives the load error when no pack is available', async () => {
    renderProbe(failing);
    expect(await screen.findByText('error: no pack anywhere')).toBeInTheDocument();
    expect(latest?.pack).toBeNull();
    expect(latest?.packSource).toBeNull();
  });
});

describe('AppProvider connection', () => {
  it('follows the browser online and offline events', async () => {
    renderProbe();
    expect(await screen.findByText('online: true')).toBeInTheDocument();

    act(() => {
      setOnline(false);
    });
    expect(screen.getByText('online: false')).toBeInTheDocument();

    act(() => {
      setOnline(true);
    });
    expect(screen.getByText('online: true')).toBeInTheDocument();
  });

  it('refuses to be used outside the provider', () => {
    expect(() => render(<Probe />)).toThrow(/AppProvider/);
  });
});
