// SPDX-License-Identifier: MIT
// Bench page: the app has no voice screen yet (SCRUM-31), so the bench drives
// @siapso/speech here, built by Vite as the app will build it, with the pack
// served from /voice/. Two ways to run the model:
//  - worker: the production path (createSpeechClient and its Web Worker);
//  - page: the same pipeline and settings on the page thread, because Chrome
//    DevTools CPU throttling slows the page thread and may not reach workers.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import {
  VOICE_CACHE,
  VoicePackError,
  createSpeechClient,
  installVoicePack,
  isVoicePackInstalled,
  voicePackInfo,
  voicePackUrl,
  type SpeechClient,
  type VoicePackInfo,
} from '../src/index.js';
import {
  applyRuntimeSettings,
  runtimeSettings,
  type TransformersEnv,
} from '../src/runtime-config.js';

let info: VoicePackInfo | undefined;
let client: SpeechClient | undefined;
let inPage: AutomaticSpeechRecognitionPipeline | undefined;

function pack(): VoicePackInfo {
  if (info === undefined) throw new Error('install() first');
  return info;
}

function textOf(output: unknown): string {
  const first: unknown = Array.isArray(output) ? output[0] : output;
  return typeof first === 'object' &&
    first !== null &&
    'text' in first &&
    typeof first.text === 'string'
    ? first.text.trim()
    : '';
}

const bench = {
  /**
   * Spawns the worker (the bench page has no service worker, so this needs the
   * network) and tries to load before installation: it must fail, and
   * download nothing. The same client loads again once the pack is installed.
   */
  async loadBeforeInstall(url: string) {
    info = await voicePackInfo(url);
    client = createSpeechClient(info);
    try {
      await client.load();
      return 'loaded';
    } catch (error) {
      return error instanceof VoicePackError ? error.reason : String(error);
    }
  },

  async install(url: string) {
    info ??= await voicePackInfo(url);
    const started = performance.now();
    if (!(await isVoicePackInstalled(info))) await installVoicePack(info, () => undefined);
    return {
      id: info.id,
      totalBytes: info.totalBytes,
      ms: Math.round(performance.now() - started),
    };
  },

  async loadWorker() {
    if (client === undefined) throw new Error('loadBeforeInstall() first');
    const started = performance.now();
    await client.load();
    return { ms: Math.round(performance.now() - started), device: client.device };
  },

  async transcribeWorker(samples: number[], language: string) {
    if (client === undefined) throw new Error('loadWorker() first');
    return client.transcribe(Float32Array.from(samples), { language });
  },

  async loadPage() {
    const settings = runtimeSettings(pack().baseUrl, false);
    applyRuntimeSettings(
      env as unknown as TransformersEnv,
      settings,
      pack().files.map((file) => file.path),
    );
    const started = performance.now();
    inPage = await pipeline('automatic-speech-recognition', settings.modelId, {
      dtype: settings.dtype,
      device: 'wasm',
      local_files_only: true,
    });
    return Math.round(performance.now() - started);
  },

  async transcribePage(samples: number[], language: string) {
    if (inPage === undefined) throw new Error('loadPage() first');
    const prompt = pack().prompts[language];
    if (prompt === undefined) throw new Error(`no prompt for ${language}`);
    const started = performance.now();
    const output: unknown = await inPage(Float32Array.from(samples), {
      decoder_input_ids: prompt,
      max_new_tokens: 96,
    });
    return { text: textOf(output), ms: Math.round(performance.now() - started) };
  },

  /** What the Cache API holds: to tell a missing file from an evicted cache. */
  async cacheState() {
    const cache = await caches.open(VOICE_CACHE);
    const keys = await cache.keys();
    const config = await cache.match(voicePackUrl(pack(), 'config.json'));
    const estimate = await navigator.storage.estimate();
    return {
      entries: keys.length,
      configCached: config !== undefined,
      usage: estimate.usage,
      quota: estimate.quota,
      persisted: await navigator.storage.persisted(),
    };
  },

  async environment() {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = gpu === undefined ? null : await gpu.requestAdapter().catch(() => null);
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      // The worker uses WebGPU only when an adapter exists, else WebAssembly.
      webgpuAdapter: adapter !== null,
    };
  },
};

(globalThis as unknown as { siapsoBench: typeof bench }).siapsoBench = bench;
