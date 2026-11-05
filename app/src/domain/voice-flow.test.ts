// SPDX-License-Identifier: MIT
import type { VoicePackErrorReason } from '@siapso/speech';
import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/translate.js';
import {
  IDLE,
  INSTALL_FAILURES,
  VOICE_FAILURES,
  cleanTranscript,
  failureMessage,
  failureOf,
  installFailureMessage,
  installFailureOf,
  isBusy,
  voiceFlow,
  type InstallFailure,
  type VoiceEvent,
  type VoiceState,
} from './voice-flow.js';

/** The state after `events`, from idle. */
function after(...events: VoiceEvent[]): VoiceState {
  return events.reduce(voiceFlow, IDLE);
}

const recording: VoiceEvent[] = [{ type: 'start' }, { type: 'started' }];
const transcribing: VoiceEvent[] = [...recording, { type: 'stop' }];

describe('voiceFlow', () => {
  it('starts idle', () => {
    expect(IDLE).toEqual({ step: 'idle' });
  });

  it('opens the microphone, then records with the elapsed seconds', () => {
    expect(after({ type: 'start' })).toEqual({ step: 'starting' });
    expect(after(...recording)).toEqual({ step: 'recording', seconds: 0 });
    expect(after(...recording, { type: 'tick', seconds: 3 })).toEqual({
      step: 'recording',
      seconds: 3,
    });
  });

  it('transcribes once the recording ends (a tap, or 8 seconds)', () => {
    expect(after(...transcribing)).toEqual({ step: 'transcribing' });
  });

  it('says what it heard, with candidates to confirm', () => {
    expect(after(...transcribing, { type: 'heard', text: 'nebeday', candidates: 1 })).toEqual({
      step: 'heard',
      text: 'nebeday',
    });
  });

  it('says what it heard when no candidate matches it', () => {
    expect(after(...transcribing, { type: 'heard', text: 'xyzzy', candidates: 0 })).toEqual({
      step: 'heard-none',
      text: 'xyzzy',
    });
    // Nothing heard at all (silence, noise).
    expect(after(...transcribing, { type: 'heard', text: '', candidates: 0 })).toEqual({
      step: 'heard-none',
      text: '',
    });
  });

  it('says the microphone was refused', () => {
    expect(after({ type: 'start' }, { type: 'denied' })).toEqual({ step: 'denied' });
  });

  it('says what failed, while opening, recording or transcribing', () => {
    const failed: VoiceEvent = { type: 'failed', failure: 'no-microphone' };
    expect(after({ type: 'start' }, failed)).toEqual({ step: 'error', failure: 'no-microphone' });
    expect(after(...recording, failed)).toEqual({ step: 'error', failure: 'no-microphone' });
    expect(after(...transcribing, { type: 'failed', failure: 'transcribe' })).toEqual({
      step: 'error',
      failure: 'transcribe',
    });
  });

  it('cancels while opening, recording or transcribing', () => {
    expect(after({ type: 'start' }, { type: 'cancel' })).toEqual({ step: 'cancelled' });
    expect(after(...recording, { type: 'cancel' })).toEqual({ step: 'cancelled' });
    expect(after(...transcribing, { type: 'cancel' })).toEqual({ step: 'cancelled' });
  });

  it('ignores what comes late: a transcription after a cancel never shows', () => {
    const cancelled = after(...transcribing, { type: 'cancel' });
    expect(voiceFlow(cancelled, { type: 'heard', text: 'nebeday', candidates: 1 })).toBe(cancelled);
    expect(voiceFlow(cancelled, { type: 'failed', failure: 'transcribe' })).toBe(cancelled);
    expect(voiceFlow(cancelled, { type: 'tick', seconds: 5 })).toBe(cancelled);
  });

  it('ignores events out of order', () => {
    const idle = after();
    for (const event of [
      { type: 'started' },
      { type: 'stop' },
      { type: 'tick', seconds: 1 },
      { type: 'heard', text: 'x', candidates: 1 },
      { type: 'denied' },
      { type: 'cancel' },
    ] satisfies VoiceEvent[]) {
      expect(voiceFlow(idle, event)).toBe(idle);
    }
    const busy = after(...transcribing);
    expect(voiceFlow(busy, { type: 'start' })).toBe(busy);
    expect(voiceFlow(busy, { type: 'stop' })).toBe(busy);
  });

  it('starts again from any end state', () => {
    for (const end of [
      after(...transcribing, { type: 'heard', text: 'a', candidates: 1 }),
      after(...transcribing, { type: 'heard', text: 'a', candidates: 0 }),
      after({ type: 'start' }, { type: 'denied' }),
      after({ type: 'start' }, { type: 'failed', failure: 'load' }),
      after({ type: 'start' }, { type: 'cancel' }),
    ]) {
      expect(voiceFlow(end, { type: 'start' })).toEqual({ step: 'starting' });
    }
  });

  it('goes back to idle when she types (reset), whatever the step', () => {
    expect(voiceFlow(after(...transcribing), { type: 'reset' })).toEqual(IDLE);
    expect(voiceFlow(after({ type: 'start' }, { type: 'denied' }), { type: 'reset' })).toEqual(
      IDLE,
    );
  });

  it('is busy while the microphone opens, records or the model transcribes', () => {
    expect(isBusy(after({ type: 'start' }))).toBe(true);
    expect(isBusy(after(...recording))).toBe(true);
    expect(isBusy(after(...transcribing))).toBe(true);
    expect(isBusy(IDLE)).toBe(false);
    expect(isBusy(after({ type: 'start' }, { type: 'cancel' }))).toBe(false);
  });
});

