// SPDX-License-Identifier: MIT
// Phone numbers in these tests are made up: +999 is not a country code, and
// local numbers are runs of the same digits. No real number in the repository.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckedItem, Pack } from '@siapso/engine';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPack } from '../data/pack-loader.js';
import { saveProfile } from '../data/profiles.js';
import { saveContacts } from '../data/referral.js';
import type { ReferralContact, Settings } from '../domain/types.js';
import { inSession, inVisit } from '../state/entry-state.js';
import { probeCheck } from '../test/check-probe.js';
import { hangIndexedDB } from '../test/idb.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp, TEST_CODE } from '../test/render-app.js';
import { probeSession } from '../test/session-probe.js';

vi.setConfig({ testTimeout: 20_000 });

const HERE = path.dirname(fileURLToPath(import.meta.url));

const woman: Settings = { lang: 'fr', mode: 'woman', onboarded: true };
const accompanied: Settings = { lang: 'fr', mode: 'accompanied', onboarded: true };
const AWA: ReferralContact = { id: 'c1', role: 'relay', name: 'Awa', phone: '000 000 001' };
const POST: ReferralContact = { id: 'c2', role: 'icp', name: '', phone: '+999 000 002' };
const deployment = {
  contacts: [{ role: 'midwife', name: 'Maternité', phone: '000 000 003' }],
  nationalCircuit: { fr: 'Le circuit national.', en: 'The national circuit.' },
};
let pack: Pack;

