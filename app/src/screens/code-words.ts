// SPDX-License-Identifier: MIT
import type { MessageKey, Vars } from '../i18n/index.js';

/** How many digits of a code are typed, in words, for a screen reader. */
export function digitCount(t: (key: MessageKey, vars?: Vars) => string): (count: number) => string {
  return (count) =>
    count === 0
      ? t('code.digitsNone')
      : count === 1
        ? t('code.digitsOne')
        : t('code.digits', { count });
}
