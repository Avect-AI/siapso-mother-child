// SPDX-License-Identifier: MIT
// Phone numbers in these tests are made up: +999 is not a country code, and
// local numbers are runs of the same digits. No real number in the repository.
import { describe, expect, it } from 'vitest';
import { translate, type MessageKey, type Vars } from '../i18n/translate.js';
import {
  contactFromForm,
  formFromContact,
  isPhone,
  isReferralContact,
  isServiceNumber,
  phoneGroups,
  REFERRAL_ROLES,
  telHref,
  tidyPhone,
  validateContactForm,
  whoOf,
} from './contacts.js';

describe('isPhone', () => {
  it('takes digits, spaces and a leading plus, from 6 to 15 digits', () => {
    expect(isPhone('000000')).toBe(true);
    expect(isPhone('00 00 00')).toBe(true);
    expect(isPhone('+999 000 000 000')).toBe(true);
    expect(isPhone('  111 111 111  ')).toBe(true);
    expect(isPhone('999999999999999')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isPhone('')).toBe(false);
    expect(isPhone('   ')).toBe(false);
    expect(isPhone('00000')).toBe(false);
    expect(isPhone('9999999999999999')).toBe(false);
    expect(isPhone('00-00-00')).toBe(false);
    expect(isPhone('00.00.00')).toBe(false);
    expect(isPhone('000 000+')).toBe(false);
    expect(isPhone('++999000000')).toBe(false);
    expect(isPhone('(000) 000')).toBe(false);
    expect(isPhone('Awa 000000')).toBe(false);
  });
});

describe('isServiceNumber', () => {
  it('takes the short numbers of public services too: 2 to 15 digits', () => {
    expect(isServiceNumber('00')).toBe(true);
    expect(isServiceNumber('000')).toBe(true);
    expect(isServiceNumber(' 00 00 ')).toBe(true);
    expect(isServiceNumber('+999 000 000 000')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isServiceNumber('')).toBe(false);
    expect(isServiceNumber('0')).toBe(false);
    expect(isServiceNumber('9999999999999999')).toBe(false);
    expect(isServiceNumber('00-00')).toBe(false);
    expect(isServiceNumber('000+')).toBe(false);
    expect(isServiceNumber('SAMU')).toBe(false);
  });
});

describe('tidyPhone and telHref', () => {
  it('keeps the number as written, with single spaces', () => {
    expect(tidyPhone('  +999   000 000 ')).toBe('+999 000 000');
  });

  it('dials the digits, with the plus when there is one', () => {
    expect(telHref('+999 000 000')).toBe('tel:+999000000');
    expect(telHref('00 00 00')).toBe('tel:000000');
  });
});

describe('phoneGroups', () => {
  it('keeps the groups as written, and shows a long run of digits in groups of three', () => {
    expect(phoneGroups('00 00 00 00')).toEqual(['00', '00', '00', '00']);
    expect(phoneGroups('+999 000 000')).toEqual(['+999', '000', '000']);
    expect(phoneGroups('000000')).toEqual(['000000']);
    expect(phoneGroups('0000000')).toEqual(['000', '000', '0']);
    // The plus stays with the first group.
    expect(phoneGroups('+999000000000')).toEqual(['+999', '000', '000', '000']);
    expect(phoneGroups(' 000  000 ')).toEqual(['000', '000']);
  });

  it('never changes the digits: the groups joined are the number as dialled', () => {
    for (const phone of ['+999000000000', '00 0000000 0', '000000000000000']) {
      expect(`tel:${phoneGroups(phone).join('')}`).toBe(telHref(phone));
    }
  });
});

describe('isReferralContact', () => {
  it('accepts a known role, a name (maybe empty) and a valid phone', () => {
    for (const role of REFERRAL_ROLES) {
      expect(isReferralContact({ id: 'a', role, name: '', phone: '000000' })).toBe(true);
    }
  });

  it('refuses a missing id, an unknown role, a name that is not text or a bad phone', () => {
    expect(isReferralContact({ id: '', role: 'relay', name: '', phone: '000000' })).toBe(false);
    expect(isReferralContact({ id: 'a', role: 'doctor', name: '', phone: '000000' })).toBe(false);
    expect(isReferralContact({ id: 'a', role: 'relay', name: 3, phone: '000000' })).toBe(false);
    expect(isReferralContact({ id: 'a', role: 'relay', name: '', phone: '' })).toBe(false);
    expect(isReferralContact(null)).toBe(false);
    expect(isReferralContact('relay')).toBe(false);
  });
});

describe('validateContactForm', () => {
  it('asks for a role and a phone; the name is optional', () => {
    expect(validateContactForm({ role: null, name: '', phone: '' })).toEqual({
      role: 'contacts.error.role',
      phone: 'contacts.error.phone',
    });
    expect(validateContactForm({ role: 'midwife', name: '', phone: '000 000' })).toEqual({});
  });

  it('says how a phone is written when it is not a phone', () => {
    expect(validateContactForm({ role: 'icp', name: 'Awa', phone: '00-00-00' })).toEqual({
      phone: 'contacts.error.phoneFormat',
    });
  });
});

describe('whoOf', () => {
  const t = (key: MessageKey, vars?: Vars) => translate('fr', key, vars);

  it('names a contact by name and role, or by its role alone', () => {
    expect(whoOf({ name: 'Awa', role: 'relay' }, t)).toBe('Awa (Relais)');
    expect(whoOf({ name: '', role: 'icp' }, t)).toBe('Infirmier chef de poste, ICP');
    // Never brackets inside brackets ("Mamadou (Infirmier chef de poste (ICP))").
    expect(whoOf({ name: 'Mamadou', role: 'icp' }, t)).toBe(
      'Mamadou (Infirmier chef de poste, ICP)',
    );
    expect(whoOf({ name: 'Fatou', role: 'midwife' }, (k, v) => translate('en', k, v))).toBe(
      'Fatou (Midwife)',
    );
  });
});

describe('contactFromForm and formFromContact', () => {
  it('makes a contact with a tidy name and phone, keeping its id when edited', () => {
    expect(
      contactFromForm({ role: 'relay', name: '  Awa  Diop ', phone: ' 000  000 ' }, 'id-1'),
    ).toEqual({ id: 'id-1', role: 'relay', name: 'Awa Diop', phone: '000 000' });
    const contact = { id: 'id-2', role: 'midwife' as const, name: 'Fatou', phone: '+999 000 000' };
    expect(formFromContact(contact)).toEqual({
      role: 'midwife',
      name: 'Fatou',
      phone: '+999 000 000',
    });
  });

  it('refuses a form that does not validate', () => {
    expect(() => contactFromForm({ role: null, name: '', phone: '000000' }, 'x')).toThrow(
      RangeError,
    );
    expect(() => contactFromForm({ role: 'relay', name: '', phone: 'abc' }, 'x')).toThrow(
      RangeError,
    );
  });
});
