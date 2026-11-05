// SPDX-License-Identifier: MIT
import type { Lang, LocalName } from '@siapso/engine';
import type { MessageKey, Vars } from '../i18n/translate.js';

/**
 * Which sentence says the other name a product or remedy was found by: a
 * Wolof name is a local name, with its language ("Nom local : nebeday
 * (wolof)"); a French or English name is another name, never a local one,
 * with its language only on a screen in the other language ("Autre nom :
 * argile"). Its placeholders are `name` and `lang`.
 */
export function localNameKey(local: Pick<LocalName, 'lang'>, lang: Lang): MessageKey {
  if (local.lang === 'wo') return 'search.localName';
  return local.lang === lang ? 'search.otherName' : 'search.otherNameLang';
}

/** The same sentence as text. */
export function localNameText(
  local: LocalName,
  lang: Lang,
  t: (key: MessageKey, vars?: Vars) => string,
): string {
  return t(localNameKey(local, lang), { name: local.text, lang: t(`nameLang.${local.lang}`) });
}
