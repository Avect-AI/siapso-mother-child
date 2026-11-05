// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import {
  VOICE_PACK_OPTIONS,
  defaultVoiceLang,
  megabytes,
  type VoiceLang,
  type VoicePackOption,
} from '../config/voice.js';
import { failureMessage } from '../domain/voice-flow.js';
import { useLang, useT, type MessageKey } from '../i18n/index.js';
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

/** What the last action ended with, said once; a warning for what went wrong. */
function activityLine(activity: VoiceActivity): { key: MessageKey; warning: boolean } | null {
  switch (activity.kind) {
    case 'cancelled':
      return { key: 'voicePack.cancelled', warning: false };
    case 'failed':
      return { key: failureMessage(activity.failure), warning: true };
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
 * It says what the voice does and that it stays on the phone, offers the two
 * languages with their size (Wolof first; the interface language chosen at
 * first, French in English), advises wifi at the health post, and downloads
 * only on the install button, with its progress and a cancel. An installation
 * cut short keeps its files, to go on later or be removed. Once installed: how
 * to use it, and a removal asked twice. One voice at a time, to spare the
 * phone's storage. Opened from the search, it goes back there.
 */
export function VoicePack() {
  const t = useT();
  const lang = useLang();
  const { online } = useApp();
  const [, navigate] = useLocation();
  const { service, snapshot } = useVoice();
  // Read once: whether this entry was opened from the search.
  const [fromSearch] = useState(() => sessionState()['fromSearch'] === true);
  const [chosen, setChosen] = useState<VoiceLang>(() => defaultVoiceLang(lang));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const sectionStart = useRef<HTMLElement | null>(null);
  const markSection = (element: HTMLElement | null) => {
    sectionStart.current = element;
  };

  const size = (bytes: number) => t('voicePack.megabytes', { count: megabytes(bytes) });
  const { activity } = snapshot;
  const installed = installedPackOf(snapshot);
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

  const back = () => {
    if (fromSearch) window.history.back();
    else navigate('/');
  };
  const line = activityLine(activity);
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
    const option = optionOf(chosen);
    const stored = snapshot.packs?.find((pack) => pack.option.lang === chosen)?.storedBytes ?? 0;
    const busy = activity.kind === 'removing';
    body = (
      <section className="voice-pack__choose">
        <div ref={markSection} tabIndex={-1}>
          <RadioGroup<VoiceLang>
            legend={t('voicePack.language')}
            hint={t('voicePack.languageHint')}
            question
            options={VOICE_PACK_OPTIONS.map((candidate) => ({
              value: candidate.lang,
              label: t('voicePack.option', {
                language: t(`voicePack.languageName.${candidate.lang}`),
                size: size(candidate.bytes),
              }),
            }))}
            value={chosen}
            onChange={setChosen}
          />
        </div>
        <p className="meta">{t(`voicePack.model.${chosen}`)}</p>
        <p className="voice-pack__advice">{t('voicePack.advice', { size: size(option.bytes) })}</p>
        {online ? null : <Notice>{t('voicePack.offline')}</Notice>}
        {said}
        {stored > 0 ? (
          <p>{t('voicePack.partial', { stored: size(stored), size: size(option.bytes) })}</p>
        ) : null}
        <Button
          variant="primary"
          className="voice-pack__install"
          aria-disabled={busy ? true : undefined}
          onClick={() => {
            if (!busy) void service.install(chosen);
          }}
        >
          {stored > 0
            ? t('voicePack.resume')
            : t('voicePack.install', { languageIn: t(`voicePack.languageIn.${chosen}`) })}
        </Button>
        {stored > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              void service.remove(chosen);
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
