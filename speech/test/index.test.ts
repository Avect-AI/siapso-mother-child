// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { SPEECH_SAMPLE_RATE } from '../src/index.js';

it('uses the 16 kHz sample rate expected by Whisper', () => {
  expect(SPEECH_SAMPLE_RATE).toBe(16000);
});
