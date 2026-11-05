// SPDX-License-Identifier: MIT
// Voice input in the search (SCRUM-31), with a fake speech package
// (test/voice.ts): the microphone, the states of the flow, and the rule that
// nothing is added to the check without the confirm screen.
import type { Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import type { Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, storeTestCode } from '../test/render-app.js';
import { fakeSpeech, voicePackError, type FakeSpeechOptions } from '../test/voice.js';
import { createVoiceService } from '../voice/voice-service.js';

beforeEach(async () => {
  await storeTestCode();
});

vi.setConfig({ testTimeout: 20_000 });

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const NBSP = ' ';
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

afterEach(() => {
  vi.restoreAllMocks();
  setHidden(false);
});

/** The page shown or hidden, as the browser says it. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Opens the check, then the search of one list, with a fake voice. */
async function openSearch(
  list: 'Ajouter un médicament' | 'Ajouter un remède',
  options: FakeSpeechOptions = {},
  settings = woman,
) {
  await saveProfile(profileOf());
  const speech = fakeSpeech(options);
  const probe = probeCheck();
  await renderApp({
    settings,
    hash: '#/check',
    packLoader: loaderOf(pack),
    voice: createVoiceService(speech.port),
    children: probe.element,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: list }));
  const field = await screen.findByRole('searchbox');
  return { user, field, probe, speech };
}

