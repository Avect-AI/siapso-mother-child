// SPDX-License-Identifier: MIT
import type { CheckedItem, ConditionId } from '@siapso/engine';
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { checkEntryOf, latestHistoryAt, recordHistory } from '../data/history.js';
import { listProfiles } from '../data/profiles.js';
import { todayIso } from '../domain/dates.js';
import { emptyForm, pseudonymKey } from '../domain/profile-form.js';
import { profileSummary } from '../domain/profile-summary.js';
import { bandedName, doseBandLine, doseBandOf } from '../domain/dose-band.js';
import { displayOf, type ItemDisplay } from '../domain/search-index.js';
import { joinNames } from '../domain/result-view.js';
import { isStale } from '../domain/staleness.js';
import { latestDay, profileTermStatus } from '../domain/term.js';
import type { HistoryEntry, Mode, Profile } from '../domain/types.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { activeProfile, useCheck, type CheckChange } from '../state/check-state.js';
import { useWarmSearchIndex } from '../state/search-index.js';
import { Button } from '../ui/Button.js';
import { useLiveRegionReady } from '../ui/live-region.js';
import { Notice } from '../ui/Notice.js';
import { CheckSearch } from './CheckSearch.js';
import { CheckSigns } from './CheckSigns.js';
import { OfflineReadiness } from './OfflineReadiness.js';
import { OutdatedTerm } from './OutdatedTerm.js';
import { ProfileQuestions } from './ProfileEdit.js';
import { CheckResult, type ShownResult } from './Result.js';
import { profileNoteText, useProfileNote, type ProfileNote } from './saved-note.js';
import { Typed } from './Typed.js';

/** How long her profile may take to read before the screen says it is loading. */
const CHECK_LOADING_DELAY_MS = 600;

/** The milliseconds from `now` to the next midnight of the phone, and one more second. */
export function untilMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return next.getTime() - now.getTime();
}

/**
 * A new reading of her profile and of the day (SCRUM-56, 8.3, her term kept
 * current): when the page shows again and at midnight, the check reads them
 * again (at unlock it is shown again, so it reads them then too).
 */
function useReading(): { reading: number; today: string } {
  // Today from the phone's clock, handed to pure code.
  const [now, setNow] = useState(() => ({ reading: 0, today: todayIso(new Date()) }));
  const again = useCallback(() => {
    setNow((before) => ({ reading: before.reading + 1, today: todayIso(new Date()) }));
  }, []);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') again();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [again]);
  useEffect(() => {
    const timer = setTimeout(again, untilMidnight(new Date()));
    return () => {
      clearTimeout(timer);
    };
  }, [now.reading, again]);
  return now;
}

/** The last change to the list, said under it. */
type Change =
  | CheckChange
  | { kind: 'removed'; item: CheckedItem; index: number }
  | { kind: 'restored'; item: CheckedItem };

const CHANGE_MESSAGES: Record<Change['kind'], MessageKey> = {
  added: 'check.added',
  already: 'check.already',
  updated: 'check.updated',
  removed: 'check.removed',
  restored: 'check.restored',
};

/** The profile screen a check without a profile opens, then comes back from. */
export function profilePathFor(mode: Mode): string {
  return mode === 'accompanied' ? '/profile/new' : '/profile';
}

