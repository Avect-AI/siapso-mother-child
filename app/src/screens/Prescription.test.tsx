// SPDX-License-Identifier: MIT
// Read a prescription (SCRUM-57, phase 3): the pack, the reading, the list to
// tick (nothing ticked at first), the confirmation of each product ticked, a
// line added as typed, and every failure said with what to do instead. The
// OCR itself is replaced: these tests are about the screen, the reading of
// lines into products is tested in prescription-reading.test.ts.
import type { Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';

const ocr = vi.hoisted(() => ({
  installed: null as unknown,
  lines: [] as string[],
  failure: null as unknown,
  reads: 0,
  installs: 0,
  manifestAsked: 0,
}));

vi.mock('@siapso/ocr', async (importOriginal) => {
  const real = await importOriginal<typeof import('@siapso/ocr')>();
  const info = { id: 'ppocrv5-mobile-latin', baseUrl: 'http://x/ocr/', files: [], totalBytes: 10 };
  return {
    ...real,
    isOcrSupported: () => true,
    installedOcrPackInfo: () => Promise.resolve(ocr.installed),
    ocrPackInfo: () => {
      ocr.manifestAsked += 1;
      return Promise.resolve(info);
    },
    installOcrPack: (_info: unknown, onProgress: (loaded: number, total: number) => void) => {
      ocr.installs += 1;
      onProgress(10, 10);
      ocr.installed = info;
      return Promise.resolve();
    },
    removeOcrPack: () => {
      ocr.installed = null;
      return Promise.resolve();
    },
    createOcrClient: () => ({
      read: () => {
        ocr.reads += 1;
        if (ocr.failure !== null) return Promise.reject(ocr.failure as Error);
        return Promise.resolve({ lines: ocr.lines, source: 'image', pages: 1, ms: 5 });
      },
      cancel: () => undefined,
      release: () => undefined,
      dispose: () => undefined,
    }),
  };
});

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

beforeEach(async () => {
  await storeTestCode();
  ocr.installed = {
    id: 'ppocrv5-mobile-latin',
    baseUrl: 'http://x/ocr/',
    files: [],
    totalBytes: 10,
  };
  ocr.lines = [];
  ocr.failure = null;
  ocr.reads = 0;
  ocr.installs = 0;
  ocr.manifestAsked = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Her check, then the prescription screen opened from its entry. */
async function openPrescription() {
  await saveProfile(profileOf({ term: { kind: 'weeks', weeks: 24, givenOn: '2026-11-04' } }));
  const probe = probeCheck();
  await renderApp({
    settings: woman,
    hash: '#/',
    packLoader: loaderOf(pack),
    children: probe.element,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /^Lire une ordonnance/ }));
  await screen.findByRole('heading', { level: 1, name: 'Lire une ordonnance' });
  return { user, probe };
}

/** A photo given to the camera input. */
async function givePhoto(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByTestId('prescription-photo');
  await user.upload(
    input,
    new File([new Uint8Array([1, 2, 3])], 'ordonnance.jpg', { type: 'image/jpeg' }),
  );
}

describe('Prescription: the pack', () => {
  it('asks for nothing on the network before she taps "Installer le pack", then reads', async () => {
    ocr.installed = null;
    const { user } = await openPrescription();
    expect(
      await screen.findByRole('heading', { level: 2, name: "Pack « Lecture d'ordonnance »" }),
    ).toBeVisible();
    expect(ocr.manifestAsked).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Installer le pack' }));
    expect(await screen.findByRole('button', { name: 'Prendre une photo' })).toBeVisible();
    expect(ocr.manifestAsked).toBe(1);
    expect(ocr.installs).toBe(1);
  });
});

describe('Prescription: the list to tick', () => {
  it('starts with nothing ticked, says what was read and what to compare', async () => {
    ocr.lines = ['1. Doliprane 1000 mg cp', '2. Efferalgan codé 500 mg', '3. Smecta 1 sachet'];
    const { user } = await openPrescription();
    await givePhoto(user);
    await screen.findByRole('heading', { level: 2, name: "Produits lus sur l'ordonnance" });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    for (const box of boxes) expect(box).not.toBeChecked();
    expect(screen.getByText("Lu sur l'ordonnance : « 1. Doliprane 1000 mg cp »")).toBeVisible();
    expect(
      screen.getByText(/^Regardez la boîte : la ligne dit aussi « cod[ée]ine »\.$/i),
    ).toBeVisible();
    // The image is never kept: one reading, and the screen holds only the lines.
    expect(ocr.reads).toBe(1);
  });

  it('asks for at least one tick before going on', async () => {
    ocr.lines = ['1. Doliprane 1000 mg cp'];
    const { user } = await openPrescription();
    await givePhoto(user);
    await user.click(await screen.findByRole('button', { name: 'Confirmer les produits cochés' }));
    expect(screen.getByText('Cochez au moins un produit.')).toBeVisible();
  });

  it('confirms each product ticked with the questions of a name typed, then back to the check', async () => {
    ocr.lines = ['1. Doliprane 1000 mg cp'];
    const { user, probe } = await openPrescription();
    await givePhoto(user);
    const list = await screen.findByRole('list');
    await user.click(within(list).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Confirmer les produits cochés' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Produit 1 sur 1' })).toHaveFocus();
    expect(probe.current().items).toEqual([]);
    // The confirm form of a name typed: its own question decides what is added.
    const yes = await screen.findByRole('button', { name: /^Oui/ });
    await user.click(yes);
    await waitFor(() => {
      expect(probe.current().items.length).toBe(1);
    });
    expect(probe.current().items[0]?.ref).toMatchObject({ kind: 'product' });
  });

  it('adds a line not recognised as typed, only when ticked', async () => {
    ocr.lines = ['1. Smecta 1 sachet x 3/j'];
    const { user, probe } = await openPrescription();
    await givePhoto(user);
    const typed = await screen.findByRole('checkbox', { name: /^Ajouter tel quel : « Smecta/ });
    await user.click(typed);
    await user.click(screen.getByRole('button', { name: 'Confirmer les produits cochés' }));
    await waitFor(() => {
      expect(probe.current().items).toEqual([{ ref: { kind: 'unrecognised', text: 'Smecta' } }]);
    });
  });
});

describe('Prescription: failures say what to do', () => {
  it('asks for a photo of the paper when a PDF is too large or cannot be read', async () => {
    const { OcrPackError } = await import('@siapso/ocr');
    ocr.failure = new OcrPackError('pdf-unsupported', 'no');
    const { user } = await openPrescription();
    await givePhoto(user);
    expect(
      await screen.findByText(
        "Ce PDF ne peut pas être lu ici. Prenez l'ordonnance en photo avec l'appareil.",
      ),
    ).toBeVisible();
    // Still one tap from another try.
    expect(screen.getByRole('button', { name: 'Prendre une photo' })).toBeVisible();
  });

  it('says nothing was read, and keeps typing one tap away', async () => {
    ocr.lines = ['Docteur Diop', 'Dakar, le 06/11/2026'];
    const { user } = await openPrescription();
    await givePhoto(user);
    expect(
      await screen.findByText(
        "Aucun produit n'a été lu sur cette ordonnance. Reprenez une photo bien nette, ou tapez les noms.",
      ),
    ).toBeVisible();
    act(() => undefined);
    expect(screen.getByRole('button', { name: 'Revenir à la liste' })).toBeVisible();
  });
});
