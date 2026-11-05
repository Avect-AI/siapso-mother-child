// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { EMERGENCY_NUMBERS } from '../config/emergency.js';
import { loadReferral, loadSavedContacts, type LoadedReferral } from '../data/referral.js';
import { dialNameOf, phoneGroups, telHref } from '../domain/contacts.js';
import { keepUnits, type InstructionSource } from '../domain/result-view.js';
import { displayOf } from '../domain/search-index.js';
import type { EmergencyNumber, ReferralContact } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { FROM_CALL, forgetSavedForCall, savedForCall } from '../state/contact-return.js';
import { epochToken, forgetStaleEntry, inVisit, visitState } from '../state/entry-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { DangerBanner } from '../ui/DangerBanner.js';
import { DialLink } from '../ui/DialLink.js';
import { useLiveRegionReady } from '../ui/live-region.js';
import { Notice } from '../ui/Notice.js';
import { PhoneNumber } from '../ui/PhoneNumber.js';
import { UNLOCK_PATH } from './Neutral.js';

/** The route of who to call, under the danger signs. */
export const CALL_PATH = '/danger/call';

/** A product or remedy of a result's danger, as the item refers to it (shown by name). */
interface DangerProduct {
  kind: 'product' | 'plant';
  id: string;
  strengthUnknown?: true;
}

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
   * From a result whose danger comes from product rules: those products, said
   * with the signs ("Dites aussi ce qu'elle prend"), and whether no danger sign
   * was ticked (the banner is then named "Danger : à montrer maintenant").
   */
  products: DangerProduct[];
  productDanger: boolean;
  /**
   * The epoch the state was left in (entry-state.ts). From a result, its
   * instruction and the check's signs say something about her, so they show
   * only while open, in that epoch. From the danger signs screen, the signs
   * were given without the code: they show locked or not, in that epoch.
   */
  epoch: string | undefined;
  /** Opened from the danger signs screen, with signs given without the code. */
  withoutCode: boolean;
}

function instructionOf(value: unknown): InstructionSource | null {
  if (typeof value !== 'object' || value === null) return null;
  const { standard, message } = value as Record<string, unknown>;
  if (standard === true) return { standard: true };
  return typeof message === 'string' && message !== '' ? { message } : null;
}

/** The products of the state: product or plant references only, each once. */
function productsOf(value: unknown): DangerProduct[] {
  if (!Array.isArray(value)) return [];
  const products: DangerProduct[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { kind, id, strengthUnknown } = entry as Record<string, unknown>;
    if ((kind !== 'product' && kind !== 'plant') || typeof id !== 'string' || id === '') continue;
    if (products.some((p) => p.kind === kind && p.id === id)) continue;
    products.push(strengthUnknown === true ? { kind, id, strengthUnknown: true } : { kind, id });
  }
  return products;
}

/**
 * The history entry's state: the signs (strings only), the instruction and
 * the products of a danger, when given in this visit (an entry left before a
 * quick exit gives nothing).
 */
function openedWith(): Opened {
  const { signs, instruction, products, productDanger, epoch, public: withoutCode } = visitState();
  return {
    signs: Array.isArray(signs)
      ? [...new Set(signs.filter((s): s is string => typeof s === 'string'))]
      : [],
    instruction: instructionOf(instruction),
    products: productsOf(products),
    productDanger: productDanger === true,
    epoch: typeof epoch === 'string' ? epoch : undefined,
    withoutCode: withoutCode === true,
  };
}

/**
 * What may show of what the screen was opened with. After its epoch (a lock,
 * or two minutes idle while locked), or from a result while locked: no sign,
 * no product, and only the standard danger instruction, since a danger was said.
 */
