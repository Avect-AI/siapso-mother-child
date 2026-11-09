// SPDX-License-Identifier: MIT
// The referral circuit: who to call when a danger sign is there and no health
// worker is. The contacts saved on this phone come first (IndexedDB, entered
// behind the code, in either mode), then those of the deployment file
// /config/referral.json, which a deployment adds before building (never
// committed: public/config/referral.example.json shows its form) and the
// service worker keeps offline. The file may also replace the built-in
// emergency numbers (config/emergency.ts) and add its circuit text under the
// built-in line. Nothing here is ever sent anywhere: a call is a tel: link that
// the phone dials.
import { findForbiddenWording } from '@siapso/engine';
import { isReferralContact, REFERRAL_ROLES, telHref } from '../domain/contacts.js';
import { isSealed, UnsealError } from '../domain/crypto.js';
import { readReferralFile, type ReferralConfig } from '../domain/referral-file.js';
import type { ReferralContact } from '../domain/types.js';
import { requireCode } from './code-guard.js';
import { openAppDb } from './db.js';
import { CONTACTS_SCOPE, openRecord, sealRecord, vaultKey } from './vault.js';

export type { ReferralConfig } from '../domain/referral-file.js';
export type { EmergencyNumber, ReferralContact, ReferralRole } from '../domain/types.js';
export { REFERRAL_ROLES };

export interface LoadedReferral extends ReferralConfig {
  /** The contacts saved on this phone could not be read: only the deployment's are listed. */
  savedUnavailable: boolean;
}

/** How long the deployment file may take before the circuit goes on without it. */
export const DEPLOYMENT_TIMEOUT_MS = 3000;

function referralUrl(): string {
  return `${import.meta.env.BASE_URL}config/referral.json`;
}

/**
 * The deployment file read as a circuit (domain/referral-file.ts), with a
 * warning for each entry it leaves out that was filled in. Never throws.
 */
export function parseReferral(data: unknown): ReferralConfig {
  const { config, leftOut } = readReferralFile(data, findForbiddenWording);
  for (const entry of leftOut) console.warn(`Referral file: ${entry}; left out`);
  return config;
}

/**
 * The circuit of the deployment file. No file (404), the app page in its
 * place (a server answering every path with it: an HTML content type, or a
 * body starting with "<"; said nothing about, as no file), a file that is not
 * valid JSON (a warning), a file that cannot be read, no network and no copy
 * offline, or no answer within `timeoutMs`: no contact. A valid file loads
 * whatever its content type, or with none. Never rejects.
 */
