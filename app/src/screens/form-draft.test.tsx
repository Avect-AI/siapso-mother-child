// SPDX-License-Identifier: MIT
// Answers typed in a form and not saved yet, when the two minutes run out
// (live test round 1: a11y-auditor#1, privacy-coercion#4, midwife#6): kept in
// memory only, given back after the code, warned about before the lock.
import { act, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openAppDb } from '../data/db.js';
import { listProfiles, saveProfile } from '../data/profiles.js';
import { AUTO_LOCK_MS, LOCK_WARNING_MS } from '../domain/code.js';
import type { Settings } from '../domain/types.js';
import { enterCode } from '../test/code-steps.js';
import { profileOf } from '../test/knowledge-pack.js';
import { renderApp, storeTestCode } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';

beforeEach(async () => {
  await storeTestCode();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

vi.setConfig({ testTimeout: 30_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
const RESTORED = 'Vos réponses sont revenues, mais elles ne sont pas encore enregistrées.';
const WARNING = "L'application va se verrouiller : touchez l'écran pour continuer.";
const HIDDEN_SITUATIONS = 'Situations masquées : touchez pour les afficher';

const PASSER_BY_WARNING =
  "L'application va se verrouiller : ses réponses seront effacées. Touchez l'écran pour continuer.";
const PASSER_BY_CLEARED =
  'Pour sa confidentialité, les réponses de la femme de passage ont été effacées.';

function radio(group: string | RegExp, name: string) {
  return within(screen.getByRole('group', { name: group })).getByRole('radio', { name });
}

/** Time passes with no touch: the clock and the timers move by `ms`. */
function idle(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** From now on the timers are faked: an interaction starts the two minutes on them. */
function fakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  act(() => {
    window.dispatchEvent(new Event('pointerdown'));
  });
}

async function newProfile(user: UserEvent) {
  await renderApp({ settings: accompanied, hash: '#/profile/new' });
  await screen.findByRole('button', { name: 'Enregistrer' });
  const name = screen.getByRole('textbox', { name: 'Surnom' });
  await user.clear(name);
  await user.type(name, 'Mariama');
  await user.click(radio(/^Enceinte/, 'Oui'));
  await user.click(radio('Terme de la grossesse', 'En semaines'));
  await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), '26');
}

describe('answers not saved at the auto-lock', () => {
  it('come back after the code, said not saved yet, and were never stored', async () => {
    const user = userEvent.setup();
    await newProfile(user);

    fakeTimers();
    idle(AUTO_LOCK_MS);
    vi.useRealTimers();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    // Hidden while locked, and nowhere in storage.
    expect(document.body.textContent).not.toContain('Mariama');
    const db = await openAppDb();
    expect(JSON.stringify(await db.getAll('profiles'))).not.toContain('Mariama');
    expect(JSON.stringify(window.history.state)).not.toContain('Mariama');

    await enterCode(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Nouveau profil' })).toBeVisible();
    expect(await screen.findByRole('textbox', { name: 'Surnom' })).toHaveValue('Mariama');
    expect(radio(/^Enceinte/, 'Oui')).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveValue('26');
    expect(screen.getByText(RESTORED)).toBeVisible();
    expect(await listProfiles()).toEqual([]);
  });

  it('come back on a saved profile too: the change is there, said not saved', async () => {
    await saveProfile(profileOf({ id: 'p1', pseudonym: 'Awa', self: true }));
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/profile' });
    const weeks = await screen.findByRole('textbox', { name: 'Nombre de semaines' });
    await user.clear(weeks);
    await user.type(weeks, '28');
    await user.click(screen.getByRole('button', { name: HIDDEN_SITUATIONS }));
    await user.click(screen.getByRole('checkbox', { name: 'Traitement contre la tuberculose' }));

    fakeTimers();
    idle(AUTO_LOCK_MS);
    vi.useRealTimers();
    await enterCode(user);

    expect(await screen.findByText(RESTORED)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Nombre de semaines' })).toHaveValue('28');
    // The situations given back are hidden again until a tap.
    expect(screen.queryByRole('checkbox', { name: 'Traitement contre la tuberculose' })).toBeNull();
    await user.click(screen.getByRole('button', { name: HIDDEN_SITUATIONS }));
    expect(
      screen.getByRole('checkbox', { name: 'Traitement contre la tuberculose' }),
    ).toBeChecked();
  });

  it('are warned about 30 s before the lock, and "Continuer" keeps the app open', async () => {
    const user = userEvent.setup();
    await newProfile(user);

    fakeTimers();
    idle(AUTO_LOCK_MS - LOCK_WARNING_MS - 1000);
    expect(screen.queryByText(WARNING)).toBeNull();
    idle(1000);
    // Read out once, as it appears.
    expect(screen.getByText(WARNING)).toBeVisible();
    expect(screen.getByText(WARNING).closest('[role="alert"]')).not.toBeNull();

    act(() => {
      screen.getByRole('button', { name: 'Continuer' }).click();
    });
    expect(screen.queryByText(WARNING)).toBeNull();
    idle(AUTO_LOCK_MS - 1000);
    expect(screen.getByRole('heading', { level: 1, name: 'Nouveau profil' })).toBeVisible();
  });

  it('are never warned about when nothing was typed', async () => {
    await renderApp({ settings: accompanied, hash: '#/profile/new' });
    await screen.findByRole('button', { name: 'Enregistrer' });

    fakeTimers();
    idle(AUTO_LOCK_MS - 1000);

    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('are dropped by the quick exit: the code opens an empty form', async () => {
    const user = userEvent.setup();
    await newProfile(user);

    await user.click(screen.getByRole('button', { name: 'Quitter' }));
    await user.click(await screen.findByRole('button', { name: 'Ouvrir' }));
    await enterCode(user);
    await screen.findByRole('heading', { level: 1, name: 'Profils' });
    act(() => {
      window.location.hash = '#/profile/new';
    });

    await screen.findByRole('heading', { level: 1, name: 'Nouveau profil' });
    expect(await screen.findByRole('textbox', { name: 'Surnom' })).toHaveValue('Femme 1');
    expect(screen.queryByText(RESTORED)).toBeNull();
  });

  it('of a contact being typed come back after the code too', async () => {
    const user = userEvent.setup();
    await renderApp({ settings: woman, hash: '#/contacts/new' });
    await user.click(await screen.findByRole('radio', { name: 'Sage-femme' }));
    await user.type(screen.getByRole('textbox', { name: /^Nom/ }), 'Awa Diop');
    await user.type(screen.getByRole('textbox', { name: /^Numéro/ }), '000 000 001');

    fakeTimers();
    idle(AUTO_LOCK_MS);
    vi.useRealTimers();
    await enterCode(user);

    expect(await screen.findByText(RESTORED)).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Sage-femme' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: /^Nom/ })).toHaveValue('Awa Diop');
    expect(screen.getByRole('textbox', { name: /^Numéro/ })).toHaveValue('000 000 001');
  });

  it('of a passer-by are warned about, then let go at the lock with her: the code opens empty questions', async () => {
    const session = probeSession();
    const user = userEvent.setup();
    await renderApp({ settings: accompanied, hash: '#/quick', children: session.element });
    await screen.findByRole('heading', { level: 1, name: 'Regarder sans enregistrer' });
    await user.click(radio(/^Enceinte/, 'Oui'));
    await user.click(radio('Terme de la grossesse', 'En semaines'));
    await user.type(screen.getByRole('textbox', { name: 'Nombre de semaines' }), '26');

    fakeTimers();
    idle(AUTO_LOCK_MS - LOCK_WARNING_MS);
    // The warning says her answers go with the lock.
    expect(screen.getByText(PASSER_BY_WARNING)).toBeVisible();
    idle(LOCK_WARNING_MS);
    vi.useRealTimers();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    // Nothing of her waits for the code, not even in memory.
    expect(session.current().draftFor('quick')).toBeNull();

    await enterCode(user);

    await screen.findByRole('heading', { level: 1, name: 'Regarder sans enregistrer' });
    expect(radio(/^Enceinte/, 'Oui')).not.toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Nombre de semaines' })).toBeNull();
    expect(screen.queryByText(RESTORED)).toBeNull();
    // Said once, so the keeper knows why her answers are gone.
    expect(await screen.findByText(PASSER_BY_CLEARED)).toBeVisible();
  });

  it('of a profile come back after the code given on the danger signs, once Back reaches her form', async () => {
    const user = userEvent.setup();
    await newProfile(user);
    fakeTimers();
    idle(AUTO_LOCK_MS);
    vi.useRealTimers();
    await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' });

    // On the code screen she goes to the danger signs, then who to call, and gives the code there.
    await user.click(
      within(screen.getByRole('banner')).getByRole('link', { name: 'Signes de danger' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Signes de danger' });
    act(() => {
      window.location.hash = '#/danger/call';
    });
    await screen.findByRole('heading', { level: 1, name: 'Qui appeler' });
    await user.click(screen.getByRole('button', { name: 'Entrer le code' }));
    await enterCode(user);
    // Back where the code was asked for: who to call.
    await screen.findByRole('heading', { level: 1, name: 'Qui appeler' });

    // Back, Back: her form, its answers given back.
    act(() => {
      window.history.back();
    });
    await screen.findByRole('heading', { level: 1, name: 'Signes de danger' });
    act(() => {
      window.history.back();
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Nouveau profil' })).toBeVisible();
    expect(await screen.findByRole('textbox', { name: 'Surnom' })).toHaveValue('Mariama');
    expect(screen.getByText(RESTORED)).toBeVisible();
  });

  it('are dropped when she leaves the form: coming back starts again', async () => {
    const user = userEvent.setup();
    await newProfile(user);

    act(() => {
      window.location.hash = '#/';
    });
    await screen.findByRole('heading', { level: 1, name: 'Profils' });
    act(() => {
      window.location.hash = '#/profile/new';
    });

    await screen.findByRole('heading', { level: 1, name: 'Nouveau profil' });
    expect(await screen.findByRole('textbox', { name: 'Surnom' })).toHaveValue('Femme 1');
  });
});
