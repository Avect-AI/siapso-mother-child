<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Licences of the voice model chain and of its data

Research of 2026-11-05 for SCRUM-33. Every row says what the page said when opened; nothing is inferred. "Unverified" means no licence was found on the source's own page. This is a record of findings, not legal advice. The model card is `speech/MODEL_CARD.md`.

## Models

| Component                               | Licence found                                                                                           | Page opened                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| OpenAI Whisper (code and weights)       | "Whisper's code and model weights are released under the MIT License. See LICENSE for further details." | https://github.com/openai/whisper                  |
| `openai/whisper-small` (HF card)        | `License: apache-2.0`                                                                                   | https://huggingface.co/openai/whisper-small        |
| `openai/whisper-base` (HF card)         | `License: apache-2.0`                                                                                   | https://huggingface.co/openai/whisper-base         |
| `M9and2M/whisper-small-wolof` (HF card) | `License: mit`; "fine-tuned from OpenAI's Whisper-small"; 57 h training, 10 h test, WER 0.17            | https://huggingface.co/M9and2M/whisper-small-wolof |

The two licences claimed for Whisper (MIT by OpenAI's repository, apache-2.0 by the Hugging Face cards) are both permissive. Both are recorded; the packs ship the MIT text and `NOTICE.md`.

## Training data of the Wolof fine-tune

Dataset: https://huggingface.co/datasets/M9and2M/Wolof_ASR_dataset. Its card shows `License: mit` for the whole dataset and lists the sources below with their links, but states no licence per source. Whether the dataset's author could relicense third-party data as MIT is not established.

| Source           | Link on the dataset card                                                           | Licence line found on the source's own page                                                                                                                                                                                                                                                                                                                                                                                                                | Status                                                                 |
| ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| FLEURS (`wo_sn`) | https://huggingface.co/datasets/google/fleurs                                      | Card metadata: `license: - cc-by-4.0`; text: "All datasets are licensed under the Creative Commons license (CC-BY)." (the metadata names version 4.0)                                                                                                                                                                                                                                                                                                      | verified, CC-BY-4.0                                                    |
| Wolof TTS corpus | https://zenodo.org/records/4498861                                                 | Title "WOLOF TTS(Text To Speech) Data", authors Thierno Ibrahima Diop, Demba AW, Ami jaane, Mamadou Badiane (BAAMTU Datamation); licence "Creative Commons Attribution 4.0 International"; access "Open" (also the Zenodo API field `license: cc-by-4.0`)                                                                                                                                                                                                  | verified, CC-BY-4.0                                                    |
| WAXAL Wolof      | https://github.com/Waxal-Multilingual/speech-data/tree/main                        | The repository's LICENSE file begins "Creative Commons Attribution-ShareAlike 4.0 International" (https://raw.githubusercontent.com/Waxal-Multilingual/speech-data/main/LICENSE). The page itself shows no licence text; audio is in a separate repository `Waxal-Multilingual/audio-files` whose licence was not checked. The third-party mirror https://huggingface.co/datasets/perrynelson/waxal-wolof says `license: cc-by-sa-4.0` with an empty card. | verified for the repository (CC-BY-SA-4.0); audio repository unchecked |
| ALFFA Wolof      | https://github.com/getalp/ALFFA_PUBLIC (paper: https://aclanthology.org/L16-1611/) | Repository sidebar "MIT license"; `LICENSE.md` begins "The MIT License (MIT) Copyright (c) [2016] [Laurent Besacier]". The Wolof section says only "please cite this paper if you publish work using theses resources" and gives no data licence. The Hugging Face mirror used by the dataset (https://huggingface.co/datasets/Isma/alffa_wolof) has no licence field. The paper page's CC BY 4.0 footer covers the paper, not the data.                   | unverified for the audio data                                          |

Consequences:

- FLEURS and the Zenodo corpus (CC-BY-4.0) allow commercial use with attribution. Attribution lines are in the model card's credits.
- WAXAL is share-alike (CC-BY-SA-4.0). Whether weights trained on share-alike data must be released under the same licence is a legal question this research does not answer. The fine-tune declares MIT.
- ALFFA Wolof audio has no stated data licence on any page opened: unverified. Do not assume MIT from the repository file.
- FLEURS `wo_sn` is among the fine-tune's sources, so SIAPSO's FLEURS Wolof test figure may be optimistic (`speech/MODEL_CARD.md`).

## Evaluation data used by SIAPSO

FLEURS `wo_sn` and `fr_fr` test splits, dataset revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`, cc-by-4.0 as above. Downloaded at run time, not committed. Reference sentences are not committed (`eval/speech/results/ATTRIBUTION.md`).

## Excluded

- Meta MMS (CC BY-NC 4.0): not used.
- Any non-commercial model or data: not used.
- SIAPSO adds no training data of its own. Consented recordings will follow the protocol in `eval/speech/README.md`, after the opinion of the national ethics committee (CNERS).

## Runtime (served with each pack)

Transformers.js 4.3.1 (Apache-2.0), `@huggingface/tokenizers` 0.2.0 (Apache-2.0), `@huggingface/jinja` 0.5.10 (MIT), ONNX Runtime Web `1.31.0-dev.20260914-8d85527a0` (MIT). Texts ship in each pack under `licenses/` and `NOTICE.md`. Details: `docs/voice.md`.

The npm package of ONNX Runtime Web carries no licence file. Each pack ships, from `microsoft/onnxruntime` at `8d85527a010e294a26b274749f74294b2a32cec5` (the commit the package names in its `__commit.txt`), its `LICENSE` (1,073 bytes, SHA-256 `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c`, as `licenses/onnxruntime-web-LICENSE.txt`) and its `ThirdPartyNotices.txt` (338,088 bytes, SHA-256 `143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3`, as `licenses/onnxruntime-ThirdPartyNotices.txt`): the notices of the third-party code the WebAssembly links. The prescription reading pack pins the same texts for the same build (pull request #69). `pnpm voice:install-local` checks both by size and SHA-256 and refuses an `onnxruntime-web` built from another commit. Read on 2026-11-06 at https://raw.githubusercontent.com/microsoft/onnxruntime/8d85527a010e294a26b274749f74294b2a32cec5/LICENSE and https://raw.githubusercontent.com/microsoft/onnxruntime/8d85527a010e294a26b274749f74294b2a32cec5/ThirdPartyNotices.txt.

## Links that failed

None of the URLs above failed when opened on 2026-11-05. Note: https://huggingface.co/datasets/google/fleurs rendered without its metadata in the page fetch (content truncated), so the licence line was read from the raw card https://huggingface.co/datasets/google/fleurs/raw/main/README.md.
