// SPDX-License-Identifier: MIT
import type { Pack } from '@siapso/engine';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { PackFallback } from '../data/pack-loader.js';
import { formatDate, isIsoDate, todayIso } from '../domain/dates.js';
import { isStale } from '../domain/staleness.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { PhoneFacts } from './OfflineReadiness.js';

/** What the source section says about the stored copy, by the reason it is used. */
const FALLBACK_TEXT: Record<PackFallback, MessageKey> = {
  offline: 'status.fallback',
  refused: 'status.fallbackRefused',
  'rolled-back': 'status.rolledBack',
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Going back to the previous version kept on the phone (accompanied mode,
 * once the code is given): one secondary button, then a confirmation that
 * says what changes. The new state shows at once, without a reload.
 */
function Rollback({ current, previous }: { current: string; previous: string }) {
  const t = useT();
  const { rollbackPack } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);

  return (
    <section className="status__rollback" aria-labelledby="status-rollback">
      <h2 id="status-rollback">{t('status.rollbackTitle')}</h2>
      <p>{t('status.rollbackLead', { version: previous })}</p>
      {confirming ? (
        <div className="status__confirm">
          <p ref={confirmRef} tabIndex={-1}>
            {t('status.rollbackConfirm', { current, previous })}
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailure(null);
              rollbackPack().then(
                () => {
                  document.querySelector<HTMLElement>('.status h1')?.focus();
                },
                (error: unknown) => {
                  setFailure(messageOf(error));
                  setConfirming(false);
                  setBusy(false);
                },
              );
            }}
          >
            {t('status.rollbackYes', { version: previous })}
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t('status.rollbackCancel')}
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            setConfirming(true);
            setFailure(null);
            // The question takes the focus, so it is read before the answers.
            requestAnimationFrame(() => confirmRef.current?.focus());
          }}
        >
          {t('status.rollbackAction', { version: previous })}
        </Button>
      )}
      {failure === null ? null : (
        <>
          <Notice>{t('status.rollbackFailed')}</Notice>
          <p className="status__reason">{t('status.reason', { reason: failure })}</p>
        </>
      )}
    </section>
  );
}

/**
 * The knowledge base: its version and date, what it holds, whether it is out
 * of date (strictly more than 90 days between the pack date and the phone's
 * date), where this copy came from (and, in accompanied mode, the technical
 * reason when an update was not used), and a line when it is an unsigned
 * test base. Nothing here is about a profile, so it opens locked or not; going
 * back to the previous version is offered in accompanied mode once the code
 * is given. The one primary action goes back to the start.
 */
export function Status() {
  const t = useT();
  const lang = useLang();
  const {
    settings,
    pack,
    packError,
    packSource,
    packFallbackReason,
    packFallback,
    packStoreError,
    packOrigin,
    readPackPrevious,
    acceptsUnsigned,
    online,
  } = useApp();
  const { unlocked } = useSession();
  const [, navigate] = useLocation();
  const accompanied = settings.mode === 'accompanied';
  // The previous version is read here only, when the rollback can be offered
  // (accompanied mode, code given), and again for each new pack: a value read
  // for another pack is never shown.
  const [read, setRead] = useState<{ pack: Pack; version: string | null } | null>(null);
  const offered = accompanied && unlocked;
  useEffect(() => {
    if (!offered || pack === null) return;
    let live = true;
    readPackPrevious().then(
      (version) => {
        if (live) setRead({ pack, version });
      },
      () => {
        if (live) setRead({ pack, version: null });
      },
    );
    return () => {
      live = false;
    };
  }, [offered, pack, readPackPrevious]);
  const previous = offered && read !== null && read.pack === pack ? read.version : null;

  return (
    <main className="screen status">
      <div className="status__intro">
        <h1 tabIndex={-1}>{t('status.title')}</h1>
        <p>{t('status.lead')}</p>
      </div>
      {/* Shown in every build that accepts unsigned packs, so a demo build is never
          taken for a release, and for any unsigned base. */}
      {acceptsUnsigned || packOrigin?.signed === false ? (
        <p className="status__unsigned">{t('status.unsigned')}</p>
      ) : null}
      {pack === null ? (
        packError === null ? (
          <p className="meta" role="status">
            {t('status.loading')}
          </p>
        ) : (
          <Notice>{t('status.unavailable')}</Notice>
        )
      ) : (
        <>
          {isStale(pack.date, todayIso(new Date())) ? <Notice>{t('status.stale')}</Notice> : null}
          {/* The counts are the pack collections as built: the pack format has no
              retired entries, so every rule, product and plant in it is current. */}
          <ul className="facts" aria-label={t('status.contentLabel')}>
            <li>
              <span>{t('status.version')}</span>
              <strong>{pack.version}</strong>
            </li>
            <li>
              <span>{t('status.date')}</span>
              {/* Written as on the result: one date format in each language. */}
              <strong>
                {isIsoDate(pack.date) ? formatDate(pack.date, lang) : t('status.dateUnknown')}
              </strong>
            </li>
            <li>
              <span>{t('status.rules')}</span>
              <strong>{pack.rules.length}</strong>
            </li>
            <li>
              <span>{t('status.products')}</span>
              <strong>{pack.products.length}</strong>
            </li>
            <li>
              <span>{t('status.remedies')}</span>
              <strong>{pack.plants.length}</strong>
            </li>
          </ul>
          {pack.clinicallyValidated ? null : (
            <p className="status__not-validated">{t('result.notValidated')}</p>
          )}
          <section className="status__source" aria-labelledby="status-source">
            <h2 id="status-source">{t('status.sourceTitle')}</h2>
            <p>{packSource === 'cache' ? t('status.fromCopy') : t('status.fromNetwork')}</p>
            {packFallback !== null ? (
              <p>{t(FALLBACK_TEXT[packFallback])}</p>
            ) : packFallbackReason === null ? null : (
              <p>{t('status.fallback')}</p>
            )}
            {accompanied && packFallbackReason !== null ? (
              <p className="status__reason">{t('status.reason', { reason: packFallbackReason })}</p>
            ) : null}
            {packStoreError === null ? null : <Notice>{t('status.notStored')}</Notice>}
          </section>
          {accompanied && unlocked && previous !== null ? (
            <Rollback current={pack.version} previous={previous} />
          ) : null}
        </>
      )}
      <PhoneFacts online={online} />
      <a className="button button--secondary status__about" href="#/about">
        {t('nav.about')}
      </a>
      <Button
        variant="primary"
        className="status__done"
        onClick={() => {
          navigate('/');
        }}
      >
        {t('settings.done')}
      </Button>
    </main>
  );
}
