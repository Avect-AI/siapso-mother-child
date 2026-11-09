// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { closeAppDb } from '../data/db.js';
import { listHistory, recordHistory } from '../data/history.js';
import { deleteProfile, listProfiles, saveProfile } from '../data/profiles.js';
import type { Profile, Settings } from '../domain/types.js';
import { AppProvider, useApp } from '../state/app-state.js';
import { inSession } from '../state/entry-state.js';
import { SESSION_CHANNEL } from '../state/tab-sync.js';
import { breakIndexedDB, hangIndexedDB } from '../test/idb.js';
import { loaderOf, renderApp, seedSettings, shellPack, storeTestCode } from '../test/render-app.js';

// Profile data is written only while a code is on the phone (data/code-guard.ts).
beforeEach(async () => {
  await storeTestCode();
});

// The real storage, with deleteProfile counted (a double tap must delete once).
vi.mock('../data/profiles.js', async (importOriginal) => {
  const profiles = await importOriginal<typeof import('../data/profiles.js')>();
  return { ...profiles, deleteProfile: vi.fn(profiles.deleteProfile) };
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

/** The button that shows the situations of a saved profile (a no-break space before the colon). */
const HIDDEN_SITUATIONS = 'Situations masquées\u00a0: touchez pour les afficher';

/** Past 42 weeks and still pregnant: in woman mode, and about her in accompanied mode. */
const POST_TERM_HERS =
  "Allez au poste de santé aujourd'hui : une grossesse de plus de 42 semaines doit être vue.";
const POST_TERM_HER =
  "Elle doit aller au poste de santé aujourd'hui : une grossesse de plus de 42 semaines doit être vue.";

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
    expect(await screen.findByText('Profil enregistré : Moi.')).toBeVisible();
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
    // The situations saved show at a tap.
    await user.click(screen.getByRole('button', { name: HIDDEN_SITUATIONS }));
    expect(screen.getByRole('checkbox', { name: "Traitement contre l'épilepsie" })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Aucune de ces situations' })).not.toBeChecked();

    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });
    await user.clear(weeks);
    await user.type(weeks, '27');
    // A new number on her profile: the day it was known is asked again.
    await user.click(option(/^Ce terme date de quand/, "Aujourd'hui"));
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

  it('shows weeks given weeks ago as given, with their day and the term today, and saving keeps them', async () => {
    const term = { kind: 'weeks', weeks: 18, givenOn: '2026-08-09' } as const;
    await saveProfile(stored({ term }));
    const user = userEvent.setup();
    await openForm(woman);

    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveValue('18');
    expect(option(/^Ce terme date de quand/, 'Un autre jour')).toBeChecked();
    expect(screen.getByLabelText('Jour où ce nombre de semaines a été noté')).toHaveValue(
      '2026-08-09',
    );
    // The term today, and the weeks on the day they were noted.
    expect(
      screen.getByText("Environ 30 semaines aujourd'hui (18 semaines le 09/08)"),
    ).toBeVisible();
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
    expect(date).toHaveAccessibleDescription(/remonte à 45 semaines ou plus/);
    expect(date).not.toHaveAccessibleDescription(/Je ne sais pas/);
  });
});