function Item({
  item,
  shown,
  band,
  named,
  list,
  written,
  said,
  onRemove,
}: {
  item: CheckedItem;
  shown: ItemDisplay;
  /** The dose range it is read in ("100 mg ou moins", "Plus de 100 mg"), when its dose is asked so. */
  band: string | undefined;
  /** Its name with that range, for the remove button: two boxes of one product told apart. */
  named: string;
  /** The list an unrecognised text was typed in. */
  list: 'product' | 'plant' | undefined;
  /** The name she typed, when the item is shown under another name. */
  written: string | undefined;
  /** The voice heard that name: "Vous avez dit". */
  said: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  const units = item.unitsPerDay;
  return (
    <li className="check__item">
      <div className="check__item-text">
        <p className="check__item-name">
          {/* A name kept as typed is her words: quoted, the line under it says it is not recognised. */}
          {item.ref.kind === 'unrecognised' ? <Typed text={shown.name} label="none" /> : shown.name}
        </p>
        {item.ref.kind === 'unrecognised' ? (
          <p className="meta">
            {t(list === 'plant' ? 'check.notRecognisedPlant' : 'check.notRecognised')}
          </p>
        ) : shown.detail === undefined ? null : (
          // A Latin name is read with Latin rules (WCAG 3.1.2).
          <p className="meta" lang={shown.detailLang}>
            {shown.detail}
          </p>
        )}
        {item.strengthUnknown === true ? (
          <p className="meta">{t('check.strengthUnknown')}</p>
        ) : null}
        {band === undefined ? null : <p className="meta">{band}</p>}
        {/* Last in the product block, as on the confirm screen. */}
        {written === undefined ? null : (
          <p className="meta">
            <Typed text={written} label="shown" said={said} />
          </p>
        )}
        {units === undefined ? null : (
          <p className="meta">
            {units === 1 ? t('check.unitsOne') : t('check.unitsMany', { units })}
          </p>
        )}
      </div>
      <Button
        variant="quiet"
        className="check__remove"
        aria-label={t('check.removeNamed', { name: named })}
        onClick={onRemove}
      >
        {t('check.remove')}
      </Button>
    </li>
  );
}

/**
 * The situations answered for her, under who the check is for, so a "none"
 * ticked by reflex can be seen and put right (SCRUM-56, the safety review):
 * behind one tap whatever was answered, as on the profile screen, since one
 * of them says HIV and showing "none" alone would tell the others apart. Hidden
 * again at every new showing of the check.
 */
function SituationsLine({ conditions }: { conditions: readonly ConditionId[] }) {
  const t = useT();
  const lang = useLang();
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      // One word on screen, beside the term, so the line takes no room of its own;
      // its name says what a tap does.
      <Button
        variant="quiet"
        className="check__situations"
        aria-label={t('check.situationsHidden')}
        onClick={() => {
          setShown(true);
        }}
      >
        {t('check.situationsShort')}
      </Button>
    );
  }
  return (
    <span className="check__situations-shown">
      {conditions.length === 0
        ? t('check.situationsNone')
        : t('check.situationsList', {
            names: joinNames(
              conditions.map((id) => t(`profile.condition.${id}`)),
              lang,
            ),
          })}
    </span>
  );
}

/**
 * Her first check in woman mode (SCRUM-56, 8.3): the questions of her
 * profile, in its order and with its defaults, where the search will be.
 * Saved, they are her profile (`self`, under her code, as the profile screen
 * keeps it); the check then folds them into the line of her term. Her
 * pseudonym is the one offered ("Moi"), asked only when a profile of the
 * phone already has it. Its heading takes the focus when the check opens
 * (App.tsx reads data-autofocus): the first question is right under it.
 */
function AboutHer({
  today,
  taken,
  onSaved,
}: {
  today: string;
  taken: readonly string[];
  onSaved: (profile: Profile) => void;
}) {
  const t = useT();
  const headingId = useId();
  // Read once: a language change keeps the answers typed (ProfileQuestions reads it once too).
  const [initial] = useState(() => emptyForm(t('profile.pseudonymMine'), today, 'today'));
  const named = taken.some((name) => pseudonymKey(name) === pseudonymKey(initial.pseudonym));
  return (
    <section className="check__about" aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1} data-autofocus="">
        {t('check.aboutTitle')}
      </h2>
      <p className="meta">{t('profile.lead')}</p>
      <ProfileQuestions
        mode="woman"
        today={today}
        base={undefined}
        self
        // The check's screen key: answers typed come back after an auto-lock (state/draft.ts).
        draftKey="check"
        taken={taken}
        initial={initial}
        named={named}
        onSaved={onSaved}
      />
    </section>
  );
}

