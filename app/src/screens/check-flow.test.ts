// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { flowState, keepOnEntry, oneMoreStep } from './check-flow.js';

describe('flowState', () => {
  it('reads the steps to the check, the query and the matched name of the entry', () => {
    window.history.replaceState({ stepsToCheck: 2, query: 'doliprane', matched: 'DOLIPRANE' }, '');
    expect(flowState()).toEqual({ stepsToCheck: 2, query: 'doliprane', matched: 'DOLIPRANE' });
  });

  it('ignores values of the wrong type and anything else left on the entry', () => {
    window.history.replaceState(
      { stepsToCheck: '2', query: 3, matched: null, profileSaved: 'Awa', next: '/check' },
      '',
    );
    expect(flowState()).toEqual({});
    window.history.replaceState({ stepsToCheck: 0 }, '');
    expect(flowState()).toEqual({});
    window.history.replaceState({ stepsToCheck: 1.5 }, '');
    expect(flowState()).toEqual({});
    window.history.replaceState('text', '');
    expect(flowState()).toEqual({});
    window.history.replaceState(null, '');
    expect(flowState()).toEqual({});
  });

  it('keeps a patch on the entry with what was valid there', () => {
    window.history.replaceState({ stepsToCheck: 1, query: 'old' }, '');
    keepOnEntry({ query: 'new' });
    expect(flowState()).toEqual({ stepsToCheck: 1, query: 'new' });
  });
});

describe('oneMoreStep', () => {
  it('counts one more entry, or none when the way back is not known', () => {
    expect(oneMoreStep(1)).toBe(2);
    expect(oneMoreStep(undefined)).toBeUndefined();
    expect(oneMoreStep(0)).toBeUndefined();
  });
});
