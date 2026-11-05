// SPDX-License-Identifier: MIT
// Referral contacts as the phone keeps and dials them: the roles, how a phone
// number is written and checked, and the contact screen's answers. Pure. A
// number is only ever dialled by the phone through a tel: link: nothing here
// sends anything.
import type { MessageKey, Vars } from '../i18n/translate.js';
import type { ReferralContact, ReferralRole } from './types.js';

type Translate = (key: MessageKey, vars?: Vars) => string;

/** How a contact is named: the name, then the role; the role alone when no name was given. */
export function whoOf(contact: Pick<ReferralContact, 'name' | 'role'>, t: Translate): string {
  const role = t(`contacts.roles.${contact.role}`);
  return contact.name.trim() === '' ? role : t('contacts.who', { name: contact.name, role });
}

/** The accessible name of a contact's call link: the visible word, then who and the number. */
export function dialNameOf(
  contact: Pick<ReferralContact, 'name' | 'role' | 'phone'>,
  t: Translate,
): string {
  return `${t('call.dial')} ${t('call.dialWho', { who: whoOf(contact, t), phone: contact.phone })}`;
}

/** The roles, in the order of the referral circuit (closest to the woman first). */
export const REFERRAL_ROLES: readonly ReferralRole[] = [
  'relay',
  'bajenu-gox',
  'icp',
  'midwife',
  'other',
];

/** A name longer than this is cut by the field. */
export const NAME_MAX_LENGTH = 60;

const PHONE_DIGITS_MIN = 6;
const PHONE_DIGITS_MAX = 15;
/** A public service may have a two-digit number, such as the fire brigade's. */
const SERVICE_DIGITS_MIN = 2;

/** The number as written, any run of spaces (a no-break space included) made one space. */
export function tidyPhone(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Digits and spaces, a plus only at the start, and from `min` to 15 digits. */
function hasDigits(text: string, min: number): boolean {
  const phone = tidyPhone(text);
  if (!/^\+?[0-9 ]+$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, '').length;
  return digits >= min && digits <= PHONE_DIGITS_MAX;
}

/** Digits and spaces, a plus only at the start, and from 6 to 15 digits. */
export function isPhone(text: string): boolean {
  return hasDigits(text, PHONE_DIGITS_MIN);
}

/** The number of a public emergency service: as a phone number, from 2 to 15 digits. */
export function isServiceNumber(text: string): boolean {
  return hasDigits(text, SERVICE_DIGITS_MIN);
}

/** A run of digits longer than this is shown in groups of three. */
const LONGEST_GROUP = 6;

/**
 * The groups a number is shown in, each kept on one line: the groups as
 * written, a run of more than six digits split into threes from its start
 * (the plus stays with the first group), so that a number wraps only between
 * groups and never pushes the page sideways. The digits never change.
 */
export function phoneGroups(phone: string): string[] {
  return tidyPhone(phone)
    .split(' ')
    .filter((group) => group !== '')
    .flatMap((group) => {
      const plus = group.startsWith('+') ? '+' : '';
      const digits = group.slice(plus.length);
      if (digits.length <= LONGEST_GROUP) return [group];
      const threes = digits.match(/\d{1,3}/g) ?? [digits];
      return threes.map((three, index) => (index === 0 ? plus + three : three));
    });
}

/** The link the phone dials: the digits, with the plus when there is one. */
export function telHref(phone: string): string {
  const tidy = tidyPhone(phone);
  return `tel:${tidy.startsWith('+') ? '+' : ''}${tidy.replace(/\D/g, '')}`;
}

function isRole(value: unknown): value is ReferralRole {
  return typeof value === 'string' && (REFERRAL_ROLES as readonly string[]).includes(value);
}

/** Whether a stored or deployed value is a contact the circuit can show and dial. */
export function isReferralContact(value: unknown): value is ReferralContact {
  if (typeof value !== 'object' || value === null) return false;
  const { id, role, name, phone } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id !== '' &&
    isRole(role) &&
    typeof name === 'string' &&
    typeof phone === 'string' &&
    isPhone(phone)
  );
}

/** The contact screen's answers as typed; null is "no role chosen yet". */
export interface ContactForm {
  role: ReferralRole | null;
  name: string;
  phone: string;
}

export type ContactField = keyof ContactForm;

export function emptyContactForm(): ContactForm {
  return { role: null, name: '', phone: '' };
}

export function formFromContact(contact: ReferralContact): ContactForm {
  return { role: contact.role, name: contact.name, phone: contact.phone };
}

/** What is wrong with each answer, as a message key; empty when the contact can be saved. */
export function validateContactForm(form: ContactForm): Partial<Record<ContactField, MessageKey>> {
  const errors: Partial<Record<ContactField, MessageKey>> = {};
  if (form.role === null) errors.role = 'contacts.error.role';
  if (tidyPhone(form.phone) === '') errors.phone = 'contacts.error.phone';
  else if (!isPhone(form.phone)) errors.phone = 'contacts.error.phoneFormat';
  return errors;
}

/** The contact the answers make, with this id. Throws a RangeError for answers that do not validate. */
export function contactFromForm(form: ContactForm, id: string): ReferralContact {
  const errors = validateContactForm(form);
  if (form.role === null || Object.keys(errors).length > 0) {
    throw new RangeError(`The contact cannot be saved: ${Object.keys(errors).join(', ')}`);
  }
  return {
    id,
    role: form.role,
    name: form.name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX_LENGTH),
    phone: tidyPhone(form.phone),
  };
}
