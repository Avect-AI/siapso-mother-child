// SPDX-License-Identifier: MIT
// Phone numbers in these tests are made up: +999 is not a country code, and
// local numbers are runs of the same digits. No real number in the repository.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferralContact } from '../domain/types.js';
import { breakIndexedDB } from '../test/idb.js';
import { closeAppDb } from './db.js';
import {
  fetchDeploymentReferral,
  loadReferral,
  loadSavedContacts,
  parseReferral,
  saveContacts,
} from './referral.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const AWA: ReferralContact = { id: 'c1', role: 'relay', name: 'Awa', phone: '000 000 001' };
const FATOU: ReferralContact = { id: 'c2', role: 'midwife', name: 'Fatou', phone: '+999 000 002' };

const deployment = {
  contacts: [
    { role: 'icp', name: 'Poste de santé', phone: '+999 000 003' },
    // As in the example file: a role with no number yet, left out.
    { role: 'bajenu-gox', name: '', phone: '' },
  ],
  nationalCircuit: { fr: 'Circuit national.', en: 'National circuit.' },
};

/** A fetch that answers /config/referral.json with `body` (404 when undefined), and records the URLs. */
function serving(body?: string, status = 200) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(
      body === undefined
        ? new Response('Not found', { status: 404 })
        : new Response(body, { status }),
    );
  };
  return { fetch: fetchImpl, urls };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveContacts and loadSavedContacts', () => {
  it('keeps the contacts on the phone, in the order of the circuit, and replaces them as a whole', async () => {
    expect(await loadSavedContacts()).toEqual([]);
    const other: ReferralContact = { id: 'c3', role: 'relay', name: 'Binta', phone: '000 000 009' };
    // The relays first (in the order given), then the midwife: the first is the first to call.
    await saveContacts([FATOU, AWA, other]);
    expect(await loadSavedContacts()).toEqual([AWA, other, FATOU]);
    await saveContacts([AWA]);
    expect(await loadSavedContacts()).toEqual([AWA]);
  });

  it('refuses a contact the circuit could not dial, and two contacts with one id', async () => {
    await expect(saveContacts([{ ...AWA, phone: 'abc' }])).rejects.toThrow(RangeError);
    await expect(saveContacts([AWA, { ...FATOU, id: AWA.id }])).rejects.toThrow(RangeError);
    expect(await loadSavedContacts()).toEqual([]);
  });
});

describe('parseReferral', () => {
  it('reads the contacts it can dial and the national circuit in both languages', () => {
    expect(parseReferral(deployment)).toEqual({
      contacts: [
        { id: 'deployment:0', role: 'icp', name: 'Poste de santé', phone: '+999 000 003' },
      ],
      nationalCircuit: { fr: 'Circuit national.', en: 'National circuit.' },
    });
  });

  it('leaves out what it cannot read, and a national circuit not written in both languages', () => {
    expect(parseReferral(null)).toEqual({ contacts: [] });
    expect(parseReferral({ contacts: 'none' })).toEqual({ contacts: [] });
    expect(
      parseReferral({
        contacts: [{ role: 'doctor', name: 'X', phone: '000000' }, 'x'],
        nationalCircuit: { fr: 'Texte', en: '' },
      }),
    ).toEqual({ contacts: [] });
  });

  it('leaves out a national circuit that would say someone was told or is coming', () => {
    const warn = vi.mocked(console.warn);
    for (const nationalCircuit of [
      { fr: 'Le relais est prévenu et arrive.', en: 'The relay goes with the woman.' },
      { fr: 'Le relais accompagne la femme.', en: 'Help is on the way.' },
      // Nor a forbidden word.
      { fr: 'Sans danger.', en: 'Safe.' },
    ]) {
      warn.mockClear();
      expect(parseReferral({ contacts: [], nationalCircuit })).toEqual({ contacts: [] });
      expect(warn).toHaveBeenCalledTimes(1);
    }
    // The circuit described, never as an event: kept.
    const described = {
      fr: 'Le relais ou la Bajenu Gox accompagne la femme au poste de santé.',
      en: 'The relay or the Bajenu Gox goes with the woman to the health post.',
    };
    expect(parseReferral({ contacts: [], nationalCircuit: described }).nationalCircuit).toEqual(
      described,
    );
  });

  it('reads the committed example as roles with no name and no number, so no contact', () => {
    const example: unknown = JSON.parse(
      readFileSync(
        path.resolve(HERE, '..', '..', 'public', 'config', 'referral.example.json'),
        'utf8',
      ),
    );
    const { contacts } = example as { contacts: { role: string; name: string; phone: string }[] };
    expect(contacts.length).toBeGreaterThan(0);
    for (const contact of contacts) {
      expect(contact.name).toBe('');
      expect(contact.phone).toBe('');
    }
    expect(parseReferral(example)).toEqual({ contacts: [] });
  });

  it('keeps the deployment file out of git, next to its example', () => {
    const ignore = readFileSync(path.resolve(HERE, '..', '..', '..', '.gitignore'), 'utf8');
    expect(ignore.split(/\r?\n/)).toContain('app/public/config/referral.json');
  });
});

