// SPDX-License-Identifier: MIT
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/index.js';
import { createServiceWorkerStore } from './service-worker.js';
import { ServiceWorkerUpdate } from './ServiceWorkerUpdate.js';

type Listener = (event: { isUpdate?: boolean }) => void;

/** A store over a fake workbox-window, already in control: the test plays the worker's part. */
function startedStore() {
  const listeners = new Map<string, Listener[]>();
  const workbox = {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    register: () => Promise.resolve({}),
    messageSkipWaiting: vi.fn(),
  };
  const store = createServiceWorkerStore({
    container: { controller: {}, addEventListener: () => undefined },
    createWorkbox: () => workbox,
    onError: () => undefined,
  });
  store.start();
  const emit = (type: string, event: { isUpdate?: boolean } = {}) => {
    act(() => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    });
  };
  return { store, workbox, emit };
}

function renderUpdate(reload: () => void, store = startedStore().store) {
  return render(
    <I18nProvider lang="fr">
      <ServiceWorkerUpdate reload={reload} store={store} />
    </I18nProvider>,
  );
}

describe('ServiceWorkerUpdate', () => {
  it('shows nothing until a new version is waiting', () => {
    renderUpdate(vi.fn());
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('reloads this window only after its user accepted and the new version took control', async () => {
    const { store, workbox, emit } = startedStore();
    const reload = vi.fn();
    renderUpdate(reload, store);
    emit('waiting');

    await userEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    expect(workbox.messageSkipWaiting).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    emit('controlling', { isUpdate: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when another window accepted the update; keeps the prompt for its own user', async () => {
    const { store, workbox, emit } = startedStore();
    const reload = vi.fn();
    renderUpdate(reload, store);
    emit('waiting');

    emit('controlling', { isUpdate: true });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Une nouvelle version est prête.');

    // The new version already controls this window: no worker is waiting any more.
    await userEvent.click(screen.getByRole('button', { name: 'Mettre à jour' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled();
  });
});
