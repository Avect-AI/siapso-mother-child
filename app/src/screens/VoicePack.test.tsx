// SPDX-License-Identifier: MIT
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../domain/types.js';
import { renderApp } from '../test/render-app.js';
import { fakeSpeech, voicePackError, type FakeSpeechOptions } from '../test/voice.js';
import { createVoiceService } from '../voice/voice-service.js';

vi.setConfig({ testTimeout: 20_000 });

// Exact names (roles, text content) keep the no-break space; text queries read it as a space.
const NBSP = ' ';
const french: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const english: Settings = { lang: 'en', mode: 'woman', onboarded: true };

afterEach(() => {
  vi.restoreAllMocks();
});

/** The question of the voice screen. */
const LANGUAGE = `Dans quelle langue allez-vous dire les noms${NBSP}?`;

/** Chooses French, as she does before installing. */
async function chooseFrench(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('radio', { name: `Français, 137${NBSP}Mo` }));
}

async function openVoicePack(options: FakeSpeechOptions = {}, settings = french) {
  const speech = fakeSpeech(options);
  await renderApp({ settings, hash: '#/voice', voice: createVoiceService(speech.port) });
  const user = userEvent.setup();
  const title = settings.lang === 'fr' ? "Parler au lieu d'écrire" : 'Speak instead of typing';
  expect(await screen.findByRole('heading', { level: 1, name: title })).toBeVisible();
  return { user, speech };
}

