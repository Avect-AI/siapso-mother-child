<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Voice input

Say a medicine or remedy name in Wolof or French, with no network, and get candidates to confirm. The speech model only proposes text: the resolver proposes candidates, the user confirms one, and the deterministic engine alone decides the level. Keyboard search works without any of this.

## Packs

The model is an optional voice pack, downloaded on request (on wifi at the health post, for example), stored in the Cache API and read from there with no network. One pack per language:

| Pack id                  | Source (revision)                                                          | Licence | Language | Served size (model + ONNX Runtime + notices)     |
| ------------------------ | -------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------ |
| `whisper-small-wolof-q8` | `M9and2M/whisper-small-wolof` (`8cc20b3c6e77ecb490210103d3b4fd0b85c3d1d8`) | MIT     | Wolof    | 325,620,637 bytes, 325.6 MB (298.7 MB + 26.9 MB) |
| `whisper-base-fr-q8`     | `openai/whisper-base` (`e37978b90ca9030d5170a5c07aadb050351a65bb`)         | MIT     | French   | 137,164,324 bytes, 137.2 MB (110.2 MB + 26.9 MB) |

Licence chain:

- Models: OpenAI Whisper small and base (OpenAI states in the README of `github.com/openai/whisper` that the code and model weights are released under the MIT License; the Hugging Face cards of `openai/whisper-small` and `openai/whisper-base` declare apache-2.0, also permissive), and the fine-tune `M9and2M/whisper-small-wolof` (MIT, declared on its card, checked at the revision above).
- Training data of the fine-tune: its dataset `M9and2M/Wolof_ASR_dataset` lists ALFFA, WAXAL, FLEURS (`google/fleurs`, `wo_sn`) and a Wolof TTS corpus on Zenodo; the dataset card states no licence for them. Each source was checked on its own page (`speech/LICENSES.md`): FLEURS CC-BY-4.0 and the Zenodo Wolof TTS corpus CC-BY-4.0 are verified, WAXAL is CC-BY-SA-4.0 (share-alike effect on the weights unresolved), ALFFA Wolof audio is unverified (no data licence stated). The model card, ready for Hugging Face, is `speech/MODEL_CARD.md`. Meta MMS and non-commercial data are not used by SIAPSO.
- Runtime: Transformers.js 4.3.1 (Apache-2.0, Copyright Hugging Face), with `@huggingface/tokenizers` 0.2.0 (Apache-2.0) and `@huggingface/jinja` 0.5.10 (MIT), bundled in the speech worker; ONNX Runtime Web `1.31.0-dev.20260914-8d85527a0` (MIT, Copyright Microsoft Corporation). The worker source carries a preserved licence comment (`/*! ... */`, kept in the built chunk) that points to the texts, and each pack ships them: `licenses/` (Transformers.js, tokenizers and jinja licence files, the MIT texts of ONNX Runtime and Whisper) and `NOTICE.md`.

Each pack holds `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx` (8-bit weights), the Whisper configuration and tokenizer files, the ONNX Runtime Web files (`runtime/`), the licence texts (`licenses/`, `NOTICE.md`) and `voice-pack.json` (files with size and sha256, licence, languages, decoder prompt, source revision). The pack folder is served from the app origin, by default `voice/<pack id>/` next to the app (`VOICE_PACKS` in `@siapso/speech`). How a pack is built: `speech/convert/README.md`.

## The French decision

