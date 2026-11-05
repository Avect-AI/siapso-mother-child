// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { closeAppDb } from '../data/db.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import type { Profile, Settings } from '../domain/types.js';
import { AppProvider, useApp } from '../state/app-state.js';
import { breakIndexedDB, hangIndexedDB } from '../test/idb.js';
import { loaderOf, renderApp, seedSettings, shellPack, storeTestCode } from '../test/render-app.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };

function stored(patch: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    pseudonym: 'Awa',
    pregnant: true,
    term: { kind: 'weeks', weeks: 26, givenOn: '2026-11-04' },
    breastfeeding: false,
    conditions: [],
    longTermItems: [],
    createdAt: '2026-11-04T08:00:00.000Z',
    updatedAt: '2026-11-04T08:00:00.000Z',
    ...patch,
  };
}

function group(name: string | RegExp) {
  return screen.getByRole('group', { name });
}

function option(groupName: string | RegExp, name: string | RegExp) {
  return within(group(groupName)).getByRole('radio', { name });
}

async function openForm(settings: Settings, hash = '#/profile') {
  await renderApp({ settings, hash });
  return screen.findByRole('button', { name: 'Enregistrer' });
}

beforeEach(() => {
  // Only the clock: IndexedDB and user events keep their real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ProfileEdit: the common case', () => {
  it('saves "26 weeks, no situation", goes home and says so', async () => {
    const user = userEvent.setup();
    await openForm(woman);

    expect(screen.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Moi');
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), '26');
    expect(screen.getByText('Environ 26 semaines')).toBeVisible();
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: /^Un médicament ou un remède/ }),
    ).toBeVisible();
    // The note names the profile saved (a no-break space before the colon).
    expect(screen.getByText('Profil enregistré : Moi.')).toBeVisible();
    const profiles = await listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      pseudonym: 'Moi',
      pregnant: true,
      term: { kind: 'weeks', weeks: 26, givenOn: '2026-11-04' },
      breastfeeding: false,
      conditions: [],
      longTermItems: [],
    });
    expect(profiles[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(profiles[0]).not.toHaveProperty('babyAgeWeeks');
  });

  it('shows the saved answers when the profile is opened again, and edits the same profile', async () => {
    await saveProfile(stored({ conditions: ['epilepsy-treatment'] }));
    const user = userEvent.setup();
    await openForm(woman);

    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Awa');
    expect(option(/^Enceinte/, 'Oui')).toBeChecked();
    expect(option('Terme de la grossesse', 'En semaines')).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveValue('26');
    expect(screen.getByText('Environ 26 semaines')).toBeVisible();
    expect(option(/^Allaite/, 'Non')).toBeChecked();
    expect(screen.getByRole('checkbox', { name: "Traitement contre l'épilepsie" })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Aucune de ces situations' })).not.toBeChecked();

    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });
    await user.clear(weeks);
    await user.type(weeks, '27');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/^Profil enregistré/)).toBeVisible();
    const profiles = await listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: 'p1',
      createdAt: '2026-11-04T08:00:00.000Z',
      term: { kind: 'weeks', weeks: 27 },
      conditions: ['epilepsy-treatment'],
    });
  });

  it('shows the weeks reached today for a term given weeks ago, and saving keeps it as stored', async () => {
    const term = { kind: 'weeks', weeks: 18, givenOn: '2026-08-09' } as const;
    await saveProfile(stored({ term }));
    const user = userEvent.setup();
    await openForm(woman);

    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveValue('30');
    expect(screen.getByText('Environ 30 semaines')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    // The days past the last whole week are not lost: the stored term is unchanged.
    expect((await listProfiles())[0]?.term).toEqual(term);
  });

  it("shows today's month for a month given earlier, and asks again for one given too long ago", async () => {
    await saveProfile(stored({ term: { kind: 'months', months: 5, givenOn: '2026-10-07' } }));
    const { unmount } = await renderApp({ settings: woman, hash: '#/profile' });
    const months = await screen.findByRole('textbox', { name: /^Dans quel mois de grossesse/ });
    expect(months).toHaveValue('6');
    expect(screen.getByText('Entre 23 et 32 semaines (estimé)')).toBeVisible();
    unmount();

    await saveProfile(stored({ term: { kind: 'months', months: 9, givenOn: '2026-08-26' } }));
    await renderApp({ settings: woman, hash: '#/profile' });
    const old = await screen.findByRole('textbox', { name: /^Dans quel mois de grossesse/ });
    expect(old).toHaveValue('9');
    expect(old).toHaveAccessibleDescription(/^Ce mois a été donné il y a longtemps/);
  });

  it('asks the month about her in accompanied mode, as "Ce qu\'elle prend" does', async () => {
    await saveProfile(stored({ term: { kind: 'months', months: 5, givenOn: '2026-10-07' } }));
    await openForm(accompanied, '#/profile/p1');
    expect(
      screen.getByRole('textbox', { name: /^Dans quel mois de grossesse est-elle/ }),
    ).toHaveValue('6');
    expect(screen.queryByRole('textbox', { name: /êtes-vous/ })).toBeNull();
  });

  it('reopens a baby age given in months as months', async () => {
    await saveProfile(
      stored({
        breastfeeding: true,
        babyAgeWeeks: 13,
        babyAgeMonths: 3,
        babyAgeGivenOn: '2026-11-04',
        premature: false,
      }),
    );
    await openForm(woman);

    expect(option('Âge du bébé', 'En mois')).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Âge en mois' })).toHaveValue('3');
    expect(screen.getByText('Environ 13 semaines')).toBeVisible();
  });

  it('keeps the answers, and reads nothing again from storage, when the language changes', async () => {
    const user = userEvent.setup();
    function English() {
      const { setSettings } = useApp();
      return (
        <button
          type="button"
          onClick={() => {
            void setSettings({ lang: 'en' });
          }}
        >
          to English
        </button>
      );
    }
    await seedSettings(woman);
    window.location.hash = '#/profile';
    render(
      <AppProvider packLoader={loaderOf(shellPack())} session={{ startUnlocked: true }}>
        <App>
          <English />
        </App>
      </AppProvider>,
    );
    await screen.findByRole('button', { name: 'Enregistrer' });
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), '26');
    // A profile appearing in storage now would become "hers" if the screen read again.
    await saveProfile(stored({ id: 'other', pseudonym: 'Other' }));

    await user.click(screen.getByRole('button', { name: 'to English' }));

    expect(await screen.findByRole('button', { name: 'Save' })).toBeVisible();
    expect(within(group('Pregnant?')).getByRole('radio', { name: 'Yes' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Number of weeks' })).toHaveValue('26');
    await user.click(within(group('Breastfeeding?')).getByRole('radio', { name: 'No' }));
    await user.click(screen.getByRole('checkbox', { name: 'None of these situations' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText(/^Profile saved/);
    expect((await listProfiles()).map((p) => p.pseudonym).sort()).toEqual(['Moi', 'Other']);
  });
});

describe('ProfileEdit: validation', () => {
  it('refuses "no" to both questions, saying the app is for pregnancy and breastfeeding', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Non'));
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      within(group(/^Allaite/)).getByText(/^L'application sert pendant la grossesse/),
    ).toBeVisible();
    expect(option(/^Allaite/, 'Oui')).toHaveFocus();
    expect(await listProfiles()).toEqual([]);
  });

  it('says at once when a number typed is out of range, before any save', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));
    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });

    await user.type(weeks, '6');
    expect(weeks).not.toHaveAttribute('aria-invalid');
    await user.type(weeks, '2');

    expect(weeks).toHaveAccessibleDescription(/Écrivez un nombre entier de 0 à 42\./);
    // Questions not answered yet are not marked before a save.
    expect(within(group(/^Allaite/)).queryByText('Répondez oui ou non.')).toBeNull();
  });

  it('names each missing answer next to its question and moves focus to the first one', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.clear(screen.getByRole('textbox', { name: 'Surnom' }));

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const pseudonym = screen.getByRole('textbox', { name: 'Surnom' });
    expect(pseudonym).toHaveAccessibleDescription(/Écrivez un surnom\./);
    expect(pseudonym).toHaveAttribute('aria-invalid', 'true');
    expect(pseudonym).toHaveFocus();
    expect(within(group(/^Enceinte/)).getByText('Répondez oui ou non.')).toBeVisible();
    expect(within(group(/^Allaite/)).getByText('Répondez oui ou non.')).toBeVisible();
    expect(
      within(group('Situations de longue durée')).getByText('Cochez au moins une case.'),
    ).toBeVisible();
    expect(await listProfiles()).toEqual([]);
  });

  it('updates the messages as answers come once a save was tried', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(option(/^Enceinte/, 'Oui')).toHaveFocus();

    await user.click(option(/^Enceinte/, 'Oui'));
    expect(within(group(/^Enceinte/)).queryByText('Répondez oui ou non.')).toBeNull();
    expect(
      within(group('Terme de la grossesse')).getByText('Choisissez une réponse.'),
    ).toBeVisible();

    await user.click(option('Terme de la grossesse', 'En semaines'));
    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });
    await user.type(weeks, '50');
    expect(weeks).toHaveAccessibleDescription(/Écrivez un nombre entier de 0 à 42\./);
    expect(screen.queryByText(/^Environ/)).toBeNull();
  });

  it('refuses a pseudonym that looks like a phone number', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    const pseudonym = screen.getByRole('textbox', { name: 'Surnom' });
    await user.clear(pseudonym);
    await user.type(pseudonym, '00 000 00 00');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(pseudonym).toHaveAccessibleDescription(/Pas de numéro de téléphone/);
  });

  it('says why a last period date cannot be used', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Date des dernières règles'));
    const date = screen.getByLabelText('Premier jour des dernières règles');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(date).toHaveAccessibleDescription('Écrivez une date.');

    fireEvent.change(date, { target: { value: '2026-11-20' } });
    // \s: French puts a no-break space before the colon.
    expect(date).toHaveAccessibleDescription(/^Cette date est après aujourd'hui\s: choisissez/);

    fireEvent.change(date, { target: { value: '2025-11-01' } });
    expect(date).toHaveAccessibleDescription(/remonte à plus de 45 semaines/);
  });
});

