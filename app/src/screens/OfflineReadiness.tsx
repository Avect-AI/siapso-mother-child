// SPDX-License-Identifier: MIT
import { useSyncExternalStore } from 'react';
import { useT, type MessageKey } from '../i18n/index.js';
import {
  serviceWorker,
  type OfflineReadiness as Readiness,
  type ServiceWorkerStore,
} from '../pwa/service-worker.js';
import { storageKeeper, type StorageKeeper } from '../pwa/storage.js';
import { Notice } from '../ui/Notice.js';

function useReadiness(store: ServiceWorkerStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot).readiness;
}

/**
 * What to say while the app is not ready to open without the Internet, with
 * what to do: keep the Internet on, turn it back on, open the app again with
 * it, or open it in Chrome. Null once it is ready.
 */
function notReady(readiness: Readiness, online: boolean): MessageKey | null {
  if (readiness === 'ready') return null;
  if (readiness === 'preparing') return online ? 'offline.preparing' : 'offline.reconnect';
  return readiness === 'failed' ? 'offline.failed' : 'offline.unsupported';
}

/**
 * On Home and the list of profiles: whether the phone would open the app now
 * without the Internet. Until it would, a notice says why and what to do; then
 * one quiet line says it is ready. A live region, so the change is said when
 * it comes. It sits after the screen's actions: the primary action follows
 * the question, and a notice never comes between them.
 */
export function OfflineReadiness({
  online,
  store = serviceWorker,
}: {
  online: boolean;
  store?: ServiceWorkerStore;
}) {
  const t = useT();
  const message = notReady(useReadiness(store), online);
  return (
    <div className="offline-ready" role="status">
      {message === null ? (
        <p className="meta">{t('offline.ready')}</p>
      ) : (
        <Notice>{t(message)}</Notice>
      )}
    </div>
  );
}

/**
 * On the status screen: whether the phone is ready without the Internet, and
 * whether the browser keeps the app's data for good or may evict it when the
 * phone runs short of space (nothing when the browser does not say).
 */
export function PhoneFacts({
  online,
  store = serviceWorker,
  keeper = storageKeeper,
}: {
  online: boolean;
  store?: ServiceWorkerStore;
  keeper?: StorageKeeper;
}) {
  const t = useT();
  const message = notReady(useReadiness(store), online);
  const persistence = useSyncExternalStore(keeper.subscribe, keeper.getSnapshot);
  return (
    <section className="status__phone" aria-labelledby="status-phone">
      <h2 id="status-phone">{t('offline.phoneTitle')}</h2>
      <div role="status">
        {message === null ? <p>{t('offline.ready')}</p> : <Notice>{t(message)}</Notice>}
      </div>
      {persistence === 'persistent' ? <p>{t('offline.persistent')}</p> : null}
      {persistence === 'best-effort' ? <Notice>{t('offline.bestEffort')}</Notice> : null}
    </section>
  );
}
