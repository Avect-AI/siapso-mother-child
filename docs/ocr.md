<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Prescription reading (OCR pack)

Read the text of a prescription on the phone, from a photo or a PDF, with no network, so that the products it names can be proposed for her to confirm (SCRUM-57; design and spike: `docs/superpowers/specs/2026-11-05-prescription-scan-design.md`). The OCR only gives lines of text: the app reads them into candidate products (phase 1, the reading), she confirms each one, and the deterministic engine alone decides the level. Typing and voice work without any of this.

This page covers `@siapso/ocr` (phase 2: the pack, the worker, the install script and the bench) and the PDF reading inside the pack (phase 4). The screens (phase 3) wait for the check screen of SCRUM-56; the app does not import `@siapso/ocr` yet.

## The pack

The models are an optional pack, "Lecture d'ordonnance", downloaded on request (on wifi at the health post), stored in a Cache API cache of its own (`siapso-ocr-pack`) and read from there with no network, as the voice pack is (`docs/voice.md`).

| Pack id                | Content                                                                                                                         | Licences                                        | Size (bytes, measured by `pnpm ocr:install-local`) |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `ppocrv5-mobile-latin` | PaddleOCR PP-OCRv5 mobile text detection and Latin text recognition (ONNX), ONNX Runtime Web (plain SIMD build), pdf.js 6.4.299 | Apache-2.0 (models, pdf.js), MIT (ONNX Runtime) | 28,907,963 (28.9 MB), 16.07 MB with gzip           |

Each file of the pack, raw and with gzip (level 9):

| File                                                                | Bytes      | With gzip |
| ------------------------------------------------------------------- | ---------- | --------- |
| `models/det.onnx` (detection)                                       | 4,826,518  | 4,530,401 |
| `models/rec-latin.onnx` (Latin recognition)                         | 8,042,023  | 7,317,099 |
| `models/dict-latin.json` (the 836 characters of the recogniser)     | 4,291      | 1,804     |
| `runtime/1.31.0-dev.20260914-8d85527a0/ort-wasm-simd-threaded.wasm` | 14,264,838 | 3,695,787 |
| `runtime/1.31.0-dev.20260914-8d85527a0/ort-wasm-simd-threaded.mjs`  | 24,381     | 9,124     |
| `pdf/6.4.299/pdf.worker.min.mjs`                                    | 1,264,342  | 375,659   |
| `pdf/6.4.299/pdf.min.mjs`                                           | 458,904    | 132,108   |
| `licenses/` (3 texts) and `NOTICE.md`                               | 22,666     | 8,451     |

`ocr-pack.json` lists every file with its size and SHA-256, the licence, the source repository, revision and licence of each model, and the ONNX Runtime Web and pdf.js versions (`runtime`). The pack folder is served from the app origin, by default `ocr/ppocrv5-mobile-latin/` next to the app (`OCR_PACK_URL`), never from a CDN or the Hugging Face hub at run time. Where the models come from, their revisions, hashes and licences: `ocr/MODEL_CARD.md` and `ocr/LICENSES.md`.

- **Install** (`installOcrPack`): only the install action downloads. Every file is streamed into the cache with progress, cancel and resume (files already stored are kept), after a free storage check and a request for persistent storage; each file is then checked by size and SHA-256 (the largest is 14 MB), and a damaged file is deleted (`invalid`). The manifest goes in last. Files of the folder that the pack no longer lists (an older runtime) are dropped.
- **Installed or not** (`installedOcrPackInfo`, `storedOcrPackBytes`): read from the cache only, never from the network: a screen can say whether the reading is ready, or how much an installation cut short kept, with no request.
- **Versions**: the runtime files are the ONNX Runtime Web build the speech worker pins (`ORT_WEB_VERSION`, `1.31.0-dev.20260914-8d85527a0`), so one ONNX Runtime ships in the app; they live under `runtime/<version>/`, and pdf.js under `pdf/<version>/`. A pack for another version reads as to install again, and only those files download. `ocr/test/versions.test.ts` fails when the installed `onnxruntime-web` or `pdfjs-dist` moves without the constants, and `pnpm ocr:install-local` refuses another installed version.
- **Remove** (`removeOcrPack`): deletes every file of the pack folder from the cache, with or without a finished installation.
- **Service worker**: never precaches `ocr/` and never answers an `ocr/` request with the app page (`app/vite.config.ts`, `app/src/pwa/sw-setup.ts`, tested). `pnpm budget:app` leaves `ocr/` out (a local build after `pnpm ocr:install-local` copies it).

## Runtime

