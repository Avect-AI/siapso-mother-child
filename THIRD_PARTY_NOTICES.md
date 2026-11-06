<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Third-party notices

Files that SIAPSO Mother-Child includes but does not author. Their licences are declared in `REUSE.toml` and the texts are in `LICENSES/`. The sources of the clinical knowledge are listed in `NOTICE` (generated from `knowledge/sources.yaml`). The licences of the speech model chain are recorded in `speech/LICENSES.md`.

## impeccable (design plugin)

- Files: `.claude/skills/impeccable/` and `.claude/agents/impeccable-*.md`. These are development tools for the interface work; they are not part of the app that is shipped to users.
- Upstream: https://github.com/pbakaus/impeccable
- Licence: Apache License 2.0 (`LICENSES/Apache-2.0.txt`). The upstream `LICENSE` ends with: "Copyright 2025 Paul Bakaus. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License." The `SKILL.md` front matter also says `license: Apache 2.0`.
- Changes: none known to the files; they are kept as installed. If you modify them, Apache-2.0 section 4(b) asks for a prominent notice of the change.
- Inside the plugin, per the upstream `NOTICE.md`: `reference/ios.md` and `reference/android.md` are distilled from `ehmo/platform-design-skills` (MIT, copyright 2026 ehmo), and `scripts/modern-screenshot.umd.js` is the `modern-screenshot` library (MIT, copyright 2021-present wxm, https://github.com/qq15725/modern-screenshot).
- `scripts/data/font-index.json` is a fingerprint index of the Google Fonts catalogue (family names, categories and measurements of renders of each family), built by the plugin's authors with their `scripts/build-font-index.mjs` from the public Google Fonts metadata. It is published in the upstream Apache-2.0 repository with no separate licence statement, and is kept here as part of the plugin (audit decision, `docs/audit/2026-11-audit.md`).

## Atkinson Hyperlegible Next (font)

- Files: `app/public/fonts/*.woff2`, licence text `app/public/fonts/OFL.txt`.
- Upstream: https://github.com/googlefonts/atkinson-hyperlegible-next
- Licence: SIL Open Font License 1.1 (`LICENSES/OFL-1.1.txt`). Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors.
- The font is self-hosted as WOFF2 files subset to Latin and Latin Extended (see `DESIGN.md`).

## FLEURS audio fixture

- File: `speech/bench/fixtures/fleurs-wo_sn-test-9405789794868564555.wav`, described in `speech/bench/fixtures/README.md`.
- Source: FLEURS (Conneau et al., 2022), Hugging Face `google/fleurs`.
- Licence: Creative Commons Attribution 4.0 International (`LICENSES/CC-BY-4.0.txt`). The file was trimmed (silence removed); the README lists the changes.

## Voice software bundled in the app

- Files: the app's speech worker (`assets/worker-*.js` in a build, downloaded only once a voice is installed) bundles Transformers.js 4.3.1 (Apache License 2.0, Copyright Hugging Face), `@huggingface/tokenizers` 0.2.0 (Apache License 2.0), `@huggingface/jinja` 0.5.10 (MIT, Copyright (c) 2023 Hugging Face) and the JavaScript of ONNX Runtime Web (MIT, Copyright (c) Microsoft Corporation); the voice packs carry the WebAssembly and loader files of the same ONNX Runtime Web build (`runtime/<version>/`).
- ONNX Runtime versions: Transformers.js 4.3.1 pins development (nightly) builds, `onnxruntime-web` `1.31.0-dev.20260914-8d85527a0` and `onnxruntime-common` `1.31.0-dev.20260911-2a43ec07e`, not releases; the evaluation tooling (`speech/eval`, Node) uses `onnxruntime-node` and `onnxruntime-common` 1.30.0. `speech/test/ort-version.test.ts` ties the pack's runtime files to the bundled version.
- The app shows them, with the Whisper models, the data of the Wolof model and the full Apache 2.0 and MIT texts, on its licences screen (`#/licences`, from About; `app/src/domain/third-party.ts`). Each voice pack also ships the texts (`licenses/`, `NOTICE.md`).
- The service worker bundles parts of Workbox 7.4.1 (MIT, Copyright Google LLC).

## Prescription reading pack (not in the repository)

- `@siapso/ocr` (SCRUM-57, `docs/ocr.md`): its reading worker (`assets/ocr-worker-*.js` in a build) bundles the JavaScript of ONNX Runtime Web (MIT, Copyright (c) Microsoft Corporation), the very build the speech worker uses (`1.31.0-dev.20260914-8d85527a0`). The app does not load it yet (the screens come in phase 3).
- The optional reading pack, built by `pnpm ocr:install-local` and never committed, carries the PaddleOCR PP-OCRv5 mobile detection and Latin recognition models (Apache License 2.0, declared on their Hugging Face cards, which name no copyright holder; the pack ships the `LICENSE` of the PaddleOCR GitHub project at a pinned commit, "Copyright (c) 2016 PaddlePaddle Authors"), the WebAssembly and loader of ONNX Runtime Web (MIT, with the `LICENSE` and `ThirdPartyNotices.txt` of ONNX Runtime at the commit the build comes from, for the third-party code its WebAssembly links), pdf.js `pdfjs-dist` 6.4.299 (Apache License 2.0, Mozilla Foundation and contributors) and the two WebAssembly decoders of scanned images pdf.js ships: `jbig2.wasm` (the JBIG2 decoder of PDFium, BSD-3-Clause and Apache License 2.0, Copyright 2014 The PDFium Authors) and `openjpeg.wasm` (OpenJPEG, BSD-2-Clause), each with its licence texts, all in `licenses/` and `NOTICE.md`. Sources, revisions and hashes: `ocr/MODEL_CARD.md` and `ocr/LICENSES.md`.
- The licences screen of the app will list them when the app ships the reading (phase 3).

## Speech model and its training data (not in the repository)

The speech model files are converted at build time from public models and are not committed. Their licence chain, including the open question on the share-alike licence of WAXAL Wolof (CC BY-SA 4.0) and the missing data licence of ALFFA Wolof, is in `speech/LICENSES.md` and `speech/MODEL_CARD.md`. This is not legal advice, and it is not settled.
