// SPDX-License-Identifier: MIT
// The microphone of the search: runs the voice flow (domain/voice-flow.ts)
// with the recorder and the speech client of the installed pack. Tap to
// start, tap again to finish (or it ends at 8 seconds), cancel at any time;
// the model loads while she speaks. What it heard goes to the search field
// through onHeard: the candidates are then those of a typed name, each to be
// confirmed. Nothing is ever added to the check from here.
import type { Recorder, SpeechClient } from '@siapso/speech';
import { useEffect, useReducer, useRef } from 'react';
import { MAX_RECORDING_SECONDS, voiceContextFor, type VoiceLang } from '../config/voice.js';
import {
  IDLE,
  cleanTranscript,
  failureOf,
  isBusy,
  voiceFlow,
  type VoiceState,
} from '../domain/voice-flow.js';
import { isPromptEcho, voiceGate } from '../domain/voice-guard.js';
import { useVoice } from './voice-context.js';
import { installedPackOf } from './voice-service.js';

export interface VoiceInputOptions {
  /** The text heard, cleaned, for the search field (never empty). */
  onHeard: (text: string) => void;
  /** How many candidates the search proposes for a text. */
  countCandidates: (text: string) => number;
  /** No pack installed: the voice screen opens instead. */
  onNeedPack: () => void;
  /** The longest text the search field takes. */
  maxLength: number;
}

export interface VoiceInput {
  state: VoiceState;
  /** Whether the browser can use the voice at all (the button shows only then). */
  supported: boolean;
  /** The language of the installed voice, when one is. */
  language: VoiceLang | undefined;
  /** The microphone button: starts, or finishes the recording. */
  press: () => void;
  cancel: () => void;
  /** She typed: a recording or a transcription is given up, and the panel goes. */
  reset: () => void;
}

interface Running {
  recorder?: Recorder;
  client?: SpeechClient;
  language?: string;
  timer?: ReturnType<typeof setInterval> | undefined;
  /** This attempt prepared the voice: the service is told when it ends (it may free the model). */
  using?: boolean;
}

export function useVoiceInput(options: VoiceInputOptions): VoiceInput {
  const { service, snapshot } = useVoice();
  const [state, dispatch] = useReducer(voiceFlow, IDLE);
  // Each start is an attempt; what an older attempt answers late is dropped.
  const attempt = useRef(0);
  const running = useRef<Running>({});
  const latest = useRef(options);
  const step = useRef(state.step);
  useEffect(() => {
    latest.current = options;
    step.current = state.step;
  });

  function clearTimer(): void {
    clearInterval(running.current.timer);
    running.current.timer = undefined;
  }

  /** The use of the voice is over: the service may free the model (after a while). */
  function endUse(): void {
    if (running.current.using !== true) return;
    running.current.using = false;
    service.release();
  }

  /**
   * Ends the current attempt: the microphone is released and a transcription
   * is dropped (never the model load, which the next attempt shares).
   */
  function abandon(): void {
    attempt.current += 1;
    clearTimer();
    running.current.recorder?.cancel();
    running.current.client?.cancel();
    endUse();
  }

  function fail(mine: number, error: unknown, phase: 'record' | 'transcribe'): void {
    if (mine !== attempt.current) return;
    // A new attempt: what this one still answers (a microphone that opens late) is dropped.
    attempt.current += 1;
    clearTimer();
    running.current.recorder?.cancel();
    endUse();
    const failure = failureOf(error, phase);
    dispatch(failure === 'denied' ? { type: 'denied' } : { type: 'failed', failure });
  }

  async function finish(mine: number): Promise<void> {
    const { recorder, client, language } = running.current;
    if (mine !== attempt.current || recorder === undefined || client === undefined) return;
    clearTimer();
    dispatch({ type: 'stop' });
    let samples: Float32Array;
    try {
      samples = await recorder.stop();
    } catch (error) {
      fail(mine, error, 'record');
      return;
    }
    // Review of #68: a recording with no speech is not transcribed (the names
    // given to the decoder would come back on their own), and a faint one, or
    // a steady sound, is transcribed without them.
    const gate = voiceGate(samples);
    if (gate === 'silent') {
      endUse();
      dispatch({ type: 'heard', text: '', candidates: 0 });
      return;
    }
    try {
      const context = gate === 'speech' ? voiceContextFor(language) : undefined;
      const { text } = await client.transcribe(samples, {
        ...(language === undefined ? {} : { language }),
        ...(context === undefined ? {} : { context }),
      });
      if (mine !== attempt.current) return;
      // The names given, repeated in their order: an echo, nothing heard.
      const echo = context !== undefined && isPromptEcho(text, context);
      const heard = echo ? '' : cleanTranscript(text, latest.current.maxLength);
      const candidates = heard === '' ? 0 : latest.current.countCandidates(heard);
      endUse();
      if (heard !== '') latest.current.onHeard(heard);
      dispatch({ type: 'heard', text: heard, candidates });
    } catch (error) {
      fail(mine, error, 'transcribe');
    }
  }

  async function start(): Promise<void> {
    clearTimer();
    attempt.current += 1;
    const mine = attempt.current;
    running.current = { using: true };
    dispatch({ type: 'start' });
    let prepared: Awaited<ReturnType<typeof service.prepare>>;
    try {
      prepared = await service.prepare(() => {
        void finish(mine);
      });
    } catch (error) {
      fail(mine, error, 'transcribe');
      return;
    }
    if (mine !== attempt.current) return;
    running.current = {
      recorder: prepared.recorder,
      client: prepared.client,
      language: prepared.language,
      using: true,
    };
    // The model loads while she speaks; a pack that cannot load ends the recording at once.
    prepared.client.load().catch((error: unknown) => {
      fail(mine, error, 'transcribe');
    });
    try {
      await prepared.recorder.start();
    } catch (error) {
      fail(mine, error, 'record');
      return;
    }
    if (mine !== attempt.current) {
      prepared.recorder.cancel();
      return;
    }
    dispatch({ type: 'started' });
    const startedAt = Date.now();
    running.current.timer = setInterval(() => {
      const seconds = Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - startedAt) / 1000));
      dispatch({ type: 'tick', seconds });
    }, 250);
  }

  async function startOrAsk(): Promise<void> {
    let known = service.getSnapshot();
    if (known.packs === null) {
      await service.refresh().catch(() => undefined);
      known = service.getSnapshot();
    }
    if (installedPackOf(known) === undefined) latest.current.onNeedPack();
    else await start();
  }

  // Leaving the screen releases the microphone and drops a transcription.
  const leave = useRef(abandon);
  useEffect(() => {
    leave.current = abandon;
  });
  useEffect(
    () => () => {
      leave.current();
    },
    [],
  );

  // The page hidden (another app, the phone locked): the microphone closes at
  // once, and the recording is cancelled; a transcription under way goes on.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      if (step.current !== 'starting' && step.current !== 'recording') return;
      leave.current();
      dispatch({ type: 'cancel' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return {
    state,
    supported: snapshot.supported,
    language: installedPackOf(snapshot)?.option.lang,
    press() {
      if (state.step === 'recording') {
        void finish(attempt.current);
        return;
      }
      if (isBusy(state)) return;
      void startOrAsk();
    },
    cancel() {
      if (!isBusy(state)) return;
      abandon();
      dispatch({ type: 'cancel' });
    },
    reset() {
      if (isBusy(state)) abandon();
      dispatch({ type: 'reset' });
    },
  };
}
