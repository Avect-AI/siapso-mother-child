// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { EMERGENCY_NUMBERS } from '../config/emergency.js';
import { loadReferral, loadSavedContacts, type LoadedReferral } from '../data/referral.js';
import { dialNameOf, phoneGroups, telHref } from '../domain/contacts.js';
import type { InstructionSource } from '../domain/result-view.js';
import type { EmergencyNumber, ReferralContact } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { FROM_CALL, forgetSavedForCall, savedForCall } from '../state/contact-return.js';
import { epochToken, forgetStaleEntry, inVisit, visitState } from '../state/entry-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { DangerBanner } from '../ui/DangerBanner.js';
import { DialLink } from '../ui/DialLink.js';
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
      <DialLink
        href={telHref(contact.phone)}
        label={t('call.dial')}
        name={dialNameOf(contact, t)}
        primary={primary}
      />
    </li>
  );
}

/** An emergency number as a call link says it: "Appeler le SAMU (1515)". */
interface EmergencyLink {
  key: string;
  label: string;
  phone: string;
}

/** The deployment's emergency numbers when it gives some, else the built-in ones. */
function emergencyLinks(
  deployed: EmergencyNumber[] | undefined,
  lang: Lang,
  t: ReturnType<typeof useT>,
): EmergencyLink[] {
  if (deployed !== undefined) {
    return deployed.map(({ name, phone }, index) => ({
      key: `deployment:${String(index)}`,
      label: t('call.emergencyDial', { service: name[lang], phone }),
      phone,
    }));
  }
  return EMERGENCY_NUMBERS.map(({ service, phone }) => ({
    key: service,
    label: t('call.emergencyDial', { service: t(`call.services.${service}`), phone }),
    phone,
  }));
}

/**
 * Who to call: the referral circuit, from the danger signs screen ("C'est
 * grave maintenant", with or without signs ticked, or straight from its
 * link) and from a result's danger banner. Opens at once, even before the
 * settings are read. With a danger, the danger banner says what to do: "Allez
 * au poste de santé maintenant." from the danger signs screen (she said it is
 * serious now), the result's own instruction from a result. Without a danger,
 * the orientation with its condition, as on the danger signs screen. Then
 * always the circuit, call links first so that the first one stays in the
 * first screen: each contact with its role, name and number shown as text,
 * and a large "Appeler" link that opens the phone's dialler (after a contact
 * saved from here, "Contact enregistré : ..." once); then, under "Circuit de
 * référence", the emergency numbers as call links ("Appeler le SAMU (1515)";
 * built in, or the deployment file's), so that a danger always leads to a
 * number to call, even with no contact; shown at once, the built-in ones until
 * the deployment file is read; then where to go, the built-in line and under
 * it the deployment's circuit text. The first link is the screen's primary
 * action: the first contact, else the first emergency number. Then the signs
 * ticked, to say when calling. Last, the contacts of the phone: "Aucun contact
 * enregistré sur ce téléphone." when there is none, and, once the code is
 * given, in either mode, a quiet way to add one (saving it comes back here)
 * or to change them: the boxed buttons of the screen are the calls. The app
 * never sends a message, and never says that someone knows or is on the way.
 *
 * Before the code (this screen opens locked too), the contacts saved on the
 * phone are not shown, only the deployment's and the emergency numbers, with
 * a way to give the code that comes back here, worded the same whether
 * contacts are saved or not; they go as soon as the session locks.
 */
export function Referral() {
  const t = useT();
  const lang = useLang();
  const { pack, packError, storageTimeoutMs } = useApp();
  const { unlocked, status } = useSession();
  const [, navigate] = useLocation();
  const [opened] = useState(openedWith);
  const [loaded, setLoaded] = useState<(LoadedReferral & { withSaved: boolean }) | null>(null);
  const nationalId = useId();
  // Read once when the screen opens, then forgotten: a later visit says nothing.
  const [justSaved] = useState(savedForCall);

  // A state left in another visit, or by a result before a lock, goes from the history.
  useEffect(() => {
    forgetStaleEntry();
    forgetSavedForCall();
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
  // Never "no contact" when that is not known: unreadable storage is said
  // instead, and locked contacts are behind the code.
  const none =
    circuit !== null && contacts.length === 0 && !circuit.savedUnavailable && !behindCode;
  // A contact just saved from here: said once, only while open in the epoch it was saved in.
  const saved =
    justSaved !== null && unlocked && justSaved.epoch === epochToken() ? justSaved.who : null;

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
      {circuit === null ? (
        <p className="referral__loading" role="status">
          {t('call.loading')}
        </p>
      ) : (
        <>
          {circuit.savedUnavailable ? <Notice>{t('call.savedUnavailable')}</Notice> : null}
          {contacts.length === 0 ? null : (
            <ul className="referral__contacts" aria-label={t('call.contactsLabel')}>
              {contacts.map((contact, index) => (
                <ContactRow key={contact.id} contact={contact} primary={index === 0} />
              ))}
            </ul>
          )}
        </>
      )}
      {saved === null ? null : (
        <p className="referral__status" role="status">
          {t('contacts.saved', { who: saved })}
        </p>
      )}

      {/* Always, and at once (built in until the deployment file is read): the
          emergency numbers, then where to go, so a danger never ends on no one
          to call. The call links come first: they stay in the first screen. */}
      <section className="referral__national" aria-labelledby={nationalId}>
        <h2 id={nationalId}>{t('call.circuit')}</h2>
        <ul className="referral__emergency" aria-label={t('call.emergencyLabel')}>
          {emergencyLinks(circuit?.emergencyNumbers, lang, t).map((number, index) => (
            <li key={number.key}>
              <DialLink
                href={telHref(number.phone)}
                label={number.label}
                primary={circuit !== null && contacts.length === 0 && index === 0}
              />
            </li>
          ))}
        </ul>
        <p>{t('call.emergencyCircuit')}</p>
        {circuit?.nationalCircuit === undefined ? null : (
          <p className="referral__deployed">{circuit.nationalCircuit[lang]}</p>
        )}
      </section>

      {/* The signs to say when calling, under the numbers. */}
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

      {/* The contacts of the phone, quiet: the boxed buttons of this screen are the calls. */}
      {circuit === null ? null : behindCode ? (
        // Worded the same whether contacts are saved or not.
        <div className="referral__mine">
          <p>{t('call.locked')}</p>
          <Button
            variant="quiet"
            className="referral__unlock"
            onClick={() => {
              // The code screen comes back here once the code is given.
              navigate(UNLOCK_PATH, { state: { back: true } });
            }}
          >
            {t('call.enterCode')}
          </Button>
        </div>
      ) : none || unlocked ? (
        <div className="referral__mine">
          {none ? <p className="referral__none">{t('call.none')}</p> : null}
          {!unlocked ? null : contacts.length === 0 ? (
            // Saving the new contact comes back here, to call it.
            <Link
              className="button button--quiet referral__manage"
              href="/contacts/new"
              state={inVisit({ [FROM_CALL]: true })}
            >
              {t('call.add')}
            </Link>
          ) : (
            <a className="button button--quiet referral__manage" href="#/contacts">
              {t('call.manage')}
            </a>
          )}
        </div>
      ) : null}
    </main>
  );
}