/**
 * Check: what the woman takes, being looked at. One field searches the
 * medicines and the remedies (SCRUM-56, S12: CheckSearch), its candidates
 * under it, each added by a tap or by the "yes" of the question under it;
 * then the items added (name, substances and strengths, units per day when
 * given), each with a way off the list. Under the list, in words, what just
 * changed (added, taken off with a way to put it back). Once at least one
 * item is listed, the danger signs present now are asked under the list
 * (S13: CheckSigns), asked again at every showing of the check, and their
 * answer opens the result.
 *
 * The check is for the active profile: hers in woman mode, the one chosen in
 * the list of profiles in accompanied mode (without a choice, the list opens),
 * or a passer-by looked up without saving (her answers in memory, "Femme de
 * passage : rien n'est enregistré" said in place of a pseudonym; accompanied
 * mode only), named with where she stands (the term used, the baby's age).
 * When her term is outdated (past 42 weeks), the check asks first whether
 * the baby is born (OutdatedTerm), and nothing can be added or looked at
 * until the profile is updated.
 *
 * In woman mode the check is her start (SCRUM-56, S4), with what Home said
 * around it: what the app is for while nothing is listed, a profile just
 * saved, the settings that could not be kept, then at the end whether the
 * phone opens the app without the Internet, the quiet links (her profile,
 * the settings, the knowledge base, about) and the closing line. Her first
 * check asks about her where the search will be (AboutHer); her answers are
 * her profile once saved, and the field takes the focus. In accompanied
 * mode, a check without any profile opens the profile screen first, then
 * comes back here. An out-of-date knowledge base is said above the field.
 */
