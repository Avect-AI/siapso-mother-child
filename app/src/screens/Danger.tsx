// SPDX-License-Identifier: MIT
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { signsByGroup, SIGN_GROUPS } from '../domain/signs.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { forgetStaleEntry, inSession, sessionState } from '../state/entry-state.js';
import { Button } from '../ui/Button.js';
import { SectionedCheckboxGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { CALL_PATH } from './Referral.js';

/**
 * The signs ticked on this history entry, so that back from who to call finds
 * them ticked: in this epoch only, so a lock, a quick exit, two minutes
 * without interaction or hidden while locked, and a reload forget them.
 */
function keptSigns(): string[] {
  const { dangerSigns } = sessionState();
  return Array.isArray(dangerSigns)
    ? dangerSigns.filter((sign): sign is string => typeof sign === 'string')
    : [];
}

/**
 * Danger signs, one tap away from every screen, even before the settings are
 * read. The orientation comes first, with its condition, so it is never read
 * as an order to someone with no sign; it needs no pack. Then who to call at
 * once (a secondary action: a sign may be missing from the list), then the
 * signs listed in the knowledge pack, in their groups, as large answers to
 * tick, and the one primary action, "C'est grave maintenant". It never
 * refuses: with or without signs ticked, it opens who to call with "Allez au
 * poste de santé maintenant." (she said it is serious now), the signs ticked
 * kept to be said when calling.
 * While the pack loads, nothing is said about the list; once loading failed,
 * or the loaded pack lists none, a notice says so in words (never a silent
 * gap). Nothing is kept but the ticks, in memory, for this history entry and
 * this epoch: given without the code, they go with the quick exit (offered
 * here before the code too) and after two minutes without interaction.
 */
export function Danger() {
  const t = useT();
  const lang = useLang();
  const { pack, packError } = useApp();
  const [, navigate] = useLocation();
  const [chosen, setChosen] = useState<string[]>(keptSigns);

  // Signs ticked in an earlier visit or epoch go from the history, not only unread.
  useEffect(() => {
    forgetStaleEntry();
  }, []);

  const choose = (id: string, checked: boolean) => {
    const next = checked ? [...chosen.filter((s) => s !== id), id] : chosen.filter((s) => s !== id);
    setChosen(next);
    window.history.replaceState(inSession({ ...sessionState(), dangerSigns: next }), '');
  };

  let list = null;
  if (pack !== null) {
    list =
      pack.dangerSigns.length === 0 ? (
        <Notice>{t('danger.listEmpty')}</Notice>
      ) : (
        <form
          className="danger__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            // The emergency action never refuses; the signs ticked go along for the call,
            // marked as given without the code.
            navigate(CALL_PATH, {
              state: inSession({ instruction: { standard: true }, signs: chosen, public: true }),
            });
          }}
        >
          <SectionedCheckboxGroup
            legend={t('danger.question')}
            hint={t('danger.hint')}
            sections={signsByGroup(pack.dangerSigns, SIGN_GROUPS).map(({ group, signs }) => ({
              id: group,
              label: t(`danger.group.${group}`),
              options: signs.map((sign) => ({
                id: sign.id,
                label: sign.label[lang],
                checked: chosen.includes(sign.id),
                onChange: (checked: boolean) => {
                  choose(sign.id, checked);
                },
              })),
            }))}
          />
          {/* Held at the bottom while the list scrolls: in reach once a sign is ticked. */}
          <div className="sticky-action">
            <Button type="submit" variant="primary" className="danger__now">
              {t('danger.now')}
            </Button>
          </div>
        </form>
      );
  } else if (packError !== null) {
    list = <Notice>{t('danger.listUnavailable')}</Notice>;
  }

  return (
    <main className="screen danger">
      <h1 tabIndex={-1}>{t('danger.title')}</h1>
      <div className="danger__orientation">
        <p>{t('danger.condition')}</p>
        <p className="orientation">{t('danger.orientation')}</p>
      </div>
      <a className="button button--secondary danger__call" href={`#${CALL_PATH}`}>
        {t('danger.call')}
      </a>
      {list}
    </main>
  );
}