beforeAll(async () => {
  pack = await knowledgePack();
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // No deployment file unless a test serves one.
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('Not found', { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function serveDeployment(file: object = deployment) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
    Promise.resolve(
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith(
        '/config/referral.json',
      )
        ? Response.json(file)
        : new Response('Not found', { status: 404 }),
    ),
  );
}

/** The built-in emergency links, in French. */
function emergencyLinks() {
  return {
    samu: screen.getByRole('link', { name: 'Appeler le SAMU (1515)' }),
    firefighters: screen.getByRole('link', { name: 'Appeler les pompiers (18)' }),
  };
}

const CIRCUIT_LINE = 'Allez au poste de santé ou au centre de santé le plus proche.';
const LOCKED_NOTE =
  'Si des contacts sont enregistrés sur ce téléphone, ils apparaissent une fois le code entré.';

describe('Who to call', () => {
  it('lists the contacts of the phone, then the deployment, each with a call link and its number', async () => {
    await saveContacts([AWA, POST]);
    serveDeployment();
    await renderApp({ settings: accompanied, hash: '#/danger/call', packLoader: loaderOf(pack) });

    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    const list = await screen.findByRole('list', { name: 'Contacts à appeler' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // The name, the role, the number as text, then the call link.
    expect(rows[0]).toHaveTextContent('AwaRelais000 000 001');
    const first = within(rows[0] as HTMLElement).getByRole('link', {
      name: 'Appeler Awa (Relais), 000 000 001',
    });
    expect(first).toHaveAttribute('href', 'tel:000000001');
    expect(first).toHaveClass('button--primary');
    // No name: the role names the contact; a leading plus is dialled.
    const second = within(rows[1] as HTMLElement).getByRole('link', {
      name: 'Appeler Infirmier chef de poste (ICP), +999 000 002',
    });
    expect(second).toHaveAttribute('href', 'tel:+999000002');
    expect(second).toHaveClass('button--secondary');
    expect(rows[2]).toHaveTextContent('Maternité');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    // The national circuit of the deployment file, after the contacts.
    expect(screen.getByRole('heading', { level: 2, name: 'Circuit de référence' })).toBeVisible();
    expect(screen.getByText('Le circuit national.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Modifier les contacts' })).toHaveAttribute(
      'href',
      '#/contacts',
    );
  });

  it('says when no contact is saved, and offers to add one in both modes', async () => {
    const { unmount } = await renderApp({ settings: accompanied, hash: '#/danger/call' });
    expect(await screen.findByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ajouter un contact' })).toHaveAttribute(
      'href',
      '#/contacts/new',
    );
    unmount();

    await renderApp({ settings: woman, hash: '#/danger/call' });
    expect(await screen.findByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ajouter un contact' })).toHaveAttribute(
      'href',
      '#/contacts/new',
    );
  });

  it('always gives the national emergency numbers to call, and where to go, even with no contact', async () => {
    await renderApp({ settings: woman, hash: '#/danger/call' });

    expect(await screen.findByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
    const { samu, firefighters } = emergencyLinks();
    expect(samu).toHaveAttribute('href', 'tel:1515');
    expect(firefighters).toHaveAttribute('href', 'tel:18');
    // No contact: the first emergency number is the screen's one primary action.
    expect(samu).toHaveClass('button--primary');
    expect(firefighters).toHaveClass('button--secondary');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    const circuit = screen.getByRole('region', { name: 'Circuit de référence' });
    expect(within(circuit).getByText(CIRCUIT_LINE)).toBeVisible();
    expect(
      within(within(circuit).getByRole('list', { name: "Numéros d'urgence" })).getAllByRole('link'),
    ).toHaveLength(2);
    // A keyboard reaches an action in the main area: the emergency links come first.
    const main = screen.getByRole('main');
    const focusable = within(main).getAllByRole('link');
    expect(focusable[0]).toBe(samu);
  });

  it('puts the contacts of the circuit first, the emergency numbers after them, all secondary', async () => {
    await saveContacts([AWA]);
    await renderApp({ settings: woman, hash: '#/danger/call' });

    const awa = await screen.findByRole('link', { name: 'Appeler Awa (Relais), 000 000 001' });
    expect(awa).toHaveClass('button--primary');
    const { samu, firefighters } = emergencyLinks();
    expect(samu).toHaveClass('button--secondary');
    expect(firefighters).toHaveClass('button--secondary');
    expect(document.querySelectorAll('main .button--primary')).toHaveLength(1);
    const links = within(screen.getByRole('main')).getAllByRole('link');
    expect(links.indexOf(awa)).toBeLessThan(links.indexOf(samu));
  });

  it('gives the emergency numbers at once, while the contacts are still loading', async () => {
    hangIndexedDB();
    await renderApp({ hash: '#/danger/call', storageTimeoutMs: 60_000 });

    expect(screen.getByText('Les contacts se chargent.')).toHaveAttribute('role', 'status');
    const { samu, firefighters } = emergencyLinks();
    expect(samu).toHaveAttribute('href', 'tel:1515');
    expect(firefighters).toHaveAttribute('href', 'tel:18');
    expect(screen.getByText(CIRCUIT_LINE)).toBeVisible();
  });

  it('keeps the boxed buttons for calls: adding, changing the contacts and the code are quiet', async () => {
    const boxed = () =>
      [...document.querySelectorAll('main .button--primary, main .button--secondary')].map(
        (button) => button.getAttribute('href') ?? button.textContent,
      );
    const { unmount } = await renderApp({ settings: woman, hash: '#/danger/call' });
    expect(await screen.findByRole('link', { name: 'Ajouter un contact' })).toHaveClass(
      'button--quiet',
    );
    expect(boxed()).toEqual(['tel:1515', 'tel:18']);
    unmount();

    await saveContacts([AWA]);
    const second = await renderApp({ settings: woman, hash: '#/danger/call' });
    expect(await screen.findByRole('link', { name: 'Modifier les contacts' })).toHaveClass(
      'button--quiet',
    );
    expect(boxed()).toEqual(['tel:000000001', 'tel:1515', 'tel:18']);
    second.unmount();

    await renderApp({ settings: woman, hash: '#/danger/call', locked: true });
    expect(await screen.findByRole('button', { name: 'Entrer le code' })).toHaveClass(
      'button--quiet',
    );
    expect(boxed()).toEqual(['tel:1515', 'tel:18']);
  });

  it('words the emergency numbers in English', async () => {
    await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger/call',
    });

    expect(await screen.findByRole('link', { name: 'Call the SAMU (1515)' })).toHaveAttribute(
      'href',
      'tel:1515',
    );
    expect(screen.getByRole('link', { name: 'Call the fire brigade (18)' })).toHaveAttribute(
      'href',
      'tel:18',
    );
    expect(screen.getByText('Go to the nearest health post or health centre.')).toBeVisible();
  });

  it("takes the deployment file's emergency numbers in place of the built-in ones, and its circuit under the line", async () => {
    serveDeployment({
      ...deployment,
      emergencyNumbers: [{ name: { fr: 'la ligne verte', en: 'the green line' }, phone: '000' }],
    });
    await renderApp({ settings: woman, hash: '#/danger/call' });

    expect(
      await screen.findByRole('link', { name: 'Appeler la ligne verte (000)' }),
    ).toHaveAttribute('href', 'tel:000');
    expect(screen.queryByRole('link', { name: /SAMU/ })).toBeNull();
    // The built-in line stays; the deployment's circuit text comes under it.
    const line = screen.getByText(CIRCUIT_LINE);
    const national = await screen.findByText('Le circuit national.');
    expect(line.compareDocumentPosition(national) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts the call links first: the numbers before where to go, the signs to say after them', async () => {
    await renderApp({
      settings: woman,
      hash: '#/danger/call',
      packLoader: loaderOf(pack),
      entryState: inVisit({ instruction: { standard: true }, signs: ['fever'] }),
    });
    const fever = pack.dangerSigns.find((d) => d.id === 'fever')?.label.fr ?? 'missing';

    const { samu } = await waitForEmergencyLinks();
    const after = (first: Node, second: Node) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    const circuit = screen.getByRole('region', { name: 'Circuit de référence' });
    // In the section: the heading, the numbers, then where to go.
    expect(after(within(circuit).getByRole('heading', { level: 2 }), samu)).toBe(true);
    expect(after(samu, within(circuit).getByText(CIRCUIT_LINE))).toBe(true);
    // The signs to say when calling come after the numbers, before the phone's contacts.
    const said = screen.getByText('Dites ces signes au téléphone ou au poste de santé :');
    expect(after(circuit, said)).toBe(true);
    expect(after(said, screen.getByText(fever))).toBe(true);
    expect(after(said, screen.getByText('Aucun contact enregistré sur ce téléphone.'))).toBe(true);
  });

  it('opens at once, and says when the phone storage does not answer, never a blank', async () => {
    hangIndexedDB();
    serveDeployment();
    await renderApp({ hash: '#/danger/call', storageTimeoutMs: 50 });

    expect(screen.getByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    expect(screen.getByText('Les contacts se chargent.')).toHaveAttribute('role', 'status');
    expect(
      await screen.findByText(
        "Les contacts de ce téléphone n'ont pas pu être lus. Fermez l'application, puis rouvrez-la.",
      ),
    ).toBeVisible();
    // The deployment's contacts are still there.
    expect(screen.getByRole('link', { name: /^Appeler Maternité/ })).toBeVisible();
  });
});

describe('Who to call, details', () => {
  it('says the saved contacts could not be read, never that there are none', async () => {
    hangIndexedDB();
    await renderApp({ hash: '#/danger/call', storageTimeoutMs: 50 });

    expect(
      await screen.findByText(
        "Les contacts de ce téléphone n'ont pas pu être lus. Fermez l'application, puis rouvrez-la.",
      ),
    ).toBeVisible();
    expect(screen.queryByText('Aucun contact enregistré sur ce téléphone.')).toBeNull();
  });

  it('keeps each digit group of a number together: it wraps only between groups', async () => {
    await saveContacts([{ id: 'c1', role: 'relay', name: 'Awa', phone: '+999 000000000' }]);
    await renderApp({ settings: woman, hash: '#/danger/call', packLoader: loaderOf(pack) });

    const row = (await screen.findByRole('link', { name: /^Appeler Awa/ })).closest('li');
    const phone = row?.querySelector('.referral__phone');
    expect(phone).toHaveTextContent('+999 000 000 000');
    // A long run of digits is shown in groups of three; each group is one unbreakable piece.
    expect([...(phone?.querySelectorAll('.phone__group') ?? [])].map((g) => g.textContent)).toEqual(
      ['+999', '000', '000', '000'],
    );
    expect(screen.getByRole('link', { name: /^Appeler Awa/ })).toHaveAttribute(
      'href',
      'tel:+999000000000',
    );
    const css = readFileSync(path.resolve(HERE, '..', 'styles', 'base.css'), 'utf8');
    expect(css).toMatch(/\.phone__group\s*\{[^}]*white-space:\s*nowrap/);
    const phoneRule = /\.referral__phone,\s*\.contacts__phone\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(phoneRule).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('words the instruction it was opened with in the language of the moment', async () => {
    // As a result leaves it: which message says the instruction, never its words.
    window.history.replaceState(
      inSession({ instruction: { message: 'castor-oil-term-uterine-scar' } }),
      '',
      '#/danger/call',
    );
    const { unmount } = await renderApp({
      settings: { lang: 'en', mode: 'woman', onboarded: true },
      hash: '#/danger/call',
      packLoader: loaderOf(pack),
    });
    const english = pack.messages.en['castor-oil-term-uterine-scar']?.orientation ?? 'missing';
    expect(await screen.findByRole('heading', { level: 2, name: english })).toBeVisible();
    unmount();

    window.history.replaceState(inVisit({ instruction: { standard: true } }), '', '#/danger/call');
    await renderApp({ settings: woman, hash: '#/danger/call', packLoader: loaderOf(pack) });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Allez au poste de santé maintenant.' }),
    ).toBeVisible();
  });

  it("says a result's own instruction only once the pack is there, never another one first", async () => {
    let deliver: (loaded: LoadedPack) => void = () => undefined;
    const later = () =>
      new Promise<LoadedPack>((resolve) => {
        deliver = resolve;
      });
    window.history.replaceState(
      inSession({ instruction: { message: 'castor-oil-term-uterine-scar' } }),
      '',
      '#/danger/call',
    );
    await renderApp({ settings: woman, hash: '#/danger/call', packLoader: later });

    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    // The pack is loading: no banner yet, rather than the standard words first.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Allez au poste de santé maintenant.')).toBeNull();

    await act(async () => {
      deliver(await loaderOf(pack)());
    });
    const own = pack.messages.fr['castor-oil-term-uterine-scar']?.orientation ?? 'missing';
    expect(await screen.findByRole('heading', { level: 2, name: own })).toBeVisible();
  });

  it('ignores signs and an instruction left on the entry before a quick exit', async () => {
    window.history.replaceState(
      { instruction: { standard: true }, signs: ['fever'], visit: 'an earlier visit' },
      '',
      '#/danger/call',
    );
    await renderApp({ settings: woman, hash: '#/danger/call', packLoader: loaderOf(pack) });

    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Dites ces signes au téléphone ou au poste de santé :')).toBeNull();
    // Gone from the history too, not only unread.
    expect(window.history.state).toBeNull();
  });
});

describe('Who to call, before the code', () => {
  it('keeps the signs ticked on the danger signs screen, given without the code', async () => {
    await renderApp({
      settings: woman,
      hash: '#/danger',
      packLoader: loaderOf(pack),
      locked: true,
    });
    const user = userEvent.setup();
    const fever = pack.dangerSigns.find((d) => d.id === 'fever')?.label.fr ?? 'missing';

    await user.click(await screen.findByRole('checkbox', { name: fever }));
    await user.click(screen.getByRole('button', { name: "C'est grave maintenant" }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    expect(screen.getByText('Dites ces signes au téléphone ou au poste de santé :')).toBeVisible();
    expect(screen.getByText(fever)).toBeVisible();
  });
  it('shows the deployment circuit only, and a way to give the code that comes back here', async () => {
    await saveContacts([AWA]);
    serveDeployment();
    await renderApp({
      settings: accompanied,
      hash: '#/danger/call',
      packLoader: loaderOf(pack),
      locked: true,
    });
    const user = userEvent.setup();

    expect(await screen.findByRole('link', { name: /^Appeler Maternité/ })).toBeVisible();
    expect(screen.queryByText('Awa')).toBeNull();
    expect(screen.queryByText('Aucun contact enregistré sur ce téléphone.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Modifier les contacts' })).toBeNull();
    expect(screen.getByText(LOCKED_NOTE)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Quitter' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Entrer le code' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Entrez votre code' }),
    ).toBeVisible();
    await user.type(screen.getByLabelText('Code'), `${TEST_CODE}{Enter}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    expect(await screen.findByRole('link', { name: /^Appeler Awa/ })).toBeVisible();
    expect(window.location.hash).toBe('#/danger/call');
  });

  it('takes the saved contacts off the screen as soon as the session locks', async () => {
    await saveContacts([AWA]);
    const session = probeSession();
    await renderApp({
      settings: accompanied,
      hash: '#/danger/call',
      packLoader: loaderOf(pack),
      children: session.element,
    });
    expect(await screen.findByRole('link', { name: /^Appeler Awa/ })).toBeVisible();

    act(() => {
      session.current().lock();
    });

    expect(screen.queryByText('Awa')).toBeNull();
    expect(await screen.findByText(LOCKED_NOTE)).toBeVisible();
  });

  it('gives the emergency numbers locked too, and never says whether contacts are saved', async () => {
    // Two phones, both locked, one with a saved contact: their screens read the same.
    const texts: (string | null)[] = [];
    for (const contacts of [[], [AWA]]) {
      await saveContacts(contacts);
      const { unmount } = await renderApp({
        settings: woman,
        hash: '#/danger/call',
        locked: true,
      });
      const { samu, firefighters } = await waitForEmergencyLinks();
      expect(samu).toHaveAttribute('href', 'tel:1515');
      expect(samu).toHaveClass('button--primary');
      expect(firefighters).toHaveAttribute('href', 'tel:18');
      expect(screen.getByText(CIRCUIT_LINE)).toBeVisible();
      expect(screen.getByText(LOCKED_NOTE)).toBeVisible();
      expect(screen.queryByText('Aucun contact enregistré sur ce téléphone.')).toBeNull();
      expect(screen.queryByRole('link', { name: 'Ajouter un contact' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'Modifier les contacts' })).toBeNull();
      texts.push(screen.getByRole('main').textContent);
      unmount();
    }
    expect(texts[1]).toBe(texts[0]);
  });
});

describe('Who to call, adding a contact', () => {
  it('woman mode: a contact added from who to call is there to call once saved, the signs kept', async () => {
    await renderApp({
      settings: woman,
      hash: '#/danger/call',
      packLoader: loaderOf(pack),
      // As the danger signs screen leaves it: "C'est grave maintenant" with a fever ticked.
      entryState: inVisit({ instruction: { standard: true }, signs: ['fever'] }),
    });
    const user = userEvent.setup();
    const fever = pack.dangerSigns.find((d) => d.id === 'fever')?.label.fr ?? 'missing';
    expect(await screen.findByText(fever)).toBeVisible();

    await user.click(await screen.findByRole('link', { name: 'Ajouter un contact' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Nouveau contact' })).toBeVisible();
    await user.click(await screen.findByText('Sage-femme'));
    await user.type(screen.getByRole('textbox', { name: 'Numéro de téléphone' }), '000 000 004');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    // Back on who to call, the same entry: the banner, the sign, and the contact to call first.
    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    expect(window.location.hash).toBe('#/danger/call');
    const call = await screen.findByRole('link', { name: 'Appeler Sage-femme, 000 000 004' });
    expect(call).toHaveAttribute('href', 'tel:000000004');
    expect(call).toHaveClass('button--primary');
    expect(screen.getByText(fever)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Allez au poste de santé maintenant.');
    expect(screen.getByRole('link', { name: 'Modifier les contacts' })).toHaveAttribute(
      'href',
      '#/contacts',
    );
    // It says the contact was saved, once.
    const status = within(screen.getByRole('main')).getByText('Contact enregistré : Sage-femme.');
    expect(status).toHaveAttribute('role', 'status');

    // Away and back: said no more.
    act(() => {
      window.location.hash = '#/danger';
    });
    await screen.findByRole('heading', { level: 1, name: 'Signes de danger' });
    act(() => {
      window.location.hash = '#/danger/call';
    });
    await screen.findByRole('link', { name: 'Appeler Sage-femme, 000 000 004' });
    expect(screen.queryByText('Contact enregistré : Sage-femme.')).toBeNull();
  });

  it('never says a contact was saved once the session locks', async () => {
    const session = probeSession();
    await renderApp({
      settings: woman,
      hash: '#/danger/call',
      packLoader: loaderOf(pack),
      children: session.element,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Ajouter un contact' }));
    await user.click(await screen.findByText('Sage-femme'));
    await user.type(screen.getByRole('textbox', { name: 'Nom' }), 'Fatou');
    await user.type(screen.getByRole('textbox', { name: 'Numéro de téléphone' }), '000 000 004');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Contact enregistré : Fatou (Sage-femme).')).toBeVisible();

    act(() => {
      session.current().lock();
    });
    expect(await screen.findByText(LOCKED_NOTE)).toBeVisible();
    expect(document.body.textContent).not.toContain('Fatou');
  });
});

/** The emergency links once the circuit is read (they show at once; the primary action waits for the contacts). */
async function waitForEmergencyLinks() {
  await screen.findByRole('link', { name: 'Appeler le SAMU (1515)' });
  await waitFor(() => {
    expect(screen.queryByText('Les contacts se chargent.')).toBeNull();
  });
  return emergencyLinks();
}

describe('Who to call, from a result', () => {
  const CASTOR: CheckedItem = { ref: { kind: 'plant', id: 'castor-oil' } };

  async function openResult(items: CheckedItem[], signs: string[], extra?: ReactElement) {
    const probe = probeCheck();
    const view = await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: (
        <>
          {probe.element}
          {extra}
        </>
      ),
    });
    await screen.findByRole('heading', { level: 1 });
    act(() => {
      const check = probe.current();
      check.start('p1');
      for (const item of items) check.add(item);
      check.setSigns(signs);
    });
    act(() => {
      window.location.hash = '#/result';
    });
    await screen.findByRole('heading', { level: 1, name: 'Résultat' });
    return view;
  }

  it("never shows a result's instruction or the check's signs once locked, nor after a reload", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
    await saveProfile(profileOf());
    const session = probeSession();
    const view = await openResult(
      [{ ref: { kind: 'plant', id: 'kinkeliba' } }],
      ['fever'],
      session.element,
    );
    const user = userEvent.setup();
    const own = pack.messages.fr['danger-sign-fever']?.orientation ?? 'missing';
    const fever = pack.dangerSigns.find((d) => d.id === 'fever')?.label.fr ?? 'missing';
    await user.click(await screen.findByRole('button', { name: 'Voir qui appeler' }));
    expect(await screen.findByRole('heading', { level: 2, name: own })).toBeVisible();
    expect(screen.getByText(fever)).toBeVisible();

    // Two minutes without a touch: the session locks on this screen.
    act(() => {
      session.current().lock();
    });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Allez au poste de santé maintenant.' }),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain("test au poste de santé aujourd'hui");
    expect(screen.queryByText(fever)).toBeNull();

    // A reload while locked: the entry's state is gone, not only unread.
    view.unmount();
    await renderApp({ hash: '#/danger/call', packLoader: loaderOf(pack), locked: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    expect(document.body.textContent).not.toContain("test au poste de santé aujourd'hui");
    expect(screen.queryByText(fever)).toBeNull();
    expect(window.history.state).toBeNull();
    vi.useRealTimers();
  });

  it('a danger finding always leads to the circuit: the same instruction, then the contacts or none', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
    await saveProfile(
      profileOf({
        term: { kind: 'weeks', weeks: 39, givenOn: '2026-11-04' },
        conditions: ['uterine-scar'],
      }),
    );
    await openResult([CASTOR], []);
    const user = userEvent.setup();
    const instruction = pack.messages.fr['castor-oil-term-uterine-scar']?.orientation ?? 'missing';
    expect(await screen.findByRole('heading', { level: 2, name: instruction })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Voir qui appeler' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    // A product's danger: its own instruction, not a sign's.
    expect(screen.getByRole('heading', { level: 2, name: instruction })).toBeVisible();
    expect(screen.queryByText('Dites ces signes au téléphone ou au poste de santé :')).toBeNull();
    expect(await screen.findByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
    vi.useRealTimers();
  });

  it('says the signs of the check to say when calling', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
    await saveProfile(profileOf());
    await saveContacts([AWA]);
    await openResult([{ ref: { kind: 'plant', id: 'kinkeliba' } }], ['fever', 'vaginal-bleeding']);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Voir qui appeler' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Qui appeler' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Signe de danger Allez au poste de santé maintenant.',
    );
    expect(screen.getByText('Dites ces signes au téléphone ou au poste de santé :')).toBeVisible();
    const said = pack.dangerSigns
      .filter((d) => d.id === 'fever' || d.id === 'vaginal-bleeding')
      .map((d) => d.label.fr);
    for (const label of said) expect(screen.getByText(label)).toBeVisible();
    expect(await screen.findByRole('link', { name: /^Appeler Awa/ })).toHaveAttribute(
      'href',
      'tel:000000001',
    );
    vi.useRealTimers();
  });
});