function mic() {
  return screen.getByRole('button', { name: /^(Dire le nom|Terminer l'enregistrement)$/ });
}

function candidates() {
  const list = screen.queryByRole('list', { name: 'Propositions' });
  return list ? within(list).getAllByRole('button') : [];
}

/** The voice panel's live line. */
function voiceStatus(): HTMLElement {
  const status = document.querySelector<HTMLElement>('.voice [role="status"]');
  if (status === null) throw new Error('no voice status');
  return status;
}

describe('Search: the microphone', () => {
  it('sits beside the field, as a large button that says what it does', async () => {
    await openSearch('Ajouter un remède', { installed: ['wo'] });
    expect(mic()).toHaveAccessibleName('Dire le nom');
    expect(mic()).toHaveClass('mic');
    expect(mic().closest('.search__entry')).toContainElement(screen.getByRole('searchbox'));
  });

  it('is not shown where the browser cannot record: the keyboard does everything', async () => {
    await openSearch('Ajouter un remède', { supported: false });
    expect(screen.queryByRole('button', { name: 'Dire le nom' })).toBeNull();
  });

  it('opens the voice screen when no voice is installed, and downloads nothing', async () => {
    const { user, speech } = await openSearch('Ajouter un remède');
    await user.click(mic());
    expect(
      await screen.findByRole('heading', { level: 1, name: "Parler au lieu d'écrire" }),
    ).toBeVisible();
    expect(window.location.hash).toBe('#/voice');
    expect(speech.module.voicePackInfo).not.toHaveBeenCalled();
    expect(speech.module.installVoicePack).not.toHaveBeenCalled();
  });
});

describe('Search: saying a name', () => {
  it('records with the elapsed seconds and a cancel, then shows what it heard and its candidates', async () => {
    const { user, field, speech } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());

    expect(await screen.findByText("J'écoute en wolof.")).toBeVisible();
    // Short, so a screen reader is quiet again before she speaks; the rest is not read out.
    expect(voiceStatus()).toHaveTextContent(/^J'écoute en wolof\.$/);
    expect(screen.getByText('Dites le nom, puis touchez le carré pour terminer.')).toBeVisible();
    expect(screen.getByText('0 s sur 8')).toBeVisible();
    expect(screen.getByText("L'enregistrement se termine seul après 8 secondes.")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeVisible();
    expect(mic()).toHaveAccessibleName("Terminer l'enregistrement");
    expect(mic()).toHaveClass('mic--recording');
    // The model loads while she speaks.
    expect(speech.client.load).toHaveBeenCalled();

    await user.click(mic());
    expect(await screen.findByText(`J'ai entendu${NBSP}: nebeday`)).toBeVisible();
    expect(speech.recorder().stop).toHaveBeenCalled();
    expect(speech.client.transcribe).toHaveBeenCalledWith(expect.any(Float32Array), {
      language: 'wo',
    });
    // The text heard goes to the field and the resolver, as if typed.
    expect(field).toHaveValue('nebeday');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });
    expect(candidates()[0]).toHaveTextContent('Nom local : nebeday (wolof)');
    expect(mic()).toHaveAccessibleName('Dire le nom');
    // The machine's text is never added as typed: only a candidate, confirmed.
    expect(screen.queryByRole('button', { name: 'Je ne trouve pas ce remède' })).toBeNull();
  });

  it('adds nothing until a candidate is confirmed, then adds it', async () => {
    const { user, probe } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(mic());
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });
    expect(probe.current().items).toEqual([]);

    await user.click(candidates()[0] as HTMLElement);
    expect(window.location.hash).toBe('#/confirm/plant');
    expect(probe.current().items).toEqual([]);

    await user.click(await screen.findByRole('button', { name: "Oui, c'est ce remède" }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([{ ref: { kind: 'plant', id: 'moringa' } }]);
  });

  it('ends the recording by itself after 8 seconds', async () => {
    const { user, field, speech } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    act(() => {
      speech.recorder().onAutoStop();
    });
    expect(await screen.findByText(`J'ai entendu${NBSP}: nebeday`)).toBeVisible();
    expect(field).toHaveValue('nebeday');
  });

  it('says "Je réfléchis..." while the model works, and a cancel drops what it finds', async () => {
    const { user, field, speech } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      holdTranscription: true,
    });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(mic());
    expect(await screen.findByText('Je réfléchis...')).toBeVisible();
    expect(screen.getByText('Cela peut prendre une minute sur ce téléphone.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(voiceStatus()).toHaveTextContent('Enregistrement annulé.');
    expect(speech.client.cancel).toHaveBeenCalled();
    speech.finishTranscription('nebeday');
    await act(() => Promise.resolve());
    expect(field).toHaveValue('');
    expect(candidates()).toEqual([]);
  });

  it('cancels a recording: the microphone is released and nothing is transcribed', async () => {
    const { user, speech } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(voiceStatus()).toHaveTextContent('Enregistrement annulé.');
    expect(speech.recorder().cancel).toHaveBeenCalled();
    expect(speech.client.transcribe).not.toHaveBeenCalled();
  });

  it('says so when nothing matches, and offers to type the name or choose from the list', async () => {
    const { user, field } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      transcript: 'Zzqxw.',
    });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(mic());

    expect(await screen.findByText(`J'ai entendu${NBSP}: Zzqxw`)).toBeVisible();
    // Said in the panel, before what to do; not said twice below.
    const panel = voiceStatus().parentElement as HTMLElement;
    expect(within(panel).getByText('Aucun remède ne correspond à ce nom.')).toBeVisible();
    expect(screen.getAllByText('Aucun remède ne correspond à ce nom.')).toHaveLength(1);
    expect(screen.getByText('Écrivez le nom, ou choisissez-le dans la liste.')).toBeVisible();
    // The way out of a typed name is offered at once (live test round 2).
    expect(screen.getByRole('button', { name: 'Je ne trouve pas ce remède' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Écrire le nom' }));
    expect(field).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Choisir dans la liste des remèdes' }));
    const all = await screen.findByRole('region', { name: 'Tous les remèdes' });
    const names = within(all)
      .getAllByRole('button')
      .filter((button) => button.classList.contains('candidate'))
      .map((button) => button.textContent);
    expect(names.length).toBe(pack.plants.length);
    // By letter, a heading each, so a screen reader goes from letter to letter.
    expect(within(all).getByRole('heading', { level: 3, name: 'M' })).toBeVisible();
    // The Wolof names she may have said, with the name of each remedy.
    const moringa = within(all).getByRole('button', { name: /^Moringa/ });
    expect(moringa).toHaveTextContent('Nom local : nebeday, nebedaay (wolof)');

    await user.click(moringa);
    expect(window.location.hash).toBe('#/confirm/plant');
    expect(await screen.findByRole('button', { name: "Oui, c'est ce remède" })).toBeVisible();
  });

  it('lists the medicines too, one per family, when nothing matches in the medicines', async () => {
    const { user } = await openSearch('Ajouter un médicament', {
      installed: ['fr'],
      transcript: 'zzqxw',
    });
    await user.click(mic());
    await screen.findByText("J'écoute en français.");
    await user.click(mic());
    await user.click(
      await screen.findByRole('button', { name: 'Choisir dans la liste des médicaments' }),
    );
    const all = await screen.findByRole('region', { name: 'Tous les médicaments' });
    const names = within(all)
      .getAllByRole('button')
      .map((button) => button.querySelector('.candidate__name')?.textContent ?? '');
    expect(names.length).toBeGreaterThan(10);
    // One per family: DOLIPRANE once, whatever its strengths.
    expect(names.filter((name) => name === 'DOLIPRANE')).toHaveLength(1);
    // By letter, in order, and in alphabetical order within each letter.
    const letters = within(all)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(letters).toEqual([...letters].sort());
    for (const list of within(all).getAllByRole('list')) {
      const inLetter = within(list)
        .getAllByRole('button')
        .map((button) => button.querySelector('.candidate__name')?.textContent ?? '');
      const sorted = [...inLetter].sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base' }),
      );
      expect(inLetter).toEqual(sorted);
    }
  });

  it('lists the names on the boxes, a letter to jump to, and a filter (live test round 2)', async () => {
    const { user } = await openSearch('Ajouter un médicament', {
      installed: ['fr'],
      transcript: 'zzqxw',
    });
    await user.click(mic());
    await screen.findByText("J'écoute en français.");
    await user.click(mic());
    await user.click(
      await screen.findByRole('button', { name: 'Choisir dans la liste des médicaments' }),
    );
    const all = await screen.findByRole('region', { name: 'Tous les médicaments' });

    // The name on the box, under its letter, opening the generic.
    const letterC = within(all).getByRole('heading', { level: 3, name: 'C' });
    const cytotec = within(all).getByRole('button', { name: /^Cytotec/ });
    expect(cytotec).toHaveTextContent('Nom sur la boîte de Misoprostol (générique)');
    expect(
      letterC.compareDocumentPosition(cytotec) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // A French name is another name, never a local one.
    const codoliprane = within(all).getByRole('button', { name: /^CODOLIPRANE ADULTES/ });
    expect(codoliprane).toHaveTextContent('Autre nom : Doliprane codéine');
    expect(codoliprane).not.toHaveTextContent('Nom local');

    // A letter jumps to its heading.
    const letters = within(all).getByRole('navigation', { name: 'Aller à une lettre' });
    await user.click(within(letters).getByRole('button', { name: 'Lettre M' }));
    expect(within(all).getByRole('heading', { level: 3, name: 'M' })).toHaveFocus();

    // The filter keeps the names that hold what she types.
    await user.type(within(all).getByRole('searchbox', { name: 'Filtrer la liste' }), 'cyto');
    const shown = within(all)
      .getAllByRole('button')
      .filter((button) => button.classList.contains('candidate'));
    expect(shown.map((button) => button.querySelector('.candidate__name')?.textContent)).toEqual([
      'Cytotec',
    ]);
    expect(within(all).queryByRole('heading', { level: 3, name: 'M' })).toBeNull();

    await user.click(cytotec);
    expect(window.location.hash).toBe('#/confirm/product');
    const product = document.querySelector('.confirm__product');
    expect(product).toHaveTextContent('Misoprostol (générique)');
    expect(product).toHaveTextContent('Nom sur la boîte : Cytotec');
  });

  it('says when the filter keeps no name', async () => {
    const { user } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      transcript: 'Zzqxw.',
    });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(mic());
    await user.click(
      await screen.findByRole('button', { name: 'Choisir dans la liste des remèdes' }),
    );
    const all = await screen.findByRole('region', { name: 'Tous les remèdes' });
    await user.type(within(all).getByRole('searchbox', { name: 'Filtrer la liste' }), 'zzqxw');
    expect(within(all).getByText('Aucun nom de la liste ne contient « zzqxw ».')).toBeVisible();
  });

  it('says when it heard no name at all, in one message', async () => {
    const { user, field } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      transcript: ' ... ',
    });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(mic());
    expect(
      await screen.findByText("Je n'ai pas entendu de nom. Réessayez, ou écrivez le nom."),
    ).toBeVisible();
    // Nothing that says a name matched nothing: there was no name.
    expect(screen.queryByText('Aucun remède ne correspond à ce nom.')).toBeNull();
    expect(screen.queryByText('Écrivez le nom, ou choisissez-le dans la liste.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Choisir dans la liste des remèdes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Je ne trouve pas ce remède' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Écrire le nom' })).toBeVisible();
    expect(field).toHaveValue('');
  });

  it('adds a name heard that matches nothing as she said it, through the same question', async () => {
    const { user, probe } = await openSearch('Ajouter un médicament', {
      installed: ['fr'],
      transcript: 'sirop du marché',
    });
    await user.click(mic());
    await screen.findByText("J'écoute en français.");
    await user.click(mic());
    await user.click(await screen.findByRole('button', { name: 'Je ne trouve pas ce produit' }));
    // A lookalike first, as for a typed name; otherwise added at once.
    const none = screen.queryByRole('button', { name: /^Non, aucun de ces/ });
    if (none !== null) await user.click(none);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ce que vous prenez' }),
    ).toBeVisible();
    expect(probe.current().items).toEqual([
      { ref: { kind: 'unrecognised', text: 'sirop du marché' } },
    ]);
    const row = within(screen.getByRole('list', { name: 'Produits ajoutés' })).getByRole(
      'listitem',
    );
    expect(row).toHaveTextContent('« sirop du marché »');
  });

  it('says "Vous avez dit" for a name the voice heard, and keeps the name on the box', async () => {
    const { user } = await openSearch('Ajouter un médicament', {
      installed: ['fr'],
      transcript: 'birufen',
    });
    await user.click(mic());
    await screen.findByText("J'écoute en français.");
    await user.click(mic());
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Ibuprofène \(générique\)/);
    });
    expect(candidates()[0]).toHaveTextContent('Nom sur la boîte : Brufen');
    await user.click(candidates()[0] as HTMLElement);

    const product = document.querySelector('.confirm__product');
    expect(product).toHaveTextContent('Vous avez dit : « birufen »');
    expect(product).not.toHaveTextContent('Vous avez écrit');
    expect(product).toHaveTextContent('Nom sur la boîte : Brufen');
    await user.click(screen.getByRole('button', { name: "Oui, c'est ce produit" }));

    const row = within(await screen.findByRole('list', { name: 'Produits ajoutés' })).getByRole(
      'listitem',
    );
    expect(row).toHaveTextContent('Vous avez dit : « birufen »');
    expect(row).not.toHaveTextContent('Vous avez écrit');
  });

  it('keeps the letters typed before the microphone, through the voice screen', async () => {
    const { user, field } = await openSearch('Ajouter un remède');
    await user.type(field, 'neb');
    await user.click(mic());
    await screen.findByRole('heading', { level: 1, name: "Parler au lieu d'écrire" });
    await user.click(screen.getByRole('button', { name: 'Revenir à la recherche' }));
    expect(await screen.findByRole('searchbox')).toHaveValue('neb');
  });

  it('typing gives up a recording, and the keyboard goes on as usual', async () => {
    const { user, field, speech } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.type(field, 'kinkeliba');
    expect(speech.recorder().cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Je ne trouve pas ce remède' })).toBeVisible();
    expect(screen.queryByText("J'écoute en wolof.")).toBeNull();
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Kinkéliba/);
    });
  });

  it('releases the microphone when she leaves the screen', async () => {
    const { user, speech } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(screen.getByRole('link', { name: 'Signes de danger' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Signes de danger' }),
    ).toBeVisible();
    expect(speech.recorder().cancel).toHaveBeenCalled();
  });
});

