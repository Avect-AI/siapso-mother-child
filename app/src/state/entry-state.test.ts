// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';
import {
  epochToken,
  forgetStaleEntry,
  inSession,
  intoThisEpoch,
  inVisit,
  newEpoch,
  newVisit,
  sessionState,
  visitState,
  visitToken,
} from './entry-state.js';

describe('entry state', () => {
  it('leaves only marks on the history entry: the values stay in memory', () => {
    window.history.replaceState(
      inSession({ query: 'efavirenz', matched: 'Efavirenz', id: 'efavirenz-generic' }),
      '',
    );

    // The browser writes history.state to disk (session restore): no value goes there.
    const written = JSON.stringify(window.history.state);
    expect(written).not.toContain('efavirenz');
    expect(written).not.toContain('Efavirenz');
    expect(sessionState()).toMatchObject({
      query: 'efavirenz',
      matched: 'Efavirenz',
      id: 'efavirenz-generic',
    });

    window.history.replaceState(inVisit({ dangerSigns: ['bleeding'] }), '');
    expect(JSON.stringify(window.history.state)).not.toContain('bleeding');
    expect(visitState()).toMatchObject({ dangerSigns: ['bleeding'] });
  });

  it('reads nothing a page load before left, even in the same visit', async () => {
    window.history.replaceState(inVisit({ dangerSigns: ['bleeding'] }), '');
    const visit = visitToken();

    // A reload: the module starts again, the visit kept in session storage stays.
    vi.resetModules();
    const reloaded = await import('./entry-state.js');

    expect(reloaded.visitToken()).toBe(visit);
    expect(reloaded.visitState()).not.toHaveProperty('dangerSigns');
    reloaded.forgetStaleEntry();
    expect(window.history.state).toBeNull();
  });

  it('forgets every value at a new visit', () => {
    window.history.replaceState(inVisit({ dangerSigns: ['bleeding'] }), '');
    const before = window.history.state as unknown;

    newVisit();
    window.history.replaceState(before, '');

    expect(visitState()).toEqual({});
  });

  it('gives a held screen its values back in the new epoch, once its own epoch has passed', () => {
    window.history.replaceState(inSession({ id: 'efavirenz-generic' }), '');
    const held = window.history.state as unknown;
    newEpoch();
    expect(sessionState()).toEqual({});

    window.history.replaceState(intoThisEpoch(held), '');

    expect(sessionState()).toMatchObject({ id: 'efavirenz-generic', epoch: epochToken() });
  });

  it('never reads values written on the entry itself, and takes them off', () => {
    window.history.replaceState({ dangerSigns: ['bleeding'], visit: visitToken() }, '');

    expect(visitState()).not.toHaveProperty('dangerSigns');
    forgetStaleEntry();
    expect(window.history.state).toBeNull();
  });
});
