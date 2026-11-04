// SPDX-License-Identifier: MIT
// The pinned FLEURS revision, which must equal FLEURS_REVISION in
// speech/convert/quick_check.py (checked by a test).
export const FLEURS_REVISION = '70bb2e84b976b7e960aa89f1c648e09c59f894dd';

/** A cached subset can be reused only when it holds enough sentences of the pinned revision. */
export function cachedSubsetUsable(
  cached: { revision?: string; utterances: readonly unknown[] } | undefined,
  count: number,
): boolean {
  return cached?.revision === FLEURS_REVISION && cached.utterances.length >= count;
}