describe('fetchDeploymentReferral', () => {
  it('reads /config/referral.json', async () => {
    const server = serving(JSON.stringify(deployment));
    const config = await fetchDeploymentReferral(server.fetch);
    expect(server.urls).toEqual(['/config/referral.json']);
    expect(config.contacts).toHaveLength(1);
  });

  it('gives no contact when the file is absent, unreadable, not JSON, or never answers', async () => {
    expect(await fetchDeploymentReferral(serving().fetch)).toEqual({ contacts: [] });
    expect(await fetchDeploymentReferral(serving('oops', 500).fetch)).toEqual({ contacts: [] });
    // A server that answers every path with the app page.
    expect(await fetchDeploymentReferral(serving('<!doctype html>').fetch)).toEqual({
      contacts: [],
    });
    const offline = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    expect(await fetchDeploymentReferral(offline)).toEqual({ contacts: [] });
    const silent = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as typeof fetch;
    expect(await fetchDeploymentReferral(silent, 20)).toEqual({ contacts: [] });
  });
});

describe('loadReferral', () => {
  it('works without a deployment file: the contacts saved on the phone', async () => {
    await saveContacts([AWA]);
    expect(await loadReferral({ fetch: serving().fetch })).toEqual({
      contacts: [AWA],
      savedUnavailable: false,
    });
    await saveContacts([]);
    expect(await loadReferral({ fetch: serving().fetch })).toEqual({
      contacts: [],
      savedUnavailable: false,
    });
  });

  it('merges the deployment file after the contacts saved on the phone', async () => {
    await saveContacts([FATOU, AWA]);
    const loaded = await loadReferral({ fetch: serving(JSON.stringify(deployment)).fetch });
    expect(loaded.contacts.map((c) => c.id)).toEqual(['c1', 'c2', 'deployment:0']);
    expect(loaded.nationalCircuit).toEqual(deployment.nationalCircuit);
  });

  it('lists a number once: a deployed contact with the number of a saved one is left out', async () => {
    await saveContacts([{ ...AWA, phone: '+999000003' }]);
    const loaded = await loadReferral({ fetch: serving(JSON.stringify(deployment)).fetch });
    expect(loaded.contacts.map((c) => c.id)).toEqual(['c1']);
  });

  it('still lists the deployed contacts when the phone storage cannot be read', async () => {
    breakIndexedDB('storage refused');
    closeAppDb();
    const loaded = await loadReferral({ fetch: serving(JSON.stringify(deployment)).fetch });
    expect(loaded.savedUnavailable).toBe(true);
    expect(loaded.contacts.map((c) => c.id)).toEqual(['deployment:0']);
  });

  it('can be given its own way of reading the saved contacts (a timeout)', async () => {
    const loaded = await loadReferral({
      fetch: serving().fetch,
      readSaved: () => Promise.reject(new Error('no answer from storage')),
    });
    expect(loaded).toEqual({ contacts: [], savedUnavailable: true });
  });
});
