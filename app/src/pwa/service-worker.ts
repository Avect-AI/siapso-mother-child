// SPDX-License-Identifier: MIT
// The service worker keeps the app and the knowledge pack on the phone, so it
// opens without the Internet. It is registered as early as possible: from
// main.tsx, before the first render and the pack's download, with
// workbox-window bundled in the app (no extra download first), and without
// waiting for the page's load event. Its first install claims the page
// (clientsClaim in vite.config.ts), so the page is in its control as soon as
// the precache is complete.
//
// The readiness says whether the app would open now without the Internet:
// 'ready' once a worker controls the page, or is active for it (after a hard
// reload the page is not in its control); a worker is active only after its
// install, the whole precache, succeeded. 'preparing' until then,
// 'failed' when the registration or the first install failed with none in
// control (a network cut, a full phone: the next start with the Internet
// tries again), and 'unsupported' when the browser has no service worker (an
// in-app browser). Home and the status screen show it, so nobody goes home
// without the network before the phone is ready.
//
// An update installs in the background and waits: the user is asked
// (ServiceWorkerUpdate), and the new version takes over only when accepted,
// here or in another window.
import { Workbox } from 'workbox-window';

export type OfflineReadiness = 'unsupported' | 'failed' | 'preparing' | 'ready';

export interface ServiceWorkerState {
  readiness: OfflineReadiness;
  /** A new version is installed and waits for the user. */
  updateWaiting: boolean;
  /** A new version took control of this window (accepted here or in another window). */
  updateInControl: boolean;
}

/** What the store uses of navigator.serviceWorker. */
interface ContainerLike {
  readonly controller: unknown;
  addEventListener: (type: 'controllerchange', listener: () => void) => void;
}

interface WorkboxEventLike {
  isUpdate?: boolean | undefined;
  isExternal?: boolean | undefined;
}

/** What the store uses of workbox-window's Workbox. */
interface WorkboxLike {
  addEventListener: (
    type: 'installed' | 'waiting' | 'controlling' | 'activated' | 'redundant',
    listener: (event: WorkboxEventLike) => void,
  ) => void;
  register: (options: { immediate: boolean }) => Promise<unknown>;
  messageSkipWaiting: () => void;
  /** Sends `data` to the worker and resolves with its answer. */
  messageSW: (data: object) => Promise<unknown>;
}

export interface ServiceWorkerStore {
  /** Registers the worker, once. */
  start: () => void;
  getSnapshot: () => ServiceWorkerState;
  subscribe: (listener: () => void) => () => void;
  /** The user asked for the new version: the waiting worker takes over. */
  acceptUpdate: () => void;
  /**
   * Once a voice is installed (pwa/sw-setup.ts): asks the worker in control
   * of this page to keep `url`, the speech worker script this page runs (a
   * worker waiting with an update, or one whose update failed, would keep
   * another file, or none), and the registered worker, waiting or installing,
   * to keep its own build's script, so the next version has it too. True when
   * the worker in control (or, with none yet, the registered one) kept it.
   */
  cacheVoiceWorker: (url: string) => Promise<boolean>;
  /** Asks the worker to drop the speech worker's script, once the voice is removed. */
  dropVoiceWorker: () => Promise<boolean>;
}

/** How long the worker has to answer a message about the speech worker's script. */
const MESSAGE_TIMEOUT_MS = 30_000;

