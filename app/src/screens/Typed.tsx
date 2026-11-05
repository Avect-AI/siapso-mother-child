// SPDX-License-Identifier: MIT
import { useT } from '../i18n/index.js';

/**
 * A text she typed: quoted, at reading weight, so it never reads as the app's
 * own words or as a name the app confirmed. With its label "Vous avez écrit"
 * (`label` 'shown'), with the label for a screen reader alone ('hidden',
 * where the quotation marks may not be voiced), or with none ('none', where a
 * line next to it says what it is).
 */
export function Typed({ text, label }: { text: string; label: 'shown' | 'hidden' | 'none' }) {
  const t = useT();
  const quote = <span className="typed">{t('result.quoted', { text })}</span>;
  if (label === 'none') return quote;
  return (
    <>
      <span className={label === 'shown' ? 'typed__label' : 'sr-only'}>
        {t('result.typedLabel')}
      </span>{' '}
      {quote}
    </>
  );
}
