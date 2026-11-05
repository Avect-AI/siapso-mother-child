// SPDX-License-Identifier: MIT
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n/index.js';
import { createServiceWorkerStore, type ServiceWorkerStore } from '../pwa/service-worker.js';
import { createStorageKeeper } from '../pwa/storage.js';
import { OfflineReadiness, PhoneFacts } from './OfflineReadiness.js';

/** A store whose worker takes control when the test says so. */
function store(controller: unknown = null) {
  const listeners: (() => void)[] = [];
  const container = {
    controller,
    addEventListener: (_type: 'controllerchange', listener: () => void) => {
      listeners.push(listener);
    },
  };
  const created = createServiceWorkerStore({
    container,
    createWorkbox: () => ({
      addEventListener: () => undefined,
      register: () => Promise.resolve({}),
      messageSkipWaiting: () => undefined,
      messageSW: () => Promise.resolve({ ok: true }),
    }),
    onError: () => undefined,
  });
  created.start();
  return {
    store: created,
    takeControl: () => {
      act(() => {
        container.controller = {};
        for (const listener of listeners) listener();
      });
    },
  };
}

const unsupported = createServiceWorkerStore({
  container: undefined,
  createWorkbox: () => {
    throw new Error('never registered');
  },
  onError: () => undefined,
});

const failing = createServiceWorkerStore({
  container: { controller: null, addEventListener: () => undefined },
  createWorkbox: () => ({
    addEventListener: () => undefined,
    register: () => Promise.reject(new Error('a precache file could not be fetched')),
    messageSkipWaiting: () => undefined,
    messageSW: () => Promise.resolve({ ok: true }),
  }),
  onError: () => undefined,
});

function renderLine(lang: 'fr' | 'en', readiness: ServiceWorkerStore, online = true) {
  return render(
    <I18nProvider lang={lang}>
      <OfflineReadiness store={readiness} online={online} />
    </I18nProvider>,
  );
}

describe('OfflineReadiness', () => {
  it('asks to keep the Internet on while the app gets ready, then says it is ready', () => {
    const { store: preparing, takeControl } = store();
    renderLine('fr', preparing);

    const line = screen.getByRole('status');
    // Testing Library reads the no-break space before ":" as a plain space.
    expect(line).toHaveTextContent(
      "Gardez Internet encore un moment : l'application se prépare pour fonctionner sans réseau.",
    );
    takeControl();
    expect(line).toHaveTextContent('Prêt sans Internet');
  });

  it('asks to turn the Internet back on when it went off before the app was ready', () => {
    renderLine('en', store().store, false);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Turn the Internet back on: the app has not finished getting ready to work without a network.',
    );
  });

  it('says when the browser cannot keep the app, and what to do', () => {
    renderLine('en', unsupported);
    expect(screen.getByRole('status')).toHaveTextContent(
      'This browser cannot keep the app to open it without the Internet. Open it in Chrome.',
    );
  });

  it('says when the app could not get ready, and what to do', async () => {
    failing.start();
    renderLine('en', failing);
    expect(
      await screen.findByText(
        'The app could not get ready to work without a network. Open it again with the Internet.',
      ),
    ).toBeVisible();
  });
});

describe('PhoneFacts', () => {
  it('says whether the phone is ready offline and whether its data may be evicted', async () => {
    const keeper = createStorageKeeper(() => ({
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(false),
    }));
    await keeper.keep();
    render(
      <I18nProvider lang="en">
        <PhoneFacts store={store({}).store} keeper={keeper} online />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'On this phone' })).toBeVisible();
    expect(screen.getByText('Ready without the Internet')).toBeVisible();
    // With what helps: Chrome keeps the data of an installed app more readily.
    expect(
      screen.getByText(
        'The data may be erased if the phone runs short of space. Add the app to the home screen to help the phone keep it.',
      ),
    ).toBeVisible();
  });

  it('says when the data is kept for good, and when the browser cannot keep the app', async () => {
    const keeper = createStorageKeeper(() => ({
      persisted: () => Promise.resolve(true),
      persist: () => Promise.resolve(true),
    }));
    await keeper.keep();
    render(
      <I18nProvider lang="en">
        <PhoneFacts store={unsupported} keeper={keeper} online />
      </I18nProvider>,
    );

    expect(screen.getByText("This phone keeps the app's data.")).toBeVisible();
    expect(
      screen.getByText(
        'This browser cannot keep the app to open it without the Internet. Open it in Chrome.',
      ),
    ).toBeVisible();
  });
});