export function createServiceWorkerStore({
  container,
  createWorkbox,
  onError,
}: {
  /** navigator.serviceWorker; undefined when the browser has none. */
  container: ContainerLike | undefined;
  createWorkbox: () => WorkboxLike;
  onError: (error: unknown) => void;
}): ServiceWorkerStore {
  /**
   * A worker is active for this scope though the page is not in its control
   * (a hard reload bypasses the worker): its precache is complete, so the
   * app opens offline at the next start.
   */
  let active = false;
  const readinessNow = (): OfflineReadiness => {
    if (container === undefined) return 'unsupported';
    return container.controller || active ? 'ready' : 'preparing';
  };
  let state: ServiceWorkerState = {
    readiness: readinessNow(),
    updateWaiting: false,
    updateInControl: false,
  };
  const listeners = new Set<() => void>();
  let workbox: WorkboxLike | null = null;

  const change = (patch: Partial<ServiceWorkerState>) => {
    const next = { ...state, ...patch };
    if (
      next.readiness === state.readiness &&
      next.updateWaiting === state.updateWaiting &&
      next.updateInControl === state.updateInControl
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    start() {
      if (workbox !== null || container === undefined) return;
      const registering = createWorkbox();
      workbox = registering;
      container.addEventListener('controllerchange', () => {
        change({ readiness: readinessNow() });
      });
      registering.addEventListener('waiting', () => {
        change({ updateWaiting: true });
      });
      registering.addEventListener('installed', (event) => {
        // A new version found by another window: it waits for the user too.
        if (event.isUpdate === undefined && event.isExternal === true) {
          change({ updateWaiting: true });
        }
      });
      registering.addEventListener('controlling', (event) => {
        change({
          readiness: readinessNow(),
          ...(event.isUpdate === true ? { updateInControl: true } : {}),
        });
      });
      // The install failed (a file of the precache could not be fetched).
      // A version already in control still opens offline.
      registering.addEventListener('redundant', () => {
        if (readinessNow() !== 'ready') change({ readiness: 'failed' });
      });
      registering.addEventListener('activated', () => {
        active = true;
        change({ readiness: readinessNow() });
      });
      registering.register({ immediate: true }).then(
        (registration) => {
          if (typeof registration === 'object' && registration !== null) {
            active ||= Boolean((registration as { active?: unknown }).active);
          }
          change({ readiness: readinessNow() });
        },
        (error: unknown) => {
          onError(error);
          if (readinessNow() !== 'ready') change({ readiness: 'failed' });
        },
      );
      change({ readiness: readinessNow() });
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    acceptUpdate() {
      workbox?.messageSkipWaiting();
    },
    cacheVoiceWorker(url) {
      if (workbox === null) return Promise.resolve(false);
      const message = { type: 'CACHE_VOICE_WORKER' };
      const controller = container?.controller;
      if (!canMessage(controller)) return ask({ ...message, url });
      // The next version keeps its own script; nobody waits for it (it may never answer).
      void ask(message);
      return askController(controller, { ...message, url });
    },
    dropVoiceWorker() {
      const controller = container?.controller;
      if (workbox !== null && canMessage(controller)) {
        return askController(controller, { type: 'DROP_VOICE_WORKER' });
      }
      return ask({ type: 'DROP_VOICE_WORKER' });
    },
  };

  /** Sends a message to the registered worker (waiting, installing or active): true when it did it. */
  function ask(message: object): Promise<boolean> {
    if (workbox === null) return Promise.resolve(false);
    return inTime(workbox.messageSW(message).then(isDone, () => false));
  }

  /** Sends a message to the worker in control of this page, on a channel of its own. */
  function askController(controller: MessageTarget, message: object): Promise<boolean> {
    const channel = new MessageChannel();
    const answered = new Promise<boolean>((resolve) => {
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        resolve(isDone(event.data));
      };
    });
    try {
      controller.postMessage(message, [channel.port2]);
    } catch {
      return Promise.resolve(false);
    }
    return inTime(answered).finally(() => {
      channel.port1.close();
    });
  }
}

/** A worker that can be sent a message with a port. */
interface MessageTarget {
  postMessage: (message: unknown, transfer: MessagePort[]) => void;
}

function canMessage(worker: unknown): worker is MessageTarget {
  return (
    typeof worker === 'object' &&
    worker !== null &&
    'postMessage' in worker &&
    typeof worker.postMessage === 'function'
  );
}

/** The worker's answer says it did it. */
function isDone(answer: unknown): boolean {
  return typeof answer === 'object' && answer !== null && 'ok' in answer && answer.ok === true;
}

/** `answer`, or false after MESSAGE_TIMEOUT_MS. */
function inTime(answer: Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, MESSAGE_TIMEOUT_MS);
  });
  return Promise.race([answer, late]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * The app's service worker: the worker vite-plugin-pwa generates, at the
 * app's base. A development server has none (vite-plugin-pwa builds it).
 */
export const serviceWorker = createServiceWorkerStore({
  container:
    import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : undefined,
  createWorkbox: () =>
    new Workbox(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }),
  onError: (error) => {
    console.warn('Service worker registration failed: the app works, but not offline', error);
  },
});