describe('ProfileEdit: what is typed is never cut', () => {
  it('keeps two digits in the month field, says 34 looks like weeks, and gives it in weeks in one tap', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En mois'));
    const months = screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ });

    await user.type(months, '34');

    expect(months).toHaveValue('34');
    expect(months).toHaveAccessibleDescription(/ressemble à des semaines/);
    expect(screen.queryByText(/^Entre/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ce sont 34 semaines' }));

    expect(option('Terme de la grossesse', 'En semaines')).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveValue('34');
    expect(screen.getByText('Environ 34 semaines')).toBeVisible();
  });

  it('refuses a month of 0 with the range, never a value cut short', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En mois'));
    const months = screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ });
    await user.type(months, '0');

    expect(months).toHaveAccessibleDescription(/Écrivez un nombre entier de 1 à 9\./);
    expect(screen.queryByRole('button', { name: /en semaines$/ })).toBeNull();
  });

  it('keeps a long pseudonym whole and says the limit instead of cutting it', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    const pseudonym = screen.getByRole('textbox', { name: 'Surnom' });
    expect(pseudonym).not.toHaveAttribute('maxlength');
    await user.clear(pseudonym);
    await user.type(pseudonym, 'Awa Diop Ndiaye fille de Moussa du quartier HLM');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(pseudonym).toHaveValue('Awa Diop Ndiaye fille de Moussa du quartier HLM');
    expect(pseudonym).toHaveAccessibleDescription(/40 caractères au plus\.$/);
    expect(pseudonym).toHaveAccessibleDescription(/Écrivez un surnom de 40 caractères au plus/);
    expect(await listProfiles()).toEqual([]);
  });

  it('refuses a pseudonym already on the phone, whatever its case and accents', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa' }));
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/new');
    const pseudonym = screen.getByRole('textbox', { name: 'Surnom' });
    await user.clear(pseudonym);
    await user.type(pseudonym, ' àwa ');
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Je ne sais pas'));
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(pseudonym).toHaveAccessibleDescription(/Ce surnom est déjà sur ce téléphone/);
    expect(pseudonym).toHaveFocus();
    expect(await listProfiles()).toHaveLength(1);
  });

  it('lets a profile keep its own pseudonym when it is saved again', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa' }));
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/a');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/^Profil enregistré/)).toBeVisible();
  });
});

describe('ProfileEdit: "Je ne sais pas"', () => {
  it('stores an unsure pregnancy as a pregnancy of unknown term, and still asks about breastfeeding', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Je ne sais pas'));

    expect(screen.queryByRole('group', { name: 'Terme de la grossesse' })).toBeNull();
    expect(screen.getByText('Grossesse possible, terme inconnu')).toBeVisible();
    await user.click(option(/^Allaite/, 'Oui'));
    await user.click(option('Âge du bébé', 'Je ne sais pas'));
    expect(screen.queryByRole('textbox', { name: 'Âge en semaines' })).toBeNull();
    await user.click(option(/^Né avant terme/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    const [profile] = await listProfiles();
    expect(profile).toMatchObject({
      pregnant: true,
      pregnancyUnsure: true,
      breastfeeding: true,
      babyAgeUnknown: true,
      premature: false,
    });
    expect(profile).not.toHaveProperty('term');
    expect(profile).not.toHaveProperty('babyAgeWeeks');
  });
});

describe('ProfileEdit: the day the weeks were known', () => {
  it('dates weeks today by default for her new profile, and takes an earlier day (an ultrasound)', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));
    expect(option(/^Ce terme date de quand/, "Aujourd'hui")).toBeChecked();

    await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), '16');
    // Still today: a new profile of her own keeps the default.
    expect(option(/^Ce terme date de quand/, "Aujourd'hui")).toBeChecked();
    await user.click(option(/^Ce terme date de quand/, 'Un autre jour'));
    const given = screen.getByLabelText('Jour où ce nombre de semaines a été noté');
    expect(given).toHaveAttribute('type', 'date');
    expect(given).toHaveAttribute('max', '2026-11-04');
    fireEvent.change(given, { target: { value: '2026-09-01' } });
    // 16 weeks on 1 September: 9 weeks and 1 day later.
    expect(
      screen.getByText("Environ 25 semaines aujourd'hui (16 semaines le 01/09)"),
    ).toBeVisible();
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    expect((await listProfiles())[0]?.term).toEqual({
      kind: 'weeks',
      weeks: 16,
      givenOn: '2026-09-01',
    });
  });

  it('reads weeks known on that day and now past 42 as more than 42 weeks, and past 45 as a date to look at', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));
    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });
    await user.type(weeks, '30');
    await user.click(option(/^Ce terme date de quand/, 'Un autre jour'));
    const day = screen.getByLabelText('Jour où ce nombre de semaines a été noté');
    // 43 weeks today: past term, still pregnant.
    fireEvent.change(day, { target: { value: '2026-08-01' } });
    expect(screen.getByText(POST_TERM_HERS)).toBeVisible();
    expect(weeks).not.toHaveAccessibleDescription(/dépasse/);

    // 47 weeks today: no pregnancy lasts so long.
    fireEvent.change(day, { target: { value: '2026-07-01' } });
    expect(weeks).toHaveAccessibleDescription(/dépasserait 45 semaines/);
    expect(weeks).not.toHaveAccessibleDescription(/Je ne sais pas/);
  });

  it('asks the day again when a new number is typed on an edited term, never keeping the old day', async () => {
    // Reproduced: 26 weeks noted on 24 September; she now says 32. The old
    // day would have read 32 weeks on 24 September, about 38 today.
    await saveProfile(
      stored({
        term: { kind: 'weeks', weeks: 26, givenOn: '2026-09-24' },
        updatedAt: '2026-09-24T08:00:00.000Z',
      }),
    );
    const user = userEvent.setup();
    await openForm(woman);
    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });
    await user.clear(weeks);
    await user.type(weeks, '32');

    expect(option(/^Ce terme date de quand/, "Aujourd'hui")).not.toBeChecked();
    expect(option(/^Ce terme date de quand/, 'Un autre jour')).not.toBeChecked();
    expect(screen.queryByText(/^Environ/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(
      within(group(/^Ce terme date de quand/)).getByText('Choisissez une réponse.'),
    ).toBeVisible();

    await user.click(option(/^Ce terme date de quand/, "Aujourd'hui"));
    expect(screen.getByText('Environ 32 semaines')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText(/^Profil enregistré/);
    expect((await listProfiles())[0]?.term).toEqual({
      kind: 'weeks',
      weeks: 32,
      givenOn: '2026-11-04',
    });
  });

  it('always asks the day of weeks typed in accompanied mode, a new profile too', async () => {
    // Reproduced: a midwife copies "26 SA" from a booklet entry of 24
    // September; with today taken for granted the term would be 6 weeks low.
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/new');
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), '26');

    expect(option(/^Ce terme date de quand/, "Aujourd'hui")).not.toBeChecked();
    await user.click(option(/^Ce terme date de quand/, 'Un autre jour'));
    fireEvent.change(screen.getByLabelText('Jour où ce nombre de semaines a été noté'), {
      target: { value: '2026-09-24' },
    });

    // 26 weeks on 24 September: 41 days later, 31 weeks and 6 days.
    expect(
      screen.getByText("Environ 31 semaines aujourd'hui (26 semaines le 24/09)"),
    ).toBeVisible();
  });
});

