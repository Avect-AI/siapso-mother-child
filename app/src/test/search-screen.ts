// SPDX-License-Identifier: MIT
// The search screen of one list, reached from the check. Since the check has
// its own field for both lists (SCRUM-56, S12), the app opens it for "Je ne
// trouve pas ce produit" (the name looks like products) and for the whole list
// after the voice found nothing: one history entry after the check, which
// "yes" on a confirm screen comes back to. Its own tests open it the same way.
import { act, screen } from '@testing-library/react';
import { navigate } from 'wouter/use-hash-location';
import { inSession } from '../state/entry-state.js';

/** The list, by the name of the button that opened it before SCRUM-56. */
export type SearchList = 'Ajouter un médicament' | 'Ajouter un remède';

/** Opens the search screen of `list` from the check on show; resolves with its field. */
export async function openSearchScreen(list: SearchList): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 1, name: /^Ce qu/ });
  act(() => {
    navigate(list === 'Ajouter un remède' ? '/search/plant' : '/search/product', {
      state: inSession({ stepsToCheck: 1 }),
    });
  });
  return screen.findByRole('searchbox', {
    name: list === 'Ajouter un remède' ? 'Nom du remède' : 'Nom du médicament',
  });
}
