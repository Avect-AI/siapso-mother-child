// SPDX-License-Identifier: MIT
import { useEffect, useId, useState } from 'react';
import { useLocation } from 'wouter';
import { loadReferral, loadSavedContacts, type LoadedReferral } from '../data/referral.js';
import { phoneGroups, telHref, whoOf } from '../domain/contacts.js';
import type { InstructionSource } from '../domain/result-view.js';
import type { ReferralContact } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { epochToken, forgetStaleEntry, visitState } from '../state/entry-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { DangerBanner } from '../ui/DangerBanner.js';
import { Notice } from '../ui/Notice.js';
import { PhoneNumber } from '../ui/PhoneNumber.js';
import { UNLOCK_PATH } from './Neutral.js';

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
  /**
   * The epoch a result left the state in (entry-state.ts), when it came from
   * a result: its instruction and the check's signs say something about her,
   * so they show only while open, in that epoch. Undefined for the danger
   * signs screen, whose signs were given without the code.
   */
  epoch: string | undefined;
}

function instructionOf(value: unknown): InstructionSource | null {
  if (typeof value !== 'object' || value === null) return null;
  const { standard, message } = value as Record<string, unknown>;
  if (standard === true) return { standard: true };
  return typeof message === 'string' && message !== '' ? { message } : null;
}

/**
 * The history entry's state: the signs (strings only) and the instruction,
 * when given in this visit (an entry left before a quick exit gives nothing).
 */
function openedWith(): Opened {
  const { signs, instruction, epoch } = visitState();
  return {
    signs: Array.isArray(signs)
      ? [...new Set(signs.filter((s): s is string => typeof s === 'string'))]
      : [],
    instruction: instructionOf(instruction),
    epoch: typeof epoch === 'string' ? epoch : undefined,
  };
}

/**
 * What may show of what the screen was opened with. From a result, while
 * locked or after a lock (a new epoch): no sign of the check, and only the
 * standard danger instruction, since a danger was said.
 */
function shownOf(opened: Opened, unlocked: boolean): Opened {
  // A result's own instruction always comes with an epoch; one without is not trusted either.
  const fromResult =
    opened.epoch !== undefined || (opened.instruction !== null && 'message' in opened.instruction);
  if (!fromResult) return opened;
  if (unlocked && opened.epoch === epochToken()) return opened;
  return { signs: [], instruction: { standard: true }, epoch: undefined };
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
 *
 * Before the code (this screen opens locked too), the contacts saved on the
 * phone are not shown, only the deployment's, with a way to give the code
 * that comes back here; they go as soon as the session locks.
 */
export function Referral() {
  const t = useT();
  const lang = useLang();
  const { settings, pack, packError, storageTimeoutMs } = useApp();
  const { unlocked, status } = useSession();
  const [, navigate] = useLocation();
  const [opened] = useState(openedWith);
  const [loaded, setLoaded] = useState<(LoadedReferral & { withSaved: boolean }) | null>(null);
  const nationalId = useId();
  const accompanied = settings.mode === 'accompanied';

  // A state left in another visit, or by a result before a lock, goes from the history.
  useEffect(() => {
    forgetStaleEntry();
  }, []);

  useEffect(() => {
    let live = true;
    // Never rejects: storage that cannot be read still lists the deployment's contacts.
    void loadReferral({
      readSaved: unlocked
        ? () => withTimeout(loadSavedContacts(), storageTimeoutMs)
        : () => Promise.resolve([]),
    }).then((result) => {
      if (live) setLoaded({ ...result, withSaved: unlocked });
    });
    return () => {
      live = false;
    };
  }, [storageTimeoutMs, unlocked]);

  // A circuit read with the saved contacts never shows once locked, even
  // while it is read again without them.
  const circuit = loaded?.withSaved === unlocked ? loaded : null;
  const shown = shownOf(opened, unlocked);
  const { signs } = shown;
  // Worded now, in the language of the moment. A result's own message waits
  // for the pack (so the banner never says one instruction, then another); a
  // message the pack does not have, or no pack at all, gives the standard
  // danger instruction. Undefined: not known yet, nothing is said.
  const source = shown.instruction;
  let instruction: string | null | undefined = null;
  if (source !== null) {
    if ('standard' in source || pack === null) {
      instruction =
        'standard' in source || packError !== null ? t('result.orientation.danger') : undefined;
    } else {
      instruction =
        pack.messages[lang][source.message]?.orientation ?? t('result.orientation.danger');
    }
  }
  const labels = signs.flatMap((id) => {
    const sign = pack?.dangerSigns.find((d) => d.id === id);
    return sign === undefined ? [] : [sign.label[lang]];
  });
  const contacts = circuit?.contacts ?? [];
  // Locked with a code on the phone: the saved contacts wait for it.
  const behindCode = !unlocked && status !== 'new';

  return (
    <main className="screen referral">
      <h1 tabIndex={-1}>{t('call.title')}</h1>
      {instruction === undefined ? null : instruction === null ? (
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
        {circuit === null ? (
          <p className="referral__loading" role="status">
            {t('call.loading')}
          </p>
        ) : (
          <>
            {circuit.savedUnavailable ? <Notice>{t('call.savedUnavailable')}</Notice> : null}
            {contacts.length === 0 ? (
              // Unreadable storage is said above, and locked contacts below:
              // never "no contact" when that is not known.
              circuit.savedUnavailable || behindCode ? null : (
                <p className="referral__none">{t('call.none')}</p>
              )
            ) : (
              <ul className="referral__contacts" aria-label={t('call.contactsLabel')}>
                {contacts.map((contact, index) => (
                  <ContactRow key={contact.id} contact={contact} primary={index === 0} />
                ))}
              </ul>
            )}
            {behindCode ? (
              <div className="referral__locked">
                <p>{t('call.locked')}</p>
                <Button
                  variant="secondary"
                  className="referral__unlock"
                  onClick={() => {
                    // The code screen comes back here once the code is given.
                    navigate(UNLOCK_PATH, { state: { back: true } });
                  }}
                >
                  {t('call.enterCode')}
                </Button>
              </div>
            ) : null}
            {accompanied && unlocked ? (
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

      {circuit?.nationalCircuit === undefined ? null : (
        <section className="referral__national" aria-labelledby={nationalId}>
          <h2 id={nationalId}>{t('call.circuit')}</h2>
          <p>{circuit.nationalCircuit[lang]}</p>
        </section>
      )}
    </main>
  );
}