describe('ProfileEdit: month 8 or 9', () => {
  it('suggests weeks or the last period, in one tap', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En mois'));
    await user.type(screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ }), '9');

    expect(screen.getByText(/^Près du terme, un mois couvre plusieurs semaines/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Donner le nombre de semaines' }));
    expect(option('Terme de la grossesse', 'En semaines')).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveFocus();
  });
});

describe('ProfileEdit: her own profile in woman mode', () => {
  it('opens her own profile, never another one kept on the phone', async () => {
    await saveProfile(stored({ id: 'other', pseudonym: 'Awa', self: false }));
    await saveProfile(
      stored({ id: 'mine', pseudonym: 'Moi', self: true, createdAt: '2026-11-04T09:00:00.000Z' }),
    );
    await openForm(woman);
    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Moi');
  });

  it('starts an empty profile when hers is not there, even with other profiles, and marks it', async () => {
    await saveProfile(stored({ id: 'other', pseudonym: 'Awa', self: false }));
    const user = userEvent.setup();
    await openForm(woman);
    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Moi');
    expect(option(/^Enceinte/, 'Oui')).not.toBeChecked();
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Je ne sais pas'));
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await screen.findByText(/^Profil enregistré/);
    const profiles = await listProfiles();
    expect(profiles.find((p) => p.pseudonym === 'Moi')?.self).toBe(true);
    expect(profiles.find((p) => p.pseudonym === 'Awa')).toMatchObject({ self: false });
  });
});

