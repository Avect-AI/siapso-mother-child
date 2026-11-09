// SPDX-License-Identifier: MIT
import { Fragment, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { listProfiles } from '../data/profiles.js';
import { todayIso } from '../domain/dates.js';
import { pseudonymKey } from '../domain/profile-form.js';
import { needsUpdate, profileSummary } from '../domain/profile-summary.js';
import type { Profile } from '../domain/types.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { useCheck } from '../state/check-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { useLiveRegionReady } from '../ui/live-region.js';
import { Notice } from '../ui/Notice.js';
import { TextField } from '../ui/TextField.js';
import { WarningMark } from '../ui/WarningMark.js';
import { editEntry, PROFILE_EDIT_PATH, QUICK_PATH } from './edit-route.js';
import { OfflineReadiness } from './OfflineReadiness.js';
import { profileNoteText, useProfileNote } from './saved-note.js';

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; profiles: Profile[]; today: string }
  | { status: 'failed' };

/** Status lines said in ink with the triangle: something to do on the profile. */
const MARKED: readonly MessageKey[] = ['profileStatus.outdated', 'profileStatus.mayBeBorn'];

/** From this many profiles on, a field finds a woman by her pseudonym: the list is long to scroll. */
export const SEARCH_FROM = 9;

/**
 * Accompanied mode, once the code is given: first the actions, "Ajouter un
 * profil" (the one primary action) and "Regarder sans enregistrer" (a
 * passer-by checked with no profile kept), so they are in reach whatever the
 * length of the list; then, from 9 profiles on, a field that finds a woman by
 * a part of her pseudonym (without case or accents); then the women
 * followed, by pseudonym only, in the order of their pseudonyms (Femme 2
 * before Femme 10), each with where she stands in plain words (the term used
 * and the baby's age, "to be updated" when her term is past 42 weeks, "to
 * confirm" when the baby may be born) and the list left unfinished for her
 * during this visit, so the right woman is picked. Tapping a pseudonym opens
 * the check for her, with her list as it was left; "Modifier" opens her
 * profile ("Mettre à jour" when there is something to update or confirm).
 * Rendered only while the session is open (App.tsx): no pseudonym is ever on
 * screen behind the code.
 */
export function Profiles() {
  const t = useT();
  const lang = useLang();
  const { storageTimeoutMs, pack, online } = useApp();
  const { start, pendingOf } = useCheck();
  // A profile deleted in another tab: the list is read again, so she is no longer named.
  const { deletedProfile, passerByLetGo, passerByNoted } = useSession();
  const [, navigate] = useLocation();
  const note = useProfileNote();
  const said = useLiveRegionReady();
  // A lock let a passer-by go: said once here (read when the screen opens, StrictMode included).
  const [letGo] = useState(() => passerByLetGo);
  useEffect(() => {
    if (letGo) passerByNoted();
  }, [letGo, passerByNoted]);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [filter, setFilter] = useState('');

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
  }, [storageTimeoutMs, deletedProfile]);

  const collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' });
  const profiles =
    loaded.status === 'ready'
      ? [...loaded.profiles].sort((a, b) => collator.compare(a.pseudonym, b.pseudonym))
      : [];
  const searchable = profiles.length >= SEARCH_FROM;
  // A part of the pseudonym, compared as pseudonyms are (no case, accents or extra spaces).
  const wanted = searchable ? pseudonymKey(filter) : '';
  const shown =
    wanted === '' ? profiles : profiles.filter((p) => pseudonymKey(p.pseudonym).includes(wanted));

  return (
    <main className="screen profiles">
      <div className="profiles__intro">
        <h1 tabIndex={-1}>{t('profiles.title')}</h1>
        <p>{t('profiles.lead')}</p>
      </div>
      {/* There empty first, then filled: a region filled as it appears is not read out. */}
      {note === null && !letGo ? null : (
        <p className="home__saved" role="status">
          {!said ? '' : note === null ? t('profiles.passerByCleared') : profileNoteText(note, t)}
        </p>
      )}
      {/* In reach at the top, however long the list. */}
      <div className="profiles__actions">
        <Button
          variant="primary"
          className="profiles__add"
          onClick={() => {
            navigate('/profile/new');
          }}
        >
          {t('profiles.add')}
        </Button>
        <Button
          variant="secondary"
          className="profiles__quick"
          onClick={() => {
            navigate(QUICK_PATH);
          }}
        >
          {t('profiles.quick')}
        </Button>
      </div>
      {loaded.status === 'loading' ? (
        <p className="meta" role="status">
          {t('profiles.loading')}
        </p>
      ) : null}
      {loaded.status === 'failed' ? <Notice>{t('profile.loadFailed')}</Notice> : null}
      {loaded.status === 'ready' && profiles.length === 0 ? (
        <p className="profiles__empty">{t('profiles.empty')}</p>
      ) : null}
      {searchable ? (
        <TextField
          type="search"
          className="profiles__search"
          label={t('profiles.search')}
          hint={t('profiles.searchHint')}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
          onKeyDown={(event) => {
            // The keyboard's search key closes the keyboard: the rows it hid show.
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      ) : null}
      {/* There from the start, so a screen reader says "none" when it comes. */}
      {searchable ? (
        <p className={shown.length === 0 ? 'profiles__empty' : 'sr-only'} role="status">
          {shown.length === 0 ? t('profiles.noMatch') : ''}
        </p>
      ) : null}
      {shown.length === 0 ? null : (
        <ul className="profiles__list" aria-label={t('profiles.listLabel')}>
          {shown.map((profile) => {
            const today = loaded.status === 'ready' ? loaded.today : null;
            // To update (outdated) or to confirm (the baby may be born): the link says so.
            const update = today !== null && needsUpdate(profile, today, pack?.date);
            const pending = pendingOf(profile.id);
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
                    {/* Her list waits for her during the visit. */}
                    {pending === 0 ? null : (
                      <>
                        {' '}
                        <span className="profiles__status profiles__status--pending">
                          {pending === 1
                            ? t('profiles.pendingOne')
                            : t('profiles.pendingMany', { count: pending })}
                        </span>
                      </>
                    )}
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
                    // To update: "Le bébé est-il né ?" first, as the check asks it.
                    navigate(PROFILE_EDIT_PATH, {
                      state: editEntry(profile.id, update ? { update: 'ask' } : {}),
                    });
                  }}
                >
                  {t(update ? 'profiles.update' : 'profiles.edit')}
                </a>
              </li>
            );
          })}
        </ul>
      )}
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
