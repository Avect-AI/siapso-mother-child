// SPDX-License-Identifier: MIT
// The code steps as the user goes through them, in French.
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { TEST_CODE } from './render-app.js';

/** Makes the code at the end of the welcome: typed, "Continuer", typed again, "Enregistrer le code". */
export async function makeCode(user: UserEvent, code: string = TEST_CODE): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Choisissez un code' });
  await user.type(screen.getByLabelText('Code'), code);
  await user.click(screen.getByRole('button', { name: 'Continuer' }));
  await screen.findByRole('heading', { level: 1, name: 'Tapez le code une deuxième fois' });
  await user.type(screen.getByLabelText('Le même code'), code);
  await user.click(screen.getByRole('button', { name: 'Enregistrer le code' }));
}

/** Gives the code on the code screen, then "Ouvrir". */
export async function enterCode(user: UserEvent, code: string = TEST_CODE): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' });
  await user.type(screen.getByLabelText('Code'), code);
  await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
}