describe('ProfileEdit: an outdated term', () => {
  const outdated = stored({
    id: 'p1',
    pseudonym: 'Bineta',
    term: { kind: 'months', months: 7, givenOn: '2026-07-01' },
    conditions: ['uterine-scar'],
  });

  it('"the baby is born": opens with pregnancy set to no, breastfeeding and the baby age to answer', async () => {
    await saveProfile(outdated);
    const user = userEvent.setup();
    await renderApp({
      settings: accompanied,
      hash: '#/profile/p1',
      entryState: inSession({ update: 'born', next: '/check' }),
    });
    await screen.findByRole('button', { name: 'Enregistrer' });

    // The screen says why it opened, and the way out when she does not breastfeed.
    expect(screen.getByText(/^Le bébé est né\s: dites si elle allaite/)).toBeVisible();
    expect(screen.getByText(/vous pouvez supprimer son profil/)).toBeVisible();
    expect(option(/^Enceinte/, 'Non')).toBeChecked();
    expect(option(/^Allaite/, 'Oui')).not.toBeChecked();
    expect(option(/^Allaite/, 'Non')).not.toBeChecked();
    await user.click(option(/^Allaite/, 'Oui'));
    await user.click(option('Âge du bébé', 'En semaines'));
    await user.type(screen.getByRole('textbox', { name: 'Âge en semaines' }), '2');
    await user.click(option(/^Né avant terme/, 'Non'));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    // Back to the check of the same woman.
    expect(
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" }),
    ).toBeVisible();
    expect(await listProfiles()).toEqual([
      expect.objectContaining({
        id: 'p1',
        pregnant: false,
        breastfeeding: true,
        babyAgeWeeks: 2,
        conditions: ['uterine-scar'],
      }),
    ]);
  });

  it('"still pregnant": opens with the term to give again', async () => {
    await saveProfile(outdated);
    await renderApp({
      settings: accompanied,
      hash: '#/profile/p1',
      entryState: inSession({ update: 'term', next: '/check' }),
    });
    await screen.findByRole('button', { name: 'Enregistrer' });

    expect(screen.getByText("Donnez le terme d'aujourd'hui.")).toBeVisible();
    expect(option(/^Enceinte/, 'Oui')).toBeChecked();
    expect(screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ })).toHaveValue('');
    expect(screen.queryByText(/^Entre/)).toBeNull();
  });

  it('"still pregnant" past 42 weeks: says to go today, and saves the term as more than 42 weeks', async () => {
    await saveProfile(outdated);
    const user = userEvent.setup();
    await renderApp({
      settings: accompanied,
      hash: '#/profile/p1',
      entryState: inSession({ update: 'post-term', next: '/check' }),
    });
    await screen.findByRole('button', { name: 'Enregistrer' });

    expect(screen.getByText(POST_TERM_HER)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Voir qui appeler' })).toHaveAttribute(
      'href',
      '#/danger/call',
    );
    expect(screen.getByText('Plus de 42 semaines')).toBeVisible();
    // Never "Je ne sais pas" for a term she knows.
    expect(document.body.textContent).not.toMatch(/choisissez Je ne sais pas/);
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: "Ce qu'elle prend" }),
    ).toBeVisible();
    expect((await listProfiles())[0]?.term).toEqual({ kind: 'post-term', givenOn: '2026-11-04' });
  });

  it('"Mettre à jour" asks first whether the baby is born, as the check does', async () => {
    // After the knowledge pack's date (5 November), so the phone's date is not behind it.
    vi.setSystemTime(new Date(2026, 10, 6, 10, 0));
    // Month 9 three weeks ago: between 39 and 45 weeks, the baby may be born.
    await saveProfile(
      stored({
        id: 'p1',
        pseudonym: 'Bineta',
        term: { kind: 'months', months: 9, givenOn: '2026-10-16' },
      }),
    );
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/' });
    const row = await screen.findByRole('button', { name: /^Bineta / });
    // The real range, which says why the baby may be born.
    expect(row).toHaveTextContent('Entre 39 et 45 semaines (estimé)');
    expect(row).toHaveTextContent(/À confirmer/);

    await user.click(screen.getByRole('link', { name: 'Mettre à jour le profil de Bineta' }));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Le terme noté a peut-être passé 42 semaines/,
      }),
    ).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Non, toujours enceinte' }));
    expect(await screen.findByText("Donnez le terme d'aujourd'hui.")).toBeVisible();
    await user.click(option('Terme de la grossesse', 'En semaines'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), '41');
    await user.click(option(/^Ce terme date de quand/, "Aujourd'hui"));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const saved = await screen.findByRole('button', { name: /^Bineta / });
    expect(saved).toHaveTextContent('Environ 41 semaines');
    expect(saved).not.toHaveTextContent(/À confirmer/);
  });
});

