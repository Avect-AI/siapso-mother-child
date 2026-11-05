// SPDX-License-Identifier: MIT
import type { MessageKey, Vars } from '../i18n/index.js';

/**
 * A wait in minutes and seconds, rounded up to the second (never "119
 * secondes"; the longest wait is 30 minutes): shown short, on one line ("45
 * s", "2 min", "1 min 59 s"), or `spoken` in whole words for a screen reader
 * ("1 minute 59 secondes").
 */
export function waitTime(
  t: (key: MessageKey, vars?: Vars) => string,
  ms: number,
  as: 'shown' | 'spoken' = 'shown',
): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (as === 'spoken') {
    const parts: string[] = [];
    if (minutes > 0) {
      parts.push(minutes === 1 ? t('code.spokenMinute') : t('code.spokenMinutes', { minutes }));
    }
    if (seconds > 0 || minutes === 0) {
      parts.push(seconds === 1 ? t('code.spokenSecond') : t('code.spokenSeconds', { seconds }));
    }
    return parts.join(' ');
  }
  if (minutes === 0) return t('code.timeSeconds', { seconds });
  if (seconds === 0) return t('code.timeMinutes', { minutes });
  return t('code.timeMinutesSeconds', { minutes, seconds });
}

/** How many digits of a code are typed, in words, for a screen reader. */
export function digitCount(t: (key: MessageKey, vars?: Vars) => string): (count: number) => string {
  return (count) =>
    count === 0
      ? t('code.digitsNone')
      : count === 1
        ? t('code.digitsOne')
        : t('code.digits', { count });
}
