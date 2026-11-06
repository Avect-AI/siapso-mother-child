// SPDX-License-Identifier: MIT
import type { CheckedItem, ConditionId } from '@siapso/engine';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { latestHistoryAt } from '../data/history.js';
import { listProfiles } from '../data/profiles.js';
import { todayIso } from '../domain/dates.js';
import { profileSummary } from '../domain/profile-summary.js';
import { bandedName, doseBandLine, doseBandOf } from '../domain/dose-band.js';
import { displayOf, type ItemDisplay } from '../domain/search-index.js';
import { joinNames } from '../domain/result-view.js';
import { latestDay, profileTermStatus } from '../domain/term.js';
import type { Mode, Profile } from '../domain/types.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { activeProfile, useCheck, type CheckChange } from '../state/check-state.js';
import { useWarmSearchIndex } from '../state/search-index.js';
import { Button } from '../ui/Button.js';
import { useLiveRegionReady } from '../ui/live-region.js';
import { Notice } from '../ui/Notice.js';
import { flowEntry, searchPath } from './check-flow.js';
import { OutdatedTerm } from './OutdatedTerm.js';
import { Typed } from './Typed.js';

/** How long her profile may take to read before the screen says it is loading. */
const CHECK_LOADING_DELAY_MS = 600;

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
 * Check: what the woman takes, being looked at. The items added (name,
 * substances and strengths, units per day when given), each with a way off the
 * list; a medicine or a remedy is added through the search screen. Under the
 * list, in words, what just changed (added, taken off with a way to put it
 * back). The one primary action goes on to the result, through the danger
 * signs present now, once at least one item is listed.
 *
 * The check is for the active profile: hers in woman mode, the one chosen in
 * the list of profiles in accompanied mode (without a choice, the list opens),
 * or a passer-by looked up without saving (her answers in memory, "Femme de
 * passage : rien n'est enregistré" said in place of a pseudonym; accompanied
 * mode only), named with where she
 * stands (the term used, the baby's age). Without any
 * profile, the profile screen opens first, then comes back here. When her term
 * is outdated (past 42 weeks), the check asks first whether the baby is born
 * (OutdatedTerm), and nothing can be added or looked at until the profile is
 * updated.
 */
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

export function Check() {
  const t = useT();
  const lang = useLang();
  const { settings, pack, packError, storageTimeoutMs } = useApp();
  const check = useCheck();
  const [, navigate] = useLocation();
  const mode: Mode = settings.mode ?? 'woman';
  const [stored, setStored] = useState<{
    profile: Profile;
    today: string;
    lastAt: string | undefined;
  } | null>(null);
  // Today from the phone's clock, once, handed to pure code.
  const [today] = useState(() => todayIso(new Date()));
  const [failed, setFailed] = useState(false);
  const [change, setChange] = useState<Change | null>(null);
  // After a removal or an undo, the row whose button takes the focus (else the first add button).
  const focusRow = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const emptyId = useId();
  const { start, profileId, changed, clearChanged, quick } = check;
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
          // Accompanied mode with profiles, none chosen: she is chosen in the list.
          if (mode === 'accompanied' && profiles.length > 0) {
            navigate('/', { replace: true });
            return;
          }
          // The profile screen reads `next` and comes back here once saved.
          navigate(profilePathFor(mode), { replace: true, state: { next: '/check' } });
          return;
        }
        start(active.id);
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
  }, [mode, profileId, passerBy, start, navigate, storageTimeoutMs]);

  // Once the list itself has changed (a render for another reason, such as the
  // profile read meanwhile, must not move the focus on the list before it).
  useEffect(() => {
    const index = focusRow.current;
    if (index === null) return;
    focusRow.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('.check__remove') ?? [];
    const next = buttons[Math.min(index, buttons.length - 1)];
    (next ?? addRef.current?.querySelector('button'))?.focus();
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
    pack === null ? shownOf(item).name : bandedName(pack, item, shownOf(item).name, lang, t);
  const bandOf = (item: CheckedItem): string | undefined => {
    const band = pack === null ? undefined : doseBandOf(pack, item);
    return band === undefined ? undefined : doseBandLine(t, band, lang);
  };
  // In a sentence of the app ("... est ajouté à la liste."), a name she typed is quoted.
  const saidOf = (item: CheckedItem): string =>
    item.ref.kind === 'unrecognised'
      ? t('result.quoted', { text: shownOf(item).name })
      : namedOf(item);

  const openSearch = (kind: 'product' | 'plant') => {
    // One entry after this one: adding an item comes back here (check-flow.ts).
    navigate(searchPath(kind), { state: flowEntry({ stepsToCheck: 1 }) });
  };

  // Nothing until her profile is read: without one, the profile screen opens
  // instead, so the check never shows first, nor takes the focus, before it.
  // The heading comes with the profile and takes the focus then (App.tsx).
  // When storage is slow, a status says it is loading, after a moment only
  // (a phone that answers at once never shows it).
  if (profile === null && !failed) {
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
  return (
    <main className="screen check">
      <div className="check__intro">
        <h1 tabIndex={-1}>
          {t(mode === 'accompanied' ? 'check.titleAccompanied' : 'check.titleWoman')}
        </h1>
        <p>{t('check.lead')}</p>
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
          </p>
        )}
      </div>
      {failed ? <Notice>{t('profile.loadFailed')}</Notice> : null}
      {packError === null ? null : <Notice>{t('home.packUnavailable')}</Notice>}

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

      <div ref={addRef} className="check__add">
        <Button
          variant="secondary"
          onClick={() => {
            openSearch('product');
          }}
        >
          {t('check.addMedicine')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            openSearch('plant');
          }}
        >
          {t('check.addRemedy')}
        </Button>
      </div>

      <Button
        variant="primary"
        className="check__result"
        disabled={empty}
        aria-describedby={empty ? emptyId : undefined}
        onClick={() => {
          // The danger signs present now come first, then the result (one entry
          // after this one, then two: their ways back come here, check-flow.ts).
          navigate('/signs', { state: flowEntry({ stepsToCheck: 1 }) });
        }}
      >
        {t('check.seeResult')}
      </Button>
    </main>
  );
}