describe('cleanTranscript', () => {
  it('drops the punctuation and spaces the model writes around a name', () => {
    expect(cleanTranscript(' Nebeday. ', 80)).toBe('Nebeday');
    expect(cleanTranscript('« doliprane 1000 ! »', 80)).toBe('doliprane 1000');
    expect(cleanTranscript('huile   de\nricin...', 80)).toBe('huile de ricin');
    expect(cleanTranscript('...', 80)).toBe('');
  });

  it('keeps what is inside a name (apostrophes, hyphens, commas)', () => {
    expect(cleanTranscript("Feuille d'eucalyptus", 80)).toBe("Feuille d'eucalyptus");
    expect(cleanTranscript('néo-codion, sirop.', 80)).toBe('néo-codion, sirop');
  });

  it('keeps the length the search field takes', () => {
    expect(cleanTranscript('a'.repeat(100), 80)).toHaveLength(80);
    expect(cleanTranscript(`${'a'.repeat(79)} bc`, 80)).toBe('a'.repeat(79));
  });
});

/** An error as the browser or @siapso/speech gives it. */
function named(name: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error('x'), { name, ...extra });
}

describe('failureOf', () => {
  it('reads a refused microphone as denied', () => {
    expect(failureOf(new DOMException('no', 'NotAllowedError'), 'record')).toBe('denied');
    expect(failureOf(new DOMException('no', 'SecurityError'), 'record')).toBe('denied');
  });

  it('reads a missing microphone, and a microphone that cannot be read', () => {
    expect(failureOf(new DOMException('none', 'NotFoundError'), 'record')).toBe('no-microphone');
    expect(failureOf(new DOMException('none', 'OverconstrainedError'), 'record')).toBe(
      'no-microphone',
    );
    expect(failureOf(new DOMException('busy', 'NotReadableError'), 'record')).toBe('record');
  });

  it('reads a browser that cannot record', () => {
    expect(failureOf(new TypeError('navigator.mediaDevices is undefined'), 'record')).toBe(
      'unsupported',
    );
  });

  it.each(['unavailable', 'invalid', 'storage', 'download', 'load', 'transcribe'] as const)(
    'keeps the voice pack reason %s',
    (reason) => {
      expect(failureOf(named('VoicePackError', { reason }), 'transcribe')).toBe(reason);
    },
  );

  it('otherwise says the step that failed', () => {
    expect(failureOf(new Error('boom'), 'record')).toBe('record');
    expect(failureOf('boom', 'transcribe')).toBe('transcribe');
    expect(failureOf(named('VoicePackError', { reason: 'other' }), 'transcribe')).toBe(
      'transcribe',
    );
  });
});

