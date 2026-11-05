<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Licences of the prescription reading pack

Research of 2026-11-06 for SCRUM-57. Every row says what the page said when opened; nothing is inferred. This is a record of findings, not legal advice. The model card is `ocr/MODEL_CARD.md`; how the pack is built and used, `docs/ocr.md`.

## Models

| Component                                                                                   | Licence found                                                                                                                                                                                                                                                                       | Page opened                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PaddlePaddle/PP-OCRv5_mobile_det_onnx` at `e6f4fa85f00e168c862bc462aebca69eef9b3d3d`       | Card front matter: `license: apache-2.0`, `library_name: PaddleOCR`; the API gives `cardData.license: "apache-2.0"` and the tag `license:apache-2.0` at that revision. No licence file in the repository (files: `.gitattributes`, `README.md`, `inference.onnx`, `inference.yml`). | https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/raw/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/README.md and https://huggingface.co/api/models/PaddlePaddle/PP-OCRv5_mobile_det_onnx/revision/e6f4fa85f00e168c862bc462aebca69eef9b3d3d             |
| `PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx` at `89d3a50e2c27e2e7cceeab0e944c25c807d5db4f` | The card is its front matter only: `license: apache-2.0`; the API gives `cardData.license: "apache-2.0"` and the tag `license:apache-2.0` at that revision. No licence file in the repository (same four files).                                                                    | https://huggingface.co/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/raw/89d3a50e2c27e2e7cceeab0e944c25c807d5db4f/README.md and https://huggingface.co/api/models/PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx/revision/89d3a50e2c27e2e7cceeab0e944c25c807d5db4f |
| PaddleOCR (the project the models come from)                                                | `LICENSE` is the Apache License 2.0 text; its appendix reads "Copyright (c) 2016 PaddlePaddle Authors. All Rights Reserved."                                                                                                                                                        | https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/LICENSE                                                                                                                                                                                         |

The model repositories declare Apache-2.0 on their cards and carry no licence file; the pack ships the Apache License 2.0 text (`licenses/paddleocr-models-LICENSE.txt`, from `LICENSES/Apache-2.0.txt`) and `NOTICE.md`.

## Software in the pack and in the reading worker

| Component                                                                 | Version                         | Licence                                                                                     | Where                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| ONNX Runtime Web (`onnxruntime-web`), Copyright (c) Microsoft Corporation | `1.31.0-dev.20260914-8d85527a0` | MIT (`package.json`; the npm package carries no licence file, the pack ships the MIT text)  | WebAssembly and loader in the pack (`runtime/`), JavaScript bundled in the reading worker |
| pdf.js (`pdfjs-dist`), Mozilla Foundation and contributors                | `6.4.299`                       | Apache-2.0 (`package.json` and its `LICENSE`, shipped as `licenses/pdfjs-dist-LICENSE.txt`) | `pdf/` in the pack                                                                        |

The same ONNX Runtime Web build serves the voice (`speech/LICENSES.md`); `pdfjs-dist` declares `@napi-rs/canvas` (MIT) as an optional dependency, installed for Node only (the tests), never shipped.

## Data

No data is used to build or measure the pack beyond synthetic prescriptions made by the tests and the bench (fake names, no real prescription). No training is done.

## Links that failed

None on 2026-11-06. The Hugging Face card pages were read through their raw `README.md` at the pinned revision and the model API at that revision.
