// SPDX-License-Identifier: MIT
import { useLocation } from 'wouter';
import { isIsoDate, todayIso } from '../domain/dates.js';
import { isStale } from '../domain/staleness.js';
import { useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';

/**
 * The knowledge base: its version and date, what it holds, whether it is out
 * of date (strictly more than 90 days between the pack date and the phone's
 * date), and where this copy came from. Nothing here is about a profile, so
 * it opens locked or not. The one primary action goes back to the start.
 */
export function Status() {
  const t = useT();
  const { pack, packError, packSource, packFallbackReason, packStoreError } = useApp();
  const [, navigate] = useLocation();

  return (
    <main className="screen status">
      <div className="status__intro">
        <h1 tabIndex={-1}>{t('status.title')}</h1>
        <p>{t('status.lead')}</p>
      </div>
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
              <strong>{isIsoDate(pack.date) ? pack.date : t('status.dateUnknown')}</strong>
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
            {packFallbackReason === null ? null : <p>{t('status.fallback')}</p>}
            {packStoreError === null ? null : <Notice>{t('status.notStored')}</Notice>}
          </section>
        </>
      )}
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
