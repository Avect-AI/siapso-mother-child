<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Model card: prescription reading pack `ppocrv5-mobile-latin`

The optional "Lecture d'ordonnance" pack of SIAPSO Mother-Child reads the text of a prescription on the phone, offline. It is two PaddleOCR models used as published, run with ONNX Runtime Web in a Web Worker. It only gives lines of text: the app proposes products from them, the user confirms each one, and the deterministic engine alone decides the alert level. Licences: `ocr/LICENSES.md`; use and limits: `docs/ocr.md`.

## Models

| Role                           | Repository (Hugging Face)                     | Revision                                                | File             | Bytes     | SHA-256                                                            | Licence    |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------- | ---------------- | --------- | ------------------------------------------------------------------ | ---------- |
| Text detection                 | `PaddlePaddle/PP-OCRv5_mobile_det_onnx`       | `e6f4fa85f00e168c862bc462aebca69eef9b3d3d` (2026-06-10) | `inference.onnx` | 4,826,518 | `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d` | Apache-2.0 |
|                                |                                               |                                                         | `inference.yml`  | 903       | `98069072e1b6b37d727fd9d9f11725faa46d6ea0de012f2ed26caea011c37699` |            |
| Text recognition, Latin script | `PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx` | `89d3a50e2c27e2e7cceeab0e944c25c807d5db4f` (2026-05-26) | `inference.onnx` | 8,042,023 | `7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498` | Apache-2.0 |
|                                |                                               |                                                         | `inference.yml`  | 6,817     | `0bbe984570f597af3638e50bdf2e8276f3ab26a61966096538b3b0d1849f5c84` |            |

The hashes were computed on 2026-11-06 on the files downloaded at those revisions (`https://huggingface.co/<repository>/resolve/<revision>/<file>`) and on the copies the spike measured: they are the same. `ocr/scripts/install-local.mjs` pins them (`PINNED_MODELS`) and refuses any other file.

## Conversion

None by SIAPSO. Both ONNX files are PaddlePaddle's own exports, published in the repositories above and used unchanged (`models/det.onnx`, `models/rec-latin.onnx` in the pack). The graphs carry Paddle2ONNX names (`p2o.*` initializers, some unused, which ONNX Runtime reports and removes when it loads them), so they were exported from the PaddlePaddle models with Paddle2ONNX by PaddlePaddle; the cards do not describe the export. No quantisation, no fine-tuning.

The only file derived by SIAPSO is `models/dict-latin.json`: the 836 characters of `PostProcess.character_dict` in the recogniser's `inference.yml`, in order, written as a JSON list. The worker reads the model's classes as blank, those 836 characters, then a space (838 classes, checked against the model's output at each reading). The detection settings the worker uses are those of the detector's `inference.yml` (`resize_long: 960`, `thresh: 0.3`, `box_thresh: 0.6`, `unclip_ratio: 1.5`, BGR input with the ImageNet mean and deviation), and the install script refuses a detector configured otherwise.

## Training data

Not described by the publisher: the Hugging Face cards of both repositories at the pinned revisions say nothing of the data the models were trained on, and SIAPSO did no training nor fine-tuning. What the models saw is therefore unknown here, and so is how far handwriting or French prescriptions were part of it.

## Intended use

- Read printed prescriptions, and some handwriting, in French (Latin script with accents), so that the names of medicines can be proposed for the user to confirm. One page at a time, three pages at most from a PDF.
- Not for: a decision without the user's confirmation, a dose (the posology lines are never used to give a dose), Arabic script, barcodes or QR codes.

## Evaluation

- Spike of 2026-11-05 (spec section 4.5, synthetic set of 36 prescriptions, 144 images, the same two files): every product of the base found on the printed prescriptions in every photo condition (156 of 156 product lines on the development part, 88 of 88 on the part then called held-out), with no false product after the reading rules; 91.3 and 97.7 percent on a handwriting-style font proxy, which is not real handwriting. These figures come from the set the reading rules were tuned on, both parts of it: they are not an independent measure, and they overstate what an unseen prescription gives. A fresh held-out set comes with the reading of the text (SCRUM-57 phase 1, pull request #70); measures on it are pending.
- Bench of 2026-11-06 (`pnpm ocr:bench`, `docs/ocr.md`): the pack's own worker read the four products of a synthetic printed page as a clean scan, a phone photo, a camera frame, a text PDF and a scanned PDF, offline; 2.1 to 3.4 s per page on a laptop over two runs, one thread.
- Not measured: real prescriptions (they need consented, de-identified samples), real handwriting, phones.

## Limits and risks

- Real paper reads worse than the synthetic set: folds, stamps over the text, carbon copies, faded ink, motion blur.
- Handwriting is read in part at best; the app promises nothing for it.
- Digits can be misread (a strength): the app shows the line read next to the product and never imposes a strength.
- A misread name can only be proposed, never added: every product is confirmed by the user, and only strong matches are proposed.

## Credits

PaddleOCR by the PaddlePaddle Authors (Apache License 2.0; the copyright line, "Copyright (c) 2016 PaddlePaddle Authors", is that of the PaddleOCR GitHub project's `LICENSE`, which the pack ships: the model repositories name no holder). ONNX Runtime by Microsoft Corporation (MIT, with the notices of the third-party code it links). pdf.js by the Mozilla Foundation and contributors (Apache License 2.0), with its decoders of scanned images: PDFium's JBIG2 decoder (BSD-3-Clause and Apache License 2.0) and OpenJPEG (BSD-2-Clause).
