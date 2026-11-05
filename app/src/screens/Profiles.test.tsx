// SPDX-License-Identifier: MIT
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import { AUTO_LOCK_MS } from '../domain/code.js';
import { addDays, todayIso } from '../domain/dates.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { enterCode } from '../test/code-steps.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';
import { inSession } from '../state/entry-state.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

vi.setConfig({ testTimeout: 20_000 });

const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };

describe('Profiles', () => {
  it('lists the women by pseudonym, each with a way to her profile, and adds one', async () => {
    for (const [id, pseudonym] of [
      ['a', 'Femme 10'],
      ['b', 'Awa'],
      ['c', 'Femme 2'],
    ] as const) {
      await saveProfile(profileOf({ id, pseudonym }));
    }
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/' });

    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    const rows = within(list).getAllByRole('listitem');
    // In the order of the pseudonyms, numbers read as numbers.
    expect(rows.map((row) => row.querySelector('.profiles__name')?.textContent)).toEqual([
      'Awa',
      'Femme 2',
      'Femme 10',
    ]);
    expect(within(list).getByRole('link', { name: "Modifier le profil d'Awa" })).toHaveAttribute(
      'href',
      '#/profile/edit',
    );
    const add = screen.getByRole('button', { name: 'Ajouter un profil' });
    expect(add).toHaveClass('button--primary');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);

    await user.click(add);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nouveau profil' })).toBeVisible();
  });

  it('says under each pseudonym where she stands: the term used, the baby, or an update to make', async () => {
    const today = todayIso(new Date());
    await saveProfile(
      profileOf({ id: 'a', pseudonym: 'Awa', term: { kind: 'weeks', weeks: 32, givenOn: today } }),
    );
    await saveProfile(
      profileOf({
        id: 'b',
        pseudonym: 'Bineta',
        // Month 7 starts at 27 weeks: 120 days later, past 42 weeks.
        term: { kind: 'months', months: 7, givenOn: addDays(today, -120) },
        updatedAt: `${addDays(today, -120)}T08:00:00.000Z`,
      }),
    );
    await saveProfile(
      profileOf({
        id: 'c',
        pseudonym: 'Coumba',
        pregnant: false,
        breastfeeding: true,
        babyAgeWeeks: 13,
        babyAgeMonths: 3,
        babyAgeGivenOn: today,
        premature: false,
      }),
    );
    await renderApp({ settings: accompanied, hash: '#/' });

    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    const open = (name: RegExp) => within(list).getByRole('button', { name });
    expect(open(/^Awa/)).toHaveAccessibleName('Awa Environ 32 semaines');
    expect(open(/^Bineta/)).toHaveAccessibleName('Bineta À mettre à jour');
    expect(open(/^Coumba/)).toHaveAccessibleName('Coumba Allaite, bébé de 3 mois');
  });

  it('says a profile was deleted, once', async () => {
    await saveProfile(profileOf({ id: 'b', pseudonym: 'Binta' }));
    await renderApp({
      settings: accompanied,
      hash: '#/',
      entryState: inSession({ profileDeleted: 'Awa' }),
    });

    expect(await screen.findByText(/^Profil supprimé\s: Awa\.$/)).toBeVisible();
  });

  it('opens her profile without its id in the address, and again after a lock', async () => {
    await saveProfile(profileOf({ id: 'profile-of-awa', pseudonym: 'Awa' }));
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/' });

    await user.click(await screen.findByRole('link', { name: "Modifier le profil d'Awa" }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Modifier le profil' }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Awa');
    expect(window.location.hash).toBe('#/profile/edit');
    expect(JSON.stringify(window.history.state)).not.toContain('profile-of-awa');

    // Two minutes without a touch lock it: the code brings her profile back.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      act(() => {
        window.dispatchEvent(new Event('pointerdown'));
      });
      act(() => {
        vi.advanceTimersByTime(AUTO_LOCK_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    await enterCode(user);
    expect(await screen.findByRole('textbox', { name: 'Surnom' })).toHaveValue('Awa');
    expect(window.location.hash).toBe('#/profile/edit');
  });

  it('goes to the list when the profile to change is not known any more (a reload)', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    await renderApp({ settings: accompanied, hash: '#/profile/edit' });

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    expect(window.location.hash).toBe('#/');
  });

  it('says when there is no profile yet', async () => {
    await renderApp({ settings: accompanied, hash: '#/' });

    expect(await screen.findByText('Aucun profil sur ce téléphone pour le moment.')).toBeVisible();
    expect(screen.queryByRole('list', { name: /^Profils enregistrés/ })).toBeNull();
    // The start of accompanied mode, as Home is for a woman: whether the phone works offline.
    expect(document.querySelector('main .offline-ready')).toHaveAttribute('role', 'status');
  });

  it('keeps the list of each woman while another is looked at, and says so on her row', async () => {
    await saveProfile(profileOf({ id: 'b', pseudonym: 'Bineta' }));
    await saveProfile(profileOf({ id: 'c', pseudonym: 'Coumba' }));
    const probe = probeCheck();
    const user = userEvent.setup();
    await renderApp({
      settings: accompanied,
      hash: '#/',
      packLoader: loaderOf(await knowledgePack()),
      children: probe.element,
    });
    const open = async (name: RegExp) => {
      const list = await screen.findByRole('list', {
        name: 'Profils enregistrés sur ce téléphone',
      });
      await user.click(within(list).getByRole('button', { name }));
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" });
    };

    await open(/^Bineta/);
    act(() => {
      probe.current().add({ ref: { kind: 'plant', id: 'kinkeliba' } });
    });
    expect(await screen.findByText(/^Kinkéliba/)).toBeVisible();
    act(() => {
      window.history.back();
    });
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    // The accessible name reads the no-break space before ":" as a plain space.
    expect(within(list).getByRole('button', { name: /^Bineta/ })).toHaveAccessibleName(
      'Bineta Environ 26 semaines Liste en cours : 1 produit',
    );

    await open(/^Coumba/);
    expect(screen.getByText(/^Rien n'est encore ajouté\./)).toBeVisible();
    act(() => {
      window.history.back();
    });
    await open(/^Bineta/);

    // Her list as it was left, nothing to type again.
    expect(screen.getByText(/^Kinkéliba/)).toBeVisible();
  });

  it('puts "Ajouter un profil" and a check without saving above the list', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    await renderApp({ settings: accompanied, hash: '#/' });

    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    const add = screen.getByRole('button', { name: 'Ajouter un profil' });
    const quick = screen.getByRole('button', { name: 'Regarder sans enregistrer' });
    expect(quick).toHaveClass('button--secondary');
    for (const action of [add, quick]) {
      expect(action.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('finds a woman by her pseudonym once more than 8 are followed', async () => {
    const names = ['Awa', 'Aïssatou', 'Bineta', 'Coumba', 'Diarra', 'Fatou', 'Khady', 'Mariama'];
    for (const [index, pseudonym] of names.entries()) {
      await saveProfile(profileOf({ id: `p${String(index)}`, pseudonym }));
    }
    const { unmount } = await renderApp({ settings: accompanied, hash: '#/' });
    await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    // Eight: the list is short enough to read.
    expect(screen.queryByRole('searchbox')).toBeNull();
    unmount();

    await saveProfile(profileOf({ id: 'p9', pseudonym: 'Ndeye' }));
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/' });
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    const field = screen.getByRole('searchbox', { name: 'Chercher un profil' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);

    // Without case or accents, anywhere in the pseudonym.
    await user.type(field, 'AISS');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByRole('button', { name: /^Aïssatou/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ajouter un profil' })).toBeVisible();

    await user.clear(field);
    await user.type(field, 'zz');
    expect(screen.getByText('Aucun profil ne porte ce surnom.')).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Profils enregistrés sur ce téléphone' })).toBeNull();
  });

  it('is never rendered while locked: the code first, then the list', async () => {
    await saveProfile(profileOf({ id: 'a', pseudonym: 'Awa' }));
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/', locked: true });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    expect(screen.queryByRole('list', { name: /^Profils enregistrés/ })).toBeNull();
    expect(document.body.textContent).not.toContain('Awa');

    await enterCode(user);
    const list = await screen.findByRole('list', { name: 'Profils enregistrés sur ce téléphone' });
    expect(within(list).getByRole('button', { name: /^Awa / })).toBeVisible();
  });
});
