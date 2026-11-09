// SPDX-License-Identifier: MIT
// Phone numbers in these tests are made up: +999 is not a country code, and
// local numbers are runs of the same digits. No real number in the repository.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferralContact } from '../domain/types.js';
import { breakIndexedDB } from '../test/idb.js';
import { openVaultOf, verifierOf } from '../test/verifier.js';
import { closeAppDb, openAppDb, storeVerifier } from './db.js';
import {
  fetchDeploymentReferral,
  loadReferral,
  loadSavedContacts,
  parseReferral,
  saveContacts,
} from './referral.js';
import { closeVault, LockedError } from './vault.js';

// Profile data is written only while a code is on the phone (code-guard.ts),
// and read or written only while the code is open in the page (vault.ts).
beforeEach(async () => {
  await storeVerifier(await verifierOf('2468'));
  await openVaultOf('2468');
});

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

/**
 * A fetch that answers /config/referral.json with `body` (404 when
 * undefined), as JSON unless another content type is given (null: no content
 * type at all), and records the URLs.
 */
function serving(body?: string, status = 200, contentType: string | null = 'application/json') {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (body === undefined) return Promise.resolve(new Response('Not found', { status: 404 }));
    // Bytes, so that the Response adds no content type of its own.
    const bytes = new TextEncoder().encode(body);
    return Promise.resolve(
      new Response(bytes, {
        status,
        headers: contentType === null ? {} : { 'content-type': contentType },
      }),
    );
  };
  return { fetch: fetchImpl, urls };
}

