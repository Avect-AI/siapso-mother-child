// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  emergencyNumbersOf,
  isMedical,
  type BuiltInEmergencyNumber,
  type EmergencyService,
} from '../config/emergency.js';
import { loadReferral, loadSavedContacts, type LoadedReferral } from '../data/referral.js';
import { dialNameOf, phoneGroups, telHref } from '../domain/contacts.js';
import { keepUnits, type InstructionSource } from '../domain/result-view.js';
import { displayOf } from '../domain/search-index.js';
import type { EmergencyNumber, ReferralContact } from '../domain/types.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp, withTimeout } from '../state/app-state.js';
import { FROM_CALL, forgetSavedForCall, savedForCall } from '../state/contact-return.js';
import { useCountryOfUse } from '../state/country.js';
import { epochToken, forgetStaleEntry, inVisit, visitState } from '../state/entry-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { DangerBanner } from '../ui/DangerBanner.js';
import { DialLink } from '../ui/DialLink.js';
import { useLiveRegionReady } from '../ui/live-region.js';
import { Notice } from '../ui/Notice.js';
import { PhoneNumber } from '../ui/PhoneNumber.js';
import { WarningMark } from '../ui/WarningMark.js';
import { COUNTRY_BACK, COUNTRY_PATH } from './Country.js';
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

/** A number of the calls section as its link says it. */
interface CallLink {
  key: string;
  label: string;
  phone: string;
  caveat?: BuiltInEmergencyNumber['caveat'];
}

/** The deployment's own numbers: "Appeler la ligne verte (000)". */
function deploymentLinks(
  deployed: EmergencyNumber[],
  lang: Lang,
  t: ReturnType<typeof useT>,
): CallLink[] {
  return deployed.map(({ name, phone }, index) => ({
    key: `deployment:${String(index)}`,
    label: t('call.emergencyDial', { service: name[lang], phone }),
    phone,
  }));
}

/** A built-in number as a call: "Appeler le SAMU (1515)", "Appeler le 112 (police, pompiers, ambulance)". */
function dialLink(
  { service, phone, caveat }: BuiltInEmergencyNumber,
  t: ReturnType<typeof useT>,
): CallLink {
  const link: CallLink = {
    key: `${service}:${phone}`,
    label: t(`call.dialService.${service}`, { phone }),
    phone,
  };
  if (caveat !== undefined) link.caveat = caveat;
  return link;
}

type OtherService = Exclude<EmergencyService, 'samu' | 'ambulance' | 'emergency'>;

/** A number that is not medical, said as such: "Pompiers : 118", "Police : 117". */
function otherLink(
  { service, phone }: BuiltInEmergencyNumber,
  t: ReturnType<typeof useT>,
): CallLink {
  return {
    key: `${service}:${phone}`,
    label: t('call.otherDial', {
      service: t(`call.serviceName.${service as OtherService}`),
      phone,
    }),
    phone,
  };
}

