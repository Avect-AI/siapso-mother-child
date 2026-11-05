// SPDX-License-Identifier: MIT
import { useEffect, useId, useState } from 'react';
import { loadReferral, loadSavedContacts, type LoadedReferral } from '../data/referral.js';
import { phoneGroups, telHref, whoOf } from '../domain/contacts.js';
import type { InstructionSource } from '../domain/result-view.js';
import type { ReferralContact } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { DangerBanner } from '../ui/DangerBanner.js';
import { Notice } from '../ui/Notice.js';
import { PhoneNumber } from '../ui/PhoneNumber.js';

/** The route of who to call, under the danger signs. */
export const CALL_PATH = '/danger/call';

/**
 * What the screen was opened with: the signs ticked, and the instruction to
 * give, as the message that says it (never its words, so a change of language
 * shows it in the language of the moment). No instruction: opened without a
 * danger, from the link on the danger signs screen or an address.
 */
interface Opened {
  signs: string[];
  instruction: InstructionSource | null;
}

function instructionOf(value: unknown): InstructionSource | null {
  if (typeof value !== 'object' || value === null) return null;
  const { standard, message } = value as Record<string, unknown>;
  if (standard === true) return { standard: true };
  return typeof message === 'string' && message !== '' ? { message } : null;
}

/** The history entry's state: the signs (strings only) and the instruction, when given. */
function openedWith(): Opened {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return { signs: [], instruction: null };
  const { signs, instruction } = state as Record<string, unknown>;
  return {
    signs: Array.isArray(signs)
      ? [...new Set(signs.filter((s): s is string => typeof s === 'string'))]
      : [],
    instruction: instructionOf(instruction),
  };
}

function ContactRow({ contact, primary }: { contact: ReferralContact; primary: boolean }) {
  const t = useT();
  const role = t(`contacts.roles.${contact.role}`);
  return (
    <li className="referral__contact">
      <div className="referral__who">
        <p className="referral__name">{contact.name === '' ? role : contact.name}</p>
        {contact.name === '' ? null : <p className="meta">{role}</p>}
        <PhoneNumber className="referral__phone" groups={phoneGroups(contact.phone)} />
      </div>
      {/* Opens the phone's dialler with the number; nothing is sent by the app. The
          name starts with the visible word, then says who and the number. */}
      <a
        className={`button button--${primary ? 'primary' : 'secondary'} referral__dial`}
        href={telHref(contact.phone)}
        aria-label={`${t('call.dial')} ${t('call.dialWho', { who: whoOf(contact, t), phone: contact.phone })}`}
      >
        {t('call.dial')}
      </a>
    </li>
  );
}

/**
 * Who to call: the referral circuit, from the danger signs screen ("C'est
 * grave maintenant", with or without signs ticked, or straight from its
 * link) and from a result's danger banner. Opens at once, even before the
 * settings are read. With a danger, the danger banner says what to do: "Allez
 * au poste de santé maintenant." from the danger signs screen (she said it is
 * serious now), the result's own instruction from a result; then the signs
 * ticked, to say when calling. Without a danger, the orientation with its
 * condition, as on the danger signs screen. Then always
 * the circuit: each contact with its role, name and number shown as text, and
 * a large "Appeler" link that opens the phone's dialler (the first one the
 * screen's primary action), or "Aucun contact enregistré sur ce téléphone."
 * In accompanied mode a way to add or change the contacts; then the national
 * circuit of the deployment file. The app never sends a message, and never
 * says that someone knows or is on the way.
 */
export function Referral() {
  const t = useT();
  const lang = useLang();
  const { settings, pack, storageTimeoutMs } = useApp();
  const [opened] = useState(openedWith);
  const [loaded, setLoaded] = useState<LoadedReferral | null>(null);
  const nationalId = useId();
  const accompanied = settings.mode === 'accompanied';

  useEffect(() => {
    let live = true;
    // Never rejects: storage that cannot be read still lists the deployment's contacts.
    void loadReferral({
      readSaved: () => withTimeout(loadSavedContacts(), storageTimeoutMs),
    }).then((result) => {
      if (live) setLoaded(result);
    });
    return () => {
      live = false;
    };
  }, [storageTimeoutMs]);

  const { signs } = opened;
  // Worded now, in the language of the moment; a message the pack does not
  // have (or a pack still loading) gives the standard danger instruction.
  const source = opened.instruction;
  let instruction: string | null = null;
  if (source !== null) {
    const own = 'message' in source ? pack?.messages[lang][source.message]?.orientation : undefined;
    instruction = own ?? t('result.orientation.danger');
  }
  const labels = signs.flatMap((id) => {
    const sign = pack?.dangerSigns.find((d) => d.id === id);
    return sign === undefined ? [] : [sign.label[lang]];
  });
  const contacts = loaded?.contacts ?? [];

  return (
    <main className="screen referral">
      <h1 tabIndex={-1}>{t('call.title')}</h1>
      {instruction === null ? (
        <div className="danger__orientation">
          <p>{t('danger.condition')}</p>
          <p className="orientation">{t('danger.orientation')}</p>
        </div>
      ) : (
        <DangerBanner levelLabel={t('level.danger')} title={instruction} headingLevel={2} />
      )}
      {labels.length === 0 ? null : (
        <div className="referral__signs">
          <p>{t('call.signsLabel')}</p>
          <ul>
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="referral__circuit">
        {loaded === null ? (
          <p className="referral__loading" role="status">
            {t('call.loading')}
          </p>
        ) : (
          <>
            {loaded.savedUnavailable ? <Notice>{t('call.savedUnavailable')}</Notice> : null}
            {contacts.length === 0 ? (
              // Unreadable storage is said above: never "no contact" when that is not known.
              loaded.savedUnavailable ? null : (
                <p className="referral__none">{t('call.none')}</p>
              )
            ) : (
              <ul className="referral__contacts" aria-label={t('call.contactsLabel')}>
                {contacts.map((contact, index) => (
                  <ContactRow key={contact.id} contact={contact} primary={index === 0} />
                ))}
              </ul>
            )}
            {accompanied ? (
              <a
                className="button button--secondary referral__manage"
                href={contacts.length === 0 ? '#/contacts/new' : '#/contacts'}
              >
                {t(contacts.length === 0 ? 'call.add' : 'call.manage')}
              </a>
            ) : null}
          </>
        )}
      </div>

      {loaded?.nationalCircuit === undefined ? null : (
        <section className="referral__national" aria-labelledby={nationalId}>
          <h2 id={nationalId}>{t('call.circuit')}</h2>
          <p>{loaded.nationalCircuit[lang]}</p>
        </section>
      )}
    </main>
  );
}
