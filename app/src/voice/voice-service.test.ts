// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VOICE_PACK_OPTIONS } from '../config/voice.js';
import { SPEECH_WORKER_SCRIPT, fakeSpeech, packInfo } from '../test/voice.js';
import { VOICE_IDLE_MS, createVoiceService, installedPackOf } from './voice-service.js';

const WO = VOICE_PACK_OPTIONS[0]?.url ?? '';
const FR = VOICE_PACK_OPTIONS[1]?.url ?? '';
/** Half the French pack: where the fake installation waits. */
const HALF_FR = Math.round(137_164_324 / 2);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setHidden(false);
});

/** The page shown or hidden, as the browser says it. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('createVoiceService', () => {
  it('reads which pack is installed and what an interrupted installation kept, without the network', async () => {
    const speech = fakeSpeech({ installed: ['fr'], stored: { [WO]: 120_000_000 } });
    const service = createVoiceService(speech.port);
    expect(service.getSnapshot().packs).toBeNull();
    await service.refresh();
    const packs = service.getSnapshot().packs ?? [];
    expect(
      packs.map((pack) => [pack.option.lang, pack.installed?.id ?? null, pack.storedBytes]),
    ).toEqual([
      ['wo', null, 120_000_000],
      ['fr', 'whisper-base-fr-q8', 137_164_324],
    ]);
    expect(installedPackOf(service.getSnapshot())?.option.lang).toBe('fr');
    // Only the Cache API was read: no manifest fetched, nothing installed.
    expect(speech.module.voicePackInfo).not.toHaveBeenCalled();
    expect(speech.module.installVoicePack).not.toHaveBeenCalled();
  });

  it('tells its subscribers when something changes', async () => {
    const service = createVoiceService(fakeSpeech().port);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    await service.refresh();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    await service.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it('says when the browser cannot use the voice, and never loads the speech package then', async () => {
    const speech = fakeSpeech({ supported: false });
    const service = createVoiceService(speech.port);
    await service.refresh();
    expect(service.getSnapshot()).toMatchObject({ supported: false, packs: [] });
    expect(speech.port.load).not.toHaveBeenCalled();
  });

  it('downloads a pack only when asked to install it, with its progress', async () => {
    const speech = fakeSpeech();
    const service = createVoiceService(speech.port);
    await service.refresh();
    const seen: unknown[] = [];
    service.subscribe(() => seen.push(service.getSnapshot().activity));

    await service.install('wo');

    expect(speech.module.voicePackInfo).toHaveBeenCalledWith(WO);
    expect(seen).toContainEqual({ kind: 'installing', lang: 'wo', loaded: 0, total: 325_620_637 });
    expect(seen).toContainEqual({
      kind: 'installing',
      lang: 'wo',
      loaded: 162_810_319,
      total: 325_620_637,
    });
    expect(service.getSnapshot().activity).toEqual({ kind: 'idle' });
    expect(installedPackOf(service.getSnapshot())?.option.lang).toBe('wo');
  });

  it('cancels an installation and keeps what it downloaded, to resume later', async () => {
    const speech = fakeSpeech({ installHangs: true });
    const service = createVoiceService(speech.port);
    await service.refresh();
    const installing = service.install('fr');
    await vi.waitFor(() => {
      expect(service.getSnapshot().activity).toMatchObject({ kind: 'installing', loaded: HALF_FR });
    });
    service.cancelInstall();
    await installing;
    expect(service.getSnapshot().activity).toEqual({ kind: 'cancelled', lang: 'fr' });
    expect(service.getSnapshot().packs?.[1]?.storedBytes).toBe(HALF_FR);
    expect(installedPackOf(service.getSnapshot())).toBeUndefined();
  });

  it('says why an installation failed, in words the screen can say', async () => {
    const speech = fakeSpeech({ installFails: 'storage' });
    const service = createVoiceService(speech.port);
    await service.refresh();
    await service.install('wo');
    expect(service.getSnapshot().activity).toEqual({
      kind: 'failed',
      lang: 'wo',
      failure: 'storage',
    });
  });

  it('keeps a pack the server does not give (offline, say) apart from a download cut short', async () => {
    const speech = fakeSpeech();
    speech.module.voicePackInfo.mockRejectedValueOnce(
      Object.assign(new Error('not available'), { name: 'VoicePackError', reason: 'unavailable' }),
    );
    const service = createVoiceService(speech.port);
    await service.refresh();
    await service.install('wo');
    expect(service.getSnapshot().activity).toMatchObject({
      kind: 'failed',
      failure: 'unavailable',
    });
  });

  it('installs one pack at a time', async () => {
    const speech = fakeSpeech({ installHangs: true });
    const service = createVoiceService(speech.port);
    await service.refresh();
    const first = service.install('fr');
    await vi.waitFor(() => {
      expect(service.getSnapshot().activity).toMatchObject({ kind: 'installing', loaded: HALF_FR });
    });
    await service.install('wo');
    expect(speech.module.installVoicePack).toHaveBeenCalledTimes(1);
    service.cancelInstall();
    await first;
  });

  it('removes a pack, installed or cut short, and the model it loaded', async () => {
    const speech = fakeSpeech({ installed: ['wo'] });
    const service = createVoiceService(speech.port);
    await service.refresh();
    await service.prepare(() => undefined);
    await service.remove('wo');
    expect(speech.module.removeVoicePackFiles).toHaveBeenCalledWith(WO);
    expect(speech.client.dispose).toHaveBeenCalled();
    expect(service.getSnapshot().activity).toEqual({ kind: 'removed', lang: 'wo' });
    expect(installedPackOf(service.getSnapshot())).toBeUndefined();
  });

  it('says when a pack could not be removed', async () => {
    const speech = fakeSpeech({ installed: ['wo'] });
    speech.module.removeVoicePackFiles.mockRejectedValueOnce(new Error('busy'));
    const service = createVoiceService(speech.port);
    await service.refresh();
    await service.remove('wo');
    expect(service.getSnapshot().activity).toEqual({ kind: 'remove-failed', lang: 'wo' });
  });

  it('prepares the installed pack: one speech client kept for it, a new recorder each time', async () => {
    const speech = fakeSpeech({ installed: ['fr'] });
    const service = createVoiceService(speech.port);
    await service.refresh();
    const onAutoStop = vi.fn();
    const first = await service.prepare(onAutoStop);
    const second = await service.prepare(() => undefined);
    expect(first.client).toBe(second.client);
    expect(speech.module.createSpeechClient).toHaveBeenCalledTimes(1);
    expect(speech.module.createSpeechClient).toHaveBeenCalledWith(packInfo('fr', FR));
    expect(speech.module.createRecorder).toHaveBeenCalledTimes(2);
    expect(speech.module.createRecorder).toHaveBeenCalledWith({ onAutoStop });
    expect(first.language).toBe('fr');
  });

  it('refuses to prepare when no pack is installed, as the speech client does', async () => {
    const service = createVoiceService(fakeSpeech().port);
    await service.refresh();
    await expect(service.prepare(() => undefined)).rejects.toMatchObject({
      name: 'VoicePackError',
      reason: 'unavailable',
    });
  });

  it('asks the service worker to keep the speech worker script once a voice is installed', async () => {
    const speech = fakeSpeech();
    const service = createVoiceService(speech.port);
    await service.refresh();
    expect(speech.port.voiceWorker.cache).not.toHaveBeenCalled();
    await service.install('wo');
    // The very script this page runs, as its worker says it.
    expect(speech.port.voiceWorker.cache).toHaveBeenCalledWith(SPEECH_WORKER_SCRIPT);
  });

  it('ends the installation even when the worker never says its address', async () => {
    vi.useFakeTimers();
    const speech = fakeSpeech();
    speech.client.scriptUrl.mockReturnValue(new Promise(() => undefined));
    const service = createVoiceService(speech.port);
    await service.refresh();
    const installing = service.install('wo');
    await vi.advanceTimersByTimeAsync(15_000);
    await installing;
    expect(service.getSnapshot().activity).toEqual({ kind: 'idle' });
    expect(installedPackOf(service.getSnapshot())?.option.lang).toBe('wo');
    expect(speech.port.voiceWorker.cache).not.toHaveBeenCalled();
  });

  it('asks it to drop the script once no voice is left', async () => {
    const speech = fakeSpeech({ installed: ['wo'] });
    const service = createVoiceService(speech.port);
    await service.refresh();
    await service.remove('wo');
    expect(speech.port.voiceWorker.drop).toHaveBeenCalledOnce();
  });

  it('frees the model a few minutes after its last use, and loads it again when needed', async () => {
    expect(VOICE_IDLE_MS).toBe(3 * 60_000);
    vi.useFakeTimers();
    const speech = fakeSpeech({ installed: ['wo'] });
    const service = createVoiceService(speech.port);
    await service.refresh();
    await service.prepare(() => undefined);
    service.release();
    await vi.advanceTimersByTimeAsync(VOICE_IDLE_MS - 1);
    expect(speech.client.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(speech.client.dispose).toHaveBeenCalledOnce();
    await service.prepare(() => undefined);
    expect(speech.module.createSpeechClient).toHaveBeenCalledTimes(2);
  });

  it('keeps the model while it is used, however long', async () => {
    vi.useFakeTimers();
    const speech = fakeSpeech({ installed: ['wo'] });
    const service = createVoiceService(speech.port);
    await service.refresh();
    await service.prepare(() => undefined);
    await vi.advanceTimersByTimeAsync(10 * VOICE_IDLE_MS);
    expect(speech.client.dispose).not.toHaveBeenCalled();
  });

  it('frees the model when the page is hidden, after a recording under way ends', async () => {
    const speech = fakeSpeech({ installed: ['wo'] });
    const service = createVoiceService(speech.port);
    await service.refresh();
    await service.prepare(() => undefined);
    setHidden(true);
    expect(speech.client.dispose).not.toHaveBeenCalled();
    service.release();
    expect(speech.client.dispose).toHaveBeenCalledOnce();
    setHidden(false);
    await service.prepare(() => undefined);
    service.release();
    setHidden(true);
    expect(speech.client.dispose).toHaveBeenCalledTimes(2);
  });

  it('says when the speech package cannot be loaded, instead of looking for ever', async () => {
    const service = createVoiceService(fakeSpeech({ packageFails: true }).port);
    await service.refresh().catch(() => undefined);
    expect(service.getSnapshot()).toMatchObject({ packs: [], packageFailed: true });
  });
});
