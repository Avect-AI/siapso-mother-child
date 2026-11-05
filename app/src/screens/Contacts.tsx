// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  fetchDeploymentReferral,
  loadSavedContacts,
  REFERRAL_ROLES,
  saveContacts,
} from '../data/referral.js';
import {
  contactFromForm,
  emptyContactForm,
  formFromContact,
  NAME_MAX_LENGTH,
  phoneGroups,
  validateContactForm,
  whoOf,
  type ContactForm,
} from '../domain/contacts.js';
import type { ReferralContact, ReferralRole } from '../domain/types.js';
import { useT, type MessageKey } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { PhoneNumber } from '../ui/PhoneNumber.js';
import { TextField } from '../ui/TextField.js';

/** The contact screen a route opens: a new contact, or one saved on this phone. */
export type ContactTarget = { kind: 'new' } | { kind: 'edit'; id: string };

/** The contact just saved, left by the contact screen on the list's history entry. */
function justSaved(): string | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null || !('contactSaved' in state)) return null;
  return typeof state.contactSaved === 'string' ? state.contactSaved : null;
}

/** What just happened to the list, said under it. */
type Change =
  | { kind: 'saved'; who: string }
  | { kind: 'removed'; contact: ReferralContact; index: number }
  | { kind: 'restored'; contact: ReferralContact };

type Saved =
  { status: 'loading' } | { status: 'ready'; contacts: ReferralContact[] } | { status: 'failed' };

function ContactText({ contact }: { contact: ReferralContact }) {
  const t = useT();
  const role = t(`contacts.roles.${contact.role}`);
  return (
    <div className="contacts__text">
      <p className="contacts__name">{contact.name === '' ? role : contact.name}</p>
      {contact.name === '' ? null : <p className="meta">{role}</p>}
      <PhoneNumber className="contacts__phone" groups={phoneGroups(contact.phone)} />
    </div>
  );
}

/**
 * The referral contacts kept on this phone (accompanied mode): each with its
 * role, name and number, a way to change it and a way off the list (with a
 * way to put it back, no time limit), then the one primary action, "Ajouter
 * un contact". The contacts of the deployment file follow, read only. Nothing
 * is ever sent: the numbers stay on the phone and are only dialled from who
 * to call.
 */
