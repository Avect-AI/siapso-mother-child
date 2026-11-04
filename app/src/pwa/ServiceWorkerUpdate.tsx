// SPDX-License-Identifier: MIT
import { useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useT } from '../i18n/index.js';
import { UpdatePrompt } from '../ui/UpdatePrompt.js';

function reloadPage(): void {
  window.location.reload();
}

/**
 * Registers the service worker (it precaches the app and the knowledge pack)
 * and offers an update when a new version is waiting. A window reloads only
 * when its own user accepted: when the update is accepted in another window,
 * the new version takes control here too, but this window keeps its prompt
 * (and whatever the user is doing) until its user asks.
 */
export function ServiceWorkerUpdate({ reload = reloadPage }: { reload?: () => void }) {
  const t = useT();
  /** This window's user asked for the new version. */
  const accepted = useRef(false);
  /** The new version already controls this window (accepted in another one). */
  const inControl = useRef(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload() {
      if (accepted.current) reload();
      else inControl.current = true;
    },
    onRegisterError(error: unknown) {
      console.warn('Service worker registration failed: the app works, but not offline', error);
    },
  });

  const onReload = () => {
    accepted.current = true;
    // No worker is waiting any more once another window let it take over.
    if (inControl.current) reload();
    else void updateServiceWorker(true);
  };

  return (
    <UpdatePrompt
      open={needRefresh}
      message={t('update.ready')}
      action={t('update.reload')}
      onReload={onReload}
    />
  );
}