describe('ProfileEdit: pseudonyms that mislead or mix up (live test round 2)', () => {
  it('refuses a safety word or a dose as a pseudonym, which would head her result', async () => {
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/new');
    const pseudonym = screen.getByRole('textbox', { name: 'Surnom' });
    await user.clear(pseudonym);
    await user.type(pseudonym, 'Sans danger');

    expect(pseudonym).toHaveAccessibleDescription(/Ce surnom ressemble à une dose ou à un avis/);
  });

  it('warns about a pseudonym one letter from another or like a full name, saves it, and says it once', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa' }));
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/new');
    const pseudonym = screen.getByRole('textbox', { name: 'Surnom' });
    await user.clear(pseudonym);
    await user.type(pseudonym, 'Awa Diop');
    expect(screen.getByText(/^Ce surnom ressemble à un prénom et un nom/)).toBeVisible();
    await user.clear(pseudonym);
    await user.type(pseudonym, 'Awa.');
    expect(screen.getByText(/^Un surnom proche est déjà sur ce téléphone\s: Awa\./)).toBeVisible();
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Je ne sais pas'));
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    // One period, never "Awa..".
    expect(await screen.findByText(/^Profil enregistré\s: Awa\.$/)).toBeVisible();
    expect((await listProfiles()).map((p) => p.pseudonym)).toEqual(['Awa', 'Awa.']);
  });
});