describe('failureMessage', () => {
  it('has a plain message for every voice pack error and every microphone failure', () => {
    const reasons: VoicePackErrorReason[] = [
      'unavailable',
      'invalid',
      'storage',
      'download',
      'load',
      'transcribe',
    ];
    for (const reason of reasons) expect(VOICE_FAILURES).toContain(reason);
    for (const failure of VOICE_FAILURES) {
      for (const lang of ['fr', 'en'] as const) {
        const text = translate(lang, failureMessage(failure));
        expect(text.length, `${lang} ${failure}`).toBeGreaterThan(20);
        // Plain words: no code, no technical name.
        expect(text, `${lang} ${failure}`).not.toMatch(
          /VoicePackError|unavailable|ONNX|worker|cache/i,
        );
      }
    }
    expect(new Set(VOICE_FAILURES.map(failureMessage)).size).toBe(VOICE_FAILURES.length);
  });

  it('never sends her to a button that is not there, nor to the health post to report it', () => {
    for (const failure of VOICE_FAILURES) {
      for (const lang of ['fr', 'en'] as const) {
        const text = translate(lang, failureMessage(failure));
        expect(text, `${lang} ${failure}`).not.toMatch(
          /Reprendre|Resume|poste de santé|health post/,
        );
      }
    }
  });
});

describe('installFailureOf', () => {
  it('tells a voice the server does not give (or no Internet) from files that came damaged', () => {
    expect(installFailureOf('unavailable', 0)).toBe('unavailable');
    expect(installFailureOf('invalid', 0)).toBe('damaged');
    expect(installFailureOf('storage', 0)).toBe('storage');
  });

  it('says a download cut short only when part of the voice is kept, to resume', () => {
    expect(installFailureOf('download', 1000)).toBe('interrupted');
    // Nothing came: the server or the Internet did not give the voice.
    expect(installFailureOf('download', 0)).toBe('unavailable');
  });

  it('keeps apart a damaged file dropped while the files before it are kept (review of #58)', () => {
    expect(installFailureOf('invalid', 1000)).toBe('damagedKept');
  });

  it('reads any other failure as a voice that could not be downloaded', () => {
    expect(installFailureOf('transcribe', 0)).toBe('unavailable');
    expect(installFailureOf('unsupported', 0)).toBe('unavailable');
  });

  it('has a plain message for each, that sends her somewhere useful', () => {
    for (const failure of INSTALL_FAILURES) {
      for (const lang of ['fr', 'en'] as const) {
        const text = translate(lang, installFailureMessage(failure));
        expect(text.length).toBeGreaterThan(20);
        expect(text).not.toMatch(/dites-le|tell the health post/i);
      }
    }
    // Only the failures that keep part of the voice name the button that resumes it, by its words.
    const resumable = ['interrupted', 'damagedKept'];
    for (const failure of resumable) {
      expect(translate('fr', installFailureMessage(failure as InstallFailure))).toMatch(
        /«\sReprendre l'installation\s»/,
      );
      expect(translate('en', installFailureMessage(failure as InstallFailure))).toMatch(
        /"Resume the installation"/,
      );
    }
    for (const failure of INSTALL_FAILURES.filter((f) => !resumable.includes(f))) {
      expect(translate('fr', installFailureMessage(failure))).not.toMatch(/Reprendre/);
    }
    expect(translate('fr', installFailureMessage('unavailable'))).toMatch(/écrivez le nom/);
  });

  it('says what was kept as it is: nothing for damaged files, the files before for one damaged file', () => {
    expect(translate('fr', installFailureMessage('damaged'))).toMatch(/ils n'ont pas été gardés/);
    const kept = translate('fr', installFailureMessage('damagedKept'));
    expect(kept).toMatch(/^Un fichier de la voix reçu était abîmé/);
    expect(kept).toMatch(/Ce qui est déjà téléchargé est gardé/);
    expect(kept).not.toMatch(/ils n'ont pas été gardés/);
  });
});
