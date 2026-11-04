# Plan D: offline French and Wolof voice input

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Say a medicine or remedy name in French or Wolof, in airplane mode, and get candidates to confirm; with an honest, reproducible measure of accuracy and a documented open model.

**Architecture:** An open Whisper-small model fine-tuned on Wolof (`M9and2M/whisper-small-wolof`, MIT) is converted to ONNX in the Transformers.js layout by a reproducible Python script, quantised to 8 bits, and served as an optional voice pack from the app origin (`/voice/<model>/`). `@siapso/speech` runs Transformers.js in a Web Worker (WebAssembly backend, WebGPU when present), captures audio with `getUserMedia`, resamples to 16 kHz mono and keeps it in memory only. The transcription goes to the resolver; the user confirms a candidate; the engine decides the level. Spec: section 8 of `docs/superpowers/specs/2026-11-03-implementation-design.md`.

**Tech Stack:** `@huggingface/transformers@4.3.1`; Python 3.10+ in a virtual environment for conversion and evaluation (`torch` CPU, `transformers`, `optimum[onnxruntime]`, `onnx`, `onnxruntime`, `datasets`, `soundfile`, versions pinned in `speech/convert/requirements.txt`, each published on or before 2026-10-20).

## Global Constraints

- Same as Plan C (language, hygiene, commits with `Refs: SCRUM-<n>`, SPDX, dependencies at least 14 days old, interface strings in `app/src/i18n/`, forbidden wording, accessibility, impeccable critique and detect for screens, local shell setup).
- Audio never leaves the phone and is never stored: no upload, no IndexedDB or Cache API storage of audio, buffers dropped after transcription.
- No audio output and no voice synthesis anywhere (answers stay text).
- Models propose, rules decide: a transcription only ever produces candidates for confirmation.
- Model weights and converted files are never committed (`*.onnx`, `app/public/voice/` and `speech/convert/out/` are git-ignored). Meta MMS and any non-commercial data are excluded.
- Python runs through `sh tools/hygiene/py.sh` to create the virtual environment (`speech/convert/.venv`, git-ignored); then the venv's own interpreter.

---

### Task 16 (SCRUM-30): the model in the browser, offline

Branch `feat/SCRUM-30-voice-runtime`.

**Files:** `speech/convert/convert.py`, `speech/convert/requirements.txt`, `speech/convert/README.md`, `speech/src/worker.ts`, `speech/src/client.ts`, `speech/src/capture.ts`, `speech/src/resample.ts`, `speech/src/voice-pack.ts`, `speech/src/index.ts`, tests in `speech/test/`, `app/vite.config.ts` (Workbox: never precache `/voice/`; navigation fallback excludes it), root scripts `voice:convert` and `voice:install-local`, `.gitignore`, `docs/voice.md`, `CHANGELOG.md`.

**Interfaces:**
```ts
export const SPEECH_SAMPLE_RATE = 16000;
export const MAX_RECORDING_MS = 8000;
export interface VoicePackInfo { id: string; baseUrl: string; files: { path: string; bytes: number }[]; totalBytes: number; licence: string }
export function voicePackInfo(): Promise<VoicePackInfo>;              // reads <baseUrl>/voice-pack.json written by the conversion script
export function isVoicePackInstalled(info: VoicePackInfo): Promise<boolean>; // every file present in the Cache API cache used by Transformers.js
export function installVoicePack(info: VoicePackInfo, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void>;
export function removeVoicePack(info: VoicePackInfo): Promise<void>;
export interface SpeechClient { load(onProgress?: (p: number) => void): Promise<void>; transcribe(samples: Float32Array): Promise<{ text: string; ms: number }>; dispose(): void }
export function createSpeechClient(info: VoicePackInfo): SpeechClient;  // spawns the worker
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array; // pure, tested
export interface Recorder { start(): Promise<void>; stop(): Promise<Float32Array>; level(): number; cancel(): void }
export function createRecorder(): Recorder;  // getUserMedia mono, stops itself at MAX_RECORDING_MS
```
The worker configures Transformers.js with `allowRemoteModels = false`, `allowLocalModels = true`, `localModelPath` set to the voice pack base URL, browser cache enabled, `dtype: 'q8'`, `device: 'webgpu'` when `navigator.gpu` is available else `'wasm'`; it never fetches from the Hugging Face hub at run time.

**Conversion (`pnpm voice:convert`):** creates the venv, installs pinned requirements, downloads `M9and2M/whisper-small-wolof` at a pinned revision (commit hash recorded in the script), exports to ONNX with past key values (encoder, merged decoder), quantises to int8 (dynamic quantisation of MatMul), copies tokenizer and config files, writes `voice-pack.json` (id, files with bytes and sha256, total size, licence `MIT`, source revision) into `speech/convert/out/whisper-small-wolof-q8/`. `pnpm voice:install-local` copies that folder to `app/public/voice/whisper-small-wolof-q8/` for local preview and phone tests. Record the pack size.

**French check:** run the converted model on 20 French utterances of the FLEURS `fr_fr` test split (CC BY 4.0) and 20 Wolof utterances of FLEURS `wo_sn` test, and compute the word error rate of each (script `speech/convert/quick_check.py`, results in the PR). If French WER is above 40 percent, also convert `openai/whisper-base` (MIT) the same way as a French pack and make the language a choice in the voice pack metadata (`languages: ['wo']` and `languages: ['fr']`); otherwise one pack serves both. Record the decision in `docs/voice.md`.

**Tests (first):** `resampleTo16k` (length ratio, a 1 kHz sine keeps its frequency, 16 kHz input unchanged); `voicePackInfo` and `isVoicePackInstalled` with a fake fetch and fake Cache API; `installVoicePack` progress reaches total and supports abort; the client posts and receives worker messages (worker mocked); the recorder stops at `MAX_RECORDING_MS` (fake media stream); a Workbox config test asserts `/voice/` is not precached.

