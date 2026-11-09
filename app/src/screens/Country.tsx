// SPDX-License-Identifier: MIT
import { useState } from 'react';
import { useLocation } from 'wouter';
import { COUNTRIES, type CountryCode } from '../config/emergency.js';
import { searchKey, type CountryChoice } from '../domain/country.js';
import { translate, useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { useCountryOfUse } from '../state/country.js';
import { visitState } from '../state/entry-state.js';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';

/** The route of the country of use, from who to call and the settings. */
export const COUNTRY_PATH = '/country';

/**
 * The key left on the history entry of the country screen by the screen that
 * opened it (who to call, the settings): choosing goes back to that screen,
 * the same entry, its danger and signs kept.
 */
export const COUNTRY_BACK = 'countryBack';

/** The place of a country in the list: the ones the phone names first, in their order. */
function rankOf(suggested: readonly CountryCode[], code: CountryCode): number {
  const index = suggested.indexOf(code);
  return index === -1 ? suggested.length : index;
}

/**
 * The country of use: the countries of the emergency numbers file
 * (config/emergency-numbers.json) by name, in the language of the screen
 * (first, when the phone's language and time zone name two countries, those
 * two, "Selon le téléphone"), a search field over their names in both
 * languages (without case or accents), then "Mon pays n'est pas dans la
 * liste". Each country is a
 * whole-width answer: one tap keeps it in the settings (it says nothing about
 * a profile: locked too, before the welcome too) and goes back, so who to
 * call shows its numbers at once. Opens at once, offline, without the code.
 */
export function Country() {
  const t = useT();
  const lang = useLang();
  const { settings, setSettings } = useApp();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState('');
  // Read once: the entry it was opened on says where to go back.
  const [back] = useState(() => visitState()[COUNTRY_BACK] === true);
  // The two countries the phone names, when its language and time zone disagree.
  const { ask } = useCountryOfUse();
  const suggested: readonly CountryCode[] = ask ?? [];

  const other = lang === 'fr' ? 'en' : 'fr';
  const collator = new Intl.Collator(lang, { sensitivity: 'base' });
  const countries = COUNTRIES.map(({ code }) => ({
    code,
    name: t(`countries.${code}`),
    // Found by its name in the other language too ("Cabo Verde", "Cap-Vert").
    otherName: translate(other, `countries.${code}`),
  })).sort(
    (a, b) =>
      rankOf(suggested, a.code) - rankOf(suggested, b.code) || collator.compare(a.name, b.name),
  );
  const wanted = searchKey(filter);
  const shown =
    wanted === ''
      ? countries
      : countries.filter(
          ({ name, otherName }) =>
            searchKey(name).includes(wanted) || searchKey(otherName).includes(wanted),
        );

  const choose = (choice: CountryChoice) => {
    // The screen follows at once; storage never holds it up.
    void setSettings({ country: choice });
    if (back) window.history.back();
    else navigate('/', { replace: true });
  };

  // The space keeps the words apart when read aloud ("Ghana Pays choisi").
  const chosenMark = (choice: CountryCode | 'other') =>
    settings.country === choice ? (
      <>
        {' '}
        <span className="country__status">{t('country.chosen')}</span>
      </>
    ) : null;

  return (
    <main className="screen country">
      <div className="country__intro">
        <h1 tabIndex={-1}>{t('country.title')}</h1>
        <p>{t('country.lead')}</p>
      </div>
      <TextField
        type="search"
        className="country__search"
        label={t('country.search')}
        hint={t('country.searchHint')}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
        onKeyDown={(event) => {
          // The keyboard's search key closes the keyboard: the rows it hid show.
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {/* There from the start, so a screen reader says "none" when it comes. */}
      <p className={shown.length === 0 ? 'country__empty' : 'sr-only'} role="status">
        {shown.length === 0 ? t('country.noMatch') : ''}
      </p>
      {shown.length === 0 ? null : (
        <ul className="country__list" aria-label={t('country.listLabel')}>
          {shown.map(({ code, name }) => (
            <li key={code}>
              <Button
                variant="secondary"
                className="country__choice"
                aria-current={settings.country === code ? 'true' : undefined}
                onClick={() => {
                  choose(code);
                }}
              >
                <span className="country__label">
                  <span className="country__name">{name}</span>
                  {chosenMark(code)}
                  {suggested.includes(code) ? (
                    <>
                      {' '}
                      <span className="country__status">{t('country.suggested')}</span>
                    </>
                  ) : null}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="secondary"
        className="country__choice country__other"
        aria-current={settings.country === 'other' ? 'true' : undefined}
        onClick={() => {
          choose('other');
        }}
      >
        <span className="country__label">
          <span className="country__name">{t('country.other')}</span>
          {chosenMark('other')}
        </span>
      </Button>
    </main>
  );
}