- `createOcrClient(info)` starts no worker until the first reading. A reading before the pack is installed fails as `unavailable` with no worker started and no request (tested with a counting fetch, and in the bench). A file that is not an image or a PDF (its first bytes, never its name), larger than 20 MB, or a photo of more than 40 megapixels (its header) is refused before any model loads (`not-image`, `too-large`).
- The worker (`ocr/src/worker.ts`, one reading at a time) reads the pack from the cache only: ONNX Runtime's loader is imported from a blob address of the worker and its WebAssembly handed over as bytes, so the runtime fetches nothing; the worker's own `fetch` is replaced by one that answers only the pack's files from the cache and refuses every other address. pdf.js is loaded from the pack the same way, its parsing code in this very worker (no nested worker).
- A photo is decoded once (`createImageBitmap`, shrunk while decoding when larger than needed), brought to 2000 pixels on its long side, and read: detection at 960 pixels on the long side (multiples of 32, BGR, ImageNet mean and deviation), the probability map turned into oriented boxes (threshold 0.3, box score 0.6, unclip 1.5, as the model's `inference.yml`), each box cut along its own angle to 48 pixels high, Latin recognition, greedy CTC decoding, and the boxes put back into lines along the page's own angle (`ocr/src/pipeline.ts` and its pure modules, unit-tested on synthetic maps). A camera frame (an `ImageBitmap`) is transferred: the page keeps no copy.
- **PDF** (phase 4): the text layer of the first three pages, lines rebuilt from the item baselines (0.2 s); a page with fewer than 20 characters of text (a scan in a PDF) is drawn at 2000 pixels on an `OffscreenCanvas` and read by the OCR. A PDF with a password (`pdf-password`) or that cannot be opened (`pdf-damaged`) is said so. pdf.js runs with no XFA, no font faces, no system fonts, no WebAssembly decoders and nothing to fetch (`docs/threat-model.md`).
- A reading that does not finish within 90 seconds (`DEFAULT_READ_TIMEOUT_MS`, the models' load included) is given up as `timeout`, and its worker ended and replaced; `cancel()` stops a reading at once with its worker (`cancelled`). The models are freed (the worker ended) 3 minutes after the last reading (`OCR_IDLE_MS`), and at once by `release()`, which the screens call when the page is hidden or the app locks. A worker that crashes (memory) gives `load`; the next reading starts a new one.
- Threads: one unless the page is cross-origin isolated, then half the cores, at most four, and at most two on a phone with 2 GB of memory or less (as the voice).
- The reading worker's script (about 64 KB in the bench build) bundles the JavaScript of ONNX Runtime Web; phase 3 makes the app's service worker keep it once the pack is installed, as for the speech worker (the worker says its address when it starts), and gives its chunk a name that `assets/worker-*.js` (the speech worker) does not match.

## Privacy

- The image never leaves the phone and is never stored: the photo or the PDF goes to the worker in memory, its pixels are dropped once the lines are read, and the worker is ended a few minutes after the last reading. Nothing is written to IndexedDB, the Cache API (the pack's cache holds only the pack), local or session storage. Only the lines of text come back to the page, which keeps what the reading needs (phase 3, spec section 7.11).
- No network: the reading runs from the pack in the Cache API and works in airplane mode; the worker refuses every address outside the pack.
- Whether the pack is installed says nothing about a profile (`docs/privacy.md`, "What the phone keeps").

## The API the screens call (phase 3)

From `@siapso/ocr` (`ocr/src/index.ts`):

- `isOcrSupported()`: whether to show "Photo ou fichier de l'ordonnance" (a secure page, WebAssembly, module workers, `OffscreenCanvas`, `createImageBitmap`, the Cache API).
- `installedOcrPackInfo()`: the installed pack (cache only), or null: open the pack screen.
- `ocrPackInfo()`, `installOcrPack(info, onProgress, signal)`, `storedOcrPackBytes()`, `removeOcrPack()`: the pack screen, the only place that downloads, on her tap.
- `createOcrClient(info, { timeoutMs, idleMs })` and its `read(file or camera frame, { onProgress, signal })`, which gives `{ lines, source: 'image' | 'pdf-text' | 'pdf-scan', pages, ms }`; `cancel()`, `release()`, `dispose()`.
- `OcrPackError` and its `reason`: `unavailable`, `invalid`, `storage`, `download`, `load`, `read`, `timeout`, `cancelled`, `not-image`, `too-large`, `pdf-password`, `pdf-damaged`; `MAX_FILE_BYTES`, `MAX_PIXELS`, `MAX_SIDE`.

The lines go to the reading of phase 1 (text lines in, candidate products out), so another engine (Tesseract.js, spec approach A) can replace this one without touching the screens.

## Commands

- `pnpm ocr:install-local --models <dir>` (or `OCR_MODELS_DIR=<dir>`): builds the pack in `app/public/ocr/ppocrv5-mobile-latin/` (git-ignored) from a folder holding `det/` and `latin/`, each with `inference.onnx` and `inference.yml` as the Hugging Face repositories give them; `--download` fetches them instead from the pinned revisions. Every file is checked against its pinned size and SHA-256, the detection settings of `inference.yml` must be those the worker uses, and the dictionary is read from the recogniser's `inference.yml`. It prints each file's size, raw and with gzip. Nothing it writes is committed.
- `pnpm ocr:bench`: the timing bench below (`BENCH_PORT`, default 4181; `BENCH_OUT` writes the JSON report; `BENCH_RATES` sets the CPU throttling rates, default `1,4,6`; `BENCH_ISOLATED=1` serves the page cross-origin isolated). It is skipped with a message when the pack is not installed locally. To run it on a phone: `pnpm --filter @siapso/ocr exec vite build --config bench/vite.config.ts`, then `pnpm --filter @siapso/ocr exec vite preview --config bench/vite.config.ts`, forward port 4181 over USB (`docs/testing.md`) and call `siapsoBench` from the remote DevTools console (`installed`, `readBeforeInstall`, `install`, `read`, `readFrame`, `release`, `loadPage`, `readPage`, `cacheState`, `environment`; images as base64).

## Timings

Measured with `pnpm ocr:bench` on 2026-11-06 on the laptop of the voice timings (Windows 11, 12 logical cores, headless Chromium 156 from Playwright 1.64.1), one thread (the page was not cross-origin isolated), on a synthetic printed prescription made by the bench (fake names; a clean scan, a phone photo turned and tilted, a text PDF and a scanned PDF of the photo):

| Measure                                                                 | Time                    |
| ----------------------------------------------------------------------- | ----------------------- |
| Installation from the local server (28.9 MB, sizes and SHA-256 checked) | 0.6 s                   |
| Models' load in the worker, from the Cache API                          | 0.7 s                   |
| Clean scan, in the worker                                               | 2.4 s                   |
| Phone photo (JPEG), in the worker                                       | 2.1 s                   |
| Camera frame (the photo as an `ImageBitmap`), in the worker             | 2.2 s                   |
| Text PDF (pdf.js text layer), in the worker                             | 0.19 s                  |
| Scanned PDF (page drawn, then the OCR), in the worker                   | 2.1 s                   |
| Clean scan on the page thread, CPU throttling 1x / 4x / 6x              | 2.5 s / 12.3 s / 18.7 s |

- Every reading found the four products of the page, in their lines ("1. Doliprane 1000 mg cp", "2. Amoxicilline 500 mg gél", "3. Fer + Acide folique cp : 1 cp/jour pendant 3 mois", "4. Spasfon Lyoc 80 mg"); the photo, the camera frame and the scanned PDF read "mg_gél" for "mg gél". Nothing was requested once offline, nothing outside the bench origin, and before the installation only `ocr-pack.json` (on the install action) and no worker script.
- DevTools CPU throttling does not reach workers, so the throttled runs use the same engine on the page thread (4x and 6x stand for a mid-range and an entry-level phone, as for the voice). The spike measured 3.9, 14.6 and 22.8 s with its own harness (spec section 4.6).

## What the team must measure on real phones

Before the screens ship (spec section 10), on an entry-level Android phone (about 2 GB of memory) and a mid-range one, in Chrome, with `siapsoBench`: the time per page in the worker (one thread, two threads cross-origin isolated, four); the models' load; the tab's memory with the models loaded and while reading a 2000-pixel and a 1600-pixel image, and whether Chrome closes the tab; whether 3 minutes of keeping the models is too long on a 2 GB phone; the download time on the health post wifi and on mobile data, and whether persistent storage is granted. Target: under 10 s from the shutter to the list on the mid-range phone; if missed, the performance step of the spec (phase 6) comes first.

## Known limits

- The synthetic page is printed and clean; real prescriptions (folds, stamps over the text, carbon copies, handwriting) read worse, and handwriting was not measured (spec section 8).
- `ocr-pack.json` is not signed: the pack is served from the app's own origin and each file is checked against it by SHA-256 (`docs/threat-model.md`).
- Each pack carries its own ONNX Runtime binaries: with a voice installed, the phone holds the plain build here (14.3 MB) and the asyncify build of the voice (26.9 MB).
- A PDF is read up to its third page; a QR code or a barcode is not read; Arabic script is not read.
- The 90-second time limit and the 3-minute idle time come from a laptop: set them from the phone measurements.
- WebGPU is not used (no adapter in headless Chromium, and the spike saw no gain from threads on the laptop).