describe('ProfileEdit: past 42 weeks and past 9 months (live test round 2)', () => {
  it('reads a last period past 42 weeks as more than 42 weeks, says to go today, never "Je ne sais pas"', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Date des dernières règles'));
    // 43 weeks before 4 November 2026.
    fireEvent.change(screen.getByLabelText('Premier jour des dernières règles'), {
      target: { value: '2026-01-05' },
    });

    expect(screen.getByText(POST_TERM_HERS)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Voir qui appeler' })).toBeVisible();
    expect(screen.getByText('Plus de 42 semaines')).toBeVisible();
    expect(screen.getByLabelText('Premier jour des dernières règles')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByText(/^Profil enregistré/)).toBeVisible();
    expect((await listProfiles())[0]?.term).toEqual({ kind: 'post-term', givenOn: '2026-11-04' });
  });

  it('"Mettre à jour" on a term said past 42 weeks days ago reads it so again from today', async () => {
    vi.setSystemTime(new Date(2026, 10, 6, 10, 0));
    await saveProfile(
      stored({ id: 'p1', pseudonym: 'Bineta', term: { kind: 'post-term', givenOn: '2026-11-03' } }),
    );
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/' });
    const row = await screen.findByRole('button', { name: /^Bineta / });
    expect(row).toHaveTextContent('Plus de 42 semaines');
    expect(row).toHaveTextContent(/À confirmer/);

    await user.click(screen.getByRole('link', { name: 'Mettre à jour le profil de Bineta' }));
    await user.click(await screen.findByRole('button', { name: 'Non, toujours enceinte' }));
    expect(await screen.findByText(POST_TERM_HER)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('button', { name: /^Bineta / })).not.toHaveTextContent(
      /À confirmer/,
    );
    expect((await listProfiles())[0]?.term).toEqual({ kind: 'post-term', givenOn: '2026-11-06' });
  });

  it('asks whether she is past 9 months for 10 to 12, never giving it as weeks in one tap', async () => {
    const user = userEvent.setup();
    await openForm(woman);
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En mois'));
    await user.type(screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ }), '10');

    expect(screen.queryByRole('button', { name: /^Ce sont 10 semaines/ })).toBeNull();
    expect(screen.getByText('Avez-vous dépassé 9 mois ?')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Oui, plus de 9 mois' }));

    expect(screen.getByText(POST_TERM_HERS)).toBeVisible();
    expect(screen.getByText('Plus de 42 semaines')).toBeVisible();
  });

  it('opens the weeks field empty on "Non, ce sont des semaines", and keeps the weeks hint for 13 to 42', async () => {
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/new');
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En mois'));
    const months = screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ });
    await user.type(months, '11');
    expect(screen.getByText('Elle a dépassé 9 mois ?')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Non, ce sont des semaines' }));

    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });
    expect(weeks).toHaveValue('');
    expect(weeks).toHaveFocus();
    await user.click(option('Terme de la grossesse', 'En mois'));
    await user.type(screen.getByRole('textbox', { name: /^Dans quel mois de grossesse/ }), '13');
    expect(screen.getByRole('button', { name: 'Ce sont 13 semaines' })).toBeVisible();
  });

  it('says when typing new weeks asks again the day they date from', async () => {
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/new');
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'En semaines'));
    const weeks = screen.getByRole('textbox', { name: 'Nombre de semaines' });
    await user.type(weeks, '20');
    await user.click(option(/^Ce terme date de quand/, "Aujourd'hui"));
    expect(screen.queryByText(/^Le nombre de semaines a changé/)).toBeNull();

    await user.clear(weeks);
    await user.type(weeks, '21');

    expect(screen.getByText(/^Le nombre de semaines a changé/)).toBeVisible();
    expect(option(/^Ce terme date de quand/, "Aujourd'hui")).not.toBeChecked();
    await user.click(option(/^Ce terme date de quand/, "Aujourd'hui"));
    expect(screen.queryByText(/^Le nombre de semaines a changé/)).toBeNull();
  });

  it('says to look at the phone date when it is before the last save, and shows no term worked out from it', async () => {
    await saveProfile(
      stored({
        term: { kind: 'weeks', weeks: 21, givenOn: '2026-11-01' },
        updatedAt: '2026-11-05T08:00:00.000Z',
      }),
    );
    // The phone's clock set back ten days.
    vi.setSystemTime(new Date(2026, 9, 26, 10, 0));
    await openForm(accompanied, '#/profile/p1');

    // Said once at the top; the date field says it too, never "après aujourd'hui".
    expect(screen.getAllByText(/^La date du téléphone semble fausse/)[0]).toBeVisible();
    expect(screen.getByText('Terme inconnu (date du téléphone)')).toBeVisible();
    expect(screen.queryByText(/^Environ/)).toBeNull();
    expect(screen.queryByText(/^Cette date est après aujourd'hui/)).toBeNull();
  });
});

