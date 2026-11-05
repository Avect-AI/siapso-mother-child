// SPDX-License-Identifier: MIT
// The referral circuit: who to call when a danger sign is there and no health
// worker is. The contacts saved on this phone come first (IndexedDB, entered
// in accompanied mode), then those of the deployment file
// /config/referral.json, which a deployment adds before building (never
// committed: public/config/referral.example.json shows its form) and the
// service worker keeps offline. Nothing here is ever sent anywhere: a call is
// a tel: link that the phone dials.
import { findForbiddenWording, type Localized } from '@siapso/engine';
import { isReferralContact, REFERRAL_ROLES, telHref, tidyPhone } from '../domain/contacts.js';
import { careUnderWayWording } from '../domain/wording.js';
import type { ReferralContact } from '../domain/types.js';
import { openAppDb } from './db.js';

export type { ReferralContact, ReferralRole } from '../domain/types.js';
export { REFERRAL_ROLES };

export interface ReferralConfig {
  contacts: ReferralContact[];
  /** The national referral circuit, in both languages, when the deployment file gives it. */
  nationalCircuit?: Localized;
}

export interface LoadedReferral extends ReferralConfig {
  /** The contacts saved on this phone could not be read: only the deployment's are listed. */
  savedUnavailable: boolean;
}

/** How long the deployment file may take before the circuit goes on without it. */
export const DEPLOYMENT_TIMEOUT_MS = 3000;

function referralUrl(): string {
  return `${import.meta.env.BASE_URL}config/referral.json`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The deployment file read as a circuit: each contact with a known role and
 * a number the phone can dial (others are left out, such as the example's
 * empty ones), given the id "deployment:<index>"; the national circuit only
 * when it is written in both languages and says nothing the app never says
 * (a forbidden word, or that someone was told or is coming: left out with a
 * warning). Never throws.
 */
export function parseReferral(data: unknown): ReferralConfig {
  if (typeof data !== 'object' || data === null) return { contacts: [] };
  const { contacts, nationalCircuit } = data as Record<string, unknown>;
  const listed: unknown[] = Array.isArray(contacts) ? contacts : [];
  const config: ReferralConfig = {
    contacts: listed.flatMap((entry, index) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { role, name, phone } = entry as Record<string, unknown>;
      const contact = {
        id: `deployment:${String(index)}`,
        role,
        name: text(name),
        phone: tidyPhone(text(phone)),
      };
      return isReferralContact(contact) ? [contact] : [];
    }),
  };
  if (typeof nationalCircuit === 'object' && nationalCircuit !== null) {
    const { fr, en } = nationalCircuit as Record<string, unknown>;
    const circuit = { fr: text(fr), en: text(en) };
    if (circuit.fr !== '' && circuit.en !== '') {
      const wrong = (['fr', 'en'] as const).flatMap((lang) => {
        const care = careUnderWayWording(circuit[lang], lang);
        return [
          ...findForbiddenWording(circuit[lang], lang),
          ...(care === undefined ? [] : [care]),
        ];
      });
      if (wrong.length === 0) config.nationalCircuit = circuit;
      else console.warn(`Referral file: national circuit left out for "${wrong.join('", "')}"`);
    }
  }
  return config;
}

/**
 * The circuit of the deployment file. No file (404), a file that cannot be
 * read or is not JSON (a server answering every path with the app page), no
 * network and no copy offline, or no answer within `timeoutMs`: no contact.
 * Never rejects.
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
    return parseReferral(await response.json());
  } catch (failure) {
    // Offline without a copy, too slow, or not JSON.
    if (!(failure instanceof TypeError) && !(failure instanceof DOMException)) {
      console.warn('Referral file not read', failure);
    }
    return { contacts: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** The contacts saved on this phone, in the order of the circuit (a stored value that is not one is left out). */
export async function loadSavedContacts(): Promise<ReferralContact[]> {
  const saved: unknown = await (await openAppDb()).get('contacts', 'saved');
  return Array.isArray(saved) ? inCircuitOrder(saved.filter(isReferralContact)) : [];
}

/**
 * Keeps these contacts on the phone in place of the ones saved before, in
 * the order of the circuit (relay, Bajenu Gox, ICP, midwife, other; the
 * order given within a role): the first one is the first to call, never
 * just the first one entered. Throws a RangeError, and keeps nothing, for a
 * contact the circuit could not dial or two contacts with one id.
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
  await (await openAppDb()).put('contacts', copies, 'saved');
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
  return loaded;
}