**Measured evidence (in the PR, not in CI):** a Playwright script (`speech/bench/bench.spec.ts`, excluded from the default e2e run) loads the app preview with the installed pack, goes offline, feeds a fixed 3 to 5 second Wolof utterance (from FLEURS `wo_sn`, CC BY 4.0, stored under `speech/bench/fixtures/` with attribution) directly to the client, and records the transcription time with no throttling and with CPU throttling 4x and 6x (Chrome DevTools Protocol `Emulation.setCPUThrottlingRate`) as approximations of mid-range and entry-level phones. Note that real-phone timings must be measured by the team.

- [ ] Steps: branch; tests first; implement; run the conversion; install locally; run the bench; full verification; PR `feat(speech): run the open speech model offline in the browser`, `Refs: SCRUM-30`, body with pack size, timings, French check and licences checked.

---

### Task 17 (SCRUM-31): voice input in the search

Branch `feat/SCRUM-31-voice-input`.

**Files:** `app/src/screens/Search.tsx` (microphone button), `app/src/screens/VoicePack.tsx` (install screen), `app/src/domain/voice-flow.ts` (+ test), `app/src/i18n/*`, tests, `app/e2e/voice.spec.ts` (with a mocked speech client), `CHANGELOG.md`.

**Behaviour:** a large microphone button next to the search field. If the voice pack is not installed, the button opens VoicePack: size in megabytes, advice to install on wifi at the health post, an install button with progress and cancel, and a remove button once installed. When installed: tap to start, tap again to stop (or it stops at 8 seconds), with a visible recording state (pulsing ring respecting reduced motion, elapsed seconds) and a cancel button; then "Je réfléchis..." while transcribing; the transcription is shown as text ("J'ai entendu : ...") and fed to the resolver; candidates appear exactly as typed search results and must be confirmed; when there is no candidate, the screen says so and offers to type the name or choose from the list. Microphone permission denied: explain in words how to allow it and offer typing. Voice is optional everywhere: the keyboard path stays complete.

**Tests:** `voice-flow` state machine (idle, recording, transcribing, heard with candidates, heard without candidate, error, permission denied, cancelled); no item is added without confirmation; the install screen shows size and progress; e2e with a mocked client: say "nebeday", see Moringa, confirm, item added; airplane mode with the mock.

- [ ] Steps as in Plan C; PR `feat(app): add voice input to the product search`, `Refs: SCRUM-31`.

---

### Task 18 (SCRUM-32): voice evaluation set and accuracy measure

Branch `feat/SCRUM-32-voice-eval`.

**Files:** `eval/speech/README.md` (protocol, consent, recording guide, data layout), `eval/speech/consent-form.fr.md` and `consent-form.en.md` (template for volunteers, no patient), `eval/speech/manifest.schema.json`, `eval/speech/manifest.yaml` (empty list until recordings exist), `speech/eval/run.ts` (or `.py`), `speech/eval/wer.ts` (+ test), root script `eval:speech`, `eval/speech/results/` (committed result files), `CHANGELOG.md`.

**Manifest entry:** `file` (relative path to audio under `eval/speech/audio/`), `text` (reference transcription), `lang` (`fr`, `wo`, `mix`), `expect` (product or plant id, optional), `speaker` (pseudonymous id), `consent` (consent record reference kept outside the repository), `licence` (`CC-BY-4.0`).

**Measures:** word error rate (normalised: lowercase, accents kept for French, punctuation removed) per language; name accuracy after the resolver (top-1 and top-3) for entries with `expect`; time per utterance. `pnpm eval:speech` runs the same ONNX model in Node (Transformers.js) on the manifest and writes `eval/speech/results/<date>-<model>.json` and a Markdown summary; reproducible with one command. Baseline now: FLEURS `wo_sn` and `fr_fr` test subsets (100 utterances each, CC BY 4.0, downloaded at run time into the scratchpad, not committed; the result file records the dataset revision). Product name accuracy needs the volunteer recordings: the README states this, and the result summary marks the name measure as "pending recordings".

- [ ] Steps: tests first for WER and manifest validation; implement; run the FLEURS baseline; PR `feat(eval): add the voice evaluation set and accuracy measure`, `Refs: SCRUM-32`, body with the baseline figures and the honest statement of what is pending.

---

### Task 19 (SCRUM-33): model card

Branch `docs/SCRUM-33-model-card`.

**Files:** `speech/MODEL_CARD.md`, `speech/LICENSES.md` (licences of the model chain and of the data), `docs/voice.md` (update), `CHANGELOG.md`.

**Content:** model origin (OpenAI Whisper small, MIT; fine-tune `M9and2M/whisper-small-wolof`, MIT, with its card's figures: 57 h training, 10 h test, WER 0.17 on its own test set), the conversion and quantisation (script, revision, sizes), intended use (recognising medicine and remedy names to propose candidates; never a decision), languages, measured results from Task 18 with dataset revisions, known limitations (one word in six wrong on its own test, French degradation measured, accents and code switching, noisy environments, children's and elderly voices untested), privacy (on device, no storage), training data and licence status: for each component of `M9and2M/Wolof_ASR_dataset` (as listed on its card: ALFFA, FLEURS, Waxal Wolof, Wolof TTS corpus) the licence found on its own source page with the URL opened, and "unverified" where not found; statement that no non-commercial data is used by SIAPSO and that Meta MMS is excluded; publication steps for the team (Hugging Face organisation, private repository during development, upload command), not executed.

- [ ] Steps: research licences (open each source page, quote the licence line), write, verify links, PR `docs(speech): add the speech model card`, `Refs: SCRUM-33`.
