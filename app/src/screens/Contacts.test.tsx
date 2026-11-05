// SPDX-License-Identifier: MIT
// Phone numbers in these tests are made up: +999 is not a country code, and
// local numbers are runs of the same digits. No real number in the repository.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSavedContacts, saveContacts } from '../data/referral.js';
import type { ReferralContact, Settings } from '../domain/types.js';
import { renderApp } from '../test/render-app.js';

// What a test makes fail: keeping the contacts.
const failure = vi.hoisted(() => ({ save: null as Error | null }));

vi.mock('../data/referral.js', async (importOriginal) => {
  const referral = await importOriginal<typeof import('../data/referral.js')>();
  return {
    ...referral,
    saveContacts: (contacts: ReferralContact[]) =>
      failure.save === null ? referral.saveContacts(contacts) : Promise.reject(failure.save),
  };
});

vi.setConfig({ testTimeout: 20_000 });

const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
const AWA: ReferralContact = { id: 'c1', role: 'relay', name: 'Awa', phone: '000 000 001' };

beforeEach(() => {
  failure.save = null;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('Not found', { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Waits until the screen's status line (not the header's offline badge) says `text`. */
async function saysInStatus(text: string) {
  const line = await within(await screen.findByRole('main')).findByText(text);
  expect(line).toHaveAttribute('role', 'status');
}

describe('Contacts', () => {
  it('adds a contact: a role, a name if known and a number, kept on the phone', async () => {
    await renderApp({ settings: accompanied, hash: '#/contacts' });
    const user = userEvent.setup();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Contacts à appeler' }),
    ).toBeVisible();
    expect(screen.getByText('Ces numéros restent sur ce téléphone.')).toBeVisible();
    expect(await screen.findByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Ajouter un contact' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Nouveau contact' })).toBeVisible();
    // The form comes once the contacts saved on the phone are read.
    await user.click(await screen.findByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByText('Choisissez un rôle.')).toBeVisible();
    expect(screen.getByText('Écrivez un numéro de téléphone.')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Relais' })).toHaveFocus();

    await user.click(screen.getByText('Relais'));
    await user.type(screen.getByRole('textbox', { name: 'Nom' }), 'Awa');
    const phone = screen.getByRole('textbox', { name: 'Numéro de téléphone' });
    expect(phone).toHaveAttribute('type', 'tel');
    await user.type(phone, '000-000');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(
      screen.getByText(
        'Écrivez de 6 à 15 chiffres, avec des espaces si vous voulez, et un + seulement au début.',
      ),
    ).toBeVisible();

    await user.clear(phone);
    await user.type(phone, ' 000  000 001 ');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Contacts à appeler' }),
    ).toBeVisible();
    await saysInStatus('Contact enregistré : Awa (Relais).');
    const list = await screen.findByRole('list', { name: 'Contacts enregistrés sur ce téléphone' });
    expect(within(list).getByRole('listitem')).toHaveTextContent('AwaRelais000 000 001');
    const saved = await loadSavedContacts();
    expect(saved).toEqual([
      { id: expect.any(String) as unknown, role: 'relay', name: 'Awa', phone: '000 000 001' },
    ]);
  });

  it('changes a contact saved on the phone', async () => {
    await saveContacts([AWA]);
    await renderApp({ settings: accompanied, hash: '#/contacts' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: 'Modifier Awa (Relais)' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Modifier le contact' }),
    ).toBeVisible();
    expect(await screen.findByRole('radio', { name: 'Relais' })).toBeChecked();
    const phone = screen.getByRole('textbox', { name: 'Numéro de téléphone' });
    expect(phone).toHaveValue('000 000 001');
    await user.click(screen.getByText('Sage-femme'));
    await user.clear(phone);
    await user.type(phone, '+999 000 004');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText('Contact enregistré : Awa (Sage-femme).')).toBeVisible();
    expect(await loadSavedContacts()).toEqual([
      { id: 'c1', role: 'midwife', name: 'Awa', phone: '+999 000 004' },
    ]);
  });

  it('takes a contact off the phone, with a way to put it back', async () => {
    await saveContacts([AWA, { id: 'c2', role: 'icp', name: '', phone: '000 000 002' }]);
    await renderApp({ settings: accompanied, hash: '#/contacts' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Retirer Awa (Relais)' }));
    await saysInStatus('Awa (Relais) est retiré des contacts.');
    await waitFor(async () => {
      expect((await loadSavedContacts()).map((c) => c.id)).toEqual(['c2']);
    });

    await user.click(screen.getByRole('button', { name: 'Remettre dans les contacts' }));
    await saysInStatus('Awa (Relais) est remis dans les contacts.');
    expect((await loadSavedContacts()).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('says so when the phone cannot keep the contacts, keeping what was typed', async () => {
    await renderApp({ settings: accompanied, hash: '#/contacts/new' });
    const user = userEvent.setup();
    failure.save = new Error('storage refused');

    await user.click(await screen.findByText('Bajenu Gox'));
    await user.type(screen.getByRole('textbox', { name: 'Numéro de téléphone' }), '000000');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByText(
        "Les contacts n'ont pas pu être enregistrés sur ce téléphone. Essayez encore.",
      ),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Numéro de téléphone' })).toHaveValue('000000');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  });

  it('lists the contacts of the deployment file apart, to read only', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            contacts: [{ role: 'midwife', name: 'Maternité', phone: '000 000 003' }],
          }),
        ),
      ),
    );
    await renderApp({ settings: accompanied, hash: '#/contacts' });

    const provided = await screen.findByRole('region', {
      name: "Contacts fournis avec l'application",
    });
    expect(within(provided).getByText('Maternité')).toBeVisible();
    expect(within(provided).queryByRole('link')).toBeNull();
    expect(within(provided).queryByRole('button')).toBeNull();
  });

  it('says when the contact to change is no longer on the phone', async () => {
    await renderApp({ settings: accompanied, hash: '#/contacts/c9' });

    expect(
      await screen.findByText("Ce contact n'est plus sur ce téléphone. Revenez aux contacts."),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  });

  it('is for accompanied mode: in woman mode the route goes home', async () => {
    await renderApp({
      settings: { lang: 'fr', mode: 'woman', onboarded: true },
      hash: '#/contacts',
    });

    expect(await screen.findByRole('button', { name: 'Regarder un produit' })).toBeVisible();
    expect(window.location.hash).toBe('#/');
  });
});
