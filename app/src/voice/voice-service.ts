// SPDX-License-Identifier: MIT
// The voice packs on this phone and what is done with them: which one is
// installed (read from the Cache API only), an installation with progress
// and cancel, removal, and the speech client and recorder of the installed
// pack. @siapso/speech is loaded only when the voice is used, so the app's
// first screen never waits for it. Nothing is ever downloaded except by
// install(), which only the install button of the voice screen calls.
import type { Recorder, SpeechClient, VoicePackInfo } from '@siapso/speech';
import { VOICE_PACK_OPTIONS, type VoiceLang, type VoicePackOption } from '../config/voice.js';
import { failureOf, type VoiceFailure } from '../domain/voice-flow.js';

/** What the app uses of @siapso/speech. */
export type SpeechModule = Pick<
  typeof import('@siapso/speech'),
  | 'installedVoicePackInfo'
  | 'storedVoicePackBytes'
  | 'voicePackInfo'
  | 'installVoicePack'
  | 'removeVoicePackFiles'
  | 'createSpeechClient'
  | 'createRecorder'
>;

/** How the service reaches @siapso/speech and the service worker: tests hand in fakes. */
export interface SpeechPort {
  /** Whether this browser can record and run the model at all. */
  supported: () => boolean;
  load: () => Promise<SpeechModule>;
  /**
   * The service worker keeps the speech worker's script only once a voice is
   * installed (pwa/sw-setup.ts): asked to keep the script this page runs (its
   * address, as the worker says it) after an installation and when a model is
   * loaded, told after the last removal. True when it did.
   */
  voiceWorker: { cache: (url: string) => Promise<boolean>; drop: () => Promise<boolean> };
}

/**
 * The model is freed this long after its last use (and at once when the page
 * is hidden). A check adds several products in a row, a minute or two apart,
 * and loading the model again takes seconds on a laptop and more on a phone;
 * but a model of several hundred megabytes kept for nothing can make a 2 GB
 * phone close the tab or other apps. Three minutes covers the next product of
 * a visit and gives the memory back soon after (to measure on a 2 GB phone,
 * docs/voice.md).
 */
export const VOICE_IDLE_MS = 3 * 60_000;

/** How long the speech worker has to say its address (it says it as it starts). */
const SCRIPT_URL_TIMEOUT_MS = 15_000;

export interface PackStatus {
  option: VoicePackOption;
  /** The pack, when every file of it is on the phone. */
  installed: VoicePackInfo | null;
  /** Bytes of the pack folder on the phone (an installation cut short keeps them). */
  storedBytes: number;
}

export type VoiceActivity =
  | { kind: 'idle' }
  | { kind: 'installing'; lang: VoiceLang; loaded: number; total: number }
  | { kind: 'cancelled'; lang: VoiceLang }
  | { kind: 'failed'; lang: VoiceLang; failure: VoiceFailure }
  | { kind: 'removing'; lang: VoiceLang }
  | { kind: 'removed'; lang: VoiceLang }
  | { kind: 'remove-failed'; lang: VoiceLang };

export interface VoiceSnapshot {
  supported: boolean;
  /** Null until the phone was looked at. */
  packs: readonly PackStatus[] | null;
  /**
   * The speech package could not be loaded (its file is gone after an update
   * accepted in another tab): the page must be opened again.
   */
  packageFailed: boolean;
  activity: VoiceActivity;
}

export interface PreparedVoice {
  client: SpeechClient;
  recorder: Recorder;
  /** The language the pack transcribes. */
  language: string;
}

export interface VoiceService {
  getSnapshot: () => VoiceSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Looks at the phone again: the installed pack, the bytes kept. Never the network. */
  refresh: () => Promise<void>;
  /** Downloads the pack of `lang` into the Cache API (the only download of the voice). */
  install: (lang: VoiceLang) => Promise<void>;
  cancelInstall: () => void;
  /** Removes every file of the pack of `lang`, installed or cut short. */
  remove: (lang: VoiceLang) => Promise<void>;
  /**
   * The speech client of the installed pack (one, kept while the pack is and
   * used, VOICE_IDLE_MS) and a new recorder; rejects as the speech client
   * does (`unavailable`) when no pack is installed.
   */
  prepare: (onAutoStop: () => void) => Promise<PreparedVoice>;
  /** The use that prepare began is over: the model may be freed (VOICE_IDLE_MS, or hidden). */
  release: () => void;
}

/** The installed pack the microphone uses: the first of the offered order. */
export function installedPackOf(snapshot: VoiceSnapshot): PackStatus | undefined {
  return snapshot.packs?.find((pack) => pack.installed !== null);
}

function notInstalled(): Error {
  return Object.assign(new Error('No voice pack is installed.'), {
    name: 'VoicePackError',
    reason: 'unavailable',
  });
}

