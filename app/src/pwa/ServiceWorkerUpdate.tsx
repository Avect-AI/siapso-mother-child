// SPDX-License-Identifier: MIT
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useT } from '../i18n/index.js';
import { UpdatePrompt } from '../ui/UpdatePrompt.js';
import { serviceWorker, type ServiceWorkerStore } from './service-worker.js';

function reloadPage(): void {
  window.location.reload();
}

/**
 * Offers an update when a new version is waiting (the service worker is
 * registered by main.tsx, see service-worker.ts). A window reloads only when
 * its own user accepted: when the update is accepted in another window, the
 * new version takes control here too, but this window keeps its prompt (and
 * whatever the user is doing) until its user asks.
 */
export function ServiceWorkerUpdate({
  reload = reloadPage,
  store = serviceWorker,
}: {
  reload?: () => void;
  store?: ServiceWorkerStore;
}) {
  const t = useT();
  const { updateWaiting, updateInControl } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  );
  /** This window's user asked for the new version. */
  const accepted = useRef(false);

  useEffect(() => {
    if (updateInControl && accepted.current) reload();
  }, [updateInControl, reload]);

  const onReload = () => {
    accepted.current = true;
    // No worker is waiting any more once another window let it take over.
    if (updateInControl) reload();
    else store.acceptUpdate();
  };

  return (
    <UpdatePrompt
      open={updateWaiting || updateInControl}
      message={t('update.ready')}
      action={t('update.reload')}
      onReload={onReload}
    />
  );
}