export function Contacts() {
  const t = useT();
  const { storageTimeoutMs } = useApp();
  const [saved, setSaved] = useState<Saved>({ status: 'loading' });
  const [provided, setProvided] = useState<ReferralContact[]>([]);
  const [change, setChange] = useState<Change | null>(() => {
    const who = justSaved();
    return who === null ? null : { kind: 'saved', who };
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const providedId = useId();

  // The note of a save is said once: taken off the history entry, so a reload does not repeat it.
  useEffect(() => {
    if (justSaved() !== null) window.history.replaceState(null, '', window.location.href);
  }, []);

  useEffect(() => {
    let live = true;
    withTimeout(loadSavedContacts(), storageTimeoutMs).then(
      (contacts) => {
        if (live) setSaved({ status: 'ready', contacts });
      },
      (failure: unknown) => {
        console.warn('Referral contacts not read on this device', failure);
        if (live) setSaved({ status: 'failed' });
      },
    );
    void fetchDeploymentReferral().then((config) => {
      if (live) setProvided(config.contacts);
    });
    return () => {
      live = false;
    };
  }, [storageTimeoutMs]);

  const keep = async (contacts: ReferralContact[], next: Change) => {
    setSaveFailed(false);
    try {
      await withTimeout(saveContacts(contacts), storageTimeoutMs);
      setSaved({ status: 'ready', contacts });
      setChange(next);
    } catch (failure) {
      console.warn('Referral contacts not stored on this device', failure);
      setSaveFailed(true);
    }
  };

  const contacts = saved.status === 'ready' ? saved.contacts : [];
  return (
    <main className="screen contacts">
      <div className="contacts__intro">
        <h1 tabIndex={-1}>{t('contacts.title')}</h1>
        <p>{t('contacts.lead')}</p>
      </div>
      {saved.status === 'failed' ? <Notice>{t('contacts.loadFailed')}</Notice> : null}
      {saveFailed ? <Notice>{t('contacts.saveFailed')}</Notice> : null}
      {saved.status !== 'ready' ? null : contacts.length === 0 ? (
        <p className="contacts__none">{t('call.none')}</p>
      ) : (
        <ul className="contacts__list" aria-label={t('contacts.listLabel')}>
          {contacts.map((contact, index) => {
            const who = whoOf(contact, t);
            return (
              <li key={contact.id} className="contacts__item">
                <ContactText contact={contact} />
                <div className="contacts__actions">
                  <a
                    className="button button--quiet"
                    href={`#/contacts/${encodeURIComponent(contact.id)}`}
                    aria-label={t('contacts.editNamed', { who })}
                  >
                    {t('contacts.edit')}
                  </a>
                  <Button
                    variant="quiet"
                    aria-label={t('contacts.removeNamed', { who })}
                    onClick={() => {
                      void keep(
                        contacts.filter((_, i) => i !== index),
                        { kind: 'removed', contact, index },
                      );
                    }}
                  >
                    {t('contacts.remove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* What just changed, in words; a removal can be undone (no time limit). */}
      <p className="contacts__status" role="status">
        {change === null ? '' : statusOf(change, t)}
      </p>
      {change?.kind === 'removed' && saved.status === 'ready' ? (
        <Button
          variant="quiet"
          className="contacts__undo"
          onClick={() => {
            const index = Math.min(change.index, contacts.length);
            void keep([...contacts.slice(0, index), change.contact, ...contacts.slice(index)], {
              kind: 'restored',
              contact: change.contact,
            });
          }}
        >
          {t('contacts.putBack')}
        </Button>
      ) : null}
      {saved.status === 'ready' ? (
        <a className="button button--primary contacts__add" href="#/contacts/new">
          {t('contacts.add')}
        </a>
      ) : null}

      {provided.length === 0 ? null : (
        <section className="contacts__provided" aria-labelledby={providedId}>
          <h2 id={providedId}>{t('contacts.provided')}</h2>
          <p className="meta">{t('contacts.providedHint')}</p>
          <ul className="contacts__list">
            {provided.map((contact) => (
              <li key={contact.id} className="contacts__item">
                <ContactText contact={contact} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function statusOf(change: Change, t: ReturnType<typeof useT>): string {
  switch (change.kind) {
    case 'saved':
      return t('contacts.saved', { who: change.who });
    case 'removed':
      return t('contacts.removed', { who: whoOf(change.contact, t) });
    case 'restored':
      return t('contacts.restored', { who: whoOf(change.contact, t) });
  }
}

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; contacts: ReferralContact[]; form: ContactForm }
  | { status: 'missing' }
  | { status: 'failed' };

/**
 * A referral contact (accompanied mode): its role, its name (optional) and
 * its number, digits with spaces and a leading plus if any. The one primary
 * action keeps it on this phone, then goes back to the list, which says it
 * was saved. A failed save says so and keeps what was typed.
 */
export function ContactEdit({ target }: { target: ContactTarget }) {
  const t = useT();
  const { storageTimeoutMs } = useApp();
  const [, navigate] = useLocation();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const id = target.kind === 'edit' ? target.id : null;

  useEffect(() => {
    let live = true;
    withTimeout(loadSavedContacts(), storageTimeoutMs).then(
      (contacts) => {
        if (!live) return;
        if (id === null) {
          setLoaded({ status: 'ready', contacts, form: emptyContactForm() });
          return;
        }
        const contact = contacts.find((c) => c.id === id);
        setLoaded(
          contact === undefined
            ? { status: 'missing' }
            : { status: 'ready', contacts, form: formFromContact(contact) },
        );
      },
      (failure: unknown) => {
        console.warn('Referral contacts not read on this device', failure);
        if (live) setLoaded({ status: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [id, storageTimeoutMs]);

  return (
    <main className="screen contact">
      <h1 tabIndex={-1}>{t(id === null ? 'contacts.titleNew' : 'contacts.titleEdit')}</h1>
      {loaded.status === 'missing' ? <Notice>{t('contacts.missing')}</Notice> : null}
      {loaded.status === 'failed' ? <Notice>{t('contacts.loadFailed')}</Notice> : null}
      {loaded.status === 'ready' ? (
        <ContactFormView
          initial={loaded.form}
          onSave={async (form) => {
            const contact = contactFromForm(form, id ?? crypto.randomUUID());
            const contacts =
              id === null
                ? [...loaded.contacts, contact]
                : loaded.contacts.map((c) => (c.id === id ? contact : c));
            await withTimeout(saveContacts(contacts), storageTimeoutMs);
            // The list reads the contact from the history entry to say it was saved.
            navigate('/contacts', { replace: true, state: { contactSaved: whoOf(contact, t) } });
          }}
        />
      ) : null}
    </main>
  );
}

function ContactFormView({
  initial,
  onSave,
}: {
  initial: ContactForm;
  /** Keeps the contact; rejects when the phone could not keep it. */
  onSave: (form: ContactForm) => Promise<void>;
}) {
  const t = useT();
  const [form, setForm] = useState(initial);
  const [attempts, setAttempts] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const errors = validateContactForm(form);
  const error = (key: MessageKey | undefined) =>
    attempts > 0 && key !== undefined ? t(key) : undefined;

  // A failed attempt moves focus to the first answer to fix, its question in view.
  useEffect(() => {
    if (attempts === 0) return;
    const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!field) return;
    field.focus({ preventScroll: true });
    const question = field.closest<HTMLElement>('fieldset, .text-field') ?? field;
    if (typeof question.scrollIntoView === 'function') question.scrollIntoView({ block: 'start' });
  }, [attempts]);

  return (
    <form
      ref={formRef}
      className="contact__form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        if (Object.keys(errors).length > 0) {
          setAttempts((n) => n + 1);
          return;
        }
        setSaving(true);
        setSaveFailed(false);
        onSave(form).catch((failure: unknown) => {
          console.warn('Referral contact not stored on this device', failure);
          setSaveFailed(true);
          setSaving(false);
        });
      }}
    >
      <RadioGroup<ReferralRole>
        legend={t('contacts.role')}
        error={error(errors.role)}
        options={REFERRAL_ROLES.map((role) => ({
          value: role,
          label: t(`contacts.roles.${role}`),
        }))}
        value={form.role}
        onChange={(role) => {
          setForm((current) => ({ ...current, role }));
        }}
      />
      <TextField
        label={t('contacts.name')}
        hint={t('contacts.nameHint')}
        value={form.name}
        maxLength={NAME_MAX_LENGTH}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setForm((current) => ({ ...current, name: event.target.value }));
        }}
      />
      <TextField
        label={t('contacts.phone')}
        hint={t('contacts.phoneHint')}
        error={error(errors.phone)}
        value={form.phone}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        maxLength={24}
        onChange={(event) => {
          setForm((current) => ({ ...current, phone: event.target.value }));
        }}
      />
      <div className="contact__save">
        {saveFailed ? <Notice>{t('contacts.saveFailed')}</Notice> : null}
        <Button type="submit" variant="primary" className="contact__submit" disabled={saving}>
          {t('contacts.save')}
        </Button>
      </div>
    </form>
  );
}