export function createVoiceService(port: SpeechPort): VoiceService {
  const supported = port.supported();
  let snapshot: VoiceSnapshot = {
    supported,
    packs: supported ? null : [],
    packageFailed: false,
    activity: { kind: 'idle' },
  };
  const listeners = new Set<() => void>();
  let installing: AbortController | undefined;
  let speech: { url: string; client: SpeechClient } | undefined;
  // A use under way (from prepare to release), and the timer that frees the model after it.
  let inUse = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function pageHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /** Frees the model: the worker and its memory go; the next use loads it again. */
  function freeModel(): void {
    clearTimeout(idleTimer);
    idleTimer = undefined;
    speech?.client.dispose();
    speech = undefined;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (pageHidden() && !inUse) freeModel();
    });
  }

  function change(patch: Partial<VoiceSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }

  function langOf(url: string): VoiceLang | undefined {
    return VOICE_PACK_OPTIONS.find((option) => option.url === url)?.lang;
  }

  function urlOf(lang: VoiceLang): string {
    const option = VOICE_PACK_OPTIONS.find((candidate) => candidate.lang === lang);
    if (option === undefined) throw new Error(`No voice pack for ${lang}`);
    return option.url;
  }

  async function refresh(): Promise<void> {
    if (!supported) {
      change({ packs: [] });
      return;
    }
    let module: SpeechModule;
    try {
      module = await port.load();
    } catch (error) {
      change({ packs: [], packageFailed: true });
      throw error;
    }
    const packs = await Promise.all(
      VOICE_PACK_OPTIONS.map(async (option) => ({
        option,
        installed: await module.installedVoicePackInfo(option.url).catch(() => null),
        storedBytes: await module.storedVoicePackBytes(option.url).catch(() => 0),
      })),
    );
    // A model loaded from a pack that is no longer there goes.
    if (speech !== undefined && !packs.some((pack) => pack.installed?.baseUrl === speech?.url)) {
      speech.client.dispose();
      speech = undefined;
    }
    change({ packs });
  }

  async function install(lang: VoiceLang): Promise<void> {
    if (!supported || installing !== undefined) return;
    const controller = new AbortController();
    installing = controller;
    change({ activity: { kind: 'installing', lang, loaded: 0, total: 0 } });
    try {
      const module = await port.load();
      const info = await module.voicePackInfo(urlOf(lang));
      await module.installVoicePack(
        info,
        (loaded, total) => {
          if (installing === controller) {
            change({ activity: { kind: 'installing', lang, loaded, total } });
          }
        },
        controller.signal,
      );
      installing = undefined;
      await refresh();
      // The speech worker's script, kept offline from now on: its worker is
      // started (online) to say its address. The voice still works online
      // without it, and the next use asks again.
      const pack = installedPackOf(snapshot);
      if (pack?.installed != null) {
        const client = clientFor(pack.installed, module);
        await keepScript(client);
        if (!inUse) scheduleFree();
      }
      change({ activity: { kind: 'idle' } });
    } catch (error) {
      installing = undefined;
      await refresh().catch(() => undefined);
      if (controller.signal.aborted) {
        change({ activity: { kind: 'cancelled', lang } });
        return;
      }
      // The reason as it is: the voice screen tells a voice the server does
      // not give from a download cut short (installFailureOf).
      const found = failureOf(error, 'transcribe');
      const failure: VoiceFailure = found === 'denied' ? 'download' : found;
      change({ activity: { kind: 'failed', lang, failure } });
    }
  }

  async function remove(lang: VoiceLang): Promise<void> {
    if (!supported) return;
    const url = urlOf(lang);
    change({ activity: { kind: 'removing', lang } });
    try {
      if (speech !== undefined && langOf(speech.url) === lang) {
        speech.client.dispose();
        speech = undefined;
      }
      const module = await port.load();
      await module.removeVoicePackFiles(url);
      await refresh();
      if (installedPackOf(snapshot) === undefined) await port.voiceWorker.drop().catch(() => false);
      change({ activity: { kind: 'removed', lang } });
    } catch {
      await refresh().catch(() => undefined);
      change({ activity: { kind: 'remove-failed', lang } });
    }
  }

  /** The speech client of `info`, kept while the pack is (one at a time). */
  function clientFor(info: VoicePackInfo, module: SpeechModule): SpeechClient {
    if (speech?.url !== info.baseUrl) {
      speech?.client.dispose();
      speech = { url: info.baseUrl, client: module.createSpeechClient(info) };
    }
    return speech.client;
  }

  /**
   * Asks the service worker to keep the script `client` runs; false when it
   * could not, or when the worker did not say its address in time (the
   * installation never waits longer: the next use asks again).
   */
  async function keepScript(client: SpeechClient): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        resolve(undefined);
      }, SCRIPT_URL_TIMEOUT_MS);
    });
    try {
      const url = await Promise.race([client.scriptUrl(), late]);
      return url === undefined ? false : await port.voiceWorker.cache(url);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function scheduleFree(): void {
    clearTimeout(idleTimer);
    if (pageHidden()) freeModel();
    else idleTimer = setTimeout(freeModel, VOICE_IDLE_MS);
  }

  async function prepare(onAutoStop: () => void): Promise<PreparedVoice> {
    clearTimeout(idleTimer);
    idleTimer = undefined;
    inUse = true;
    if (snapshot.packs === null) await refresh();
    const pack = installedPackOf(snapshot);
    if (pack?.installed == null || !supported) throw notInstalled();
    const module = await port.load();
    const info = pack.installed;
    const known = speech?.url === info.baseUrl;
    const client = clientFor(info, module);
    // Installed before the service worker kept it, or dropped since: asked again.
    if (!known) void keepScript(client);
    return {
      client,
      recorder: module.createRecorder({ onAutoStop }),
      language: info.languages[0] ?? pack.option.lang,
    };
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    install,
    cancelInstall() {
      installing?.abort();
    },
    remove,
    prepare,
    release() {
      inUse = false;
      scheduleFree();
    },
  };
}
