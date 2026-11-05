// SPDX-License-Identifier: MIT
// The code steps as the user goes through them, in French.
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { TEST_CODE } from './render-app.js';

/**
 * Makes the code at the end of the welcome: its length chosen when another
 * one is offered, typed, then typed again (each moves on at its last digit).
 */
export async function makeCode(user: UserEvent, code: string = TEST_CODE): Promise<void> {
  await screen.findByRole('heading', { name: /^Choisissez un code de \d chiffres$/ });
  const length = screen.getByRole<HTMLInputElement>('radio', { name: String(code.length) });
  if (!length.checked) await user.click(length);
  await user.type(screen.getByLabelText('Code'), code);
  await user.type(await screen.findByLabelText('Tapez-le encore'), code);
}

/**
 * Gives the code on the code screen: a code of the length kept with the
 * stored one is tried at its last digit (SCRUM-56); otherwise "Ouvrir".
 */
export async function enterCode(user: UserEvent, code: string = TEST_CODE): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' });
  const field = screen.getByLabelText<HTMLInputElement>('Code');
  await user.type(field, code);
  // Tried already: the screen says it is opening, or the try is over (the
  // field emptied, or the screen gone).
  const tried =
    screen.queryByText('Ouverture en cours.') !== null ||
    !field.isConnected ||
    field.value !== code;
  if (!tried) await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
}
