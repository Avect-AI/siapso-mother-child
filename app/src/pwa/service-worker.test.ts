// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';
import { createServiceWorkerStore } from './service-worker.js';

type Listener = (event: { isUpdate?: boolean; isExternal?: boolean }) => void;

/** Plays the part of workbox-window: the test sends its events. */
function fakeWorkbox(registered: Promise<unknown> = Promise.resolve({})) {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    register: vi.fn<(options: { immediate: boolean }) => Promise<unknown>>(() => registered),
    messageSkipWaiting: vi.fn(),
    emit(type: string, event: { isUpdate?: boolean; isExternal?: boolean } = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

/** Plays the part of navigator.serviceWorker: the controller of the page, and its change. */
function fakeContainer(controller: unknown = null) {
  const listeners: (() => void)[] = [];
  return {
    controller,
    addEventListener: (_type: 'controllerchange', listener: () => void) => {
      listeners.push(listener);
    },
    takeControl() {
      this.controller = {};
      for (const listener of listeners) listener();
    },
  };
}

/** A store over fakes; `container: undefined` is a browser without service workers. */
function storeWith(
  options: {
    container?: ReturnType<typeof fakeContainer> | undefined;
    workbox?: ReturnType<typeof fakeWorkbox>;
  } = {},
) {
  const container = 'container' in options ? options.container : fakeContainer();
  const workbox = options.workbox ?? fakeWorkbox();
  const onError = vi.fn();
  const store = createServiceWorkerStore({ container, createWorkbox: () => workbox, onError });
  return { store, container, workbox, onError };
}

describe('the service worker', () => {
  it('registers at once, without waiting for the page to finish loading', () => {
    const { store, workbox } = storeWith();
    store.start();
    expect(workbox.register).toHaveBeenCalledWith({ immediate: true });
  });

  it('says to keep the Internet on until the app is kept offline and in control, then that it is ready', () => {
    const { store, container, workbox } = storeWith();
    const seen = vi.fn();
    store.subscribe(seen);
    store.start();
    expect(store.getSnapshot().readiness).toBe('preparing');

    // The precache is complete; the worker takes control of the page just after.
    workbox.emit('installed', { isUpdate: false });
    expect(store.getSnapshot().readiness).toBe('preparing');
    container?.takeControl();

    expect(store.getSnapshot().readiness).toBe('ready');
    expect(seen).toHaveBeenCalled();
  });

  it('is ready after a hard reload too: the page is not controlled, but a worker is active', async () => {
    const { store } = storeWith({ workbox: fakeWorkbox(Promise.resolve({ active: {} })) });
    store.start();
    expect(store.getSnapshot().readiness).toBe('preparing');

    await vi.waitFor(() => {
      expect(store.getSnapshot().readiness).toBe('ready');
    });
  });

  it('is ready at once on a later launch: a worker already controls the page', () => {
    const { store } = storeWith({ container: fakeContainer({}) });
    store.start();
    expect(store.getSnapshot().readiness).toBe('ready');
  });

  it('says so when the browser has no service worker', () => {
    const { store, workbox } = storeWith({ container: undefined });
    store.start();
    expect(store.getSnapshot().readiness).toBe('unsupported');
    expect(workbox.register).not.toHaveBeenCalled();
  });

  it('says so, and logs it, when the registration fails and no worker controls the page', async () => {
    const failure = new Error('no service worker here');
    const { store, onError } = storeWith({ workbox: fakeWorkbox(Promise.reject(failure)) });
    store.start();

    await vi.waitFor(() => {
      expect(store.getSnapshot().readiness).toBe('failed');
    });
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('says so when the first install fails (a network cut, a full phone), until a worker takes control', () => {
    const { store, container, workbox } = storeWith();
    store.start();

    workbox.emit('redundant');
    expect(store.getSnapshot().readiness).toBe('failed');
    container?.takeControl();
    expect(store.getSnapshot().readiness).toBe('ready');
  });

  it('stays ready when an update fails to register: the version in control works offline', async () => {
    const { store } = storeWith({
      container: fakeContainer({}),
      workbox: fakeWorkbox(Promise.reject(new Error('offline'))),
    });
    store.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().readiness).toBe('ready');
  });

  it('offers a new version that waits, takes it only when accepted, and says when it is in control', () => {
    const { store, workbox } = storeWith({ container: fakeContainer({}) });
    store.start();

    workbox.emit('waiting');
    expect(store.getSnapshot()).toMatchObject({ updateWaiting: true, updateInControl: false });
    expect(workbox.messageSkipWaiting).not.toHaveBeenCalled();

    store.acceptUpdate();
    expect(workbox.messageSkipWaiting).toHaveBeenCalledTimes(1);
    workbox.emit('controlling', { isUpdate: true });
    expect(store.getSnapshot()).toMatchObject({ updateInControl: true, readiness: 'ready' });
  });

  it('offers a new version installed from another window', () => {
    const { store, workbox } = storeWith({ container: fakeContainer({}) });
    store.start();
    workbox.emit('installed', { isExternal: true });
    expect(store.getSnapshot().updateWaiting).toBe(true);
  });

  it('starts once', () => {
    const { store, workbox } = storeWith();
    store.start();
    store.start();
    expect(workbox.register).toHaveBeenCalledTimes(1);
  });
});