export function Check() {
  const t = useT();
  const lang = useLang();
  const { settings, pack, packError, storageTimeoutMs, settingsUnavailable, online } = useApp();
  const check = useCheck();
  const [, navigate] = useLocation();
  const mode: Mode = settings.mode ?? 'woman';
  // Woman mode: her check is her start (SCRUM-56, S4).
  const woman = mode === 'woman';
  const [stored, setStored] = useState<{
    profile: Profile;
    today: string;
    lastAt: string | undefined;
  } | null>(null);
  // A new reading of her profile and of the day: when the page shows again, at midnight.
  const { reading, today } = useReading();
  const [failed, setFailed] = useState(false);
  // Her first check in woman mode: no profile yet, so the questions about her (AboutHer).
  const [ask, setAsk] = useState<{ today: string; taken: readonly string[] } | null>(null);
  // A profile just saved, said once: by the profile screen (on the entry) or on this check.
  const leftNote = useProfileNote();
  const [note, setNote] = useState<ProfileNote | null>(leftNote);
  // Her answers just saved on the check: the field takes the focus once it shows.
  const focusField = useRef(false);
  const [change, setChange] = useState<Change | null>(null);
  // After a removal or an undo, the row whose button takes the focus (else the search field).
  const focusRow = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const emptyId = useId();
  const { start, profileId, changed, clearChanged, quick } = check;
  // Read once, before it is said and cleared: an item was just added on another screen.
  const [justAdded] = useState(() => changed !== null);
  // A passer-by checked without saving: her answers are in memory, never stored.
  // Accompanied mode only: woman mode never shows a passer-by's answers.
  const passerBy =
    mode === 'accompanied' && quick !== null && quick.id === profileId ? quick : null;
  const profile =
    passerBy === null
      ? stored
      : { profile: passerBy, today, lastAt: undefined as string | undefined };
  useWarmSearchIndex(pack);
  // True once the profile has taken a moment to read: the loading status speaks then.
  const slow = useLiveRegionReady(CHECK_LOADING_DELAY_MS);

  // The danger signs answer is kept within this check only (SCRUM-56, S14):
  // leaving the check (Back, the band, her profile, the list of profiles, a
  // lock, the quick exit) forgets it, so it is asked again, nothing chosen.
  const { clearSigns } = check;
  useEffect(
    () => () => {
      clearSigns();
    },
    [clearSigns],
  );

  // Her answers as last read (her id and when her profile was saved).
  const readAnswers = useRef<string | null>(null);

  // One history entry per check (S15): the highest level shown during it,
  // written in order (each write is the whole entry, under the same id).
  const entry = useRef<HistoryEntry | undefined>(undefined);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const onShown = useCallback(
    ({ evaluation, checked, signs }: ShownResult) => {
      if (profileId === null) return;
      const next = checkEntryOf(entry.current, {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        profileId,
        evaluation,
        items: checked,
        signs,
      });
      // Nothing new to keep (a render again, a change of language).
      if (entry.current !== undefined && JSON.stringify(next) === JSON.stringify(entry.current)) {
        return;
      }
      entry.current = next;
      writes.current = writes.current
        .then(() => recordHistory(next))
        .catch((failure: unknown) => {
          console.warn('Evaluation not kept in the history on this device', failure);
        });
    },
    [profileId],
  );

  // What the confirm or search screen just did to the list (added, already
  // there, updated) is said once, after this screen is up, so the live region
  // (there and empty at first) reads it.
  useEffect(() => {
    if (changed === null) return;
    const timer = setTimeout(() => {
      setChange(changed);
      clearChanged();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [changed, clearChanged]);

  useEffect(() => {
    // A passer-by's answers are in memory: nothing to read.
    if (passerBy !== null) return;
    let live = true;
    const load = async () => {
      const profiles = await listProfiles();
      const active = activeProfile(profiles, mode, profileId);
      // The last result kept for her: a phone date before it is a clock set back.
      const lastAt = active === undefined ? undefined : await latestHistoryAt(active.id);
      return { profiles, active, lastAt };
    };
    // What is done with the profile is in the chain too: an error there says
    // the profiles could not be read, never leaves the screen empty.
    withTimeout(load(), storageTimeoutMs)
      .then(({ profiles, active, lastAt }) => {
        if (!live) return;
        if (active === undefined) {
          // Her first check in woman mode: the questions about her, here (SCRUM-56, 8.3).
          if (mode === 'woman') {
            setAsk({
              today: todayIso(new Date()),
              taken: profiles.map((other) => other.pseudonym),
            });
            return;
          }
          // Accompanied mode with profiles, none chosen: she is chosen in the list.
          if (profiles.length > 0) {
            navigate('/', { replace: true });
            return;
          }
          // The profile screen reads `next` and comes back here once saved.
          navigate(profilePathFor(mode), { replace: true, state: { next: '/check' } });
          return;
        }
        setAsk(null);
        start(active.id);
        // Her answers changed since the check read them (saved elsewhere meanwhile):
        // the danger signs answer was about her as she was, so it is asked again (S14).
        const before = readAnswers.current;
        if (before !== null && before !== `${active.id}@${active.updatedAt}`) clearSigns();
        readAnswers.current = `${active.id}@${active.updatedAt}`;
        // Today from the phone's clock, handed to pure code.
        setStored({ profile: active, today: todayIso(new Date()), lastAt });
      })
      .catch((failure: unknown) => {
        console.warn('Profiles not read on this device', failure);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [mode, profileId, passerBy, start, navigate, storageTimeoutMs, reading, clearSigns]);

  // Her answers saved on the check: back to its top (the band and its danger
  // signs in view, her term folded under the title), and the field, there now,
  // takes the focus for the first name.
  useEffect(() => {
    if (!focusField.current || stored === null) return;
    focusField.current = false;
    document.documentElement.scrollTop = 0;
    fieldRef.current?.focus();
  }, [stored]);

  // Her answers saved as her profile (AboutHer): the check is hers from now on.
  const aboutHerSaved = useCallback(
    (saved: Profile) => {
      focusField.current = true;
      readAnswers.current = `${saved.id}@${saved.updatedAt}`;
      setAsk(null);
      setNote({ kind: 'saved', name: saved.pseudonym });
      setStored({ profile: saved, today: todayIso(new Date()), lastAt: undefined });
      start(saved.id);
    },
    [start],
  );

  // Once the list itself has changed (a render for another reason, such as the
  // profile read meanwhile, must not move the focus on the list before it).
  useEffect(() => {
    const index = focusRow.current;
    if (index === null) return;
    focusRow.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('.check__remove') ?? [];
    const next = buttons[Math.min(index, buttons.length - 1)];
    (next ?? fieldRef.current)?.focus();
  }, [check.items]);

  const putBack = (removed: Extract<Change, { kind: 'removed' }>) => {
    focusRow.current = removed.index;
    check.restore(removed.index, removed.item);
    setChange({ kind: 'restored', item: removed.item });
  };

  const shownOf = (item: CheckedItem): ItemDisplay =>
    pack === null
      ? { name: item.ref.kind === 'unrecognised' ? item.ref.text : item.ref.id, detail: undefined }
      : displayOf(pack, item.ref, lang, item.strengthUnknown === true);
  // A box whose dose is asked by a range is named with it: "Aspirine (générique), plus de 100 mg".
  const namedOf = (item: CheckedItem): string =>
    pack === null
      ? shownOf(item).name
      : bandedName(pack, item, shownOf(item).name, lang, t, check.aboveOf(item));
  const bandOf = (item: CheckedItem): string | undefined => {
    const band = pack === null ? undefined : doseBandOf(pack, item, check.aboveOf(item));
    return band === undefined ? undefined : doseBandLine(t, band, lang);
  };
  // In a sentence of the app ("... est ajouté à la liste."), a name she typed is quoted.
  const saidOf = (item: CheckedItem): string =>
    item.ref.kind === 'unrecognised'
      ? t('result.quoted', { text: shownOf(item).name })
      : namedOf(item);

  // Nothing until her profile is read: without one, the profile screen opens
  // instead, so the check never shows first, nor takes the focus, before it.
  // The heading comes with the profile and takes the focus then (App.tsx).
  // When storage is slow, a status says it is loading, after a moment only
  // (a phone that answers at once never shows it).
  if (profile === null && ask === null && !failed) {
    return (
      <main className="screen check">
        <p className="check__loading" role="status">
          {slow ? t('check.loading') : ''}
        </p>
      </main>
    );
  }

  // A day the app has already seen: the knowledge pack's date, her last result.
  const notBefore = profile === null ? undefined : latestDay(pack?.date, profile.lastAt);
  if (
    profile &&
    profileTermStatus(profile.profile, profile.today, notBefore).status === 'outdated'
  ) {
    return (
      <main className="screen check">
        <OutdatedTerm mode={mode} profile={profile.profile} passerBy={passerBy !== null} />
      </main>
    );
  }

  const empty = check.items.length === 0;
  // An old base is said before she looks at a product, not only on the status screen.
  const stale = pack !== null && isStale(pack.date, today);
  return (
    <main className="screen check">
      <div className="check__intro">
        <h1 tabIndex={-1}>
          {t(mode === 'accompanied' ? 'check.titleAccompanied' : 'check.titleWoman')}
        </h1>
        {/* Her start: what the app is for, until a product is listed (SCRUM-56, S4). */}
        {woman && empty ? <p>{t('home.lead')}</p> : null}
        {profile === null ? null : (
          <p className="meta check__profile">
            {passerBy !== null ? <span>{t('check.quick')}</span> : null}
            {mode === 'accompanied' && passerBy === null ? (
              <span>{t('check.profile', { name: profile.profile.pseudonym })}</span>
            ) : null}
            {profileSummary(profile.profile, profile.today, notBefore).map((line) => (
              // The space keeps the lines apart when read aloud (the grid shows one a line).
              <Fragment key={line.key}>
                {' '}
                <span>{t(line.key, line.vars)}</span>
              </Fragment>
            ))}{' '}
            <SituationsLine key={profile.profile.id} conditions={profile.profile.conditions} />
            {/* Her profile, one tap away, in the line of her term (SCRUM-56, 8.7). */}
            {woman ? (
              <>
                {' '}
                <a className="button button--quiet check__edit" href="#/profile">
                  {t('check.edit')}
                </a>
              </>
            ) : null}
          </p>
        )}
        {/* A profile just saved, said once, until a product is listed. */}
        {woman ? (
          <p className="check__saved" role="status">
            {note !== null && empty ? profileNoteText(note, t) : ''}
          </p>
        ) : null}
      </div>
      {woman && settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
      {failed ? <Notice>{t('profile.loadFailed')}</Notice> : null}
      {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}
      {stale ? <Notice>{t('status.stale')}</Notice> : null}

      {ask !== null && profile === null ? (
        // Her first check: nothing to look up before her term is known (8.5).
        <AboutHer today={ask.today} taken={ask.taken} onSaved={aboutHerSaved} />
      ) : (
        <>
          {/* When her profile could not be read, the heading takes the focus, so the notice is read first. */}
          <CheckSearch field={fieldRef} autoFocus={!failed} startEmpty={justAdded} />

          {empty ? (
            <p id={emptyId} className="check__empty">
              {t('check.empty')}
            </p>
          ) : (
            <ul ref={listRef} className="check__items" aria-label={t('check.listLabel')}>
              {check.items.map((item, index) => {
                const shown = shownOf(item);
                return (
                  <Item
                    // Items have no id; the list only changes by adding at the end or removing.
                    key={`${String(index)}:${item.ref.kind}:${'id' in item.ref ? item.ref.id : item.ref.text}`}
                    item={item}
                    shown={shown}
                    band={bandOf(item)}
                    named={namedOf(item)}
                    list={check.listOf(item)}
                    written={check.writtenOf(item)}
                    said={check.saidOf(item)}
                    onRemove={() => {
                      focusRow.current = index;
                      setChange({ kind: 'removed', item, index });
                      check.remove(index);
                    }}
                  />
                );
              })}
            </ul>
          )}
          {/* What just changed in the list, in words; a removal can be undone (no time limit). */}
          <p className="check__status" role="status">
            {change === null ? '' : t(CHANGE_MESSAGES[change.kind], { name: saidOf(change.item) })}
          </p>
          {change?.kind === 'removed' ? (
            <Button
              variant="quiet"
              className="check__undo"
              onClick={() => {
                putBack(change);
              }}
            >
              {t('check.putBack')}
            </Button>
          ) : null}

          {/* The danger signs present now, once a product is listed (S13): no result without an answer. */}
          {empty ? null : (
            <CheckSigns
              profile={profile?.profile ?? null}
              today={profile?.today ?? today}
              notBefore={notBefore}
              mode={mode}
            />
          )}
          {/* The result under the answer (S15), worked out again at each change. */}
          {empty || !check.signsGiven || profile === null ? null : (
            <CheckResult
              profile={profile.profile}
              today={profile.today}
              notBefore={notBefore}
              passerBy={passerBy !== null}
              onShown={onShown}
            />
          )}
        </>
      )}

      {/* Her start, at its end: what Home said there (SCRUM-56, S4). */}
      {woman ? (
        <div className="check__closing">
          <OfflineReadiness online={online} />
          {profile === null ? null : (
            <a className="button button--quiet check__link" href="#/profile">
              {t('home.profileMine')}
            </a>
          )}
          <a className="button button--quiet check__link" href="#/settings">
            {t('home.settings')}
          </a>
          <a className="button button--quiet check__link" href="#/status">
            {t('nav.status')}
          </a>
          <a className="button button--quiet check__link" href="#/about">
            {t('nav.about')}
          </a>
          <p className="meta">{t('home.closing')}</p>
        </div>
      ) : null}
    </main>
  );
}
