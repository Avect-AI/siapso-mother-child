// SPDX-License-Identifier: MIT
import { Fragment, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { listProfiles } from '../data/profiles.js';
import { todayIso } from '../domain/dates.js';
import { needsUpdate, profileSummary } from '../domain/profile-summary.js';
import type { Profile } from '../domain/types.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { WarningMark } from '../ui/WarningMark.js';
import { editEntry, PROFILE_EDIT_PATH } from './edit-route.js';
import { OfflineReadiness } from './OfflineReadiness.js';
import { profileNoteText, useProfileNote } from './saved-note.js';

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; profiles: Profile[]; today: string }
  | { status: 'failed' };

/** Status lines said in ink with the triangle: something to do on the profile. */
const MARKED: readonly MessageKey[] = ['profileStatus.outdated', 'profileStatus.mayBeBorn'];

/**
 * Accompanied mode, once the code is given: the women followed, by pseudonym
 * only, in the order of their pseudonyms (Femme 2 before Femme 10), each with
 * where she stands in plain words (the term used and the baby's age, "to be
 * updated" when her term is past 42 weeks, "to confirm" when the baby may be
 * born), so the right woman is picked. Tapping a pseudonym opens the check for
 * her; "Modifier" opens her profile ("Mettre à jour" when there is something
 * to update or confirm). The one primary action adds a profile. Rendered only
 * while the session is open (App.tsx): no pseudonym is ever on screen behind
 * the code.
 */
export function Profiles() {
  const t = useT();
  const lang = useLang();
  const { storageTimeoutMs, pack, online } = useApp();
  const { start } = useCheck();
  const [, navigate] = useLocation();
  const note = useProfileNote();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    withTimeout(listProfiles(), storageTimeoutMs).then(
      (profiles) => {
        // Today from the phone's clock, handed to pure code.
        if (live) setLoaded({ status: 'ready', profiles, today: todayIso(new Date()) });
      },
      (failure: unknown) => {
        console.warn('Profiles not read on this device', failure);
        if (live) setLoaded({ status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [storageTimeoutMs]);

  const collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });
  const profiles =
    loaded.status === 'ready'
      ? [...loaded.profiles].sort((a, b) => collator.compare(a.pseudonym, b.pseudonym))
      : [];

  return (
    <main className="screen profiles">
      <div className="profiles__intro">
        <h1 tabIndex={-1}>{t('profiles.title')}</h1>
        <p>{t('profiles.lead')}</p>
      </div>
      {note === null ? null : (
        <p className="home__saved" role="status">
          {profileNoteText(note, t)}
        </p>
      )}
      {loaded.status === 'loading' ? (
        <p className="meta" role="status">
          {t('profiles.loading')}
        </p>
      ) : null}
      {loaded.status === 'failed' ? <Notice>{t('profile.loadFailed')}</Notice> : null}
      {loaded.status === 'ready' && profiles.length === 0 ? (
        <p className="profiles__empty">{t('profiles.empty')}</p>
      ) : null}
      {profiles.length === 0 ? null : (
        <ul className="profiles__list" aria-label={t('profiles.listLabel')}>
          {profiles.map((profile) => {
            const today = loaded.status === 'ready' ? loaded.today : null;
            // To update (outdated) or to confirm (the baby may be born): the link says so.
            const update = today !== null && needsUpdate(profile, today, pack?.date);
            return (
              <li key={profile.id} className="profiles__row">
                <Button
                  variant="secondary"
                  className="profiles__open"
                  onClick={() => {
                    start(profile.id);
                    navigate('/check');
                  }}
                >
                  <span className="profiles__label">
                    <span className="profiles__name">{profile.pseudonym}</span>
                    {today === null
                      ? null
                      : profileSummary(profile, today, pack?.date).map((line) => (
                          // The space between the lines keeps the words apart when read aloud.
                          <Fragment key={line.key}>
                            {' '}
                            {MARKED.includes(line.key) ? (
                              <span className="profiles__status profiles__status--update">
                                <WarningMark />
                                {t(line.key, line.vars)}
                              </span>
                            ) : (
                              <span className="profiles__status">{t(line.key, line.vars)}</span>
                            )}
                          </Fragment>
                        ))}
                  </span>
                </Button>
                {/* Her id goes in the entry's state, never in the address (edit-route.ts). */}
                <a
                  className="button button--quiet profiles__edit"
                  href={`#${PROFILE_EDIT_PATH}`}
                  aria-label={t(update ? 'profiles.updateNamed' : 'profiles.editNamed', {
                    name: profile.pseudonym,
                  })}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(PROFILE_EDIT_PATH, { state: editEntry(profile.id) });
                  }}
                >
                  {t(update ? 'profiles.update' : 'profiles.edit')}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        variant="primary"
        className="profiles__add"
        onClick={() => {
          navigate('/profile/new');
        }}
      >
        {t('profiles.add')}
      </Button>
      <OfflineReadiness online={online} />
      <a className="button button--quiet profiles__settings" href="#/settings">
        {t('home.settings')}
      </a>
      <a className="button button--quiet profiles__settings" href="#/status">
        {t('nav.status')}
      </a>
      <a className="button button--quiet profiles__settings" href="#/about">
        {t('nav.about')}
      </a>
    </main>
  );
}