describe('ProfileEdit: the term', () => {
  it('computes the term from the last period, offers to correct it in weeks, and stores the date', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Date des dernières règles'));
    const date = screen.getByLabelText('Premier jour des dernières règles');
    expect(date).toHaveAttribute('type', 'date');
    expect(date).toHaveAttribute('max', '2026-11-04');
    fireEvent.change(date, { target: { value: '2026-05-06' } });

    expect(screen.getByText('Environ 26 semaines')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Corriger le nombre de semaines' }));

    expect(option('Terme de la grossesse', 'En semaines')).toBeChecked();
    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });
    expect(weeks).toHaveValue('26');
    expect(weeks).toHaveFocus();
  });

  it('stores a last period as a date', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Date des dernières règles'));
    fireEvent.change(screen.getByLabelText('Premier jour des dernières règles'), {
      target: { value: '2026-05-06' },
    });
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    expect((await listProfiles())[0]?.term).toEqual({ kind: 'lmp', date: '2026-05-06' });
  });

  it('shows the estimated range of a month, and an unknown term in words', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));

    await user.click(option('Terme de la grossesse', 'En mois'));
    await user.type(screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ }), '5');
    expect(screen.getByText('Entre 19 et 28 semaines (estimé)')).toBeVisible();

    await user.click(option('Terme de la grossesse', 'Je ne sais pas'));
    expect(screen.getByText('Terme inconnu')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /^Dans quel mois de grossesse/ })).toBeNull();
  });

  it('explains weeks as weeks of amenorrhoea, counted from the last period', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));

    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveAccessibleDescription(
      "Semaines d'aménorrhée (depuis les dernières règles), de 0 à 42.",
    );
  });

  it('asks nothing about the term when not pregnant, and stores none', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Non'));

    expect(screen.queryByRole('group', { name: 'Terme de la grossesse' })).toBeNull();
    await user.click(option(/^Allaite/, 'Oui'));
    await user.click(option('Âge du bébé', 'En mois'));
    await user.type(screen.getByRole('textbox', { name: 'Âge en mois' }), '3');
    // The months read back in the weeks the rules use.
    expect(screen.getByText('Âge retenu')).toBeVisible();
    expect(screen.getByText('Environ 13 semaines')).toBeVisible();
    await user.click(option(/^Né avant terme/, 'Je ne sais pas'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    const [profile] = await listProfiles();
    expect(profile).toMatchObject({
      pregnant: false,
      breastfeeding: true,
      babyAgeWeeks: 13,
      babyAgeGivenOn: '2026-11-04',
      premature: null,
    });
    expect(profile).not.toHaveProperty('term');
  });

  it('stores a baby birth date', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Non'));
    await user.click(option(/^Allaite/, 'Oui'));
    await user.click(option('Âge du bébé', 'Date de naissance'));
    const birth = screen.getByLabelText('Date de naissance du bébé');
    expect(birth).toHaveAttribute('max', '2026-11-04');
    fireEvent.change(birth, { target: { value: '2026-10-01' } });
    await user.click(option(/^Né avant terme/, 'Oui'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    expect((await listProfiles())[0]).toMatchObject({
      babyBirthDate: '2026-10-01',
      premature: true,
    });
  });
});

