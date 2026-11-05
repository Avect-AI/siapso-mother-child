// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import {
  VOICE_PACK_OPTIONS,
  megabytes,
  type VoiceLang,
  type VoicePackOption,
} from '../config/voice.js';
import { installFailureMessage, installFailureOf } from '../domain/voice-flow.js';
import { useT, type MessageKey } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { sessionState } from '../state/entry-state.js';
import { Button } from '../ui/Button.js';
import { RadioGroup } from '../ui/ChoiceGroup.js';
import { Notice } from '../ui/Notice.js';
import { WarningMark } from '../ui/WarningMark.js';
import { useVoice } from '../voice/voice-context.js';
import { installedPackOf, type VoiceActivity } from '../voice/voice-service.js';

/** The voice screen's route. */
export const VOICE_PATH = '/voice';

function optionOf(lang: VoiceLang): VoicePackOption {
  const option = VOICE_PACK_OPTIONS.find((candidate) => candidate.lang === lang);
  if (option === undefined) throw new Error(`No voice pack for ${lang}`);
  return option;
}

/**
 * What the last action ended with, said once; a warning for what went wrong.
 * A failed installation says whether the voice did not come at all, came
 * damaged, or stopped with part of it kept (`storedBytes` of its pack).
 */
function activityLine(
  activity: VoiceActivity,
  storedBytes: (lang: VoiceLang) => number,
): { key: MessageKey; warning: boolean } | null {
  switch (activity.kind) {
    case 'cancelled':
      return { key: 'voicePack.cancelled', warning: false };
    case 'failed':
      return {
        key: installFailureMessage(installFailureOf(activity.failure, storedBytes(activity.lang))),
        warning: true,
      };
    case 'removed':
      return { key: 'voicePack.removed', warning: false };
    case 'remove-failed':
      return { key: 'voicePack.removeFailed', warning: true };
    default:
      return null;
  }
}

/**
 * The voice screen: the one place where the voice is installed or removed.
 * It says what the voice does and that it stays on the phone, asks the
 * language the names will be said in (Wolof first, each with its size; none
 * chosen for her, and changing later means downloading the other voice),
 * advises wifi at the health post, and downloads only on the install button,
 * with its progress and a cancel; offline, that button is off and the screen
 * says to connect. An installation cut short keeps its files, to go on later
 * or be removed. A failed installation says whether the voice did not come
 * (no Internet, or not on this server), came damaged, or stopped part way.
 * Once installed: how to use it, and a removal asked twice. One voice at a
 * time, to spare the phone's storage. Opened from the search, it goes back
 * there.
 */
