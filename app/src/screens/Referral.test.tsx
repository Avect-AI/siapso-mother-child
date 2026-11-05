// SPDX-License-Identifier: MIT
// Phone numbers in these tests are made up: +999 is not a country code, and
// local numbers are runs of the same digits. No real number in the repository.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckedItem, Pack } from '@siapso/engine';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProfile } from '../data/profiles.js';
import { saveContacts } from '../data/referral.js';
import type { ReferralContact, Settings } from '../domain/types.js';
import { probeCheck } from '../test/check-probe.js';
import { hangIndexedDB } from '../test/idb.js';
import { knowledgePack, profileOf } from '../test/knowledge-pack.js';
import { loaderOf, renderApp } from '../test/render-app.js';

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

function serveDeployment() {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) =>
    Promise.resolve(
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith(
        '/config/referral.json',
      )
        ? new Response(JSON.stringify(deployment))
        : new Response('Not found', { status: 404 }),
    ),
  );
}

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

  it('says when no contact is saved, and offers to add one in accompanied mode only', async () => {
    const { unmount } = await renderApp({ settings: accompanied, hash: '#/danger/call' });
    expect(await screen.findByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ajouter un contact' })).toHaveAttribute(
      'href',
      '#/contacts/new',
    );
    unmount();

    await renderApp({ settings: woman, hash: '#/danger/call' });
    expect(await screen.findByText('Aucun contact enregistré sur ce téléphone.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Ajouter un contact' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Appeler/ })).toBeNull();
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
      { instruction: { message: 'castor-oil-term-uterine-scar' } },
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

    window.history.replaceState({ instruction: { standard: true } }, '', '#/danger/call');
    await renderApp({ settings: woman, hash: '#/danger/call', packLoader: loaderOf(pack) });
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Allez au poste de santé maintenant.' }),
    ).toBeVisible();
  });
});

describe('Who to call, from a result', () => {
  const CASTOR: CheckedItem = { ref: { kind: 'plant', id: 'castor-oil' } };

  async function openResult(items: CheckedItem[], signs: string[]) {
    const probe = probeCheck();
    await renderApp({
      settings: woman,
      hash: '#/',
      packLoader: loaderOf(pack),
      children: probe.element,
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
  }

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