describe('ProfileEdit: situations and modes', () => {
  it('shows four situations in woman mode', async () => {
    await openForm(woman);

    const situations = within(group('Situations de longue durée')).getAllByRole('checkbox');
    expect(situations.map((box) => box.closest('label')?.textContent)).toEqual([
      'VIH, avec cotrimoxazole',
      'Traitement contre la tuberculose',
      "Traitement contre l'épilepsie",
      "Ancienne césarienne (cicatrice sur l'utérus)",
      'Aucune de ces situations',
    ]);
  });

  it('shows seven situations in accompanied mode, and numbers the new profile', async () => {
    await saveProfile(stored());
    await openForm(accompanied, '#/profile/new');

    expect(screen.getByRole('heading', { level: 1, name: 'Nouveau profil' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Femme 2');
    expect(screen.getByRole('checkbox', { name: 'Insuffisance rénale' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Insuffisance hépatique' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Drépanocytose' })).toBeVisible();
  });

  it('creates a second profile in accompanied mode instead of editing the first', async () => {
    await saveProfile(stored());
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/new');
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Je ne sais pas'));
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Drépanocytose' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    const profiles = await listProfiles();
    expect(profiles.map((p) => p.pseudonym)).toEqual(['Awa', 'Femme 2']);
    expect(profiles[1]).toMatchObject({ term: { kind: 'unknown' }, conditions: ['sickle-cell'] });
  });

  it('keeps a situation woman mode does not show when the profile is saved there', async () => {
    await saveProfile(stored({ conditions: ['sickle-cell'] }));
    const user = userEvent.setup();
    await openForm(woman);

    expect(screen.queryByRole('checkbox', { name: 'Drépanocytose' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Aucune de ces situations' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    expect((await listProfiles())[0]?.conditions).toEqual(['sickle-cell']);
  });

  it('makes "none of these" and the situations exclusive', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    const none = screen.getByRole('checkbox', { name: 'Aucune de ces situations' });
    const scar = screen.getByRole('checkbox', {
      name: "Ancienne césarienne (cicatrice sur l'utérus)",
    });

    await user.click(scar);
    await user.click(none);
    expect(scar).not.toBeChecked();
    expect(none).toBeChecked();

    await user.click(scar);
    expect(none).not.toBeChecked();
  });

  it('asks for no phone number or address, and every field has a label', async () => {
    await openForm(woman);

    const inputs = [...document.querySelectorAll('main input')];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(input).toHaveAccessibleName();
    expect(screen.queryByRole('textbox', { name: /téléphone|adresse/i })).toBeNull();
    expect(document.querySelector('input[type="tel"], input[autocomplete~="tel"]')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveAccessibleDescription(
      'Un surnom, jamais le vrai nom.',
    );
  });

  it('has one primary action', async () => {
    await openForm(woman);
    expect(document.querySelectorAll('.button--primary')).toHaveLength(1);
  });

  it('speaks English', async () => {
    await renderApp({ settings: { ...woman, lang: 'en' }, hash: '#/profile' });

    expect(await screen.findByRole('button', { name: 'Save' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'My profile' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Pregnant?' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Me');
  });
});

describe('ProfileEdit: storage', () => {
  it('edits a profile by its id', async () => {
    await saveProfile(stored({ id: 'abc', pseudonym: 'Fatou' }));
    await openForm(accompanied, '#/profile/abc');
    expect(screen.getByRole('heading', { level: 1, name: 'Modifier le profil' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Fatou');
  });

  it('says so when the profile asked for is not on this phone', async () => {
    await renderApp({ settings: accompanied, hash: '#/profile/missing' });

    expect(await screen.findByText(/^Ce profil n'est pas sur ce téléphone. Revenez/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  });

  it('says so when the profiles cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    await renderApp({ settings: woman });
    const link = await screen.findByRole('link', { name: 'Mon profil' });
    closeAppDb();
    breakIndexedDB('SecurityError');

    await user.click(link);

    expect(
      await screen.findByText(/^Les profils n'ont pas pu être lus sur ce téléphone. Fermez/),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  });

  it('stops waiting for storage that never answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    await renderApp({ settings: woman, storageTimeoutMs: 1000 });
    const link = await screen.findByRole('link', { name: 'Mon profil' });
    closeAppDb();
    hangIndexedDB();

    await user.click(link);

    expect(
      await screen.findByText(
        /^Les profils n'ont pas pu être lus sur ce téléphone\. Fermez/,
        {},
        { timeout: 3000 },
      ),
    ).toBeVisible();
  });

  it('keeps the answers and says so when the profile cannot be stored', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Je ne sais pas'));
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    closeAppDb();
    breakIndexedDB('QuotaExceededError');

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Ce profil n'a pas pu être enregistré sur ce téléphone. Essayez encore.",
    );
    expect(option(/^Enceinte/, 'Oui')).toBeChecked();
    expect(screen.getByRole('heading', { level: 1, name: 'Mon profil' })).toBeVisible();
  });
});

describe('ProfileEdit: what the browser keeps', () => {
  it('lets the browser keep no typed term or age in its form history', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));
    await user.click(option(/^Allaite/, 'Oui'));
    await user.click(option('Âge du bébé', 'En semaines'));

    for (const name of ['Nombre de semaines', 'Âge en semaines']) {
      expect(screen.getByRole('textbox', { name })).toHaveAttribute('autocomplete', 'off');
    }
  });
});