describe('ProfileEdit: deleting a profile', () => {
  it('deletes one profile and its history after a last yes, and says so on the list', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa' }));
    await saveProfile(stored({ id: 'b', pseudonym: 'Binta' }));
    await recordHistory({
      id: 'h1',
      profileId: 'a',
      at: '2026-11-04T09:00:00.000Z',
      packVersion: '0.1.0',
      level: 'unknown',
      ruleIds: [],
      items: [],
      signs: [],
    });
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/a');

    await user.click(screen.getByRole('button', { name: 'Supprimer ce profil' }));
    expect(
      screen.getByRole('heading', { level: 1, name: /^Supprimer le profil Awa/ }),
    ).toHaveFocus();
    expect(screen.getByText(/^Son profil et l'historique de ses résultats/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Supprimer le profil' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    expect(await screen.findByText(/^Profil supprimé\s: Awa\.$/)).toBeVisible();
    expect((await listProfiles()).map((p) => p.id)).toEqual(['b']);
    expect(await listHistory('a')).toEqual([]);
  });

  it('tells the other tabs which profile was deleted, on the channel only', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa' }));
    const heard: unknown[] = [];
    const other = new BroadcastChannel(SESSION_CHANNEL);
    other.onmessage = (event) => {
      heard.push(event.data);
    };
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/a');

    await user.click(screen.getByRole('button', { name: 'Supprimer ce profil' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer le profil' }));

    await vi.waitFor(() => {
      expect(heard).toContainEqual(expect.objectContaining({ id: 'a' }));
    });
    other.close();
  });

  it('leaves the form of a profile deleted in another tab, its answers gone', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa', conditions: ['hiv-cotrimoxazole'] }));
    await saveProfile(stored({ id: 'b', pseudonym: 'Binta' }));
    await openForm(accompanied, '#/profile/a');
    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Awa');

    // Another tab deletes her, and says so.
    await deleteProfile('a');
    const other = new BroadcastChannel(SESSION_CHANNEL);
    other.postMessage({ event: 'profile-deleted', mark: 'e'.repeat(31) + '3', id: 'a' });
    other.close();

    expect(await screen.findByRole('heading', { level: 1, name: 'Profils' })).toBeVisible();
    expect(await screen.findByText('Binta')).toBeVisible();
    expect(screen.queryByText('Awa')).toBeNull();
  });

  it('never writes back a profile deleted meanwhile: the save is refused and said', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa', conditions: ['hiv-cotrimoxazole'] }));
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/a');
    // Deleted from a tab that told nobody (no channel, no storage event).
    await deleteProfile('a');

    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Ce profil a été supprimé de ce téléphone : il n'est pas enregistré.",
    );
    expect(await listProfiles()).toEqual([]);
  });

  it('keeps the profile when the last step says no', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa' }));
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/a');

    await user.click(screen.getByRole('button', { name: 'Supprimer ce profil' }));
    await user.click(screen.getByRole('button', { name: 'Garder le profil' }));

    expect(screen.getByRole('textbox', { name: 'Surnom' })).toHaveValue('Awa');
    expect(await listProfiles()).toHaveLength(1);
  });

  it('lets a woman delete her own profile, back to an empty one', async () => {
    await saveProfile(stored({ id: 'mine', pseudonym: 'Moi' }));
    const user = userEvent.setup();
    await openForm(woman);

    await user.click(screen.getByRole('button', { name: 'Supprimer ce profil' }));
    expect(
      screen.getByRole('heading', { level: 1, name: /^Supprimer votre profil/ }),
    ).toHaveFocus();
    expect(screen.getByText(/^Votre profil et l'historique de vos résultats/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Supprimer le profil' }));

    expect(await screen.findByText('Votre profil est supprimé.')).toBeVisible();
    expect(await listProfiles()).toEqual([]);
    await user.click(screen.getByRole('link', { name: 'Mon profil' }));
    expect(await screen.findByRole('textbox', { name: 'Surnom' })).toHaveValue('Moi');
    expect(option(/^Enceinte/, 'Oui')).not.toBeChecked();
  });

  it('offers no deletion for a profile not saved yet', async () => {
    await openForm(accompanied, '#/profile/new');
    expect(screen.queryByRole('button', { name: 'Supprimer ce profil' })).toBeNull();
  });

  it('deletes once, however fast the last yes is pressed twice', async () => {
    await saveProfile(stored({ id: 'a', pseudonym: 'Awa' }));
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/a');
    await user.click(screen.getByRole('button', { name: 'Supprimer ce profil' }));
    vi.mocked(deleteProfile).mockClear();
    const yes = screen.getByRole('button', { name: 'Supprimer le profil' });

    yes.click();
    yes.click();

    expect(await screen.findByText(/^Profil supprimé/)).toBeVisible();
    expect(deleteProfile).toHaveBeenCalledTimes(1);
  });

  it('says plainly that the app no longer covers her when the baby is born and she does not breastfeed', async () => {
    await saveProfile(
      stored({
        id: 'p1',
        pseudonym: 'Bineta',
        term: { kind: 'months', months: 7, givenOn: '2026-07-01' },
      }),
    );
    const user = userEvent.setup();
    await renderApp({
      settings: accompanied,
      hash: '#/profile/p1',
      entryState: inSession({ update: 'born', next: '/check' }),
    });
    await screen.findByRole('button', { name: 'Enregistrer' });

    await user.click(option(/^Allaite/, 'Non'));

    expect(
      screen.getByText(
        /^L'application sert pendant la grossesse et l'allaitement\. Si elle n'est plus enceinte/,
      ),
    ).toBeVisible();
    // No refusal shown: the way out is offered instead.
    expect(
      screen.queryByText(/^L'application sert pendant la grossesse et l'allaitement\s: répondez/),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Supprimer son profil' }));
    expect(
      screen.getByRole('heading', { level: 1, name: /^Supprimer le profil Bineta/ }),
    ).toHaveFocus();
  });

  it('never offers a save that does nothing when the app no longer covers her', async () => {
    await saveProfile(
      stored({
        id: 'p1',
        pseudonym: 'Bineta',
        term: { kind: 'months', months: 7, givenOn: '2026-07-01' },
      }),
    );
    const user = userEvent.setup();
    await renderApp({
      settings: accompanied,
      hash: '#/profile/p1',
      entryState: inSession({ update: 'born', next: '/check' }),
    });
    await screen.findByRole('button', { name: 'Enregistrer' });

    await user.click(option(/^Allaite/, 'Non'));

    // "Enregistrer" is gone while the profile cannot be saved; the way out is the delete.
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
    const remove = screen.getByRole('button', { name: 'Supprimer son profil' });
    // Enter in the name (then the form's only text field) goes to that way out.
    const name = screen.getByLabelText<HTMLInputElement>('Surnom');
    if (name.form === null) throw new Error('The name is not in the form');
    fireEvent.submit(name.form);
    expect(remove).toHaveFocus();
    expect(window.location.hash).toBe('#/profile/p1');
    // Another answer brings the save back.
    await user.click(option(/^Allaite/, 'Oui'));
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
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

    // Plain words: no "aménorrhée".
    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveAccessibleDescription(
      'Semaines de grossesse, comptées depuis le premier jour des dernières règles, de 0 à 42.',
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
    expect(screen.getByText('Âge calculé')).toBeVisible();
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

  it('hides the situations of a saved profile until an explicit tap: HIV or not, the same screen', async () => {
    await saveProfile(stored({ conditions: ['hiv-cotrimoxazole'] }));
    const user = userEvent.setup();
    await openForm(woman);
    // What the situations show: their words, and which boxes are ticked.
    const seen = () => {
      const situations = group('Situations de longue durée');
      return [
        situations.textContent,
        within(situations)
          .queryAllByRole('checkbox')
          .map((box) => (box as HTMLInputElement).checked),
      ];
    };
    const withHiv = seen();

    expect(document.body.textContent).not.toMatch(/VIH/);
    expect(withHiv[1]).toEqual([]);
    await user.click(screen.getByRole('button', { name: HIDDEN_SITUATIONS }));
    expect(screen.getByRole('checkbox', { name: 'VIH, avec cotrimoxazole' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'VIH, avec cotrimoxazole' })).toHaveFocus();

    // The same profile with no situation: the same screen.
    await saveProfile(stored({ conditions: [] }));
    act(() => {
      window.location.hash = '#/';
    });
    await screen.findByRole('heading', { level: 1, name: /^Un médicament ou un remède/ });
    act(() => {
      window.location.hash = '#/profile';
    });
    await screen.findByRole('button', { name: HIDDEN_SITUATIONS });
    expect(seen()).toEqual(withHiv);
    await user.click(screen.getByRole('button', { name: HIDDEN_SITUATIONS }));
    expect(screen.getByRole('checkbox', { name: 'Aucune de ces situations' })).toBeChecked();
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
    await user.click(screen.getByRole('button', { name: HIDDEN_SITUATIONS }));

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
      'Un surnom, jamais le vrai nom. 40 caractères au plus.',
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

  it('saves one profile only, however fast the save is pressed twice', async () => {
    const user = userEvent.setup();
    await openForm(accompanied, '#/profile/new');
    await user.click(option(/^Enceinte/, 'Oui'));
    await user.click(option('Terme de la grossesse', 'Je ne sais pas'));
    await user.click(option(/^Allaite/, 'Non'));
    await user.click(screen.getByRole('checkbox', { name: 'Aucune de ces situations' }));
    const save = screen.getByRole('button', { name: 'Enregistrer' });

    // Two clicks in the same task, before any render.
    save.click();
    save.click();

    await screen.findByText(/^Profil enregistré/);
    expect(await listProfiles()).toHaveLength(1);
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
