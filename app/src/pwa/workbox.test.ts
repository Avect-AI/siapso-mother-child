// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { workbox } from '../../vite.config.js';

describe('service worker precache', () => {
  it('never precaches the voice pack: it is an optional download kept in the Cache API', () => {
    expect(workbox.globIgnores).toContain('voice/**');
    for (const pattern of workbox.globPatterns) expect(pattern.startsWith('voice')).toBe(false);
  });

  it('never answers a /voice/ request with the app page', () => {
    const denied = (path: string) =>
      workbox.navigateFallbackDenylist.some((rule) => rule.test(path));
    expect(denied('/voice/whisper-small-wolof-q8/voice-pack.json')).toBe(true);
    // Also under a deployment base path.
    expect(denied('/siapso/voice/whisper-small-wolof-q8/onnx/encoder_model_quantized.onnx')).toBe(
      true,
    );
    expect(denied('/')).toBe(false);
    expect(denied('/index.html')).toBe(false);
  });

  it('keeps the app shell and the knowledge pack in the precache', () => {
    expect(workbox.globPatterns).toContain('pack/*.{json,sig}');
    expect(workbox.navigateFallback).toBe('index.html');
  });

  it('keeps the signature of a signed pack offline: manifest.sig is precached when present', () => {
    // One pattern for both, so an unsigned build (no .sig file) has no pattern that matches nothing.
    expect(workbox.globPatterns.filter((pattern) => pattern.startsWith('pack/'))).toEqual([
      'pack/*.{json,sig}',
    ]);
    expect(workbox.globIgnores).toEqual(['pack/pack.json', 'voice/**']);
  });

  it('keeps the referral file of a deployment offline: who to call works in airplane mode', () => {
    expect(workbox.globPatterns).toContain('config/*.json');
    expect(workbox.globIgnores.some((pattern) => pattern.startsWith('config'))).toBe(false);
  });
});
