// SPDX-License-Identifier: MIT
import type { CheckedItem } from '@siapso/engine';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { listProfiles } from '../data/profiles.js';
import { displayOf, type ItemDisplay } from '../domain/search-index.js';
import type { Mode, Profile } from '../domain/types.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { activeProfile, useCheck, type CheckChange } from '../state/check-state.js';
import { useWarmSearchIndex } from '../state/search-index.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { flowEntry, searchPath } from './check-flow.js';

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
  list,
  onRemove,
}: {
  item: CheckedItem;
  shown: ItemDisplay;
  /** The list an unrecognised text was typed in. */
  list: 'product' | 'plant' | undefined;
  onRemove: () => void;
}) {
  const t = useT();
  const units = item.unitsPerDay;
  return (
    <li className="check__item">
      <div className="check__item-text">
        <p className="check__item-name">{shown.name}</p>
        {item.ref.kind === 'unrecognised' ? (
          <p className="meta">
            {t(list === 'plant' ? 'check.notRecognisedPlant' : 'check.notRecognised')}
          </p>
        ) : shown.detail === undefined ? null : (
          <p className="meta">{shown.detail}</p>
        )}
        {item.strengthUnknown === true ? (
          <p className="meta">{t('check.strengthUnknown')}</p>
        ) : null}
        {units === undefined ? null : (
          <p className="meta">
            {units === 1 ? t('check.unitsOne') : t('check.unitsMany', { units })}
          </p>
        )}
      </div>
      <Button
        variant="quiet"
        className="check__remove"
        aria-label={t('check.removeNamed', { name: shown.name })}
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
 * the list of profiles in accompanied mode (without a choice, the list opens).
 * Without any profile, the profile screen opens first, then comes back here.
 */
export function Check() {
  const t = useT();
  const lang = useLang();
  const { settings, pack, packError, storageTimeoutMs } = useApp();
  const check = useCheck();
  const [, navigate] = useLocation();
  const mode: Mode = settings.mode ?? 'woman';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);
  const [change, setChange] = useState<Change | null>(null);
  // After a removal or an undo, the row whose button takes the focus (else the first add button).
  const focusRow = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const emptyId = useId();
  const { start, profileId, changed, clearChanged } = check;
  useWarmSearchIndex(pack);

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
    let live = true;
    withTimeout(listProfiles(), storageTimeoutMs).then(
      (profiles) => {
        if (!live) return;
        const active = activeProfile(profiles, mode, profileId);
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
        setProfile(active);
      },
      (failure: unknown) => {
        console.warn('Profiles not read on this device', failure);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [mode, profileId, start, navigate, storageTimeoutMs]);

  useEffect(() => {
    const index = focusRow.current;
    if (index === null) return;
    focusRow.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('.check__remove') ?? [];
    const next = buttons[Math.min(index, buttons.length - 1)];
    (next ?? addRef.current?.querySelector('button'))?.focus();
  });

  const putBack = (removed: Extract<Change, { kind: 'removed' }>) => {
    focusRow.current = removed.index;
    check.restore(removed.index, removed.item);
    setChange({ kind: 'restored', item: removed.item });
  };

  const shownOf = (item: CheckedItem): ItemDisplay =>
    pack === null
      ? { name: item.ref.kind === 'unrecognised' ? item.ref.text : item.ref.id, detail: undefined }
      : displayOf(pack, item.ref, lang, item.strengthUnknown === true);

  const openSearch = (kind: 'product' | 'plant') => {
    // One entry after this one: adding an item comes back here (check-flow.ts).
    navigate(searchPath(kind), { state: flowEntry({ stepsToCheck: 1 }) });
  };

  const empty = check.items.length === 0;
  return (
    <main className="screen check">
      <div className="check__intro">
        <h1 tabIndex={-1}>
          {t(mode === 'accompanied' ? 'check.titleAccompanied' : 'check.titleWoman')}
        </h1>
        <p>{t('check.lead')}</p>
        {mode === 'accompanied' && profile !== null ? (
          <p className="meta">{t('check.profile', { name: profile.pseudonym })}</p>
        ) : null}
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
                list={check.listOf(item)}
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
        {change === null
          ? ''
          : t(CHANGE_MESSAGES[change.kind], { name: shownOf(change.item).name })}
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
