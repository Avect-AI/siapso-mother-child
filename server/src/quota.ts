// SPDX-License-Identifier: MIT
// Fixed-window quota per API key, in memory. The counters belong to one
// process: with several instances each one counts on its own, so the effective
// limit of a key is the limit times the number of instances.

export interface QuotaOptions {
  /** Requests allowed per window and per key. */
  limit: number;
  windowMs: number;
  /** The clock, in milliseconds; a parameter so tests do not wait. */
  now?: () => number;
}

export interface QuotaResult {
  allowed: boolean;
  /** Seconds until the window of the key ends (at least 1). */
  retryAfterSeconds: number;
}

export interface Quota {
  consume: (id: string) => QuotaResult;
  /** Number of windows currently held. */
  size: () => number;
}

export function createQuota(options: QuotaOptions): Quota {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    consume(id) {
      const time = now();
      for (const [key, window] of windows) {
        if (time - window.start >= options.windowMs) windows.delete(key);
      }
      let window = windows.get(id);
      if (!window) {
        window = { start: time, count: 0 };
        windows.set(id, window);
      }
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((window.start + options.windowMs - time) / 1000),
      );
      if (window.count >= options.limit) return { allowed: false, retryAfterSeconds };
      window.count += 1;
      return { allowed: true, retryAfterSeconds };
    },
    size: () => windows.size,
  };
}