export async function fetchDeploymentReferral(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  timeoutMs = DEPLOYMENT_TIMEOUT_MS,
): Promise<ReferralConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(referralUrl(), {
      cache: 'no-cache',
      signal: controller.signal,
    });
    // No deployment file: the usual case, nothing to say.
    if (response.status === 404) return { contacts: [] };
    if (!response.ok) {
      console.warn(`Referral file not read: HTTP ${String(response.status)}`);
      return { contacts: [] };
    }
    const type = response.headers.get('content-type') ?? '';
    const body = await response.text();
    // A missing file answered with the app page is the usual case of a
    // deployment without one: nothing to say.
    if (/html/i.test(type) || body.trimStart().startsWith('<')) return { contacts: [] };
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      console.warn('Referral file not read: it is not valid JSON');
      return { contacts: [] };
    }
    return parseReferral(data);
  } catch (failure) {
    // Offline without a copy, or too slow.
    if (!(failure instanceof TypeError) && !(failure instanceof DOMException)) {
      console.warn('Referral file not read', failure);
    }
    return { contacts: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The contacts saved on this phone, sealed (domain/crypto.ts), in the order
 * of the circuit (a stored value that is not one is left out). LockedError
 * while the code is not open; UnsealError when its code does not open them,
 * and for contacts in clear, which no version since SCRUM-39 writes
 * (migration.ts): the circuit then says they cannot be read, never that
 * there are none, and never lists a number written into the storage.
 */
export async function loadSavedContacts(): Promise<ReferralContact[]> {
  vaultKey();
  const stored: unknown = await (await openAppDb()).get('contacts', 'saved');
  if (stored === undefined) return [];
  if (
    typeof stored !== 'object' ||
    stored === null ||
    !('sealed' in stored) ||
    !isSealed(stored.sealed)
  ) {
    throw new UnsealError('Contacts in clear on this phone are not read');
  }
  const saved = await openRecord(stored.sealed, CONTACTS_SCOPE);
  return Array.isArray(saved) ? inCircuitOrder(saved.filter(isReferralContact)) : [];
}

/**
 * Keeps these contacts on the phone, sealed, in place of the ones saved
 * before, in the order of the circuit (relay, Bajenu Gox, ICP, midwife,
 * other; the order given within a role): the first one is the first to call,
 * never just the first one entered. Throws a RangeError, and keeps nothing,
 * for a contact the circuit could not dial or two contacts with one id;
 * NoCodeError while no code is on the phone, LockedError while the code is
 * not open here.
 */
export async function saveContacts(contacts: readonly ReferralContact[]): Promise<void> {
  const ids = new Set<string>();
  for (const contact of contacts) {
    if (!isReferralContact(contact))
      throw new RangeError(`Not a contact: ${JSON.stringify(contact)}`);
    if (ids.has(contact.id)) throw new RangeError(`Two contacts with the id ${contact.id}`);
    ids.add(contact.id);
  }
  const copies = inCircuitOrder(contacts).map(({ id, role, name, phone }) => ({
    id,
    role,
    name,
    phone,
  }));
  // Sealed before the transaction: a transaction cannot wait for WebCrypto.
  // Written only while the code it was sealed under is the one stored.
  const { sealed, fingerprint } = await sealRecord(copies, CONTACTS_SCOPE);
  const tx = (await openAppDb()).transaction(['contacts', 'settings'], 'readwrite');
  await requireCode(tx, fingerprint);
  await tx.objectStore('contacts').put({ sealed }, 'saved');
  await tx.done;
}

/** The contacts in the order of the circuit's roles; the order given within a role. */
export function inCircuitOrder(contacts: readonly ReferralContact[]): ReferralContact[] {
  const rank = (contact: ReferralContact) => REFERRAL_ROLES.indexOf(contact.role);
  return contacts
    .map((contact, index) => ({ contact, index }))
    .sort((a, b) => rank(a.contact) - rank(b.contact) || a.index - b.index)
    .map(({ contact }) => contact);
}

/** The number a phone dials, so two ways of writing one number are one number. */
function dialled(contact: ReferralContact): string {
  return telHref(contact.phone);
}

/**
 * The circuit: the contacts saved on this phone first, then the deployment's
 * (a deployed contact with the number of a saved one is left out), and the
 * national circuit of the deployment file. Never rejects: when the saved
 * contacts cannot be read (`readSaved` fails, by default the phone storage),
 * the deployment's are listed and `savedUnavailable` says so.
 */
export async function loadReferral({
  fetch: fetchImpl,
  readSaved = loadSavedContacts,
}: {
  fetch?: typeof fetch;
  readSaved?: () => Promise<ReferralContact[]>;
} = {}): Promise<LoadedReferral> {
  const [saved, deployment] = await Promise.all([
    readSaved().then(
      (contacts) => ({ contacts, unavailable: false }),
      (failure: unknown) => {
        console.warn('Referral contacts not read on this device', failure);
        return { contacts: [] as ReferralContact[], unavailable: true };
      },
    ),
    fetchDeploymentReferral(fetchImpl),
  ]);
  const numbers = new Set(saved.contacts.map(dialled));
  const loaded: LoadedReferral = {
    contacts: [
      ...saved.contacts,
      ...deployment.contacts.filter((contact) => !numbers.has(dialled(contact))),
    ],
    savedUnavailable: saved.unavailable,
  };
  if (deployment.nationalCircuit) loaded.nationalCircuit = deployment.nationalCircuit;
  if (deployment.emergencyNumbers) loaded.emergencyNumbers = deployment.emergencyNumbers;
  return loaded;
}
