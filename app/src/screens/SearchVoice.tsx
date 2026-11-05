// SPDX-License-Identifier: MIT
// The voice parts of the search screen: the microphone button beside the
// field, the panel that says where the voice is (opening, listening with the
// seconds, thinking, what it heard, what went wrong), and the whole list of
// a kind to choose from when a name finds nothing.
import type { EntryKind } from '@siapso/resolver';
import { useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { MAX_RECORDING_SECONDS, type VoiceLang } from '../config/voice.js';
import { browseEntriesOf, browseGroupsOf, type BrowseEntry } from '../domain/search-index.js';
import { failureMessage, type VoiceState } from '../domain/voice-flow.js';
import { useLang, useT } from '../i18n/index.js';
import { useApp } from '../state/app-state.js';
import { Button } from '../ui/Button.js';
import { Chevron } from '../ui/Chevron.js';
import { FinishMark, MicMark } from '../ui/MicMark.js';
import { WarningMark } from '../ui/WarningMark.js';

/**
 * The microphone: a large square button beside the field. Recording, it
 * fills, a ring pulses around it (still under reduced motion) and it says
 * that a tap finishes; opening or thinking, it waits (aria-disabled, so the
 * focus stays on it).
 */
export function MicButton({ state, onPress }: { state: VoiceState; onPress: () => void }) {
  const t = useT();
  const recording = state.step === 'recording';
  const waiting = state.step === 'starting' || state.step === 'transcribing';
  return (
    <button
      type="button"
      className={recording ? 'mic mic--recording' : 'mic'}
      aria-label={t(recording ? 'voice.micFinish' : 'voice.mic')}
      aria-disabled={waiting ? true : undefined}
      onClick={onPress}
    >
      {recording ? <FinishMark /> : <MicMark />}
    </button>
  );
}

export interface VoicePanelActions {
  onCancel: () => void;
  /** Back to the keyboard: the field takes the focus. */
  onType: () => void;
  /** The whole list of the kind searched. */
  onBrowse: () => void;
  /** The voice screen, to install the voice again. */
  onInstall: () => void;
}

/**
 * Where the voice is, in words: one live line (read once by a screen
 * reader), then what goes with it. The seconds are for the eye: a screen
 * reader hears that the recording ends by itself.
 */
export function VoicePanel({
  state,
  kind,
  language,
  actions,
}: {
  state: VoiceState;
  kind: EntryKind;
  /** The language the installed voice understands, said while it listens. */
  language: VoiceLang | undefined;
  actions: VoicePanelActions;
}) {
  const t = useT();
  let message: ReactNode = '';
  let warning = false;
  let details: ReactNode = null;
  let cancel = false;
  const typeButton = (
    <Button variant="secondary" className="voice__type" onClick={actions.onType}>
      {t('voice.type')}
    </Button>
  );

  switch (state.step) {
    case 'idle':
      break;
    case 'starting':
      message = t('voice.opening');
      cancel = true;
      break;
    case 'recording':
      message =
        language === undefined
          ? t('voice.listeningPlain')
          : t('voice.listening', { languageIn: t(`voicePack.languageIn.${language}`) });
      cancel = true;
      details = (
        <>
          <p>{t('voice.listeningHow')}</p>
          <p className="voice__seconds" aria-hidden="true">
            {t('voice.seconds', { count: state.seconds, max: MAX_RECORDING_SECONDS })}
          </p>
          <p className="meta">{t('voice.autoEnd', { max: MAX_RECORDING_SECONDS })}</p>
        </>
      );
      break;
    case 'transcribing':
      message = t('voice.thinking');
      cancel = true;
      details = <p className="meta">{t('voice.thinkingHint')}</p>;
      break;
    case 'heard':
      message = t('voice.heard', { text: state.text });
      break;
    case 'heard-none':
      message =
        state.text === '' ? t('voice.heardNothing') : t('voice.heard', { text: state.text });
      details = (
        <>
          {/* What is wrong first, then what to do; the results below do not say it again. */}
          <p className="voice__none">
            {t(kind === 'product' ? 'search.noneFound' : 'search.noneFoundPlant')}
          </p>
          <p>{t('voice.noneHint')}</p>
          <div className="voice__actions">
            {typeButton}
            <Button variant="secondary" className="voice__browse" onClick={actions.onBrowse}>
              {t(kind === 'product' ? 'voice.chooseProduct' : 'voice.choosePlant')}
            </Button>
          </div>
        </>
      );
      break;
    case 'error':
      message = t(failureMessage(state.failure));
      warning = true;
      details = (
        <div className="voice__actions">
          {state.failure === 'unavailable' ? (
            <Button variant="secondary" onClick={actions.onInstall}>
              {t('voice.install')}
            </Button>
          ) : null}
          {typeButton}
        </div>
      );
      break;
    case 'denied':
      message = t('voice.denied');
      warning = true;
      details = (
        <>
          <p>{t('voice.deniedHow')}</p>
          <div className="voice__actions">{typeButton}</div>
        </>
      );
      break;
    case 'cancelled':
      message = t('voice.cancelled');
      break;
  }

  return (
    <div className={state.step === 'idle' ? 'voice voice--idle' : 'voice'}>
      {/* Always in the page, so its first words are read when they appear. */}
      <p className={warning ? 'voice__status notice' : 'voice__status'} role="status">
        {warning ? <WarningMark /> : null}
        {warning ? <span>{message}</span> : message}
      </p>
      {details}
      {cancel ? (
        <Button variant="secondary" className="voice__cancel" onClick={actions.onCancel}>
          {t('voice.cancel')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Every remedy, or every medicine family, to choose from when a name finds
 * nothing, by first letter (a heading each, so a screen reader goes from
 * letter to letter), each with its local names (the Wolof name she said is
 * found again). Each opens its confirm screen, as a candidate does: nothing
 * is added from here. The heading takes the focus, so a screen reader starts
 * with what the list is.
 */
export function BrowseList({
  kind,
  onChoose,
}: {
  kind: EntryKind;
  onChoose: (entry: BrowseEntry) => void;
}) {
  const t = useT();
  const lang = useLang();
  const { pack } = useApp();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const groups = useMemo(
    () => (pack === null ? [] : browseGroupsOf(browseEntriesOf(pack, kind, lang))),
    [pack, kind, lang],
  );
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="search__browse" aria-labelledby={id}>
      <h2 id={id} ref={heading} tabIndex={-1}>
        {t(kind === 'product' ? 'voice.listProduct' : 'voice.listPlant')}
      </h2>
      {groups.map((group) => (
        <div className="search__letter" key={group.letter}>
          <h3 id={`${id}-${group.letter}`}>{group.letter}</h3>
          <ul className="candidates" aria-labelledby={`${id}-${group.letter}`}>
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="candidate"
                  onClick={() => {
                    onChoose(entry);
                  }}
                >
                  <span className="candidate__text">
                    <span className="candidate__name">{entry.name}</span>
                    {entry.local.map((local) => (
                      <span className="candidate__local" key={local.lang}>
                        {t('search.localName', {
                          name: local.names.join(', '),
                          lang: t(`nameLang.${local.lang}`),
                        })}
                      </span>
                    ))}
                    {entry.detail === undefined ? null : (
                      <span className="candidate__detail">{entry.detail}</span>
                    )}
                  </span>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
