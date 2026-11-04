// SPDX-License-Identifier: MIT
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/index.js';
import { ServiceWorkerUpdate } from './ServiceWorkerUpdate.js';

// The register module of vite-plugin-pwa, replaced: the test plays the
// service worker's part by calling the options the component passed.
const sw = vi.hoisted(() => ({
  options: undefined as RegisterSWOptions | undefined,
  needRefresh: false,
  update: vi.fn(() => Promise.resolve()),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    sw.options = options;
    return {
      needRefresh: [sw.needRefresh, () => undefined],
      offlineReady: [false, () => undefined],
      updateServiceWorker: sw.update,
    };
  },
}));

function renderUpdate(reload: () => void) {
  return render(
    <I18nProvider lang="fr">
      <ServiceWorkerUpdate reload={reload} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  sw.options = undefined;
  sw.needRefresh = false;
  sw.update.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ServiceWorkerUpdate', () => {
  it('shows nothing until a new version is waiting', () => {
    renderUpdate(vi.fn());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('reloads this window only after its user accepted and the new version took control', async () => {
    sw.needRefresh = true;
    const reload = vi.fn();
    renderUpdate(reload);

    await userEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    expect(sw.update).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    act(() => {
      sw.options?.onNeedReload?.();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when another window accepted the update; keeps the prompt for its own user', async () => {
    sw.needRefresh = true;
    const reload = vi.fn();
    renderUpdate(reload);

    act(() => {
      sw.options?.onNeedReload?.();
    });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Une nouvelle version est prête.');

    // The new version already controls this window: no worker is waiting any more.
    await userEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sw.update).not.toHaveBeenCalled();
  });

  it('logs a failed registration instead of crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderUpdate(vi.fn());

    act(() => {
      sw.options?.onRegisterError?.(new Error('no service worker here'));
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/service worker/i),
      expect.objectContaining({ message: 'no service worker here' }),
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