Measured with `speech/convert/quick_check.py` on the first 20 sentences of the FLEURS test splits (CC BY 4.0, revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`), 8-bit graphs, decoded as in the browser (greedy, the same prompt and suppressed tokens, at most 96 new tokens); word error rate after lowercasing and removing punctuation, accents kept:

| Pack                     | Language (FLEURS, words) | Prompt `<\|startoftranscript\|>` alone | Prompt `<\|startoftranscript\|><\|fr\|><\|transcribe\|><\|notimestamps\|>` |
| ------------------------ | ------------------------ | -------------------------------------- | -------------------------------------------------------------------------- |
| `whisper-small-wolof-q8` | Wolof (`wo_sn`, 441)     | **55.6 %**                             | 72.1 %                                                                     |
| `whisper-small-wolof-q8` | French (`fr_fr`, 534)    | 93.3 %                                 | 69.3 %                                                                     |
| `whisper-base-fr-q8`     | French (`fr_fr`, 534)    | 125.8 %                                | **30.0 %**                                                                 |

The first measure decoded up to 448 tokens: the same 55.6 %, 69.5 % and 30.0 % in the cells that matter; the other cells were higher (129.2 %, 112.9 %, 257.3 %) because a wrong prompt makes the model repeat itself, and the 96-token limit cuts those loops short.

- The Wolof fine-tune was trained with `<|startoftranscript|>` alone: right after it, the model writes Wolof text, with no language, task or timestamp token, even for French audio. Transformers.js would otherwise add `<|en|><|transcribe|><|notimestamps|>` (it has no language detection), so the pack records its decoder prompt and the worker passes it.
- French through the Wolof fine-tune is above the 40 percent limit of the plan (69.3 %, with Wolof-like spellings of French words). Decision: French uses its own pack, built the same way from the multilingual Whisper base model (30.0 %), and the language is a choice: each pack declares `languages: ['wo']` or `languages: ['fr']`. The voice screen (SCRUM-31) offers the language and says which model it uses.
- The Wolof figure may be optimistic: the fine-tune's training dataset (`M9and2M/Wolof_ASR_dataset`) lists `google/fleurs` `wo_sn` among its sources without saying which splits, so some of these FLEURS test sentences may have been seen in training. The fine-tune's card gives a word error rate of 0.17 on its own test set. Only consented recordings that were never used for training measure the model fairly (SCRUM-32).
- Part of the Wolof error rate is spelling: Wolof spelling varies (`nuy` and `ñuy`, `diwaan` and `diiwaan`, `gëna` and `gën`), and each variant counts as an error. Name accuracy after the resolver is what matters for SIAPSO; it is measured on consented recordings in SCRUM-32.
- Quantising the token embedding (Gather) to int8 as well as MatMul saves 120 MB on the Wolof pack. With the Wolof prompt, the only one the Wolof pack uses, the loss is not measurable: 55.6 % against 56.7 % with MatMul only (decoding up to 448 tokens). That holds for the Wolof prompt only: with the French prompt the two graphs swung widely, both ways (Wolof 129.2 % against 62.4 %, French 69.5 % against 103.2 %), because of repetition loops. The MatMul-only graphs were not kept, so this comparison was not repeated with the 96-token limit.

## Runtime

- `@siapso/speech` runs Transformers.js 4.3.1 in a dedicated Web Worker (`createSpeechClient`). The worker sets `allowRemoteModels = false`, `allowLocalModels = true`, `localModelPath` to the folder of the pack, the browser cache on with `cacheKey` set to the cache that `installVoicePack` fills (`transformers-cache`), `dtype: 'q8'`, and `device: 'webgpu'` when `navigator.gpu` gives an adapter, else `'wasm'` (and falls back to WebAssembly if WebGPU fails to start).
- Nothing is downloaded without the user's consent. The client first checks that every file of the pack is installed (`VoicePackError` `unavailable` otherwise, and the worker is not asked to load). The worker's `fetch` never uses the network: it answers files listed by the pack from the Cache API only, a file that is not installed answers 404 (a load error, never a download), and any other URL is refused, so it never reaches the Hugging Face hub or a CDN (tested in `speech/test/runtime-config.test.ts`; the bench checks in a browser that a load before installation fails and fetches no model file, and that nothing at all is requested once offline).
- ONNX Runtime Web loads its binaries (`runtime/ort-wasm-simd-threaded.asyncify.{mjs,wasm}`) from the pack, not from the jsDelivr CDN that Transformers.js uses by default.
- Errors reach the page as `VoicePackError` with a reason for the voice screen: `unavailable` (not installed), `invalid`, `storage`, `download`, `load` (the model did not start), `transcribe`. Transcriptions run one at a time, in order; a load or a transcription that gets no answer within 60 seconds (`timeoutMs` option) is given up, and the next one still runs.
- `installVoicePack` streams every file into the Cache API cache that Transformers.js reads (`transformers-cache`, fetched with `cache: 'no-store'` so it is not also kept in the HTTP cache), with progress, cancel and resume (files already stored are kept), checks the free storage first and asks for persistent storage; `isVoicePackInstalled` checks every file; `removeVoicePack` deletes them. `voicePackInfo` reads `voice-pack.json`, and uses the installed copy when offline or when the server answers with something else than JSON.
- The microphone (`createRecorder`) records one channel in an audio worklet, keeps the samples in memory only, stops by itself after 8 seconds (`MAX_RECORDING_MS`) and releases the microphone at once. Each start owns its own microphone stream: a start cancelled during the permission prompt and answered late closes only its own stream. `resampleTo16k` brings the audio to 16 kHz with a low-pass filter. The samples are transferred to the worker (the page keeps no copy) and dropped after transcription. Audio is never stored or sent, and nothing is ever played back.
- Decoding stops after 96 new tokens, enough for a name or a short sentence.
- The service worker never precaches `voice/` and never answers a `voice/` request with the app page (`app/vite.config.ts`, tested in `app/src/pwa/workbox.test.ts`).

## Commands

- `pnpm voice:convert`: build the packs into `speech/convert/out/` (`speech/convert/README.md`).
- `pnpm voice:install-local`: copy them, with the ONNX Runtime files and the licence texts, to `app/public/voice/` for local preview and phone tests (`docs/testing.md`).
- `pnpm eval:speech`: word error rate of the packs on FLEURS and on consented volunteer recordings, with Transformers.js in Node; protocol, consent forms and committed results in `eval/speech/`. Baseline of 2026-11-04 (100 sentences per language): Wolof pack 54.1 % on `wo_sn`, French pack 30.3 % on `fr_fr`. Name accuracy is pending recordings.
- Conversion tool versions (hashed lock `speech/convert/requirements.txt`, moved to patched versions on 2026-11-05, alerts in `docs/dependencies.md`): torch 2.10.0 (CPU build), onnx 1.22.0, onnxruntime 1.23.2, transformers 4.57.6, optimum 2.1.0, optimum-onnx 0.1.0, filelock 4.2.1 (Python 3.11 and 3.12; 4.1.0 on 3.10). After the move, the French pack was converted again and the 20-sentence FLEURS check gave the same 30.0 % (534 words) as before.
- `pnpm voice:bench`: the timing bench below (`BENCH_PORT`, default 4180; `BENCH_OUT` writes the JSON report).

## Timings

Measured with `pnpm voice:bench` on 2026-11-04 on a laptop (Windows 11, 12 logical cores, headless Chromium 156 from Playwright 1.64.1): Wolof pack, the 3.3-second FLEURS utterance of `speech/bench/fixtures/`, offline (no request at all after going offline, and none ever outside the bench origin). Headless Chromium had no WebGPU adapter, so the model ran on WebAssembly. Without cross-origin isolation, which is how the app is served today, ONNX Runtime uses one thread.

| Measure                                                            | One thread | Cross-origin isolated (several threads) |
| ------------------------------------------------------------------ | ---------- | --------------------------------------- |
| Model load from the Cache API, in the worker                       | 2.9 s      | 2.6 s                                   |
| Transcription in the worker, first                                 | 13.8 s     | 7.3 s                                   |
| Transcription in the worker, median of 3                           | 13.1 s     | 6.7 s                                   |
| Same pipeline on the page thread, median of 3, no throttling       | 13.2 s     | 6.5 s                                   |
| Page thread, CPU throttling 4x (stand-in for a mid-range phone)    | 73.8 s     | not measured                            |
| Page thread, CPU throttling 6x (stand-in for an entry-level phone) | 122.7 s    | not measured                            |

- Chrome DevTools CPU throttling does not reach workers (the worker at 4x took 14.1 s, as without throttling), so the throttled runs use the same pipeline and settings on the page thread. With threads, ONNX Runtime computes in workers, so throttling means nothing there.
- Whisper always encodes a 30-second window: a short name costs almost as much as a long sentence. The encoder dominates.
- Runs vary on one machine: an earlier run gave a 16.8-second median in the worker.
- Transcription of the fixture: "gërpidamil bi ci giza doom moo taxaw ba tey" (reference: "great pyramid bi ci giza dong mo taxaw batay").
- What this means: on one thread, the stand-in for an entry-level phone needs about two minutes per utterance, which is not usable. Several threads halve the time on the laptop. The ways forward are cross-origin isolation for the app (COOP and COEP headers, or a service worker that adds them), and a lighter Wolof model (SCRUM-42).

### What the team must measure on real phones

Throttling only approximates a phone. Before the voice screen ships, measure on at least one entry-level Android phone (about 2 GB of memory) and one mid-range phone, in Chrome:

1. transcription time for a 2-second name and an 8-second sentence, Wolof and French packs, with and without cross-origin isolation;
2. model load time and memory (a 2 GB phone may close the tab);
3. download time on the health post wifi and on mobile data, storage used, whether persistent storage is granted, and whether the pack is still there after a week;
4. whether WebGPU is offered, and whether it is faster with these 8-bit graphs;
5. battery and heat over ten transcriptions;
6. accuracy with real voices and background noise (SCRUM-32).

To run the bench page on a phone: `pnpm --filter @siapso/speech exec vite build --config bench/vite.config.ts`, then `pnpm --filter @siapso/speech exec vite preview --config bench/vite.config.ts`, forward port 4180 over USB (`docs/testing.md`) and call `siapsoBench` from the remote DevTools console.

## Lighter model (SCRUM-42)

Goal: under 100 MB and usable on an entry-level phone. Measured on 2026-11-05 (`eval/speech/results/2026-11-05-4bit-summary.md`): 4-bit weights (MatMulNBits, block 32, embedding kept in int8) take the Wolof model files from 298.7 MB to 207.8 MB and the FLEURS word error rate from 54.1 % to 57.1 %; the French base pack goes from 110.2 MB to 83.0 MB and from 30.3 % to 32.1 % (100 sentences each, Node). Quantisation alone does not reach 100 MB for Whisper small, and 4-bit weights were not faster (Node, and a WebAssembly run of the encoder): they cut download and memory, not compute. The way to under 100 MB is a smaller model (Whisper base 4-bit is 83 MB), which must be fine-tuned for Wolof: that needs a GPU and consented data, so `speech/train/` holds the plan (`README.md`: data, licences, CNERS opinion, consent), the script (`finetune.py`, not run) and the options with sizes (`distill.md`).

Browser support: Transformers.js 4.3.1 has the `q4` data type, and the ONNX Runtime Web build it pins contains the `MatMulNBits` operator and ran the 4-bit encoder and a decoder step in WebAssembly in Node (`speech/eval/wasm-q4-check.mjs`, output `eval/speech/results/2026-11-05-wasm-q4-check.json`; the encoder took 3.1 s against 2.1 s in 8-bit, one run on synthetic input, indicative only). A committed test (`speech/test/wasm-matmulnbits.test.ts`) checks that the pinned WebAssembly binaries contain `MatMulNBits` and run a 4-bit fixture correctly. Not tested in a browser or on a phone, and the app's worker and the pack manifest only know `q8` today.

## For the voice screen (SCRUM-31)

- Build the app's worker as an ES module (`worker: { format: 'es' }`) and resolve ONNX Runtime Web with the `onnxruntime-web-use-extern-wasm` condition, as `speech/bench/vite.config.ts` does; otherwise Vite copies a 25 MB wasm file into the app bundle.
- The worker chunk is about 500 KB (minified): it counts in the app budget and the service worker precaches it, so the voice screen works offline once the pack is installed. Load the client only on the voice screen.
- Show the pack size before the download, and the language of each pack.

## Known limits

- Each pack carries its own copy of the ONNX Runtime binaries (26.9 MB): installing both packs stores them twice.
- Without cross-origin isolation (COOP and COEP headers), ONNX Runtime runs on one thread: see the timings.
- WebGPU is not measured (no adapter in headless Chromium). The 8-bit graphs may run partly on the CPU under WebGPU: measure before relying on it.
- ONNX Runtime Web is the build that Transformers.js 4.3.1 pins (`1.31.0-dev.20260914-8d85527a0`).
- Safari before version 26 without WebGPU is not tested.
- A new version of a pack at the same URL is not detected: files already in the cache are kept by path, and their sha256 is not checked on the phone (hashing 200 MB would need the whole file in memory). Remove the pack, then install it again; versioned and signed packs come with SCRUM-38.
- The 60-second time limit may be short for a first load on a slow phone (300 MB read from storage, then compiled): measure it, and raise `timeoutMs` if needed.
- When a recording stops, its last incomplete audio worklet block (under 2048 samples, 43 ms at 48 kHz) is dropped.
