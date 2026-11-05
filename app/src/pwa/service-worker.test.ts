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
    messageSW: vi.fn<(data: object) => Promise<unknown>>(() => Promise.resolve({ ok: true })),
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

/** A worker in control that answers on the port it is given, or never. */
function answeringController(answer: unknown = { ok: true }) {
  return {
    postMessage: vi.fn((_message: unknown, ports: MessagePort[]) => {
      if (answer !== undefined) ports[0]?.postMessage(answer);
    }),
  };
}

const SCRIPT = 'https://app.test/assets/worker-Ab1.js';

describe('the speech worker script', () => {
  it('is kept by the worker in control, the very script the page runs, and by the next version', async () => {
    const container = fakeContainer(answeringController());
    const { store, workbox } = storeWith({ container });
    store.start();
    expect(await store.cacheVoiceWorker(SCRIPT)).toBe(true);
    expect(
      (container.controller as ReturnType<typeof answeringController>).postMessage,
    ).toHaveBeenCalledWith({ type: 'CACHE_VOICE_WORKER', url: SCRIPT }, [expect.any(MessagePort)]);
    // The waiting or installing worker, if any, keeps its own build's script.
    expect(workbox.messageSW).toHaveBeenCalledWith({ type: 'CACHE_VOICE_WORKER' });
  });

  it('does not wait for a waiting worker that never answers (a failed update)', async () => {
    const container = fakeContainer(answeringController());
    const silent = fakeWorkbox();
    silent.messageSW.mockReturnValue(new Promise(() => undefined));
    const { store } = storeWith({ container, workbox: silent });
    store.start();
    expect(await store.cacheVoiceWorker(SCRIPT)).toBe(true);
  });

  it('asks the registered worker when none is in control yet (the first visit)', async () => {
    const { store, workbox } = storeWith({ container: fakeContainer(null) });
    store.start();
    expect(await store.cacheVoiceWorker(SCRIPT)).toBe(true);
    expect(workbox.messageSW).toHaveBeenCalledWith({ type: 'CACHE_VOICE_WORKER', url: SCRIPT });
  });

  it('says when the worker in control could not keep it', async () => {
    const { store } = storeWith({ container: fakeContainer(answeringController({ ok: false })) });
    store.start();
    expect(await store.cacheVoiceWorker(SCRIPT)).toBe(false);
  });

  it('is dropped by the worker when the voice is removed', async () => {
    const { store, workbox } = storeWith();
    store.start();
    expect(await store.dropVoiceWorker()).toBe(true);
    expect(workbox.messageSW).toHaveBeenCalledWith({ type: 'DROP_VOICE_WORKER' });
  });

  it('says when the worker could not, or did not answer in time', async () => {
    const failing = fakeWorkbox();
    failing.messageSW.mockResolvedValueOnce({ ok: false });
    const { store } = storeWith({ workbox: failing, container: fakeContainer(null) });
    store.start();
    expect(await store.cacheVoiceWorker(SCRIPT)).toBe(false);

    vi.useFakeTimers();
    try {
      failing.messageSW.mockReturnValueOnce(new Promise(() => undefined));
      const silent = store.cacheVoiceWorker(SCRIPT);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await silent).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not asked for without a service worker', async () => {
    const { store } = storeWith({ container: undefined });
    store.start();
    expect(await store.cacheVoiceWorker(SCRIPT)).toBe(false);
    expect(await store.dropVoiceWorker()).toBe(false);
  });
});
