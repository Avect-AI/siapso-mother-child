<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Third-party notices

Files that SIAPSO Mother-Child includes but does not author. Their licences are declared in `REUSE.toml` and the texts are in `LICENSES/`. The sources of the clinical knowledge are listed in `NOTICE` (generated from `knowledge/sources.yaml`). The licences of the speech model chain are recorded in `speech/LICENSES.md`.

## impeccable (design plugin)

- Files: `.claude/skills/impeccable/` and `.claude/agents/impeccable-*.md`. These are development tools for the interface work; they are not part of the app that is shipped to users.
- Upstream: https://github.com/pbakaus/impeccable
- Licence: Apache License 2.0 (`LICENSES/Apache-2.0.txt`). The upstream `LICENSE` ends with: "Copyright 2025 Paul Bakaus. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License." The `SKILL.md` front matter also says `license: Apache 2.0`.
- Changes: none known to the files; they are kept as installed. If you modify them, Apache-2.0 section 4(b) asks for a prominent notice of the change.
- Inside the plugin, per the upstream `NOTICE.md`: `reference/ios.md` and `reference/android.md` are distilled from `ehmo/platform-design-skills` (MIT, copyright 2026 ehmo), and `scripts/modern-screenshot.umd.js` is the `modern-screenshot` library (MIT, copyright 2021-present wxm, https://github.com/qq15725/modern-screenshot).

## Atkinson Hyperlegible Next (font)

- Files: `app/public/fonts/*.woff2`, licence text `app/public/fonts/OFL.txt`.
- Upstream: https://github.com/googlefonts/atkinson-hyperlegible-next
- Licence: SIL Open Font License 1.1 (`LICENSES/OFL-1.1.txt`). Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors.
- The font is self-hosted as WOFF2 files subset to Latin and Latin Extended (see `DESIGN.md`).

## FLEURS audio fixture

- File: `speech/bench/fixtures/fleurs-wo_sn-test-9405789794868564555.wav`, described in `speech/bench/fixtures/README.md`.
- Source: FLEURS (Conneau et al., 2022), Hugging Face `google/fleurs`.
- Licence: Creative Commons Attribution 4.0 International (`LICENSES/CC-BY-4.0.txt`). The file was trimmed (silence removed); the README lists the changes.

## Speech model and its training data (not in the repository)

The speech model files are converted at build time from public models and are not committed. Their licence chain, including the open question on the share-alike licence of WAXAL Wolof (CC BY-SA 4.0) and the missing data licence of ALFFA Wolof, is in `speech/LICENSES.md` and `speech/MODEL_CARD.md`. This is not legal advice, and it is not settled.