describe('VoicePack', () => {
  it('asks the language, Wolof first with its size, and chooses none for her', async () => {
    await openVoicePack();
    const group = await screen.findByRole('group', { name: LANGUAGE });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([
      `Wolof, 326${NBSP}Mo`,
      `Français, 137${NBSP}Mo`,
    ]);
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    // Changing later means downloading the other voice: said before she chooses.
    expect(group).toHaveAccessibleDescription(
      "Une seule voix à la fois. Pour changer de langue plus tard, il faudra retirer cette voix et télécharger l'autre.",
    );
    expect(screen.queryByText(/^Modèle Whisper/)).toBeNull();
    expect(
      screen.getByText(
        'À installer une seule fois, en wifi, au poste de santé par exemple. Ensuite, la voix marche sans Internet.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Installer la voix' })).toHaveClass(
      'button--primary',
    );
    expect(screen.getByText(/Votre voix reste sur ce téléphone/)).toBeVisible();
  });

  it('asks for a language before it installs anything', async () => {
    const { user, speech } = await openVoicePack();
    await user.click(await screen.findByRole('button', { name: 'Installer la voix' }));
    const group = screen.getByRole('group', { name: LANGUAGE });
    expect(within(group).getByText('Choisissez une langue.')).toBeVisible();
    expect(within(group).getAllByRole('radio')[0]).toHaveFocus();
    expect(speech.module.voicePackInfo).not.toHaveBeenCalled();

    await user.click(within(group).getByRole('radio', { name: `Français, 137${NBSP}Mo` }));
    expect(screen.getByText("Modèle Whisper base d'OpenAI, licence MIT.")).toBeVisible();
    expect(
      screen.getByText(
        'À installer une seule fois, en wifi, au poste de santé par exemple : 137 Mo à télécharger. Ensuite, la voix marche sans Internet.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Installer la voix en français' })).toBeVisible();
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

  it('chooses no language for her in English either', async () => {
    await openVoicePack({}, english);
    const group = await screen.findByRole('group', {
      name: 'In which language will you say the names?',
    });
    expect(within(group).getByRole('radio', { name: 'Wolof, 326 MB' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'French, 137 MB' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Install the voice' })).toBeVisible();
  });

  it('offline, keeps the install button off and says to connect', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { user, speech } = await openVoicePack();
    await user.click(await screen.findByRole('radio', { name: `Français, 137${NBSP}Mo` }));
    const install = screen.getByRole('button', { name: 'Installer la voix en français' });
    expect(install).toHaveAttribute('aria-disabled', 'true');
    expect(install).toHaveAccessibleDescription(
      'Connectez-vous à Internet pour installer la voix.',
    );
    await user.click(install);
    expect(speech.module.voicePackInfo).not.toHaveBeenCalled();
    expect(screen.queryByText(/Reprendre/)).toBeNull();
  });

  it('downloads nothing until the install button is pressed', async () => {
    const { speech } = await openVoicePack();
    await screen.findByRole('group', { name: LANGUAGE });
    expect(speech.module.voicePackInfo).not.toHaveBeenCalled();
    expect(speech.module.installVoicePack).not.toHaveBeenCalled();
  });

  it('installs with its progress and a cancel, and keeps what it downloaded to resume', async () => {
    const { user, speech } = await openVoicePack({ installHangs: true });
    await chooseFrench(user);
    await user.click(screen.getByRole('button', { name: 'Installer la voix en français' }));

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
    await chooseFrench(user);
    await user.click(screen.getByRole('button', { name: 'Installer la voix en français' }));
    expect(await screen.findByText('La voix en français est installée (137 Mo).')).toBeVisible();
    expect(
      screen.getByText('Touchez le micro à côté du champ de recherche pour dire un nom.'),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Pour changer de langue, retirez d'abord cette voix : il faudra ensuite télécharger l'autre voix.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole('group', { name: LANGUAGE })).toBeNull();

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
    expect(await screen.findByRole('group', { name: LANGUAGE })).toBeVisible();
  });

  it('says a download cut short, and offers to go on from what it kept', async () => {
    const { user } = await openVoicePack({ installFails: 'download' });
    await chooseFrench(user);
    await user.click(screen.getByRole('button', { name: 'Installer la voix en français' }));
    expect(
      await screen.findByText(
        /^Le téléchargement s'est interrompu\. Ce qui est déjà téléchargé est gardé\./,
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: "Reprendre l'installation" })).toBeVisible();
  });

  it('says a voice the server does not give, without a button that is not there', async () => {
    const { user, speech } = await openVoicePack();
    speech.module.voicePackInfo.mockRejectedValueOnce(voicePackError('unavailable'));
    await chooseFrench(user);
    await user.click(screen.getByRole('button', { name: 'Installer la voix en français' }));
    expect(
      await screen.findByText(/^La voix ne peut pas être téléchargée pour le moment/),
    ).toBeVisible();
    expect(screen.getByText(/En attendant, écrivez le nom\./)).toBeVisible();
    expect(screen.queryByText(/Reprendre|poste de santé\.$|dites-le/)).toBeNull();
    expect(screen.queryByRole('button', { name: "Reprendre l'installation" })).toBeNull();
  });

  it('says when the files received are damaged, never to report it to the health post', async () => {
    const { user, speech } = await openVoicePack();
    speech.module.voicePackInfo.mockRejectedValueOnce(voicePackError('invalid'));
    await chooseFrench(user);
    await user.click(screen.getByRole('button', { name: 'Installer la voix en français' }));
    expect(
      await screen.findByText(
        /^Les fichiers de la voix reçus sont abîmés : ils n'ont pas été gardés\./,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/dites-le au poste de santé/)).toBeNull();
    expect(screen.queryByRole('button', { name: "Reprendre l'installation" })).toBeNull();
  });

  it('says a damaged file was dropped while what came before it is kept, to resume (review of #58)', async () => {
    // The fake keeps half the pack, then a file comes of another size.
    const { user } = await openVoicePack({ installFails: 'invalid' });
    await chooseFrench(user);
    await user.click(screen.getByRole('button', { name: 'Installer la voix en français' }));
    expect(
      await screen.findByText(/^Un fichier de la voix reçu était abîmé : il n'a pas été gardé\./),
    ).toBeVisible();
    expect(screen.getByText(/Ce qui est déjà téléchargé est gardé/)).toBeVisible();
    expect(screen.queryByText(/ils n'ont pas été gardés/)).toBeNull();
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
