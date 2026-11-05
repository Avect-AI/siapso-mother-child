// SPDX-License-Identifier: MIT
// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { referralFileWarning, workbox } from '../../vite.config.js';

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

  it('never answers a /config/ request with the app page: a missing file stays missing', () => {
    const denied = (path: string) =>
      workbox.navigateFallbackDenylist.some((rule) => rule.test(path));
    expect(denied('/config/referral.json')).toBe(true);
    expect(denied('/siapso/config/referral.json')).toBe(true);
    expect(denied('/#/danger/call')).toBe(false);
  });
});

describe('build warning for the referral file', () => {
  it('is loud when the deployment has no public/config/referral.json', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'siapso-public-'));
    try {
      const warning = referralFileWarning(empty);
      expect(warning).toMatch(/WARNING/);
      expect(warning).toMatch(/config\/referral\.json/);
      // It says what the phones will show without it.
      expect(warning).toMatch(/1515/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  /** referralFileWarning over a public folder whose config/referral.json holds `text`. */
  function warningFor(text: string): string | null {
    const publicDir = mkdtempSync(path.join(tmpdir(), 'siapso-public-'));
    try {
      mkdirSync(path.join(publicDir, 'config'));
      writeFileSync(path.join(publicDir, 'config', 'referral.json'), text);
      return referralFileWarning(publicDir);
    } finally {
      rmSync(publicDir, { recursive: true, force: true });
    }
  }

  it('says nothing when the file is there and read whole', () => {
    expect(warningFor('{"contacts":[]}')).toBeNull();
    // Entries left empty, as in the example, are not mistakes.
    const example = readFileSync(
      fileURLToPath(new URL('../../public/config/referral.example.json', import.meta.url)),
      'utf8',
    );
    expect(warningFor(example)).toBeNull();
  });

  it('is loud when the file is not valid JSON: the phones would read it as no file', () => {
    const warning = warningFor('{ "contacts": [');
    expect(warning).toMatch(/WARNING/);
    expect(warning).toMatch(/not valid JSON/);
  });

  it('is loud about each entry of the file the phones would leave out', () => {
    const warning = warningFor(
      JSON.stringify({
        contacts: [
          { role: 'icp', name: 'Poste de santé', phone: '000 000 003' },
          { role: 'doctor', name: 'X', phone: '000000' },
          { role: 'midwife', name: '', phone: 'abc' },
        ],
        emergencyNumbers: [{ name: { fr: 'le SAMU', en: '' }, phone: '000' }],
      }),
    );
    expect(warning).toMatch(/WARNING/);
    expect(warning).toMatch(/contacts\[1\]/);
    expect(warning).toMatch(/contacts\[2\]/);
    expect(warning).toMatch(/emergencyNumbers\[0\]/);
    expect(warning).not.toMatch(/contacts\[0\]/);
  });
});
