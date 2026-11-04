// SPDX-License-Identifier: MIT
// @siapso/speech: French and Wolof voice input with an open model running in
// the browser, offline. The model only proposes text: the resolver proposes
// candidates, the user confirms one, and the engine alone decides the level.
export { SPEECH_SAMPLE_RATE, resampleTo16k } from './resample.js';
export {
  MAX_RECORDING_MS,
  createRecorder,
  type Recorder,
  type RecorderOptions,
} from './capture.js';
export {
  DEFAULT_VOICE_PACK_URL,
  MANIFEST_FILE,
  RUNTIME_FILES,
  VOICE_CACHE,
  VOICE_PACKS,
  VoicePackError,
  installVoicePack,
  isVoicePackInstalled,
  removeVoicePack,
  voicePackInfo,
  voicePackUrl,
  type VoicePackErrorReason,
  type VoicePackFile,
  type VoicePackInfo,
} from './voice-pack.js';
export {
  createSpeechClient,
  type SpeechClient,
  type TranscribeOptions,
  type Transcription,
} from './client.js';
