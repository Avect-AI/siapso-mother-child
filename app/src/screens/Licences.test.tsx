// SPDX-License-Identifier: MIT
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Settings } from '../domain/types.js';
import { noPack, renderApp } from '../test/render-app.js';

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };

describe('Licences', () => {
  it('opens from About, before the code too', async () => {
    await renderApp({ settings: woman, hash: '#/about', locked: true, packLoader: noPack });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('link', { name: 'Lire les licences des logiciels tiers' }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Licences des logiciels tiers' }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/licences');
  });

  it('lists the software of the voice with its version, licence and copyright', async () => {
    await renderApp({ settings: woman, hash: '#/licences' });
    const software = await screen.findByRole('region', { name: 'Logiciels' });
    expect(within(software).getByText(/^Transformers\.js 4\.3\.1/)).toBeVisible();
    expect(within(software).getByText(/^ONNX Runtime Web 1\.31\.0/)).toBeVisible();
    expect(within(software).getByText('Copyright (c) Microsoft Corporation')).toBeVisible();
    expect(within(software).getAllByText('Licence : Apache-2.0')).toHaveLength(2);
  });

  it('lists the models and the data of the Wolof model, with what is not settled', async () => {
    await renderApp({ settings: woman, hash: '#/licences' });
    const models = await screen.findByRole('region', { name: 'Modèles de la voix' });
    expect(within(models).getByText('Copyright (c) 2022 OpenAI')).toBeVisible();
    expect(within(models).getByText('M9and2M/whisper-small-wolof')).toBeVisible();
    expect(within(models).getByText('Licence déclarée sur la fiche du modèle.')).toBeVisible();
    const data = screen.getByRole('region', {
      name: 'Données qui ont servi à adapter le modèle au wolof',
    });
    expect(within(data).getByText(/FLEURS/)).toBeVisible();
    expect(within(data).getByText(/partage à l'identique/)).toBeVisible();
    expect(
      within(data).getByText('Aucune licence trouvée pour ces enregistrements.'),
    ).toBeVisible();
  });

  it('holds the full texts of the Apache 2.0 and MIT licences', async () => {
    await renderApp({ settings: woman, hash: '#/licences' });
    const user = userEvent.setup();
    const texts = await screen.findByRole('region', { name: 'Textes des licences' });
    await user.click(within(texts).getByText('Apache License 2.0'));
    expect(within(texts).getByText(/TERMS AND CONDITIONS FOR USE, REPRODUCTION/)).toBeVisible();
    await user.click(within(texts).getByText('MIT License'));
    expect(within(texts).getByText(/Permission is hereby granted, free of charge/)).toBeVisible();
  });

  it('renders in English', async () => {
    await renderApp({ settings: { ...woman, lang: 'en' }, hash: '#/licences' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Third-party licences' }),
    ).toBeVisible();
    expect(screen.getAllByText('Licence: MIT').length).toBeGreaterThan(0);
  });
});