/** A list of call links; the first is the primary action when `primary`. */
function CallList({
  links,
  label,
  labelledBy,
  primary,
}: {
  links: CallLink[];
  label?: string;
  labelledBy?: string;
  primary: boolean;
}) {
  const t = useT();
  const id = useId();
  return (
    <ul className="referral__emergency" aria-label={label} aria-labelledby={labelledBy}>
      {links.map((link, index) => (
        <li key={link.key}>
          <DialLink
            href={telHref(link.phone)}
            label={link.label}
            primary={primary && index === 0}
            {...(link.caveat === undefined ? {} : { describedBy: `${id}-${String(index)}` })}
          />
          {link.caveat === undefined ? null : (
            <p id={`${id}-${String(index)}`} className="notice referral__caveat">
              <WarningMark />
              <span>{t(`call.caveats.${link.caveat}`)}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Who to call: the referral circuit, from the danger signs screen ("C'est
 * grave maintenant", with or without signs ticked, or straight from its
 * link) and from a result's danger banner. Opens at once, even before the
 * settings are read. The calls come first, right under the title, so that the
 * first one ends in the first screen of a small phone whatever the instruction
 * below says: each contact with its role, name and number shown as text, and
 * a large "Appeler" link that opens the phone's dialler (after a contact saved
 * from here, "Contact enregistré : ..." once); then the emergency numbers of
 * the country of use (state/country.ts) as call links, medical first
 * ("Appeler le SAMU (1515)"; or the deployment file's), with the country under
 * them and a quiet way to change it, shown at once, those the phone says
 * until the deployment file is read (while a finger is down, what is read
 * waits, so nothing moves under a tap). When no medical number is sure to
 * answer, where to go comes first ("Allez au poste de santé ou au centre de
 * santé le plus proche."): with none, the other numbers follow under "Autres
 * numéros (non médicaux)" ("Pompiers : 118"), none of them first; a number
 * that may not work from every network says so. With no number for a known
 * country, it says so, with "Changer le pays"; with no country, "Appelez le
 * numéro d'urgence de votre pays." and "Choisir le pays"; when the language
 * and the time zone of the phone name two countries, the question and both
 * countries, then "Autre pays". Never a guessed number. The first link is the
 * screen's primary action: the first contact, else the first medical number,
 * else the way to choose an unknown country, never a number that is not
 * medical. Then what to do: with a danger, the danger banner,
 * "Allez au poste de santé maintenant." from the danger signs screen (she said
 * it is serious now), the result's own instruction from a result; without a
 * danger, the orientation with its condition, as on the danger signs screen.
 * The banner is named "Danger : à montrer maintenant" when the result's danger
 * comes from a product and no sign was ticked, never "Signe de danger".
 * Then the signs ticked, to say when calling, and the products of a result's
 * danger ("Dites aussi ce qu'elle prend :"); then, under "Circuit de
 * référence", where to go: the built-in line (unless said first) and under it
 * the deployment's circuit text. Last, the contacts of the phone: "Aucun contact
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
  const { pack, packError, storageTimeoutMs, settings, setSettings } = useApp();
  const { unlocked, status } = useSession();
  const [, navigate] = useLocation();
  const [opened] = useState(openedWith);
  const [loaded, setLoaded] = useState<(LoadedReferral & { withSaved: boolean }) | null>(null);
  // While a finger is down on the screen, the circuit read meanwhile waits:
  // nothing moves or changes under a tap about to land.
  const held = useRef(false);
  const waiting = useRef<(LoadedReferral & { withSaved: boolean }) | null>(null);
  const showCircuit = useCallback((circuit: LoadedReferral & { withSaved: boolean }) => {
    if (held.current) waiting.current = circuit;
    else setLoaded(circuit);
  }, []);
  // A country just answered here: its first call takes the focus.
  const focusCall = useRef(false);
  const nationalId = useId();
  const othersId = useId();
  const askId = useId();
  // Read once when the screen opens, then forgotten: a later visit says nothing.
  const [justSaved] = useState(savedForCall);
  const announce = useLiveRegionReady();

  // A state left in another visit, or by a result before a lock, goes from the history.
  useEffect(() => {
    forgetStaleEntry();
    forgetSavedForCall();
  }, []);

  useEffect(() => {
    const release = () => {
      held.current = false;
      const circuit = waiting.current;
      waiting.current = null;
      if (circuit !== null) setLoaded(circuit);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  useEffect(() => {
    let live = true;
    // Never rejects: storage that cannot be read still lists the deployment's contacts.
    void loadReferral({
      readSaved: unlocked
        ? () => withTimeout(loadSavedContacts(), storageTimeoutMs)
        : () => Promise.resolve([]),
    }).then((result) => {
      if (live) showCircuit({ ...result, withSaved: unlocked });
    });
    return () => {
      live = false;
    };
  }, [storageTimeoutMs, unlocked, showCircuit]);

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
  // The country of use: the deployment's once its file is read, else the one
  // chosen, else what the phone says; its numbers show at once.
  const { country, source: countryFrom, ask } = useCountryOfUse(circuit?.country);
  const deployed = circuit?.emergencyNumbers;
  const numbers = deployed === undefined ? emergencyNumbersOf(country) : [];
  const medical = numbers.filter(({ service }) => isMedical(service));
  // The health post first when no medical number is sure to answer: none, or
  // one that may not work from every network.
  const healthPostFirst =
    deployed === undefined &&
    (medical.length === 0 || medical.some(({ caveat }) => caveat !== undefined));
  const countryName = country === null ? null : t(`countries.${country}`);
  // Fixed by the deployment: changing it here would change nothing.
  const changeable = countryFrom !== 'deployment';
  // No contact listed: the first action of the screen is ours. Only a medical
  // number, or the way to choose the country when none is known, may be it.
  const firstIsOurs = circuit !== null && contacts.length === 0;
  // Opened from here, the country screen comes back to this entry, banner and signs kept.
  const toCountry = inVisit({ [COUNTRY_BACK]: true });

  useEffect(() => {
    if (!focusCall.current) return;
    const call = document.querySelector<HTMLElement>('main .referral__emergency a');
    if (call === null) return;
    focusCall.current = false;
    call.focus();
  });

  const countryLine =
    countryName === null ? null : (
      <div className="referral__country">
        <p>{t('call.country', { country: countryName })}</p>
        {changeable ? (
          <Link
            className="button button--quiet referral__country-change"
            href={COUNTRY_PATH}
            state={toCountry}
          >
            {t('call.changeCountry')}
          </Link>
        ) : null}
      </div>
    );

  let calls;
  if (deployed !== undefined) {
    // The deployment's own numbers: they belong to no country of the list.
    calls = (
      <CallList
        links={deploymentLinks(deployed, lang, t)}
        label={t('call.emergencyLabel')}
        primary={firstIsOurs}
      />
    );
  } else if (medical.length > 0) {
    calls = (
      <>
        <CallList
          links={numbers.map((number) => dialLink(number, t))}
          label={t('call.emergencyLabel')}
          primary={firstIsOurs}
        />
        {countryLine}
      </>
    );
  } else if (numbers.length > 0) {
    // No medical number: the others, said as such, none of them first.
    calls = (
      <>
        <p id={othersId} className="referral__others">
          {t('call.otherNumbers')}
        </p>
        <CallList
          links={numbers.map((number) => otherLink(number, t))}
          labelledBy={othersId}
          primary={false}
        />
        {countryLine}
      </>
    );
  } else if (ask !== undefined) {
    // The language and the time zone name two countries: she says which.
    calls = (
      <div className="referral__ask" role="group" aria-labelledby={askId}>
        <p id={askId} className="referral__ask-question">
          {t('country.title')}
        </p>
        {ask.map((code) => (
          <Button
            key={code}
            variant="secondary"
            className="referral__choose"
            onClick={() => {
              focusCall.current = true;
              void setSettings({ country: code });
            }}
          >
            {t(`countries.${code}`)}
          </Button>
        ))}
        <Link
          className="button button--quiet referral__manage"
          href={COUNTRY_PATH}
          state={toCountry}
        >
          {t('call.otherCountry')}
        </Link>
      </div>
    );
  } else if (countryName !== null) {
    // A known country with no number the app can give: never a guessed one.
    calls = (
      <div className="referral__no-number">
        <p className="referral__call-country">{t('call.noConfirmed', { country: countryName })}</p>
        {changeable ? (
          <Link
            className="button button--secondary referral__choose"
            href={COUNTRY_PATH}
            state={toCountry}
          >
            {t('call.changeCountry')}
          </Link>
        ) : null}
      </div>
    );
  } else {
    calls = (
      <div className="referral__no-number">
        <p className="referral__call-country">{t('call.noNumber')}</p>
        <Link
          className={`button button--${firstIsOurs ? 'primary' : 'secondary'} referral__choose`}
          href={COUNTRY_PATH}
          state={toCountry}
        >
          {t('call.chooseCountry')}
        </Link>
      </div>
    );
  }

  return (
    <main
      className="screen referral"
      onPointerDown={() => {
        held.current = true;
      }}
    >
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

      {/* With no medical number sure to answer, where to go comes first. */}
      {healthPostFirst ? (
        <p className="orientation referral__go">{t('call.emergencyCircuit')}</p>
      ) : null}

      {/* Always, and at once (those of the country of use until the deployment
          file is read): the emergency numbers, medical first, so a danger
          never ends on no one to call; with no number for the country, what to
          do and the country to choose, never a guessed number. */}
      {calls}

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

      {/* Where to go: the built-in line (unless said first), and under it the deployment's circuit. */}
      {healthPostFirst && circuit?.nationalCircuit === undefined ? null : (
        <section className="referral__national" aria-labelledby={nationalId}>
          <h2 id={nationalId}>{t('call.circuit')}</h2>
          {healthPostFirst ? null : <p>{t('call.emergencyCircuit')}</p>}
          {circuit?.nationalCircuit === undefined ? null : (
            <p className="referral__deployed">{circuit.nationalCircuit[lang]}</p>
          )}
        </section>
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