function shownOf(opened: Opened, unlocked: boolean): Opened {
  const said: Opened = {
    signs: [],
    instruction: { standard: true },
    products: [],
    productDanger: false,
    epoch: undefined,
    withoutCode: false,
  };
  if (opened.withoutCode) return opened.epoch === epochToken() ? opened : said;
  // A result's own instruction always comes with an epoch; one without is not trusted either.
  const fromResult =
    opened.epoch !== undefined || (opened.instruction !== null && 'message' in opened.instruction);
  if (!fromResult) return opened;
  if (unlocked && opened.epoch === epochToken()) return opened;
  return said;
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
 * settings are read. The calls come first, right under the title, so that the
 * first one ends in the first screen of a small phone whatever the instruction
 * below says: each contact with its role, name and number shown as text, and
 * a large "Appeler" link that opens the phone's dialler (after a contact saved
 * from here, "Contact enregistré : ..." once); then the emergency numbers as
 * call links ("Appeler le SAMU (1515)"; built in, or the deployment file's),
 * so that a danger always leads to a number to call, even with no contact;
 * shown at once, the built-in ones until the deployment file is read. The
 * first link is the screen's primary action: the first contact, else the
 * first emergency number. Then what to do: with a danger, the danger banner,
 * "Allez au poste de santé maintenant." from the danger signs screen (she said
 * it is serious now), the result's own instruction from a result; without a
 * danger, the orientation with its condition, as on the danger signs screen.
 * The banner is named "Danger : à montrer maintenant" when the result's danger
 * comes from a product and no sign was ticked, never "Signe de danger".
 * Then the signs ticked, to say when calling, and the products of a result's
 * danger ("Dites aussi ce qu'elle prend :"); then, under "Circuit de
 * référence", where to go: the built-in line and under it the deployment's
 * circuit text. Last, the contacts of the phone: "Aucun contact
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
  const { pack, packError, storageTimeoutMs, settings } = useApp();
  const { unlocked, status } = useSession();
  const [, navigate] = useLocation();
  const [opened] = useState(openedWith);
  const [loaded, setLoaded] = useState<(LoadedReferral & { withSaved: boolean }) | null>(null);
  const nationalId = useId();
  // Read once when the screen opens, then forgotten: a later visit says nothing.
  const [justSaved] = useState(savedForCall);
  const announce = useLiveRegionReady();

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
  // What she takes, named as on the result, in the language of the moment.
  const products =
    pack === null
      ? []
      : shown.products.map(({ kind, id, strengthUnknown }) =>
          keepUnits(displayOf(pack, { kind, id }, lang, strengthUnknown === true).name),
        );
  // A danger from a product, no sign ticked: never called a danger sign.
  const levelLabel =
    shown.productDanger && labels.length === 0 ? t('result.dangerProductLevel') : t('level.danger');
  const mode = settings.mode ?? 'woman';
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
      {/* The calls first, whatever the instruction says and however long it
          is: the first one always ends in the first screen of a small phone. */}
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
      {/* There and empty when the screen appears, then filled: a status region
          filled in the same moment it is added is often not read out. */}
      <p className="referral__status" role="status">
        {saved === null || !announce ? '' : t('contacts.saved', { who: saved })}
      </p>

      {/* Always, and at once (built in until the deployment file is read): the
          emergency numbers, so a danger never ends on no one to call. */}
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

      {/* Then what to do: the danger banner (the calls are its actions), or the orientation. */}
      {instruction === undefined ? null : instruction === null ? (
        <div className="danger__orientation">
          <p>{t('danger.condition')}</p>
          <p className="orientation">{t('danger.orientation')}</p>
        </div>
      ) : (
        <DangerBanner levelLabel={levelLabel} title={instruction} headingLevel={2} />
      )}

      {/* The signs to say when calling. */}
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
      {/* What she takes, when the danger comes from it. */}
      {products.length === 0 ? null : (
        <div className="referral__signs">
          <p>{t(mode === 'accompanied' ? 'call.productsAccompanied' : 'call.productsWoman')}</p>
          <ul>
            {products.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Where to go: the built-in line, always, and under it the deployment's circuit. */}
      <section className="referral__national" aria-labelledby={nationalId}>
        <h2 id={nationalId}>{t('call.circuit')}</h2>
        <p>{t('call.emergencyCircuit')}</p>
        {circuit?.nationalCircuit === undefined ? null : (
          <p className="referral__deployed">{circuit.nationalCircuit[lang]}</p>
        )}
      </section>

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