export function VoicePack() {
  const t = useT();
  const { online } = useApp();
  const [, navigate] = useLocation();
  const { service, snapshot } = useVoice();
  const offlineId = useId();
  // Read once: whether this entry was opened from the search.
  const [fromSearch] = useState(() => sessionState()['fromSearch'] === true);
  // Never chosen for her: the language is her answer.
  const [chosen, setChosen] = useState<VoiceLang | null>(null);
  // The install button was pressed with no language chosen: the question says so.
  const [asked, setAsked] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const sectionStart = useRef<HTMLElement | null>(null);
  const markSection = (element: HTMLElement | null) => {
    sectionStart.current = element;
  };

  const size = (bytes: number) => t('voicePack.megabytes', { count: megabytes(bytes) });
  const { activity } = snapshot;
  const installed = installedPackOf(snapshot);
  const storedOf = (lang: VoiceLang) =>
    snapshot.packs?.find((pack) => pack.option.lang === lang)?.storedBytes ?? 0;
  // An installation cut short was her choice: it is the one to go on with.
  const partial = VOICE_PACK_OPTIONS.find((option) => storedOf(option.lang) > 0)?.lang ?? null;
  const language = chosen ?? partial;
  const section = !snapshot.supported
    ? 'unsupported'
    : snapshot.packageFailed
      ? 'failed'
      : snapshot.packs === null
        ? 'checking'
        : activity.kind === 'installing'
          ? 'installing'
          : installed !== undefined
            ? 'installed'
            : 'choose';

  // A new part of the screen (installing, installed, back to the choice) takes
  // the focus: the button pressed is gone.
  const shown = useRef(section);
  useEffect(() => {
    if (shown.current === section) return;
    const previous = shown.current;
    shown.current = section;
    if (previous !== 'checking') sectionStart.current?.focus();
  }, [section]);

  // Install pressed with no language: the first answer takes the focus, with the question's error.
  useEffect(() => {
    if (asked === 0) return;
    sectionStart.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [asked]);

  const back = () => {
    if (fromSearch) window.history.back();
    else navigate('/');
  };
  const line = activityLine(activity, storedOf);
  const said = (
    <p className={line?.warning ? 'voice-pack__said notice' : 'voice-pack__said'} role="status">
      {line?.warning ? <WarningMark /> : null}
      {line === null ? '' : <span>{t(line.key)}</span>}
    </p>
  );

  let body: ReactNode;
  let backIsPrimary = true;
  if (section === 'unsupported') {
    body = <Notice>{t('voicePack.unsupported')}</Notice>;
  } else if (section === 'failed') {
    body = <Notice>{t('voicePack.packageFailed')}</Notice>;
  } else if (section === 'checking') {
    body = <p role="status">{t('voicePack.checking')}</p>;
  } else if (section === 'installing' && activity.kind === 'installing') {
    const languageIn = t(`voicePack.languageIn.${activity.lang}`);
    const total = activity.total > 0 ? activity.total : optionOf(activity.lang).bytes;
    const percent = Math.min(100, Math.floor((activity.loaded / total) * 100));
    body = (
      <section className="voice-pack__installing">
        <h2 ref={markSection} tabIndex={-1}>
          {t('voicePack.installing', { languageIn })}
        </h2>
        <progress
          className="voice-pack__progress"
          max={total}
          value={activity.loaded}
          aria-label={t('voicePack.progressLabel')}
        />
        <p className="voice-pack__amount">
          {t('voicePack.progress', {
            loaded: size(activity.loaded),
            size: size(total),
            percent,
          })}
        </p>
        <p className="meta">{t('voicePack.keepOpen')}</p>
        <Button variant="secondary" onClick={service.cancelInstall}>
          {t('voicePack.cancel')}
        </Button>
      </section>
    );
  } else if (section === 'installed' && installed?.installed != null) {
    const pack = installed.option;
    const languageIn = t(`voicePack.languageIn.${pack.lang}`);
    body = (
      <section className="voice-pack__installed">
        <p className="voice-pack__done" ref={markSection} tabIndex={-1}>
          {t('voicePack.installed', { languageIn, size: size(pack.bytes) })}
        </p>
        <p>{t('voicePack.ready')}</p>
        <p className="meta">{t(`voicePack.model.${pack.lang}`)}</p>
        <p className="meta">{t('voicePack.oneAtATime')}</p>
        {confirmRemove ? (
          <div className="voice-pack__confirm">
            <p>{t('voicePack.removeConfirm', { size: size(pack.bytes) })}</p>
            <div className="voice-pack__actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmRemove(false);
                  void service.remove(pack.lang);
                }}
              >
                {t('voicePack.removeYes')}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setConfirmRemove(false);
                }}
              >
                {t('voicePack.removeNo')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              setConfirmRemove(true);
            }}
          >
            {t('voicePack.remove', { languageIn })}
          </Button>
        )}
      </section>
    );
  } else {
    backIsPrimary = false;
    const option = language === null ? undefined : optionOf(language);
    const stored = language === null ? 0 : storedOf(language);
    const busy = activity.kind === 'removing';
    // Offline, nothing can be downloaded: the button is off and says why.
    const off = busy || !online;
    let install = t('voicePack.installPlain');
    if (stored > 0) install = t('voicePack.resume');
    else if (language !== null) {
      install = t('voicePack.install', { languageIn: t(`voicePack.languageIn.${language}`) });
    }
    body = (
      <section className="voice-pack__choose">
        <div ref={markSection} tabIndex={-1}>
          <RadioGroup<VoiceLang>
            legend={t('voicePack.language')}
            hint={t('voicePack.languageHint')}
            error={asked > 0 && language === null ? t('voicePack.chooseLanguage') : undefined}
            question
            options={VOICE_PACK_OPTIONS.map((candidate) => ({
              value: candidate.lang,
              label: t('voicePack.option', {
                language: t(`voicePack.languageName.${candidate.lang}`),
                size: size(candidate.bytes),
              }),
            }))}
            value={language}
            onChange={setChosen}
          />
        </div>
        {language === null ? null : <p className="meta">{t(`voicePack.model.${language}`)}</p>}
        <p className="voice-pack__advice">
          {option === undefined
            ? t('voicePack.adviceNoSize')
            : t('voicePack.advice', { size: size(option.bytes) })}
        </p>
        {online ? null : <Notice id={offlineId}>{t('voicePack.offline')}</Notice>}
        {said}
        {stored > 0 && option !== undefined ? (
          <p>{t('voicePack.partial', { stored: size(stored), size: size(option.bytes) })}</p>
        ) : null}
        <Button
          variant="primary"
          className="voice-pack__install"
          aria-disabled={off ? true : undefined}
          aria-describedby={online ? undefined : offlineId}
          onClick={() => {
            if (off) return;
            if (language === null) setAsked((n) => n + 1);
            else void service.install(language);
          }}
        >
          {install}
        </Button>
        {stored > 0 && language !== null ? (
          <Button
            variant="secondary"
            onClick={() => {
              void service.remove(language);
            }}
          >
            {t('voicePack.removePartial')}
          </Button>
        ) : null}
      </section>
    );
  }

  return (
    <main className="screen voice-pack">
      <h1 tabIndex={-1}>{t('voicePack.title')}</h1>
      <p>{t('voicePack.lead')}</p>
      <p className="voice-pack__privacy">{t('voicePack.privacy')}</p>
      {body}
      {section === 'choose' ? null : said}
      <Button
        variant={backIsPrimary ? 'primary' : 'secondary'}
        className="voice-pack__back"
        onClick={back}
      >
        {t(fromSearch ? 'voicePack.back' : 'settings.done')}
      </Button>
    </main>
  );
}
