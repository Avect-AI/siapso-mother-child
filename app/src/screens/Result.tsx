// SPDX-License-Identifier: MIT
import { evaluate, type Evaluation } from '@siapso/engine';
import { useEffect, useMemo, useState } from 'react';
import { Redirect } from 'wouter';
import { getProfile } from '../data/profiles.js';
import { contextFromProfile } from '../domain/context.js';
import { todayIso } from '../domain/dates.js';
import { displayOf } from '../domain/search-index.js';
import type { Profile } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { LevelBadge } from '../ui/LevelBadge.js';
import { Notice } from '../ui/Notice.js';

type Loaded = { status: 'loading' } | { status: 'ready'; profile: Profile } | { status: 'failed' };

/**
 * Result, minimal for now (Task 12, SCRUM-25, builds the full screen): the
 * engine evaluates the confirmed items for the check's profile, and the
 * screen shows the overall level, its pictogram and its name, then the items
 * looked at. Without a check in progress it goes back to the check.
 */
export function Result() {
  const t = useT();
  const lang = useLang();
  const { pack, packError, storageTimeoutMs } = useApp();
  const check = useCheck();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const { profileId, items, signs } = check;

  useEffect(() => {
    if (profileId === null) return;
    let live = true;
    withTimeout(getProfile(profileId), storageTimeoutMs).then(
      (profile) => {
        if (live) setLoaded(profile ? { status: 'ready', profile } : { status: 'failed' });
      },
      (failure: unknown) => {
        console.warn('Profile not read on this device', failure);
        if (live) setLoaded({ status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [profileId, storageTimeoutMs]);

  const evaluation = useMemo((): Evaluation | 'failed' | null => {
    if (pack === null || loaded.status !== 'ready') return null;
    try {
      // Today from the phone's clock, handed to pure code.
      return evaluate(
        pack,
        contextFromProfile(loaded.profile, { items, signs }, todayIso(new Date())),
      );
    } catch (failure) {
      console.warn('The check could not be evaluated', failure);
      return 'failed';
    }
  }, [pack, loaded, items, signs]);

  if (profileId === null || items.length === 0) return <Redirect to="/check" replace />;

  return (
    <main className="screen result">
      <h1 tabIndex={-1}>{t('result.title')}</h1>
      {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}
      {loaded.status === 'failed' || evaluation === 'failed' ? (
        <Notice>{t('result.failed')}</Notice>
      ) : null}
      {evaluation === null || evaluation === 'failed' ? null : (
        <>
          <LevelBadge level={evaluation.level} label={t(`level.${evaluation.level}`)} />
          <ul className="result__items" aria-label={t('result.items')}>
            {items.map((item, index) => (
              <li key={index}>
                {pack === null
                  ? null
                  : displayOf(pack, item.ref, lang, item.strengthUnknown === true).name}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
