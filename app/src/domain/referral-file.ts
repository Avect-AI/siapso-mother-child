// SPDX-License-Identifier: MIT
// The deployment file public/config/referral.json read as a circuit, and what
// it leaves out. Pure: the app reads the file with it (data/referral.ts, a
// warning for each entry left out) and so does the production build
// (vite.config.ts, a loud warning), so a mistake in the file is seen before
// the phones get it. It imports nothing from @siapso/engine at run time: the
// build config cannot load the engine package, so the engine's forbidden
// wording check is given by the caller.
import type { Lang, Localized } from '@siapso/engine';
import { isReferralContact, isServiceNumber, REFERRAL_ROLES, tidyPhone } from './contacts.js';
import type { EmergencyNumber, ReferralContact } from './types.js';
import { careUnderWayWording } from './wording.js';

/** The words of a text the app never says ("safe", ...): the engine's findForbiddenWording. */
export type ForbiddenWording = (text: string, lang: Lang) => string[];

export interface ReferralConfig {
  contacts: ReferralContact[];
  /** The national referral circuit, in both languages, when the deployment file gives it. */
  nationalCircuit?: Localized;
  /** The emergency numbers in place of the built-in ones, when the deployment file gives at least one. */
  emergencyNumbers?: EmergencyNumber[];
}

export interface ReadReferralFile {
  config: ReferralConfig;
  /** Each entry that was filled in and is left out, with why ("contacts[1]: ..."); an empty entry is not one. */
  leftOut: string[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A number of the file as the phone keeps it: "-" and "." are taken as spaces. */
function fileNumber(value: unknown): string {
  return tidyPhone(text(value).replace(/[-.]/g, ' '));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A text of the file in both languages, or why it cannot be shown: one
 * language missing, or words the app never says (a forbidden word, or that
 * someone was told or is coming). Undefined for a text left empty.
 */
function localizedText(
  value: unknown,
  findForbiddenWording: ForbiddenWording,
): { words: Localized } | { why: string } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return { why: 'is not written as { "fr": ..., "en": ... }' };
  const words = { fr: text(value['fr']), en: text(value['en']) };
  if (words.fr === '' && words.en === '') return undefined;
  if (words.fr === '' || words.en === '')
    return { why: 'is not written in both French and English' };
  const wrong = (['fr', 'en'] as const).flatMap((lang) => {
    const care = careUnderWayWording(words[lang], lang);
    return [...findForbiddenWording(words[lang], lang), ...(care === undefined ? [] : [care])];
  });
  return wrong.length === 0 ? { words } : { why: `says "${wrong.join('", "')}"` };
}

/**
 * The file read as a circuit, never throwing: each contact with a known role
 * and a number the phone can dial, given the id "deployment:<index>"; the
 * national circuit when it is written in both languages and says nothing the
 * app never says; the emergency numbers on the same terms, only when at least
 * one is left (else the built-in ones stay). Numbers may use "-" or "." as
 * separators. Entries left empty, as in the example file, are skipped
 * quietly; any other entry left out is listed with why.
 */
export function readReferralFile(
  data: unknown,
  findForbiddenWording: ForbiddenWording,
): ReadReferralFile {
  const leftOut: string[] = [];
  if (!isRecord(data))
    return { config: { contacts: [] }, leftOut: ['the file is not a JSON object'] };
  const { contacts, nationalCircuit, emergencyNumbers } = data;

  if (contacts !== undefined && !Array.isArray(contacts)) leftOut.push('contacts: not a list');
  const listed: unknown[] = Array.isArray(contacts) ? contacts : [];
  const config: ReferralConfig = {
    contacts: listed.flatMap((entry, index) => {
      const where = `contacts[${String(index)}]`;
      if (!isRecord(entry)) {
        leftOut.push(`${where}: not an entry with a role, a name and a phone`);
        return [];
      }
      const contact = {
        id: `deployment:${String(index)}`,
        role: entry['role'],
        name: text(entry['name']),
        phone: fileNumber(entry['phone']),
      };
      if (isReferralContact(contact)) return [contact];
      if (contact.name === '' && contact.phone === '') return [];
      if (!(REFERRAL_ROLES as readonly unknown[]).includes(contact.role)) {
        leftOut.push(
          `${where}: the role ${JSON.stringify(contact.role)} is not one of ${REFERRAL_ROLES.join(', ')}`,
        );
      } else {
        leftOut.push(
          `${where}: the number "${text(entry['phone'])}" cannot be dialled (6 to 15 digits)`,
        );
      }
      return [];
    }),
  };

  const circuit = localizedText(nationalCircuit, findForbiddenWording);
  if (circuit !== undefined) {
    if ('words' in circuit) config.nationalCircuit = circuit.words;
    else leftOut.push(`nationalCircuit: the text ${circuit.why}`);
  }

  if (emergencyNumbers !== undefined && !Array.isArray(emergencyNumbers)) {
    leftOut.push('emergencyNumbers: not a list');
  }
  const numbers: EmergencyNumber[] = (
    Array.isArray(emergencyNumbers) ? emergencyNumbers : []
  ).flatMap((entry: unknown, index) => {
    const where = `emergencyNumbers[${String(index)}]`;
    if (!isRecord(entry)) {
      leftOut.push(`${where}: not an entry with a name and a phone`);
      return [];
    }
    const phone = fileNumber(entry['phone']);
    const name = localizedText(entry['name'], findForbiddenWording);
    if (phone === '' && name === undefined) return [];
    if (!isServiceNumber(phone)) {
      leftOut.push(
        `${where}: the number "${text(entry['phone'])}" cannot be dialled (2 to 15 digits)`,
      );
      return [];
    }
    if (name === undefined || 'why' in name) {
      leftOut.push(`${where}: the name ${name === undefined ? 'is missing' : name.why}`);
      return [];
    }
    return [{ name: name.words, phone }];
  });
  if (numbers.length > 0) config.emergencyNumbers = numbers;
  return { config, leftOut };
}
