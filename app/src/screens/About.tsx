// SPDX-License-Identifier: MIT
import { useLocation } from 'wouter';
import { REPOSITORY_URL } from '../domain/repository.js';
import { useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Button } from '../ui/Button.js';

/** Only web addresses become links: a source address is data from the pack. */
function isWebAddress(url: string): boolean {
  return /^https?:\/\//.test(url);
}

/**
 * About: what the app is for (the intended use shared with the README and the
 * medical disclaimer), the fixed sentence, the licences, the sources the pack
 * declares, the third-party software, and where the code is. No profile data,
 * so it opens locked or not. There is no contact line: none exists yet.
 */
export function About() {
  const t = useT();
  const { pack, packOrigin, acceptsUnsigned } = useApp();
  const [, navigate] = useLocation();

  return (
    <main className="screen about">
      <h1 tabIndex={-1}>{t('about.title')}</h1>
      {/* A test or demo build, or an unsigned base: said here too, since About is
          where the app describes itself. */}
      {acceptsUnsigned || packOrigin?.signed === false ? (
        <p className="status__unsigned">{t('status.unsigned')}</p>
      ) : null}
      <section className="about__section" aria-labelledby="about-use">
        <h2 id="about-use">{t('about.intendedUseTitle')}</h2>
        <p>{t('about.intendedUse')}</p>
        <p className="about__fixed">{t('home.closing')}</p>
      </section>
      <section className="about__section" aria-labelledby="about-licences">
        <h2 id="about-licences">{t('about.licencesTitle')}</h2>
        <ul>
          <li>{t('about.licenceCode')}</li>
          <li>{t('about.licenceContent')}</li>
          <li>{t('about.licenceFont')}</li>
        </ul>
      </section>
      <section className="about__section" aria-labelledby="about-sources">
        <h2 id="about-sources">{t('about.sourcesTitle')}</h2>
        {pack === null ? (
          <p>{t('about.sourcesNone')}</p>
        ) : pack.sources.length === 0 ? (
          <p>{t('about.sourcesEmpty')}</p>
        ) : (
          <>
            <p>{t('about.sourcesLead')}</p>
            {/* Offline, a link opens the browser's error page: say so before. */}
            {pack.sources.some((source) => isWebAddress(source.url)) ? (
              <p>{t('offline.linksNeedInternet')}</p>
            ) : null}
            <ul aria-label={t('about.sourcesTitle')} className="about__sources">
              {pack.sources.map((source) => (
                <li key={source.id}>
                  {isWebAddress(source.url) ? (
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.name}
                      <span className="sr-only"> {t('about.newWindow')}</span>
                    </a>
                  ) : (
                    <span>{source.name}</span>
                  )}
                  <span className="meta">
                    <span>{t('about.sourceLicence', { licence: source.licence })}</span>
                    {source.version === undefined ? null : (
                      <span>{t('about.sourceVersion', { version: source.version })}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="about__section" aria-labelledby="about-third">
        <h2 id="about-third">{t('about.thirdPartyTitle')}</h2>
        <ul>
          <li>{t('about.thirdTransformers')}</li>
        </ul>
      </section>
      <section className="about__section" aria-labelledby="about-code">
        <h2 id="about-code">{t('about.repositoryTitle')}</h2>
        <p className="about__address">{REPOSITORY_URL}</p>
        <p>{t('about.repositoryPrivate')}</p>
      </section>
      <a className="button button--secondary about__status" href="#/status">
        {t('nav.status')}
      </a>
      <Button
        variant="primary"
        className="about__done"
        onClick={() => {
          navigate('/');
        }}
      >
        {t('settings.done')}
      </Button>
    </main>
  );
}
