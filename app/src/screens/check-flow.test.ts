// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { inSession, newEpoch } from '../state/entry-state.js';
import { confirmPath, flowState, keepOnEntry, oneMoreStep } from './check-flow.js';

describe('flowState', () => {
  it('reads the steps to the check, the query, the matched name and the id of the entry', () => {
    window.history.replaceState(
      inSession({ stepsToCheck: 2, query: 'doliprane', matched: 'DOLIPRANE', id: 'p' }),
      '',
    );
    expect(flowState()).toEqual({
      stepsToCheck: 2,
      query: 'doliprane',
      matched: 'DOLIPRANE',
      id: 'p',
    });
  });

  it('ignores values of the wrong type and anything else left on the entry', () => {
    window.history.replaceState(
      inSession({ stepsToCheck: '2', query: 3, matched: null, id: '', profileSaved: 'Awa' }),
      '',
    );
    expect(flowState()).toEqual({});
    window.history.replaceState(inSession({ stepsToCheck: 0 }), '');
    expect(flowState()).toEqual({});
    window.history.replaceState(inSession({ stepsToCheck: 1.5 }), '');
    expect(flowState()).toEqual({});
    window.history.replaceState('text', '');
    expect(flowState()).toEqual({});
    window.history.replaceState(null, '');
    expect(flowState()).toEqual({});
  });

  it('reads nothing left in another visit or before a lock', () => {
    window.history.replaceState({ stepsToCheck: 2, query: 'efavirenz' }, '');
    expect(flowState()).toEqual({});
    window.history.replaceState(inSession({ query: 'efavirenz' }), '');
    newEpoch();
    expect(flowState()).toEqual({});
  });

  it('keeps a patch on the entry with what was valid there', () => {
    window.history.replaceState(inSession({ stepsToCheck: 1, query: 'old' }), '');
    keepOnEntry({ query: 'new' });
    expect(flowState()).toEqual({ stepsToCheck: 1, query: 'new' });
  });

  it('keeps that the text was heard by the voice, only when it was', () => {
    window.history.replaceState(inSession({ query: 'nebeday', heard: true }), '');
    expect(flowState()).toEqual({ query: 'nebeday', heard: true });
    keepOnEntry({ heard: false });
    expect(flowState()).toEqual({ query: 'nebeday' });
    window.history.replaceState(inSession({ query: 'x', heard: 'yes' }), '');
    expect(flowState()).toEqual({ query: 'x' });
  });

  // SCRUM-61: the products ticked in a sentence are confirmed one after the other.
  it('reads the products still to confirm after this one, how many were ticked, and one added', () => {
    const next = { kind: 'plant', id: 'moringa', query: 'nebeday', matched: 'nebeday' };
    window.history.replaceState(
      inSession({ id: 'p', queue: [next], queueTotal: 2, queueAdded: true }),
      '',
    );
    expect(flowState()).toEqual({ id: 'p', queue: [next], queueTotal: 2, queueAdded: true });
  });

  it('ignores a queue that is not a list of products to confirm', () => {
    for (const queue of [
      'moringa',
      [{ kind: 'unrecognised', id: 'x', query: '', matched: '' }],
      [{ kind: 'plant', id: '', query: '', matched: '' }],
      [{ kind: 'plant', id: 'moringa', query: 3, matched: '' }],
    ]) {
      window.history.replaceState(inSession({ id: 'p', queue, queueTotal: 0 }), '');
      expect(flowState(), JSON.stringify(queue)).toEqual({ id: 'p' });
    }
  });

  it('never puts the product in the address', () => {
    expect(confirmPath('product')).toBe('/confirm/product');
  });
});

describe('oneMoreStep', () => {
  it('counts one more entry, or none when the way back is not known', () => {
    expect(oneMoreStep(1)).toBe(2);
    expect(oneMoreStep(undefined)).toBeUndefined();
    expect(oneMoreStep(0)).toBeUndefined();
  });
});
