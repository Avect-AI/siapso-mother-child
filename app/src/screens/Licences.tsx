// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef } from 'react';
import { useLocation } from 'wouter';
import {
  APACHE_2_0,
  MIT_TEXT,
  VOICE_DATA,
  VOICE_MODELS,
  VOICE_SOFTWARE,
  type ThirdParty,
} from '../domain/third-party.js';
import { useT, type MessageKey } from '../i18n/index.js';
import { Button } from '../ui/Button.js';

function Entries({ title, entries }: { title: MessageKey; entries: readonly ThirdParty[] }) {
  const t = useT();
  const id = useId();
  return (
    <section className="about__section" aria-labelledby={id}>
      <h2 id={id}>{t(title)}</h2>
      <ul className="licences__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className="licences__name">
              {entry.version === undefined ? entry.name : `${entry.name} ${entry.version}`}
            </span>
            {entry.licence === null ? null : (
              <span>{t('licences.licence', { licence: entry.licence })}</span>
            )}
            {entry.copyright === undefined ? null : <span>{entry.copyright}</span>}
            {entry.note === undefined ? null : <span>{t(`licences.note.${entry.note}`)}</span>}
            <span className="meta licences__source">
              {t('licences.source', { source: entry.source })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The third-party licences, reached from About: the software the speech
 * worker bundles, the models of the voice packs and the data of the Wolof
 * model, each with its licence (speech/LICENSES.md), then the full texts of
 * the Apache 2.0 and MIT licences, folded, in English as written. No profile
 * data, so it opens locked or not; addresses are text, links need the
 * Internet. Its own chunk (App.tsx), so the texts are not in the first load.
 */
export function Licences() {
  const t = useT();
  const [, navigate] = useLocation();
  const textsId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Loaded apart (App.tsx): the title takes the focus once it is there, as a new screen's does.
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main className="screen about licences">
      <h1 ref={heading} tabIndex={-1}>
        {t('licences.title')}
      </h1>
      <p>{t('licences.lead')}</p>
      <Entries title="licences.softwareTitle" entries={VOICE_SOFTWARE} />
      <Entries title="licences.modelsTitle" entries={VOICE_MODELS} />
      <section className="about__section" aria-labelledby={`${textsId}-data`}>
        <h2 id={`${textsId}-data`}>{t('licences.dataTitle')}</h2>
        <p className="meta">{t('licences.dataLead')}</p>
        <ul className="licences__list">
          {VOICE_DATA.map((entry) => (
            <li key={entry.id}>
              <span className="licences__name">{entry.name}</span>
              {entry.licence === null ? null : (
                <span>{t('licences.licence', { licence: entry.licence })}</span>
              )}
              {entry.note === undefined ? null : <span>{t(`licences.note.${entry.note}`)}</span>}
              <span className="meta licences__source">
                {t('licences.source', { source: entry.source })}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="about__section" aria-labelledby={textsId}>
        <h2 id={textsId}>{t('licences.textsTitle')}</h2>
        <p>{t('licences.textsLead')}</p>
        <details className="licences__text">
          <summary>Apache License 2.0</summary>
          <pre lang="en">{APACHE_2_0}</pre>
        </details>
        <details className="licences__text">
          <summary>MIT License</summary>
          <pre lang="en">{MIT_TEXT}</pre>
        </details>
      </section>
      <Button
        variant="primary"
        className="about__done"
        onClick={() => {
          navigate('/about');
        }}
      >
        {t('licences.back')}
      </Button>
    </main>
  );
}
