// SPDX-License-Identifier: MIT
import type { Lang } from '@siapso/engine';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import type { CountryCode } from '../config/emergency.js';
import { fetchDeploymentReferral } from '../data/referral.js';
import type { Mode } from '../domain/types.js';
import { translate, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCountryOfUse } from '../state/country.js';
import { inVisit } from '../state/entry-state.js';
import { useSession } from '../state/session.js';
import { Button } from '../ui/Button.js';
import { RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { COUNTRY_BACK, COUNTRY_PATH } from './Country.js';

type Group = 'lang' | 'mode';

/**
 * Settings: the language, at any time, and, once the code is given, the mode.
 * The mode in use says who the phone is for, so it never shows behind the
 * code. Each question is a group of native radios, and a choice applies only
 * with the button that appears under its group once the answer differs from
 * the one in use ("Switch to English", said in the language it switches to;
 * "Changer de mode"): the arrow keys move through the answers and select them,
 * as WAI-ARIA and screen readers expect of radios, and selecting changes
 * nothing yet (WCAG 3.2.2, On Input), so exploring the answers never turns the
 * app into English or into the other mode. An applied choice is stored and
 * said ("Réglage enregistré."), and the focus goes back to the answer chosen;
 * changing the mode never deletes a profile, a check or a contact (woman mode
 * opens the first profile made, the others stay on the phone). Then, at any
 * time too, the country of use, whose emergency numbers who to call shows
 * ("Pays : Sénégal", domain/country.ts), with a way to the country screen;
 * none when the deployment file fixes it. It links to the knowledge base
 * status, the about screen and the voice screen (install the voice at the
 * health post), which need no code. The one primary action goes back to the
 * start.
 */
export function Settings() {
  const t = useT();
  const { settings, setSettings, settingsUnavailable } = useApp();
  const { unlocked } = useSession();
  const [, navigate] = useLocation();
  const [changed, setChanged] = useState(false);
  // The answers chosen and not applied yet (null: the one in use).
  const [pendingLang, setPendingLang] = useState<Lang | null>(null);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const langGroup = useRef<HTMLDivElement>(null);
  const modeGroup = useRef<HTMLDivElement>(null);
  // The group whose choice was just applied: its button is gone, the focus goes to its answer.
  const focusAfter = useRef<Group | null>(null);
  // The deployment file's country, once read: it comes before any other.
  const [deployed, setDeployed] = useState<CountryCode | undefined>(undefined);
  const { country, source, ask } = useCountryOfUse(deployed);
  const countryLineId = useId();

  useEffect(() => {
    let live = true;
    // Never rejects: no file, offline without a copy, or too slow, is no country.
    void fetchDeploymentReferral().then(({ country: fixed }) => {
      if (live) setDeployed(fixed);
    });
    return () => {
      live = false;
    };
  }, []);

  const countryName =
    country !== null
      ? t(`countries.${country}`)
      : source === 'chosen'
        ? t('country.otherName')
        : ask !== undefined
          ? t('country.toChoose')
          : t('country.unknown');

  const langToApply = pendingLang !== null && pendingLang !== settings.lang ? pendingLang : null;
  const modeToApply = pendingMode !== null && pendingMode !== settings.mode ? pendingMode : null;
  // While a choice waits, applying it is the screen's one primary action (the
  // first one when both wait): the way back, which would leave it, steps down.
  const primary: Group | 'done' =
    langToApply !== null ? 'lang' : modeToApply !== null ? 'mode' : 'done';
  const variantOf = (group: Group | 'done') => (primary === group ? 'primary' : 'secondary');

  // A new answer clears what the last choice said, so the next one is said again.
  const pickLang = (lang: Lang) => {
    setChanged(false);
    setPendingLang(lang);
  };
  const pickMode = (mode: Mode) => {
    setChanged(false);
    setPendingMode(mode);
  };

  useEffect(() => {
    const group = focusAfter.current;
    if (group === null) return;
    focusAfter.current = null;
    const container = group === 'lang' ? langGroup.current : modeGroup.current;
    container?.querySelector<HTMLInputElement>('input:checked')?.focus();
  });

  const apply = (patch: { lang: Lang } | { mode: Mode }, group: Group) => {
    setChanged(true);
    if (group === 'lang') setPendingLang(null);
    else setPendingMode(null);
    focusAfter.current = group;
    void setSettings(patch);
  };

  return (
    <main className="screen settings">
      <h1 tabIndex={-1}>{t('settings.title')}</h1>
      {settingsUnavailable ? <Notice>{t('settings.unavailable')}</Notice> : null}
      <div ref={langGroup} className="settings__group">
        <RadioGroup<Lang>
          legend={t('settings.language')}
          // Each language named in itself, as on the welcome screen.
          options={[
            { value: 'fr', label: translate('fr', 'language.fr'), lang: 'fr' },
            { value: 'en', label: translate('en', 'language.en'), lang: 'en' },
          ]}
          value={pendingLang ?? settings.lang}
          onChange={pickLang}
        />
        {langToApply === null ? null : (
          <Button
            variant={variantOf('lang')}
            className="settings__apply"
            // Said in the language it switches to, which she can read.
            lang={langToApply}
            onClick={() => {
              apply({ lang: langToApply }, 'lang');
            }}
          >
            {translate(langToApply, 'settings.applyLanguage')}
          </Button>
        )}
      </div>
      {unlocked ? (
        <div ref={modeGroup} className="settings__group">
          <RadioGroup<Mode>
            legend={t('settings.mode')}
            hint={`${t('settings.modeHint')} ${t('settings.modeWomanNote')}`}
            options={[
              { value: 'woman', label: t('welcome.modeWoman') },
              { value: 'accompanied', label: t('welcome.modeAccompanied') },
            ]}
            value={pendingMode ?? settings.mode}
            onChange={pickMode}
          />
          {modeToApply === null ? null : (
            <Button
              variant={variantOf('mode')}
              className="settings__apply"
              onClick={() => {
                apply({ mode: modeToApply }, 'mode');
              }}
            >
              {t('settings.applyMode')}
            </Button>
          )}
        </div>
      ) : null}
      {/* The country of use: it says nothing about a profile, locked too. */}
      <div className="settings__group settings__country">
        <p id={countryLineId} className="settings__country-name">
          {t('call.country', { country: countryName })}
        </p>
        <p className="settings__country-hint">
          {source === 'deployment'
            ? t('settings.countryFixed')
            : country === null
              ? t('country.lead')
              : t('settings.countryHint')}
        </p>
        {source === 'deployment' ? null : (
          <Link
            className="button button--secondary settings__country-change"
            href={COUNTRY_PATH}
            state={inVisit({ [COUNTRY_BACK]: true })}
            aria-describedby={countryLineId}
          >
            {country === null && source === null
              ? t('call.chooseCountry')
              : t('call.changeCountry')}
          </Link>
        )}
      </div>
      <p className="settings__status" role="status">
        {changed ? t('settings.changed') : ''}
      </p>
      <div className="settings__more">
        <a className="button button--secondary" href="#/status">
          {t('nav.status')}
        </a>
        <a className="button button--secondary" href="#/about">
          {t('nav.about')}
        </a>
        <a className="button button--secondary" href="#/voice">
          {t('nav.voice')}
        </a>
      </div>
      <Button
        variant={variantOf('done')}
        className="settings__done"
        onClick={() => {
          navigate('/');
        }}
      >
        {t('settings.done')}
      </Button>
    </main>
  );
}
