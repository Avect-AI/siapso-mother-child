// SPDX-License-Identifier: MIT
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Notice } from '../ui/Notice.js';

/**
 * Danger signs, one tap away from every screen, even before the settings are
 * read. The orientation comes first, with its condition, so it is never read
 * as an order to someone with no sign; it needs no pack. Then the signs
 * listed in the knowledge pack. While the pack loads, nothing is said about
 * the list; once loading failed, or the loaded pack lists none, a notice says
 * so in words (never a silent gap). Task 13 (SCRUM-26) adds the referral
 * circuit.
 */
export function Danger() {
  const t = useT();
  const lang = useLang();
  const { pack, packError } = useApp();

  let list = null;
  if (pack !== null) {
    list =
      pack.dangerSigns.length === 0 ? (
        <Notice>{t('danger.listEmpty')}</Notice>
      ) : (
        <ul className="danger__signs">
          {pack.dangerSigns.map((sign) => (
            <li key={sign.id}>{sign.label[lang]}</li>
          ))}
        </ul>
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
      {list}
    </main>
  );
}
