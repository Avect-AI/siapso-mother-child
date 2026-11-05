// SPDX-License-Identifier: MIT
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../domain/types.js';
import { renderApp } from '../test/render-app.js';
import { fakeSpeech, type FakeSpeechOptions } from '../test/voice.js';
import { createVoiceService } from '../voice/voice-service.js';

vi.setConfig({ testTimeout: 20_000 });

// Exact names (roles, text content) keep the no-break space; text queries read it as a space.
const NBSP = ' ';
const french: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const english: Settings = { lang: 'en', mode: 'woman', onboarded: true };

afterEach(() => {
  vi.restoreAllMocks();
});

async function openVoicePack(options: FakeSpeechOptions = {}, settings = french) {
  const speech = fakeSpeech(options);
  await renderApp({ settings, hash: '#/voice', voice: createVoiceService(speech.port) });
  const user = userEvent.setup();
  const title = settings.lang === 'fr' ? "Parler au lieu d'écrire" : 'Speak instead of typing';
  expect(await screen.findByRole('heading', { level: 1, name: title })).toBeVisible();
  return { user, speech };
}

describe('VoicePack', () => {
  it('offers both languages with their size, Wolof first, French chosen in French', async () => {
    await openVoicePack();
    const group = await screen.findByRole('group', { name: 'Langue de la voix' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      `Wolof, 326${NBSP}Mo`,
      `Français, 137${NBSP}Mo`,
    ]);
    expect(within(group).getByRole('radio', { name: `Français, 137${NBSP}Mo` })).toBeChecked();
    expect(screen.getByText("Modèle Whisper base d'OpenAI, licence MIT.")).toBeVisible();
    expect(
      screen.getByText(
        'À installer une seule fois, en wifi, au poste de santé par exemple : 137 Mo à télécharger. Ensuite, la voix marche sans Internet.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Installer la voix en français' })).toHaveClass(
      'button--primary',
    );
    expect(screen.getByText(/Votre voix reste sur ce téléphone/)).toBeVisible();
  });

  it('follows the language chosen: its size, its model and its button', async () => {
    const { user } = await openVoicePack();
    await user.click(await screen.findByRole('radio', { name: `Wolof, 326${NBSP}Mo` }));
    expect(screen.getByText(/326\s+Mo à télécharger/)).toBeVisible();
    expect(
      screen.getByText('Modèle Whisper small adapté au wolof (M9and2M), licence MIT.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Installer la voix en wolof' })).toBeVisible();
  });

  it('chooses French at first in English too, with Wolof offered beside it', async () => {
    await openVoicePack({}, english);
    const group = await screen.findByRole('group', { name: 'Language of the voice' });
    expect(within(group).getByRole('radio', { name: 'Wolof, 326 MB' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'French, 137 MB' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Install the voice in French' })).toBeVisible();
  });

  it('downloads nothing until the install button is pressed', async () => {
    const { speech } = await openVoicePack();
    await screen.findByRole('group', { name: 'Langue de la voix' });
    expect(speech.module.voicePackInfo).not.toHaveBeenCalled();
    expect(speech.module.installVoicePack).not.toHaveBeenCalled();
  });

  it('installs with its progress and a cancel, and keeps what it downloaded to resume', async () => {
    const { user, speech } = await openVoicePack({ installHangs: true });
    await user.click(await screen.findByRole('button', { name: 'Installer la voix en français' }));

    expect(await screen.findByText('Installation de la voix en français')).toBeVisible();
    const progress = await screen.findByRole('progressbar', {
      name: "Avancement de l'installation",
    });
    await waitFor(() => {
      expect(progress).toHaveAttribute('value', String(Math.round(137_164_324 / 2)));
    });
    expect(progress).toHaveAttribute('max', '137164324');
    expect(screen.getByText('69 Mo sur 137 Mo (50 %)')).toBeVisible();
    expect(
      screen.getByText("Gardez l'application ouverte et Internet allumé jusqu'à la fin."),
    ).toBeVisible();
    expect(speech.module.voicePackInfo).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: "Annuler l'installation" }));
    expect(
      await screen.findByText(
        'Installation annulée. Les fichiers déjà téléchargés sont gardés pour la reprendre plus tard.',
      ),
    ).toBeVisible();
    const kept = screen.getByText('69 Mo sur 137 Mo sont déjà sur ce téléphone.');
    expect(kept).toBeVisible();
    // What happened comes first, then what is kept.
    const cancelled = screen.getByText(/^Installation annulée\./);
    expect(cancelled.compareDocumentPosition(kept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: "Reprendre l'installation" })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Retirer les fichiers déjà téléchargés' }));
    await waitFor(() => {
      expect(screen.queryByText(/sont déjà sur ce téléphone/)).toBeNull();
    });
    expect(speech.module.removeVoicePackFiles).toHaveBeenCalledWith('voice/whisper-base-fr-q8/');
  });

  it('says once installed, with how to use it, and a removal asked twice', async () => {
    const { user, speech } = await openVoicePack();
    await user.click(await screen.findByRole('button', { name: 'Installer la voix en français' }));
    expect(await screen.findByText('La voix en français est installée (137 Mo).')).toBeVisible();
    expect(
      screen.getByText('Touchez le micro à côté du champ de recherche pour dire un nom.'),
    ).toBeVisible();
    expect(screen.getByText("Pour changer de langue, retirez d'abord cette voix.")).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Langue de la voix' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retirer la voix en français' }));
    expect(
      screen.getByText(
        'Retirer la voix ? Pour la remettre, il faudra télécharger à nouveau 137 Mo.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Garder la voix' }));
    expect(speech.module.removeVoicePackFiles).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retirer la voix en français' }));
    await user.click(screen.getByRole('button', { name: 'Oui, retirer la voix' }));
    expect(await screen.findByText('La voix est retirée de ce téléphone.')).toBeVisible();
    expect(speech.module.removeVoicePackFiles).toHaveBeenCalledWith('voice/whisper-base-fr-q8/');
    expect(await screen.findByRole('group', { name: 'Langue de la voix' })).toBeVisible();
  });

  it('says why an installation failed, in plain words, and offers to go on', async () => {
    const { user } = await openVoicePack({ installFails: 'download' });
    await user.click(await screen.findByRole('button', { name: 'Installer la voix en français' }));
    expect(await screen.findByText(/Le téléchargement s'est interrompu\./)).toBeVisible();
    expect(screen.getByRole('button', { name: "Reprendre l'installation" })).toBeVisible();
  });

  it('says to open the app again when the voice cannot load on this page (an update elsewhere)', async () => {
    await openVoicePack({ packageFails: true });
    expect(
      await screen.findByText(
        "La voix n'a pas pu se charger sur cette page, peut-être après une mise à jour. Fermez l'application, puis rouvrez-la.",
      ),
    ).toBeVisible();
    expect(screen.queryByText('Recherche de la voix sur ce téléphone.')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Installer/ })).toBeNull();
  });

  it('says when this browser cannot use the voice', async () => {
    await openVoicePack({ supported: false });
    expect(screen.getByText(/Ce navigateur ne peut pas utiliser la voix\./)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Installer/ })).toBeNull();
  });

  it('goes back to the start when not opened from the search', async () => {
    const { user } = await openVoicePack();
    await user.click(screen.getByRole('button', { name: "Revenir à l'accueil" }));
    expect(window.location.hash).toBe('#/');
  });
});
