// SPDX-License-Identifier: MIT
// The voice service of the app: one for the page, reached through useVoice.
// Tests hand in their own (VoiceProvider); otherwise the real one, which
// loads @siapso/speech only when the voice is used.
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { serviceWorker } from '../pwa/service-worker.js';
import {
  createVoiceService,
  type SpeechPort,
  type VoiceService,
  type VoiceSnapshot,
} from './voice-service.js';

/**
 * Whether this browser can record and run the speech model: a secure page
 * (the microphone needs one), getUserMedia, Web Audio with an audio worklet,
 * module workers and the Cache API. Otherwise the microphone button is not
 * shown at all and the keyboard does everything.
 */
export function voiceSupported(scope: Record<string, unknown> = globalThis): boolean {
  const navigator = scope['navigator'] as { mediaDevices?: { getUserMedia?: unknown } } | undefined;
  return (
    scope['isSecureContext'] === true &&
    typeof navigator?.mediaDevices?.getUserMedia === 'function' &&
    (typeof scope['AudioContext'] === 'function' ||
      typeof scope['webkitAudioContext'] === 'function') &&
    typeof scope['AudioWorkletNode'] === 'function' &&
    typeof scope['Worker'] === 'function' &&
    typeof scope['caches'] === 'object' &&
    scope['caches'] !== null
  );
}

/**
 * @siapso/speech, loaded on first use (its own small chunk, precached), and
 * the service worker, which keeps the speech worker's script only once a
 * voice is installed (pwa/sw-setup.ts).
 */
export const speechPort: SpeechPort = {
  supported: () => voiceSupported(),
  load: () => import('@siapso/speech'),
  voiceWorker: {
    cache: (url) => serviceWorker.cacheVoiceWorker(url),
    drop: () => serviceWorker.dropVoiceWorker(),
  },
};

let pageService: VoiceService | undefined;

/** The page's voice service, made on first use. */
function defaultService(): VoiceService {
  pageService ??= createVoiceService(speechPort);
  return pageService;
}

const VoiceContext = createContext<VoiceService | null>(null);

export function VoiceProvider({
  service,
  children,
}: {
  service: VoiceService;
  children: ReactNode;
}) {
  return <VoiceContext value={service}>{children}</VoiceContext>;
}

/**
 * The voice service and what it knows now. The phone is looked at once when a
 * screen first asks (Cache API only, never the network).
 */
export function useVoice(): { service: VoiceService; snapshot: VoiceSnapshot } {
  const service = useContext(VoiceContext) ?? defaultService();
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const unknown = snapshot.packs === null;
  useEffect(() => {
    if (unknown) void service.refresh().catch(() => undefined);
  }, [service, unknown]);
  return { service, snapshot };
}
