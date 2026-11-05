// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';
import { createStorageKeeper } from './storage.js';

describe('keeping the data for good', () => {
  it('asks the browser while the data may be evicted, and says what it answered', async () => {
    const persist = vi.fn(() => Promise.resolve(false));
    const keeper = createStorageKeeper(() => ({
      persisted: () => Promise.resolve(false),
      persist,
    }));
    const seen = vi.fn();
    keeper.subscribe(seen);

    expect(keeper.getSnapshot()).toBe('unknown');
    await keeper.keep();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(keeper.getSnapshot()).toBe('best-effort');
    expect(seen).toHaveBeenCalled();

    persist.mockResolvedValueOnce(true);
    await keeper.keep();
    expect(keeper.getSnapshot()).toBe('persistent');
  });

  it('does not ask again once the data is kept for good', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    const keeper = createStorageKeeper(() => ({ persisted: () => Promise.resolve(true), persist }));

    await keeper.keep();

    expect(persist).not.toHaveBeenCalled();
    expect(keeper.getSnapshot()).toBe('persistent');
  });

  it('says nothing it does not know: no storage manager, or a browser that throws', async () => {
    expect(await createStorageKeeper(() => undefined).keep()).toBe('unknown');
    const refusing = createStorageKeeper(() => ({
      persist: () => Promise.reject(new Error('not here')),
    }));
    expect(await refusing.keep()).toBe('unknown');
  });
});