describe('Search: when the voice cannot be used', () => {
  it('explains in steps how to allow a refused microphone in the browser, and offers typing', async () => {
    const { user, field } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      startError: new DOMException('Permission denied', 'NotAllowedError'),
    });
    await user.click(mic());
    expect(await screen.findByText('Le micro est bloqué pour cette application.')).toBeVisible();
    const steps = within(screen.getByRole('list', { name: 'Pour autoriser le micro' }))
      .getAllByRole('listitem')
      .map((step) => step.textContent);
    expect(steps).toEqual([
      'Dans Chrome, touchez les trois points en haut, puis Paramètres.',
      'Touchez Paramètres des sites, puis Micro.',
      'Autorisez ce site, puis revenez ici et touchez à nouveau le micro.',
    ]);
    expect(screen.getByText('En attendant, écrivez le nom.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Écrire le nom' }));
    expect(field).toHaveFocus();
  });

  it('gives the steps of the phone settings in the installed app, which has no browser menu', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({ matches: query === '(display-mode: standalone)', media: query }) as MediaQueryList,
    );
    const { user } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      startError: new DOMException('Permission denied', 'NotAllowedError'),
    });
    await user.click(mic());
    expect(await screen.findByText('Le micro est bloqué pour cette application.')).toBeVisible();
    const steps = within(screen.getByRole('list', { name: 'Pour autoriser le micro' }))
      .getAllByRole('listitem')
      .map((step) => step.textContent);
    expect(steps).toEqual([
      'Ouvrez les réglages du téléphone, puis Applications.',
      'Touchez Carnet, puis Autorisations, puis Micro.',
      'Choisissez Autoriser, puis revenez ici et touchez à nouveau le micro.',
    ]);
    expect(screen.queryByText(/trois points/)).toBeNull();
    vi.unstubAllGlobals();
  });

  it('says a missing microphone in words', async () => {
    const { user } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      startError: new DOMException('none', 'NotFoundError'),
    });
    await user.click(mic());
    expect(
      await screen.findByText("Aucun micro n'a été trouvé sur ce téléphone. Écrivez le nom."),
    ).toBeVisible();
  });

  it('says in plain words when the model cannot start, and ends the recording at once', async () => {
    const { user, speech } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      loadError: voicePackError('load', 'out of memory'),
    });
    await user.click(mic());
    expect(await screen.findByText(/La voix n'a pas pu démarrer sur ce téléphone\./)).toBeVisible();
    expect(screen.queryByText(/out of memory/)).toBeNull();
    expect(speech.recorder().cancel).toHaveBeenCalled();
    // If it happens again: the voice screen, to remove it and install it again.
    expect(screen.getByText(/Si cela recommence, retirez la voix/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retirer ou réinstaller la voix' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: "Parler au lieu d'écrire" }),
    ).toBeVisible();
  });

  it('offers to install the voice again when its files are missing', async () => {
    const { user } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      loadError: voicePackError('unavailable'),
    });
    await user.click(mic());
    expect(await screen.findByText(/La voix n'est pas complète sur ce téléphone\./)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Installer la voix' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: "Parler au lieu d'écrire" }),
    ).toBeVisible();
  });

  it('says a transcription that failed in plain words', async () => {
    const { user, speech } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      holdTranscription: true,
    });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(mic());
    await screen.findByText('Je réfléchis...');
    act(() => {
      speech.failTranscription(voicePackError('transcribe', 'did not answer within 180000 ms'));
    });
    expect(
      await screen.findByText(
        "Je n'ai pas pu comprendre cet enregistrement. Réessayez, ou écrivez le nom.",
      ),
    ).toBeVisible();
    // A new try works.
    expect(mic()).toHaveAccessibleName('Dire le nom');
  });

  it('leaves no timer running when the model fails while the microphone opens', async () => {
    const started = new Set<unknown>();
    const cleared = new Set<unknown>();
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((handler: () => void, ms?: number) => {
      const id = realSet(handler, ms);
      started.add(id);
      return id;
    });
    vi.spyOn(globalThis, 'clearInterval').mockImplementation((id?: unknown) => {
      cleared.add(id);
      realClear(id as ReturnType<typeof setInterval>);
    });
    const { user } = await openSearch('Ajouter un remède', {
      installed: ['wo'],
      loadError: voicePackError('load', 'out of memory'),
    });
    await user.click(mic());
    expect(await screen.findByText(/La voix n'a pas pu démarrer sur ce téléphone\./)).toBeVisible();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect([...started].filter((id) => !cleared.has(id))).toEqual([]);
    expect(screen.queryByText(/s sur 8$/)).toBeNull();
  });
});