/** The messages console.warn was given, each call as one string. */
function warnings(): string[] {
  return vi.mocked(console.warn).mock.calls.map((call) => call.map(String).join(' '));
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

describe('contacts at rest', () => {
  it('keeps nothing readable: no name and no number in storage', async () => {
    await saveContacts([AWA, FATOU]);

    const stored: unknown = await (await openAppDb()).get('contacts', 'saved');
    expect(Object.keys(stored as object)).toEqual(['sealed']);
    const text = JSON.stringify(stored);
    for (const clear of ['Awa', 'Fatou', '000 000 001', '999', 'midwife', 'relay']) {
      expect(text).not.toContain(clear);
    }
    expect(await loadSavedContacts()).toEqual([AWA, FATOU]);
  });

  it('reads and writes nothing while the code is not open (locked)', async () => {
    await saveContacts([AWA]);
    closeVault();

    await expect(loadSavedContacts()).rejects.toBeInstanceOf(LockedError);
    await expect(saveContacts([FATOU])).rejects.toBeInstanceOf(LockedError);
  });

  it('cannot read contacts its code does not open, and says so rather than none', async () => {
    await openVaultOf('1357');
    await saveContacts([AWA]);
    await openVaultOf('2468');

    await expect(loadSavedContacts()).rejects.toThrow();
    const circuit = await loadReferral({ fetch: serving().fetch });
    expect(circuit.savedUnavailable).toBe(true);
  });

  it('never shows contacts kept in clear: they cannot be read, never listed', async () => {
    await (await openAppDb()).put('contacts', [FATOU, { ...AWA, phone: '000 000 999' }], 'saved');

    await expect(loadSavedContacts()).rejects.toThrow();
    const circuit = await loadReferral({ fetch: serving().fetch });
    expect(circuit.savedUnavailable).toBe(true);
    expect(circuit.contacts.map((contact) => contact.phone)).not.toContain('000 000 999');
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

  it('takes "-" and "." as separators in the numbers of the file', () => {
    expect(
      parseReferral({
        contacts: [{ role: 'icp', name: '', phone: '000-000-003' }],
        emergencyNumbers: [
          { name: { fr: 'la ligne verte', en: 'the green line' }, phone: '00.00' },
        ],
      }),
    ).toEqual({
      contacts: [{ id: 'deployment:0', role: 'icp', name: '', phone: '000 000 003' }],
      emergencyNumbers: [{ name: { fr: 'la ligne verte', en: 'the green line' }, phone: '00 00' }],
    });
  });

  it('warns once for each entry it leaves out that was filled in, never for an empty one', () => {
    parseReferral({
      contacts: [
        { role: 'doctor', name: 'X', phone: '000000' },
        { role: 'icp', name: '', phone: 'abc' },
        // Empty, as in the example: no warning.
        { role: 'relay', name: '', phone: '' },
      ],
      emergencyNumbers: [
        { name: { fr: '', en: '' }, phone: '' },
        { name: { fr: 'le SAMU', en: '' }, phone: '000' },
      ],
      nationalCircuit: { fr: 'Texte', en: '' },
    });
    const said = warnings();
    expect(said).toHaveLength(4);
    expect(said[0]).toMatch(/contacts\[0\].*doctor/);
    expect(said[1]).toMatch(/contacts\[1\].*abc/);
    // In the order of the file.
    expect(said[2]).toMatch(/nationalCircuit/);
    expect(said[3]).toMatch(/emergencyNumbers\[1\]/);
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

  it('reads the emergency numbers that replace the built-in ones: named in both languages, short numbers too', () => {
    const emergencyNumbers = [
      { name: { fr: 'la ligne verte', en: 'the green line' }, phone: ' 000 ' },
      { name: { fr: 'les pompiers du district', en: 'the district fire brigade' }, phone: '00' },
      // Left out: no number, a number that cannot be dialled, a name in one language only.
      { name: { fr: 'le SAMU', en: 'the SAMU' }, phone: '' },
      { name: { fr: 'le SAMU', en: 'the SAMU' }, phone: '0' },
      { name: { fr: 'le SAMU', en: 'the SAMU' }, phone: 'abc' },
      { name: { fr: 'le SAMU', en: '' }, phone: '000' },
      'x',
    ];
    expect(parseReferral({ contacts: [], emergencyNumbers }).emergencyNumbers).toEqual([
      { name: { fr: 'la ligne verte', en: 'the green line' }, phone: '000' },
      { name: { fr: 'les pompiers du district', en: 'the district fire brigade' }, phone: '00' },
    ]);
  });

  it('keeps the built-in emergency numbers when the file gives none it can dial', () => {
    expect(parseReferral({ contacts: [], emergencyNumbers: [] })).toEqual({ contacts: [] });
    expect(parseReferral({ contacts: [], emergencyNumbers: 'none' })).toEqual({ contacts: [] });
    expect(
      parseReferral({
        contacts: [],
        emergencyNumbers: [{ name: { fr: '', en: '' }, phone: '' }],
      }),
    ).toEqual({ contacts: [] });
  });

  it('leaves out an emergency number whose name would say someone is coming', () => {
    const warn = vi.mocked(console.warn);
    expect(
      parseReferral({
        contacts: [],
        emergencyNumbers: [{ name: { fr: 'les secours', en: 'help is on the way' }, phone: '000' }],
      }),
    ).toEqual({ contacts: [] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reads the country of the deployment, a country of the emergency numbers file', () => {
    expect(parseReferral({ contacts: [], country: 'ML' })).toEqual({ contacts: [], country: 'ML' });
    expect(parseReferral({ contacts: [], country: ' CI ' })).toEqual({
      contacts: [],
      country: 'CI',
    });
    expect(warnings()).toEqual([]);
  });

  it('leaves out a country the file does not have, saying so; an empty one quietly', () => {
    expect(parseReferral({ contacts: [], country: '' })).toEqual({ contacts: [] });
    expect(warnings()).toEqual([]);
    expect(parseReferral({ contacts: [], country: 'XX' })).toEqual({ contacts: [] });
    expect(parseReferral({ contacts: [], country: 'sn' })).toEqual({ contacts: [] });
    expect(parseReferral({ contacts: [], country: 221 })).toEqual({ contacts: [] });
    expect(warnings()).toHaveLength(3);
    expect(warnings()[0]).toMatch(/country: "XX" is not a country of the emergency numbers/);
  });

  it('reads the committed example as roles with no name and no number, so no contact', () => {
    const example: unknown = JSON.parse(
      readFileSync(
        path.resolve(HERE, '..', '..', 'public', 'config', 'referral.example.json'),
        'utf8',
      ),
    );
    const { contacts, emergencyNumbers, country } = example as {
      contacts: { role: string; name: string; phone: string }[];
      emergencyNumbers: { name: { fr: string; en: string }; phone: string }[];
      country: string;
    };
    // The country is shown empty too: the phone finds it.
    expect(country).toBe('');
    expect(contacts.length).toBeGreaterThan(0);
    for (const contact of contacts) {
      expect(contact.name).toBe('');
      expect(contact.phone).toBe('');
    }
    // The emergency numbers' form is shown too, empty: the built-in ones stay.
    expect(emergencyNumbers.length).toBeGreaterThan(0);
    for (const number of emergencyNumbers) {
      expect(number.name).toEqual({ fr: '', en: '' });
      expect(number.phone).toBe('');
    }
    expect(parseReferral(example)).toEqual({ contacts: [] });
    expect(warnings()).toEqual([]);
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

  it('reads a server that answers every path with the app page as no file, saying nothing', async () => {
    const page = '<!doctype html><html></html>';
    for (const contentType of ['text/html', 'text/html; charset=utf-8']) {
      expect(await fetchDeploymentReferral(serving(page, 200, contentType).fetch)).toEqual({
        contacts: [],
      });
    }
    // A page whatever its content type says, or with none.
    for (const contentType of ['application/octet-stream', 'application/json', null]) {
      expect(await fetchDeploymentReferral(serving(`  ${page}`, 200, contentType).fetch)).toEqual({
        contacts: [],
      });
    }
    expect(warnings()).toEqual([]);
  });

  it('loads a valid file whatever its content type, or with none', async () => {
    for (const contentType of [
      'application/json; charset=utf-8',
      'application/octet-stream',
      'text/plain',
      null,
    ]) {
      const config = await fetchDeploymentReferral(
        serving(JSON.stringify(deployment), 200, contentType).fetch,
      );
      expect(config.contacts, String(contentType)).toHaveLength(1);
    }
    expect(warnings()).toEqual([]);
  });

  it('warns, without a raw SyntaxError, when the file is not JSON', async () => {
    const warn = vi.mocked(console.warn);
    expect(
      await fetchDeploymentReferral(serving('{ "contacts": [', 200, 'application/json').fetch),
    ).toEqual({ contacts: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    const args: unknown[] = warn.mock.calls[0] ?? [];
    expect(args.some((arg) => arg instanceof Error)).toBe(false);
    expect(warnings()[0]).toMatch(/not valid JSON/);
    expect(warnings()[0]).not.toMatch(/SyntaxError/);
  });

  it('gives no contact when the file is absent, unreadable, not JSON, or never answers', async () => {
    expect(await fetchDeploymentReferral(serving().fetch)).toEqual({ contacts: [] });
    expect(await fetchDeploymentReferral(serving('oops', 500).fetch)).toEqual({ contacts: [] });
    // A JSON content type over the app page.
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
    expect(loaded.emergencyNumbers).toBeUndefined();
  });

  it("passes on the deployment's emergency numbers", async () => {
    const emergencyNumbers = [
      { name: { fr: 'la ligne verte', en: 'the green line' }, phone: '000' },
    ];
    const loaded = await loadReferral({
      fetch: serving(JSON.stringify({ ...deployment, emergencyNumbers })).fetch,
    });
    expect(loaded.emergencyNumbers).toEqual(emergencyNumbers);
    expect(loaded.country).toBeUndefined();
  });

  it("passes on the deployment's country", async () => {
    const loaded = await loadReferral({
      fetch: serving(JSON.stringify({ ...deployment, country: 'GH' })).fetch,
    });
    expect(loaded.country).toBe('GH');
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