describe('Search: the voice and the phone', () => {
  it('closes the microphone at once when the page is hidden during a recording', async () => {
    const { user, speech } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    act(() => {
      setHidden(true);
    });
    expect(speech.recorder().cancel).toHaveBeenCalled();
    expect(voiceStatus()).toHaveTextContent('Enregistrement annulé.');
    // The model goes too: nothing uses it while the page is hidden.
    expect(speech.client.dispose).toHaveBeenCalled();
  });

  it('gives the model back to the phone when the page is hidden after a name was heard', async () => {
    const { user, speech } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(mic());
    await screen.findByText(`J'ai entendu${NBSP}: nebeday`);
    expect(speech.client.dispose).not.toHaveBeenCalled();
    act(() => {
      setHidden(true);
    });
    expect(speech.client.dispose).toHaveBeenCalledOnce();
  });

  it('keeps a name heard from being added as typed after Back from its confirm screen', async () => {
    const { user } = await openSearch('Ajouter un remède', { installed: ['wo'] });
    await user.click(mic());
    await screen.findByText("J'écoute en wolof.");
    await user.click(mic());
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });
    await user.click(candidates()[0] as HTMLElement);
    await screen.findByRole('button', { name: "Oui, c'est ce remède" });
    act(() => {
      window.history.back();
    });
    const back = await screen.findByRole('searchbox');
    expect(back).toHaveValue('nebeday');
    await waitFor(() => {
      expect(candidates()[0]).toHaveTextContent(/^Moringa/);
    });
    expect(screen.queryByRole('button', { name: 'Je ne trouve pas ce remède' })).toBeNull();
    // Once she types, it is hers: offered again.
    await user.type(back, 'x');
    expect(await screen.findByRole('button', { name: 'Je ne trouve pas ce remède' })).toBeVisible();
  });
});
