# Prescription scanning: design and measured spike

Status: proposed on 2026-11-05, for review before any implementation.
Jira: SCRUM-57 (scan or upload a prescription to add products), with the pharmacist journey of SCRUM-59. Related: SCRUM-56 (UX fluidity: one check screen, "Fiche pour la patiente", "Note pour le prescripteur"), which runs in parallel.
References: `PRODUCT.md`, `DESIGN.md`, `docs/privacy.md`, `docs/voice.md` (the optional voice pack is the model for the optional download here), `resolver/README.md`, `app/src/domain/possible-matches.ts`, `docs/dependencies.md`, `docs/superpowers/specs/2026-11-03-implementation-design.md`.

French interface sentences are quoted with their accents; they go in the translation files, never in components.

## 1. In short

- **What it does.** On the check screen, "Photo ou fichier de l'ordonnance" takes a photo in the page or opens a photo or a PDF already on the phone. The text is read on the phone, the resolver proposes the products it names, and all of them come back in one list to check: nothing is added until she ticks it, strengths read are proposed and never imposed, posology is never used to give a dose, and the lines that name nothing of the base can be added as typed so that an unknown product still reaches the result as grey.
- **Recommendation.** PaddleOCR PP-OCRv5 mobile (text detection, and the Latin recognition model that reads French accents), Apache-2.0, run with the ONNX Runtime Web build the app already ships for the voice, in an optional "Lecture d'ordonnance" pack of 28.9 MB (16.1 MB to download with gzip), installed on request like the voice. PDF through pdf.js (Apache-2.0) in the same pack: the text layer when there is one, the page drawn and read otherwise.
- **Measured** on a synthetic set (no patient data) of 36 prescriptions, 144 images, on a laptop: on printed prescriptions, PaddleOCR plus the reading found every product of the base (244 of 244 product lines across a clean scan, a phone photo, a tilted and blurred photo and a dim photo) with no false product; Tesseract.js, 5 times smaller and 4 times faster, found 100 percent on clean scans but lost the text on tilted, blurred photos (46 to 54 percent). On handwriting-style fonts (a proxy only), PaddleOCR found 93 percent, Tesseract 47 percent. A page takes 3.3 s with PaddleOCR on the laptop (0.7 s with Tesseract), about 15 s and 23 s with the CPU slowed 4 and 6 times (stand-ins for a mid-range and an entry-level phone).
- **Honest limits.** Real handwriting was not measured and will read much worse than the fonts that stand for it; the screen says so and keeps typing and voice one tap away. Speed on an entry-level phone is the main risk for the pharmacist at the counter and is measured on real phones before the screen ships. Products outside the base are never recognised as products, only offered as lines to add as typed.
- **Plan.** Six pull requests: the reading of a text (pure, with an evaluation in CI), the reading pack and its worker, the screens, PDF, the counter and the outputs with SCRUM-56 and SCRUM-59, then the performance work the phone measurements call for (section 9).

## 2. Who scans a prescription, and when

The team's request (2026-11-05): "Aujourd'hui on ne peut pas scanner, télécharger ou uploader une ordonnance directement, ce qui peut faire gagner du temps si on a déjà une ordonnance."

| Person                                   | Moment                                  | The prescription                                                                                         | What matters                                                                                             |
| ---------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Pharmacist or depot keeper (SCRUM-59)    | At the counter, many times a day        | Handed over on paper: printed (clinic software, typed form) or written by hand on a printed form         | Main entry point. Seconds per prescription, one list to check, then the two outputs of SCRUM-56          |
| Relais or Bajenu Gox                     | Home visit                              | The paper kept at home, often folded, read in a dim room or in bright sun                                | Fewer names to type on a small keyboard; nothing missed                                                  |
| Midwife or ICP                           | Antenatal or postnatal contact          | Another prescriber's paper (a clinic, a hospital), or a photo on the woman's phone                       | What she takes besides what the midwife gave                                                             |
| Woman in personal mode                   | At home                                 | A photo she already has (WhatsApp, gallery), sometimes a PDF from a clinic                               | Upload of an existing photo or PDF, not only the camera                                                  |

In every case the prescription only saves typing: the products still go through the confirmation, the engine still sets the level, and typing or speaking a name is always one tap away.

## 3. Constraints carried into the design

- Offline on low-end Android phones (Android Go class, 2 GB of memory, Chrome), small screens from 360 px.
- The image never leaves the phone and is never stored: it lives in memory, is read, then dropped. No history of the image, nor of the full text read from it.
- Models propose, rules decide: every product read is confirmed by the user, as on the confirm screen. No item is added without confirmation. A strength read from the text is proposed, never imposed. A posology line never gives a dose: at most, a number of units per day is offered for the daily-maximum rules (C7), after the product is confirmed, and only as a value she accepts or changes.
- Honest about limits: handwritten prescriptions are common in Senegal. The app says what it cannot read and always offers to type or speak the names instead.
- Open-source licences only (MIT, Apache-2.0, BSD; fonts and data under OFL or CC-BY used only for the synthetic test set); dependencies at least 14 days old (`minimumReleaseAge` in `pnpm-workspace.yaml`, `docs/dependencies.md`); no LEDIAM or DDInter data; no TerangaHealth component.
- Anything large is an optional download, asked for, never silent (the voice pack model, `docs/voice.md`).

## 4. The spike

Measured on 2026-11-05 on the laptop of the voice timings (Windows 11, AMD Ryzen 5 8640HS, 12 logical cores, 14 GB of memory), headless Chromium 156 from Playwright 1.64.1, one browser at a time, WebAssembly on one thread unless said otherwise. Knowledge pack built from `main` at `160de43` (355 products, 14 plants). Scripts: appendix.

### 4.1 Test set: synthetic, no patient data

No real prescription and no real person: `tools/prescription-eval/` generates them.

- **Content.** 39 ways of writing 26 products of the pack as prescribers write them ("Fer + Acide folique cp", "SP (Sulfadoxine Pyriméthamine)", "Doliprane 1000 mg cp", "Efferalgan 1 g cp eff", "Coartem 20/120 mg", "Néo-Codion sirop", "Cytotec 200 µg"), each with posologies ("1 cp x 3/j si douleur", "2 gél x 3/j pendant 7 jours", "3 cp en prise unique (TPI) devant l'agent", "2 cp par semaine") and the units per day they say; 18 products common on Senegalese prescriptions that the pack does not have (Spasfon, Mébendazole, Albendazole, Magné B6, Calcium, Gaviscon, Primpéran, Duphaston, Aldomet, Adalate, Augmentin, Oméprazole, Smecta, Vogalène, Polygynax, Céfixime, a mosquito net, vitamin B); patient names drawn from common first and family names, a term in weeks of amenorrhoea, a date, a prescriber.
- **Layouts** (A5, 1100 px wide): a health post form with the national header ("RÉPUBLIQUE DU SÉNÉGAL", "Un Peuple - Un But - Une Foi", the ministry, the medical region, the health district, the health post); a private practice letterhead; a maternity form with a table "Médicament | Posologie". Two to six products, posology on the same line after a colon or on the next line, a signature, a round stamp that overlaps the last lines on a third of them. Fonts: Arial, Times New Roman, Courier New, Calibri, Verdana.
- **Handwriting proxy.** One prescription in three has its patient line and products in a handwriting-style font (Caveat, Reenie Beanie, Homemade Apple, Nothing You Could Do, Kalam; OFL or Apache-2.0), in blue ink, each line slightly turned and shifted. **This is only a proxy**: a font repeats the same letter shapes, never crosses out, never abbreviates, never runs words together the way a hurried prescriber does. It tells which engine copes better with irregular script, not how real handwriting reads.
- **Conditions.** Each prescription as a clean scan (PNG), and as three phone photos on a table: "photo" (1200 x 1600, turned 3 degrees, tilted 6, slight blur, JPEG 75), "hard" (900 x 1200, turned 8 degrees, tilted 14 and 6, blur 1.3 px, a shadow across, noise, JPEG 50), "dim" (1200 x 1600, half the light, low contrast, warm cast, noise, JPEG 60).
- **Size.** A development set of 24 prescriptions (16 printed, 8 handwriting proxy; 88 product lines, 62 of them in the pack), 96 images; then a held-out set of 12 more (8 printed, 4 proxy; 45 lines, 33 in the pack), 48 images, meant to be read once after the reading rules were set. It did not stay held out: rule 1 of section 4.3 was added after its first reading (section 4.5), and phase 1 (PR #70) set further rules and unit tests on its texts, so its figures are no held-out measure. PR #70 adds a fresh held-out set (`eval/prescription/fresh/`: 12 prescriptions with new seeds and new layouts, frozen before the reading was run on it), never tuned on but designed around the cases of the review of PR #70; its OCR measure is pending. The committed generator reproduces the development set exactly (same products and the same pixels of every scan).

### 4.2 Engines tried

| Engine | Version | Licence | Notes |
| --- | --- | --- | --- |
| Tesseract.js (LSTM engine) | `tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0 (2025-12-15) | Apache-2.0; the WebAssembly core bundles Leptonica (BSD-2-Clause) and image codecs (libtiff and the like: permissive, to list in the notices) | Language data: `tessdata_fast` (fra, eng), `tessdata_best` (fra, eng), and the `best_int` files of `@tesseract.js-data` 1.0.0, all Apache-2.0 (tesseract-ocr/tessdata\*; the npm wrapper says MIT) |
| PaddleOCR PP-OCRv5 mobile | `PaddlePaddle/PP-OCRv5_mobile_det_onnx` (revision `e6f4fa85f00e168c862bc462aebca69eef9b3d3d`, 2026-06-10) and `PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx` (revision `89d3a50e2c27e2e7cceeab0e944c25c807d5db4f`, 2026-05-26), PaddlePaddle's own ONNX exports | Apache-2.0 | Run with ONNX Runtime Web `1.31.0-dev.20260914-8d85527a0` (MIT), the build the app already ships for the voice. The Latin recogniser reads 836 characters, French accents included |
| pdf.js | `pdfjs-dist` 6.4.299 (2026-10-03; 6.5.438 is younger than 14 days) | Apache-2.0 | Text layer, and page drawing for scanned PDFs |
| Shape Detection `TextDetector` | Chromium 156 | | Not offered (`'TextDetector' in self` is false; it is behind a flag on desktop and absent on Android), so not usable |

Both OCR engines ran on the page thread with the same image path: decode, scale to 2000 px on the long side at most, then the engine. For Tesseract, six settings: automatic layout (PSM 3) on the image as given; automatic layout or a single block of text (PSM 6) after a flat-field step (grey, divided by a blurred copy of itself, which turns uneven light, shadows and the dark table into a white ground); and the `best_int`, `best` and French plus English data with the single block. PaddleOCR: detection at 960 px on the long side, the boxes of the probability map (threshold 0.3, box score 0.6, unclip 1.5) with their own angle, each recognised at 48 px high, lines rebuilt in reading order.

The real `tesseract.js` API (its own Web Worker) was also run with every file served locally: 0.38 s to start, 0.39 to 0.66 s per clean page, the same text as the page-thread harness, 10 requests to the local server and none to any other origin.

### 4.3 From text to products (the reading)

The OCR gives lines of text; the reading turns them into proposals with the resolver (`resolver/`, unchanged) and the strength classes of `possible-matches.ts`. Prototype in the scratch `extract.ts`; phase 1 makes it tested app code (section 9). Rules, each added for a failure seen in the spike:

1. **Lines.** A name wrapped over two lines is joined again (an open bracket closed on the next line, a line ending with "+"): a table cell "SP (Sulfadoxine" / "Pyriméthamine)" otherwise gave pyrimethamine alone (MALOCIDE) as a second product.
2. **Not a product line.** The header, the patient, the date, the prescriber, the signature and the stamp are skipped by their words (république, ministère, district, poste de santé, nom, prénom, âge, terme, date, signature, cachet, Dr, Mme...), unless the line starts with a list number (the OCR sometimes joins the stamp to the last product: "Fluconazole 150 mg gél CLINIQUE DE"). A posology line (it starts with a count and a unit, or is made mostly of posology words) is never searched; it gives the units per day of the product above it.
3. **Cleaning.** The list mark goes ("1.", "2)", and a number whose dot was lost: "2 Acide folique 5 mg" must not read 2 mg); a strength glued to a long word is split ("Spéciafoldine5"); a word of 7 letters or more within one edit (two from 9 letters) of a substance name or a brand name of the pack is snapped to it ("Gsulfadofine" to "sulfadoxine", "Efferalany" to "efferalgan").
4. **Search.** The name part (before a colon) is searched whole, then by windows of 3, 2 and 1 words from its first two words, never a posology word alone. Only **strong** and **very strong** candidates count (`strengthOf`); a weak resemblance (a short prefix, one word of a longer name, a laboratory) never becomes a proposal.
5. **One product per line**: very strong first, then the longest window, then the score, so "Fer + Acide folique" is the iron and folic acid product, never also "Fer" and "Acide folique".
6. **Strength and units.** The strength of the name part (`parseStrength`), and units per day from the posology when it says a plain count ("2 cp x 3/j" is 6, "1 cp matin, midi et soir" is 3, "2 cp matin et soir" is 4; "par semaine" and anything else unclear give nothing).
7. **Lines kept.** A line that looks like a product (a list mark, a strength, a form word) and names nothing of the base is kept for "Ajouter tel quel".

On the exact text of the 36 prescriptions (no OCR), the reading finds all 95 products of the pack with no false product, every strength (73 of 73) and every unit count (93 of 93), and keeps all 38 products outside the pack as lines to add. It takes 32 ms per page (90th percentile 56 ms) in Node on the laptop, after an index built once in 111 ms.

### 4.4 Results: sizes and licences

| File | Raw | With gzip |
| --- | --- | --- |
| `tesseract.js` 7.0.0: worker and API | 0.17 MB | 0.04 MB |
| `tesseract.js-core` 7.0.0: SIMD LSTM WebAssembly and its loader (the `.wasm.js` variant that embeds it: 3.90 MB) | 2.95 MB | 1.08 MB |
| `tessdata_fast` French / English | 1.13 / 4.11 MB | 0.61 / 1.96 MB |
| `tessdata_best` French / English | 3.97 / 15.40 MB | 3.34 / 12.80 MB |
| `best_int` French / English (`@tesseract.js-data` 1.0.0) | 1.25 / 5.20 MB | 0.70 / 2.93 MB |
| PP-OCRv5 mobile detection (ONNX) | 4.83 MB | 4.53 MB |
| PP-OCRv5 Latin mobile recognition (ONNX) | 8.04 MB | 7.32 MB |
| ONNX Runtime Web, plain SIMD threaded build (`ort-wasm-simd-threaded.wasm` and `.mjs`) | 14.28 MB | 3.71 MB |
| ONNX Runtime Web, the asyncify build the voice pack already carries | 26.86 MB | 6.63 MB |
| pdf.js 6.4.299 (`pdf.min.mjs` and `pdf.worker.min.mjs`) | 1.72 MB | 0.51 MB |
| **Pack with Tesseract fast French and pdf.js** | **5.97 MB** | **2.24 MB** |
| **Pack with PaddleOCR, its runtime and pdf.js** | **28.87 MB** | **16.07 MB** |

The app shell budget is 1.5 MB (`pnpm budget:app`), so either engine needs a pack. For comparison the voice packs are 137 and 326 MB.

### 4.5 Results: products found

Recall: products of the pack found, among those on the prescriptions. Precision: right products among all proposed. A false product is a proposal whose substances are not those of a product of the prescription. All rows use the reading of section 4.3.

Development set (24 prescriptions):

| Engine and setting | Printed: scan | Printed: photo | Printed: hard | Printed: dim | Printed, all (156 lines) | Handwriting proxy (92 lines) | False products | Strengths read: right / wrong | Products outside the pack kept as lines |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Exact text, no OCR | | | | | 100 / 100 | 100 / 100 | 0 | 73 / 0 (36 prescriptions) | 38 of 38 |
| Tesseract fast fra, automatic layout | 100 / 100 | 97.4 / 100 | 0 / 0 | 94.9 / 100 | 73.1 / 100 | 44.6 / 89.1 | 5 | 108 / 5 | 66 of 104 |
| Tesseract fast fra, automatic layout, flat-field | 100 / 100 | 92.3 / 100 | 0 / 0 | 87.2 / 100 | 69.9 / 100 | 50.0 / 93.9 | 3 | 106 / 4 | 66 of 104 |
| Tesseract fast fra, single block, flat-field | 100 / 100 | 97.4 / 100 | 53.8 / 91.3 | 94.9 / 100 | 86.5 / 98.5 | 53.3 / 83.1 | 12 | 116 / 14 | 76 of 104 |
| Tesseract best_int fra, single block, flat-field | 94.9 / 100 | 92.3 / 100 | 61.5 / 96.0 | 89.7 / 100 | 84.6 / 99.2 | 59.8 / 91.7 | 6 | 119 / 8 | 77 of 104 |
| Tesseract best fra, single block, flat-field | 97.4 / 100 | 92.3 / 100 | 59.0 / 95.8 | 89.7 / 100 | 84.6 / 99.2 | 59.8 / 91.7 | 6 | 119 / 6 | 77 of 104 |
| Tesseract fast fra+eng, single block, flat-field | 100 / 100 | 97.4 / 100 | 59.0 / 92.0 | 94.9 / 100 | 87.8 / 98.6 | 56.5 / 85.2 | 11 | 122 / 12 | 80 of 104 |
| **PaddleOCR PP-OCRv5 mobile, Latin** | **100 / 100** | **100 / 100** | **100 / 100** | **100 / 100** | **100 / 100** | **91.3 / 100** | **0** | **162 / 0** | **99 of 104** |

Held-out set (12 prescriptions, read with the rules above; rule 1 of section 4.3 was added after its first reading, see below, so these are not held-out figures):

| Engine | Printed, all conditions (88 lines) | Handwriting proxy (44 lines) | False products | Strengths: right / wrong |
| --- | --- | --- | --- | --- |
| Tesseract fast fra, single block, flat-field | 83.0 / 100 (scan 100, photo 95.5, hard 45.5, dim 90.9) | 34.1 / 88.2 | 2 | 69 / 8 |
| **PaddleOCR** | **100 / 100** (every condition) | **97.7 / 100** | **0** | **109 / 2** |

What the numbers say:

- **Every false product left is part of a combination** read alone: iron for "Fer + Acide folique", amodiaquine for ASAQ, pyrimethamine (MALOCIDE) for SP, TARDYFERON for "Tardyféron B9" read "B7". None came from a patient's name, the header, a posology line or a product outside the pack. On the held-out set, PaddleOCR first gave 8 such false products, all the second line of a name wrapped in a table cell ("Pyriméthamine)", "Amodiaquine)"); rule 1 of section 4.3 was added after seeing them, so the 0 of the held-out row is after that rule. Without the snap of rule 3, PaddleOCR gives 7 false products on the development set (SP read as pyrimethamine) and finds 91.9 percent instead of 96.8; on the held-out set the snap takes it from 90.2 to 99.2 percent, so it is not a fit to the development set only.
- **Tesseract loses the text of tilted and blurred photos**: with automatic layout it finds no text block at all on the "hard" photos (0 percent); a single block after the flat-field step recovers half. Its partial reads of combinations are the false products, mostly on the handwriting proxy.
- **Strengths.** Two strengths were read wrong by PaddleOCR on the held-out handwriting proxy: "z50 mg" for 250 mg (no product of that strength, so nothing would be preselected) and "flucinazole 100 mg" for 150 mg (a 100 mg box exists: it would be preselected). Hence the strength is shown with the line it was read on, to compare with the box (section 7.5).
- **Units per day** were read right for 174 of the 236 products found by PaddleOCR whose posology says a daily count, wrong for 1, and not read for the others (she types them).
- **Products outside the pack** are kept as lines to add as typed: 99 of 104 with PaddleOCR (the 5 others were read as part of another line).

### 4.6 Results: speed and memory

Time per page: the engine only, the median and the 90th percentile; the decoding and scaling are given apart.

| Engine and setting | Laptop, 1 thread | Decode and scale | Start (load the engine) | Peak working set of the page |
| --- | --- | --- | --- | --- |
| Tesseract fast fra, automatic layout, no preparation | 0.44 s (0.61 s) | 0.02 s | 0.18 s | 134 MB |
| Tesseract fast fra, single block, flat-field | 0.71 s (0.88 s) | 0.19 s (flat-field and PNG) | 0.22 s | 327 MB |
| Tesseract best_int / best fra, single block, flat-field | 0.73 s / 1.12 s | 0.19 s | 0.42 s / 0.33 s | 388 / 345 MB |
| Tesseract fast fra+eng, single block, flat-field | 1.30 s (1.64 s) | 0.23 s | 0.54 s | 382 MB |
| PaddleOCR (detection 0.74 s, recognition of about 20 boxes the rest) | 3.25 s (3.92 s) | 0.06 s | 1.7 s | 351 MB |

CPU slowed by DevTools throttling on the page thread (subset of 8 pages: 4 prescriptions, scan and photo), the stand-ins `docs/voice.md` uses for a mid-range (4x) and an entry-level (6x) phone:

| Engine | 1x | 4x (mid-range stand-in) | 6x (entry-level stand-in) |
| --- | --- | --- | --- |
| Tesseract fast fra, single block, flat-field (engine + preparation) | 1.0 + 0.3 s | 3.6 + 0.7 s | 4.2 + 1.0 s |
| PaddleOCR (engine + preparation) | 3.9 + 0.1 s | 14.6 + 0.3 s | 22.8 + 0.3 s |

- The baseline working set of the page is 58 MB; the peaks above include the images at 2000 px, the flat-field copies, the engine's WebAssembly memory and the decoded models. On a 2 GB phone this is the second risk after speed (section 10).
- ONNX Runtime with 2 and 4 threads (page cross-origin isolated) gave 4.2 s and 4.0 s against 3.9 s with one: no gain in this harness, not investigated further (the voice saw a 2x gain with Whisper; to measure again in phase 2). Recognising the boxes 8 at a time, padded to the widest, was slower (one page: 5.9 s): not pursued.
- The reading (text to proposals) takes 32 ms per page, the PDF text layer 0.25 s (below).

### 4.7 PDF

Eight prescriptions (6 printed, 2 proxy) as a text PDF (printed from the sheet: a text layer, 70 to 180 KB) and as a scanned PDF (the phone photo inside a PDF: no text layer, 70 to 110 KB).

| Input | Time | Products found |
| --- | --- | --- |
| Text PDF: pdf.js opens it and reads the text layer, lines rebuilt from the baselines | 0.25 s (open 0.19 to 0.28 s, text 0.04 to 0.09 s) | 26 of 26, no false product |
| Scanned PDF: no text layer found, the first page drawn at 2000 px, then PaddleOCR | 0.1 to 0.18 s to draw, then 2.5 to 4.0 s | printed 20 of 20, proxy 4 of 6, no false product |
| Scanned PDF, then Tesseract fast fra (single block, flat-field) | then 0.7 to 1.3 s | printed 18 of 20, proxy 3 of 6, 1 false product |

A real handwritten prescription in a PDF is a scan: it has no text layer, whatever the PDF. pdf.js opens untrusted files: it runs with `isEvalSupported: false`, no scripting, no XFA, in its worker (`docs/threat-model.md` gets the line in phase 4).

### 4.8 What the numbers do not say

- The set is synthetic and its degradations are simulated (CSS blur and perspective, JPEG): no motion blur, folds, creases, carbon copies, faded thermal paper, coloured stamps over the text, fingers in the picture. Real prescriptions will read worse.
- The reading rules were tuned on the development set and, after its first reading, on the held-out set too (rule 1 of section 4.3, then the rules of PR #70): neither measures the reading on prescriptions it was not set on. The fresh held-out set of PR #70 has new seeds and layouts, but the same catalog and no new writers.
- Handwriting was not measured: the fonts stand for it only in shape.
- Phone timings are throttled laptop timings; memory is the laptop renderer's. Both are measured on real phones before shipping (section 10).
- The inputs measured are image files and PDFs. The camera itself (in the page with `getUserMedia`, or the phone's camera app through `<input type="file" capture="environment">`) was not measured: the spike had no phone camera. Headless Chromium 156 offers `ImageCapture`; what a phone's rear camera gives through it is measured in section 10.

## 5. Approaches

| Approach | For | Against | Verdict |
| --- | --- | --- | --- |
| A. Tesseract.js, fast French data, in a 6 MB pack | Small (2.2 MB download), fast (0.7 s a page, about 5 s at 6x), mature, Apache-2.0 | Loses the text on tilted or blurred photos (0 to 54 percent on the hard set), half the handwriting proxy, partial combinations as false products; the core bundles third-party codecs to list | Fallback only, if PaddleOCR proves too slow on real phones |
| **B. PaddleOCR PP-OCRv5 mobile with ONNX Runtime Web, in a 29 MB pack** | **Every printed product in every condition, 93 percent of the handwriting proxy, no false product with the reading rules; Apache-2.0 models, the MIT runtime the app already ships; PaddlePaddle's own ONNX exports** | **4 to 5 times slower than A (3.3 s a page, about 23 s at 6x); 16 MB to download; more code (detection boxes, decoding)** | **Recommended** |
| C. Both: Tesseract first, PaddleOCR when Tesseract reads little | Fast on clean scans | Two engines, 35 MB, two code paths to keep, and the slow path is still the one photos need | No |
| D. PDF text layer only, no OCR | Tiny (pdf.js only), exact | Covers e-prescriptions only; paper and photos, the usual case, are left out | Part of B (pdf.js in the pack) |
| E. The platform's text recognition (`TextDetector`, Android ML Kit) | Fast, no download | Not offered to web pages (false in Chromium 156, behind a flag); ML Kit is not reachable from a web app, and is not open source | No |
| F. OCR on a server | Strong models | The image would leave the phone; needs a network | Excluded by the constraints |
| G. Larger models for handwriting (TrOCR, vision-language OCR such as PaddleOCR-VL) | The only hope for real handwriting | Hundreds of MB, minutes a page on a phone, and nothing to measure them on without consented real prescriptions | Not now (section 10) |

## 6. Recommendation

Approach B, built in phases (section 9):

1. **Reading pack** "Lecture d'ordonnance": PP-OCRv5 mobile detection and Latin recognition (pinned revisions and sha256), ONNX Runtime Web (the version the speech worker pins, `ORT_WEB_VERSION`), pdf.js 6.4.299, licences and notices; optional, installed on request, read from the Cache API only.
2. **The reading** of section 4.3, engine-agnostic (text lines in, proposals out), so that approach A can replace the engine if the phone measurements require it, without touching the screens.
3. **One list to check**, nothing ticked, strengths proposed, posology never used for a dose, lines not recognised addable as typed, typing and voice one tap away (section 7).
4. **Gates before the screen ships**: zero false products on the printed synthetic set in CI (`pnpm eval:prescription`), and phone measurements of section 10 within the pharmacist target, or the performance step of phase 6 first.

## 7. Design

### 7.1 Entry point, and how it fits SCRUM-56

One entry on the check screen, next to typing and voice: a secondary button "Photo ou fichier de l'ordonnance" ("Photo or file of the prescription"), with a page mark (a sheet with lines, a shape no level uses) and the words always shown. It is a plain button that opens a route of its own, `#/prescription`, through the check flow (`flowEntry({ stepsToCheck: 1 })` in `app/src/screens/check-flow.ts`), and comes back to `/check` the way the search screen does. It reads nothing from the check screen and gives back only confirmed items through `useCheck().add`, so it fits whatever SCRUM-56 makes of the check screen (one screen with the search field and the microphone, or today's two buttons): SCRUM-56 only has to place one more button in its add area. Proposed order in that area: the search field (typing), the microphone (voice), then "Photo ou fichier de l'ordonnance".

The button shows only where the browser can do the work (WebAssembly, `createImageBitmap`, a canvas, module workers and the Cache API, as for the voice). Before the reading pack is installed, it opens the pack screen (section 7.10), as the microphone opens the voice screen.

### 7.2 Flow

```text
Check -- "Photo ou fichier de l'ordonnance" --> #/prescription
  |-- pack not installed --> #/prescription-pack (install, on wifi) --> back
  |-- "Prendre une photo" --> camera in the page --> "Prendre la photo" --+
  |-- "Choisir une photo ou un PDF" --> file chooser --------------------+
  |                                                                       v
  |                                            reading ("Je lis l'ordonnance...")
  |                                                  |                 |
  |                                     products found          nothing found
  |                                                  v                 v
  |                       one list to check (7.4)      "Reprendre la photo",
  |                       "Ajouter les produits cochés"     "Écrire ou dire les noms"
  |                                                  |
  +-------------------- back to Check, the items added said once ("3 produits ajoutés.")
```

The image exists from the shutter (or the file chosen) to the end of the reading, in memory only; the list screen holds text, never the image (section 7.11).

### 7.3 Screen states

All sentences below are French interface text (the English goes in `en.ts`). One primary action per screen.

1. **Start** (`#/prescription`): heading "Ordonnance"; lead "Prenez l'ordonnance en photo, ou choisissez une photo ou un PDF déjà sur le téléphone." then, in bold, "La photo reste sur ce téléphone. Elle n'est pas gardée." Primary "Prendre une photo"; secondary "Choisir une photo ou un PDF"; quiet "Écrire ou dire les noms à la place" (back to the check, focus on the search field). A short note under them: "Une ordonnance écrite à la main est souvent mal lue : vérifiez chaque produit."
2. **Camera** (in the page, `getUserMedia` with the rear camera): the picture of the camera across the width, four corner marks for the frame, the hint "Toute l'ordonnance dans le cadre, à plat, avec de la lumière."; primary "Prendre la photo" (56 px); secondary "Lampe" only when the camera offers a torch (`MediaStreamTrack` `torch` capability); secondary "Annuler". The camera opens only on this screen, after the tap on "Prendre une photo", and closes as soon as the photo is taken, the screen is left, the page is hidden, or the app locks. A refused camera says it in plain words with numbered steps (Chrome, or the installed app), as the refused microphone does, and offers "Choisir une photo ou un PDF".
3. **Reading**: "Je lis l'ordonnance..." in a status region, a progress bar when the engine reports progress, the time it usually takes ("Cela prend quelques secondes, parfois une demi-minute sur un petit téléphone."), and a secondary "Annuler". No thumbnail of the photo: nothing about the patient on screen longer than needed (the recent apps screen keeps a picture of the last screen).
4. **Products found** (section 7.4): heading "Produits lus sur l'ordonnance", then the list, then the lines not recognised, then "Ajouter les produits cochés" (primary, held at the bottom with `StickyAction` when the list is long), "Reprendre la photo" (secondary), "Écrire ou dire un autre nom" (quiet).
5. **Nothing found**: "Je n'ai trouvé aucun produit connu sur cette photo." then why it may be ("La photo est peut-être floue, sombre ou de travers, ou l'ordonnance est écrite à la main."), the lines not recognised if any (section 7.6), primary "Reprendre la photo", secondary "Écrire ou dire les noms". Never "rien à signaler" or anything that could read as "nothing to worry about": nothing found is not nothing taken.
6. **Errors**: a file that is not an image or a PDF ("Ce fichier n'est pas une photo ni un PDF."), a PDF protected by a password ("Ce PDF est protégé : il ne peut pas être lu ici."), too large ("Ce fichier est trop gros pour ce téléphone." above 20 MB or 40 megapixels, checked before decoding), a reading that fails or takes more than its time limit ("La lecture n'a pas abouti."), the pack damaged (as the voice: remove and install again). Each says to type or speak the names meanwhile, with the button for it. Errors use the notice (ink and the triangle), never a level colour.

### 7.4 One list to check (SCRUM-59)

All the products read are confirmed in one list, not one by one: a `fieldset` named "Produits lus sur l'ordonnance" with one native checkbox answer per product (the `CheckboxGroup` of `DESIGN.md`, whole-width 56 px answers), in the order of the prescription.

- **Nothing is ticked at the start.** Ticking an answer is the same act as "Oui, c'est ce produit" on the confirm screen: she looks at each product, ticks the right ones, leaves the others. Pre-ticked boxes would let one tap on the primary action add products nobody looked at (a misread name, a product proposed from another line). Speed comes from the single list and from no typing, not from skipping the look. Whether a "Tout cocher" shortcut is worth its risk is a question for the pharmacist live test (section 10), not a default.
- **Each answer says**, in this order: the product name as the confirm screen shows it (label weight, never hyphenated, numbers held to their units); the line read, quoted, under the small muted label "Lu sur l'ordonnance :" ("« Doliprane 1000 mg cp »"), at reading weight like any text she gave (the same quotation as "Vous avez écrit :" and "Vous avez dit :"); when the match is only strong (section 7.13), "À vérifier : le nom lu ressemble à ce produit." with the triangle mark; when the line names a substance the product lacks, the confirm screen's sentence ("Codéine : ce produit n'en contient pas. Comparez avec le nom sur la boîte.").
- **"Corriger"** (quiet, 48 px) under each answer opens the search screen with the line read in the field (`searchPath`, the text as typed), so she picks the right product or keeps the name as typed; the answer is then replaced by what she chose, ticked.
- **The strength** of a ticked product follows section 7.5, inside the answer, under the box, so the list stays one screen of decisions.
- **"Ajouter les produits cochés (3)"** adds the ticked items with `useCheck().add` (each through the same `add` rules: never twice, a known strength takes the place of an unknown one), says "3 produits ajoutés." once on the check screen, and drops the list. With nothing ticked it is dashed (`aria-disabled`) and described by "Cochez les produits qui sont sur l'ordonnance."
- A product already in the check is shown with "Déjà dans la liste" and no box.

### 7.5 Strengths, and what happens to posology lines

- **Strength.** The strength read on the product's line (`parseStrength`, the same reader as typed names: "1000 mg", "1 g", "500") is handed to `strengthChoiceOf` as if typed: when it matches one product of the family, that strength is preselected ("Dosage lu : 1000 mg", with "Changer"); otherwise nothing is chosen and the strength question of the confirm screen opens under the ticked box, "Je ne sais pas" included. A strength read is never added without the box ticked, and a strength that matches no product of the family is never used: she chooses, or the product goes in with its strength unknown (the engine then reads the family's strengths, `strengthUnknown`). Units in micrograms ("200 µg") are read as no strength in mg, so nothing is preselected.
- **Posology.** Posology lines ("1 cp x 3/j pendant 5 jours", "matin, midi et soir", "QSP 3 mois") are never used to give, check or repeat a dose, and nothing in the interface comments on them. They are used for one thing only: for a product whose substance has a daily-maximum rule (`needsUnitsPerDay`, the same condition as the units field of the confirm screen), once the box is ticked, the units field shows under it with the line quoted ("Sur l'ordonnance : « 1 cp x 3/j »") and a quiet button "Mettre 3 par jour" when the line says a plain count (rule 6 of section 4.3: "2 cp x 3/j" is 6, "1 cp matin et soir" is 2, "par semaine" and anything unclear is nothing). The field itself stays empty until she taps that button or types a number: the count is proposed, never imposed, and the engine's daily maximum then works as for a count she typed.
- **Never** a dose said back, a "dose too high" from the prescription itself (the engine decides that from her confirmed items and counts, as today), or any advice to take or stop: `PRODUCT.md` holds.

### 7.6 Lines not recognised, and products outside the base

A line that looks like a product (a list mark, a strength, a form word such as "cp", "gél", "sirop", "ovule") but names nothing of the base is not dropped: it shows under the heading "Lignes non reconnues", quoted, each with a box "Ajouter tel quel" (unticked) and "Corriger". Ticked, it is added as an unrecognised item, with its list ("Produit non reconnu"), so the result shows its grey card and the safety net of `possible-matches.ts` looks it up again in both lists. Unknown is not safe: a product the base does not know must reach the result as grey, never vanish because the scan did not know it. Header lines, the patient line, the date, the signature and the stamp are never offered (rule 2 of section 4.3).

### 7.7 The pharmacist at the counter (SCRUM-59)

The counter is the main entry point for pharmacists and depot keepers, so the flow is built for a prescription in seconds:

1. In accompanied mode the counter starts with "Regarder sans enregistrer" (a passer-by, nothing stored) or her profile; the term and breastfeeding questions stay first, as today (a result without them would be wrong).
2. "Photo ou fichier de l'ordonnance", then "Prendre une photo": the camera opens in the page, one tap takes the photo.
3. The list appears after the reading, product by product from the top of the page as lines are read (PR 5): 3.3 s per page with PaddleOCR on the laptop, an estimated 15 s on a mid-range phone and 23 s on an entry-level one (section 4.6). She ticks the right products, fixes or leaves the others, and adds them in one tap.
4. The danger signs question, then the result, as for typed products.

Target: from the shutter to the list in under 10 seconds on a mid-range phone, and the whole prescription checked in under a minute for 3 to 5 printed products. The phone timings of section 10 confirm or change the engine settings. Handwritten prescriptions handed over the counter are read partly at best (section 8): the list then shows what was read, and the pharmacist types the rest; the screen says so, and the app never implies a complete reading.

### 7.8 Outputs: "Fiche pour la patiente" and "Note pour le prescripteur" (SCRUM-56)

SCRUM-56 defines two outputs generated on the phone from a result: a sheet for the woman and a note for the prescriber, each shared only by an explicit action (the phone's share sheet or print), never sent by the app. The prescription scan feeds them nothing but confirmed items, exactly as typed or spoken ones: the products, the strengths she chose, the counts she gave. Two links only:

- An item added from a prescription carries its provenance, `read` next to `written` and `said` (`AddOptions` in `app/src/state/check-state.ts`), with the line read as its quoted text. The result and the note may then say "Lu sur l'ordonnance : « ... »" so the prescriber recognises his own line; the sheet for the woman does not need it.
- Neither output ever holds the image, the full text read, the patient's name read from the paper, the prescriber's name or stamp read from it, or any posology. The text of the header and of the patient line is dropped at the end of the reading (section 7.11), so it cannot leak into an output.

### 7.9 Fit with the voice and the search

The reading uses the resolver exactly as the search does: the same index (`searchIndexOf`), the same candidates, the same strength classes as the possible-match safety net (`strengthOf`). A product proposed from a prescription is never better trusted than a typed name: it goes through the same confirmation, and the result's capped evaluation applies to what she adds as typed.

### 7.10 The optional "Lecture d'ordonnance" pack

The reading needs 28.9 MB of files (section 4.4), far above the app shell budget (1.5 MB), so it is an optional pack, the voice pack's model (`docs/voice.md`) applied here:

- **What it holds.** `ocr-pack.json` (each file with its size and sha256, the licences, the model revisions, the ONNX Runtime Web version in `runtime`), `models/det.onnx` (PP-OCRv5 mobile detection, sha256 `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d`), `models/rec-latin.onnx` (Latin recognition, sha256 `7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498`), `models/dict-latin.json` (the 836 characters of the model's `inference.yml`), `runtime/<version>/ort-wasm-simd-threaded.{mjs,wasm}` (the plain build: 14.3 MB, against 26.9 MB for the asyncify build of the voice pack), `pdf/pdf.worker.min.mjs`, `licenses/` (Apache-2.0 for the models and pdf.js, MIT for ONNX Runtime) and `NOTICE.md`. Built by a script from pinned sources, checked against their sha256.
- **Where.** Served from the app origin (`ocr/<pack id>/`), never from a CDN or the Hugging Face hub at run time; stored in a Cache API cache of its own; the service worker never precaches `ocr/` and never answers it with the app page, as for `voice/`.
- **Screen** (`#/prescription-pack`, also from the settings): what the reading does; in bold, "La lecture se fait sur ce téléphone : la photo n'est envoyée nulle part."; the size ("29 Mo sur le téléphone, 16 Mo à télécharger"); the advice to install once on wifi at the health post; "Installer la lecture d'ordonnance" as the one primary action. Offline the button is dashed (`aria-disabled`) and described by "Connectez-vous à Internet pour installer la lecture d'ordonnance."; installing shows a progress bar with the megabytes and a secondary "Annuler"; a download cut short keeps its files and offers "Reprendre l'installation"; installed, how to use it and a removal asked twice. The failures say what the voice's say (not available here, damaged, stopped part way, not enough space), each with "Écrire ou dire les noms" meanwhile. Nothing is downloaded without that button.
- **Runtime.** A dedicated worker (`@siapso/ocr`, built like `@siapso/speech`): its `fetch` answers the files of the pack from the Cache API and refuses every other address; ONNX Runtime loads its WebAssembly from the pack (`onnxruntime-web-use-extern-wasm`, as the speech worker); one reading at a time, cancel at any time, a time limit (90 s to start with, set from the phone measurements) after which the worker is ended and replaced; the models are freed 3 minutes after the last reading and when the page is hidden. The runtime version is the one the speech worker pins (`ORT_WEB_VERSION`), checked by a test, so one ONNX Runtime version ships in the app.
- **Sharing with the voice.** Both packs carry a runtime (14.3 MB here, 26.9 MB in the voice). Sharing one copy is possible only if both use the same build; it is left for later (phase 6), since a phone with the voice already holds 137 to 326 MB and 14 MB more is not the deciding cost.
- **What it says about her.** Whether the pack is installed says nothing about a profile; `docs/privacy.md`, "What the phone keeps", gets the line.

### 7.11 Privacy

Added to `docs/privacy.md` in the implementation, under "What protects the data":

- **The camera** opens only on the prescription screen, after the tap on "Prendre une photo", and closes (every track stopped) as soon as the photo is taken, the screen is left, the page is hidden, or the app locks or quits. The photo is one frame drawn from the camera into memory (`ImageCapture.takePhoto` where offered, else the video frame): no file is written. This is the reason to prefer the camera in the page over `<input capture>`, which hands the photo to the phone's camera app: that app or Chrome may write it to a temporary file outside the app's reach, and on a 2 GB phone Android may close the browser tab while the camera app is in front, losing the list in memory.
- **A file chosen** (a photo already in the gallery or WhatsApp, or a PDF) is read through the file chooser into memory. The app neither copies nor changes nor deletes the file: it was there before and stays, as the phone's owner left it. The screen says so ("La photo reste dans la galerie du téléphone : la supprimer, c'est à vous de le faire.").
- **The image** is decoded once, scaled down to 2000 pixels at most on its long side, transferred to the reading worker (the page keeps no copy: `ImageBitmap` transfer, then `close()`), read, and dropped: the worker lets go of its pixels and tensors as soon as the lines are read, and the worker itself is ended a few minutes after the last reading, as the voice model is. Nothing is written to IndexedDB, the Cache API, local or session storage, or a history entry. The service worker never sees it.
- **The text read** stays in the worker and the page's memory only. At the end of the reading, every line that is neither a product nor a line offered to add as typed (the header, the patient's name and age, the date, the prescriber, the stamp, the posology of products not ticked) is dropped. The lines kept are those of the list, held like the check list (memory only, forgotten at "Quitter", at a reload, and with the check); a line added becomes the quoted text of its item, as a typed name. The history entry of `#/prescription` holds random marks only, like every screen (`docs/privacy.md`, "History entries").
- **No network**: the reading runs from the pack in the Cache API; the worker's `fetch` answers only the files of the pack and refuses everything else, as the speech worker does (`docs/voice.md`, Runtime). The reading works in airplane mode.
- **Locks**: at a lock or "Quitter", the camera closes, a reading under way is cancelled and its worker ended, and an image not yet read is dropped; after the code, the screen comes back without the image (the list, if it was there, comes back like the check list; "Quitter" forgets it).
- **What the phone keeps** gains one line: Cache Storage holds the reading pack once installed, nothing about a profile; whether it is installed says nothing about a profile.
- **Limits** to write down: the recent apps screen may show the camera picture if the phone is switched away during the photo (the page hides, the camera closes, but the last frame may be the thumbnail); a photo chosen from the gallery stays in the gallery; the browser's file chooser may list recent files.

### 7.12 Accessibility

- Every path has an alternative: the camera is of no use to a blind user or in the dark, so "Choisir une photo ou un PDF" and "Écrire ou dire les noms à la place" are on the same screen, and the whole check works without the scan.
- The camera screen is not a gesture surface: one 56 px button takes the photo; the frame is decoration (`aria-hidden`), the hint is text. A status region says each state once ("Appareil photo ouvert.", "Je lis l'ordonnance.", "4 produits lus, 1 ligne non reconnue."), present and empty when the screen appears.
- The list is native checkboxes in a `fieldset` (WCAG 1.3.1), 56 px answers, the line read as a quotation with `lang="fr"`, the "À vérifier" warning as text with the triangle (never colour alone, never a level pictogram), focus on the heading when the list appears and on the check screen's status after adding. At 200 percent text on a 360 px phone nothing scrolls sideways (`app/e2e/layout.spec.ts` gets a case), and the sticky primary action never hides the focused answer (`StickyAction`).
- Time: no time limit on the list; a reading can be cancelled at any time; the reading's own limit (section 7.3) gives a message, never a silent stop.
- `/impeccable shape`, `critique` and `audit` run on the three new screens (start and camera, list, pack), and `impeccable detect app/src` stays clean.

### 7.13 Safety: models propose, rules decide

- Only **strong** and **very strong** candidates are proposed (the classes of `strengthOf` in `possible-matches.ts`: a whole name, a whole word, a name contained in the line, a score of 0.9 or more is very strong; a score of 0.8 or more, or a whole name within one edit, is strong). Weak resemblances (a short prefix such as a first name, one word of a longer name, a laboratory) are never proposed from a prescription: the line goes to "Lignes non reconnues" instead.
- One product per line: the best window of the line wins, very strong first, then the longest window, so "Fer + Acide folique" is never also "Fer" and "Acide folique" (rule 5 of section 4.3).
- Lines of the header, the patient, the date and the signature are never searched (a first name is never proposed as a remedy).
- Nothing is added without its box ticked; a strong match says "À vérifier"; the confirm screen's missing-substance sentence is said in the list.
- The engine is unchanged: a product from a prescription is an ordinary confirmed item.

## 8. Honest limits

What the app says, and what the documentation (`docs/prescription-scan.md` in phase 3) keeps:

- **Handwriting.** Handwritten prescriptions are common in Senegal, and they were not measured: only handwriting-style fonts were, which read well (93 percent with PaddleOCR) because a font is regular. Real prescriptions written in a hurry will often be read in part or not at all. The start screen says "Une ordonnance écrite à la main est souvent mal lue : vérifiez chaque produit.", the list never claims to be complete, and "Écrire ou dire les noms" is on every screen of the flow. No promise is made for handwriting until consented real samples are measured (section 10).
- **Printed prescriptions** are the case that works: every product of the base found on the synthetic printed set, in every photo condition, with no false product. Real paper adds folds, stamps over the text, faded ink, carbon copies and motion blur that the set does not have.
- **Products outside the base** are never recognised as products: they come as "Lignes non reconnues", to add as typed (95 percent of them were kept that way); a product outside the base whose line the OCR merged with another is lost from that list, so the check list is to be compared with the paper.
- **Digits.** OCR misreads digits: 2 of the 115 strengths read on the held-out set were wrong, both on the handwriting proxy, one of them a strength the product exists in. A strength read is therefore shown next to the line it came from, and the box is the reference.
- **Combinations.** A combination read in part (iron for iron and folic acid) was the only kind of false product seen. The reading rules removed them on the synthetic set; on real paper some will remain, and the "À vérifier" mark (strong matches) and the missing-substance sentence are the safety net, with her eyes.
- **Units per day** are read for about three products in four whose posology says a daily count; she types the others. Never a dose.
- **Speed** on an entry-level phone is estimated at about 23 s per page with PaddleOCR (6x throttling of a laptop), 15 s on a mid-range one: within "seconds, not minutes", above the 10 s target of the counter until measured and improved (sections 9 and 10).
- **Memory.** The page peaked at about 350 MB on the laptop while reading a 2000 px image; a 2 GB phone may close the tab. The image size and the freeing of buffers are tuned on real phones.
- **One page at a time**; a PDF is read up to its third page; a PDF with a password is refused; a QR code or barcode on an e-prescription is not read.
- **French and Latin script** only (English words are read by the same model); Arabic script is not.
- **The camera's last frame** may stay as the thumbnail of the recent apps screen if the phone is switched away during the photo; a photo chosen from the gallery stays in the gallery.

## 9. Phased implementation plan

One ticket, one branch, one pull request each, test-driven, in this order. Each pull request runs `/impeccable` where it touches a screen and updates the documents it changes.

| # | Pull request | Content | Tests |
| --- | --- | --- | --- |
| 1 | `feat(app): read products from the text of a prescription` | `app/src/domain/prescription-reading.ts`: the reading of section 4.3 (joined lines, header and patient lines skipped, list marks, snap to substance and brand names, windows, strong and very strong only, one product per line, strength, units per day, lines kept), with `strengthOf` and `strengthChoiceOf` reused. `eval/prescription/`: the OCR texts of the synthetic set (PaddleOCR and Tesseract, about 300 KB of text, CC-BY-4.0 like `eval/`), `truth.json` and a baseline; `pnpm eval:prescription` reports recall, precision, false products by kind, strengths and units, and fails CI below the baseline or on any false product on the printed pages. Run again once PR #59 (resolver phonetic folding) is merged | Unit tests per rule, each from a failure of the spike: "SP (Sulfadoxine" / "Pyriméthamine)" is SP; "Fer + Acide folique" is never "Fer"; "2 Acide folique 5 mg" reads 5 mg; "Spéciafoldine5 my"; "Fluconazole 150 mg gél CLINIQUE DE"; every synthetic patient name and the header words propose nothing; posology lines propose nothing; "par semaine" gives no units; a product outside the base becomes a kept line; a weak resemblance never becomes a proposal |
| 2 | `feat(ocr): add the offline prescription reading pack` | Package `ocr/` (`@siapso/ocr`): the worker (decode, scale to 2000 px, PP-OCRv5 detection and Latin recognition with ONNX Runtime Web, oriented boxes, reading order, progress, cancel, time limit, freeing), the pack (`ocr-pack.json`, install, resume, remove, installed check in the Cache API, the same discipline as `speech/src/voice-pack.ts`, sharing its helpers where they fit), the build script with pinned revisions and sha256, `pnpm ocr:install-local`, `pnpm ocr:bench` (a bench page to run on phones, as `pnpm voice:bench`). Licences in `#/licences`, `THIRD_PARTY_NOTICES.md`, `docs/dependencies.md` (pdfjs-dist 6.4.299; onnxruntime-web at the speech version) | Unit: manifest validation, fetch refusal of any other address, CTC decoding and reading order on fixtures, boxes from synthetic probability maps, the runtime version equal to `ORT_WEB_VERSION`; integration: the real models on two synthetic pages in Node give the expected lines; the bench checks no request leaves the origin once offline |
| 3 | `feat(app): add the prescription entry and reading screens` | The entry on the check screen (placed with SCRUM-56), `#/prescription` (start, camera in the page, file chooser for images and PDF, reading, the one list, strengths and units in the list, lines not recognised, nothing found, errors), `#/prescription-pack`, the `read` provenance in the check state, French and English text, the privacy rules of section 7.11 (camera closed, image dropped, lines dropped, locks), `docs/privacy.md` and `DESIGN.md` updated | Component tests for each state and rule (nothing ticked at start, the primary action dashed until a tick, a strength preselected only on an exact product, units never filled without the button, a kept line added as unrecognised, "Déjà dans la liste", the lock closes the camera and drops the image); Playwright end to end, offline after installing the pack from the local server: a synthetic prescription image through the file chooser, the list, ticking, the result; no request after installation; nothing of the image in IndexedDB, the Cache API, local or session storage or the history state; axe; 360 px and 200 percent text; the camera path with Chromium's fake camera fed a synthetic prescription |
| 4 | `feat(ocr): read prescriptions sent as PDF` | pdf.js in the pack: the text layer first (three pages at most), the page drawn and read otherwise; password, size and damaged-file errors; `isEvalSupported: false`, no scripting; `docs/threat-model.md` | Synthetic text and scanned PDFs made in the test with Playwright; a PDF with a password; a file that is not a PDF; end to end with a text PDF |
| 5 | `feat(app): fit the scan to the pharmacist counter and the outputs` (with SCRUM-56 and SCRUM-59) | The list shown as lines are read (products appear from the top while the rest is read), "Lu sur l'ordonnance" carried to the result and to the "Note pour le prescripteur", the counter flow timed; live test round with a pharmacist persona photographing printed synthetic prescriptions with a phone camera; decide "Tout cocher" from it | Component tests of the progressive list; the outputs never hold the image, the patient line or a posology (a test reads their text) |
| 6 | `perf(ocr): ...` (only if section 10 asks for it) | What the phone measurements call for: threads or WebGPU for ONNX Runtime, a smaller image, the recognition of fewer boxes, or approach A (Tesseract) for printed pages behind the same reading | The evaluation of PR 1 holds; the bench shows the gain on the phone |

## 10. To measure on real phones, and open questions

Before PR 3 ships to users:

1. **Speed and memory** with `pnpm ocr:bench` on an entry-level Android phone (2 GB) and a mid-range one, in Chrome: time per page (one thread, threads when cross-origin isolated, WebGPU if offered), tab memory with the models loaded and while reading a 2000 px and a 1600 px image, whether Chrome closes the tab. Target: under 10 s from the shutter to the list on the mid-range phone. If missed: phase 6 before the screen ships.
2. **Camera**: the rear camera's resolution through `getUserMedia`, `ImageCapture.takePhoto` and the torch on those phones; focus at 20 to 30 cm; and whether the native camera (`<input capture>`) makes Android close the tab on a 2 GB phone, which decided the camera in the page.
3. **Real prescriptions**: accuracy on real printed and handwritten prescriptions needs consented, de-identified samples, collected with the same care as the voice recordings (an opinion of the ethics committee, consent forms, nothing kept that names a person). Until then the app promises nothing for handwriting.
4. **Pharmacist live test** (SCRUM-59): time per prescription at the counter, whether "Tout cocher" is needed, where the entry sits on the check screen of SCRUM-56.
5. **PDF**: do pharmacists and women receive PDF prescriptions at all? If not, PR 4 can wait.
6. **Clinical committee**: is the units-per-day button ("Mettre 3 par jour", after confirmation, for the daily-maximum rules only) acceptable? Is there a rule whose level drops when a combination is read in part (SP read as pyrimethamine alone, for the cotrimoxazole interaction)? The answer sets how strongly the "À vérifier" mark is worded.
7. **The resolver after PR #59** (phonetic folding, open on 2026-11-05): these measures use the resolver of `main` at `160de43`; `pnpm eval:prescription` (PR 1) runs them again once it is merged.

## Appendix: spike scripts

Committed, small and tested (`tools/prescription-eval/`, run by `pnpm test` as the other `tools/*` folders):

- `catalog.mjs`: the synthetic content: 39 ways of writing 26 products of the pack (26 distinct sets of substances), each with its pack product id, the strength the line gives and its posologies with the units per day they say; 18 products common on Senegalese prescriptions that the pack does not have, synthetic first and family names, prescribers, places, and a seeded generator.
- `synth.mjs`: `makeRx(i)` (the prescription number `i`: layout, fonts, patient, 2 to 6 products), `sheetHtml` (the A5 sheet: a health post form with the national header, a private practice letterhead, or a maternity table; a stamp and a signature), `sceneHtml` (the phone photo around it: tilt, rotation, blur, uneven light, noise) and `truthText`.
- `generate.mjs`: renders them with the app's Playwright Chromium: `node tools/prescription-eval/generate.mjs <out-dir> [count] [fonts-dir]` writes `<id>-scan.png`, `<id>-photo.jpg`, `<id>-hard.jpg`, `<id>-dim.jpg` and `truth.json`. The images are never committed.
- `metrics.mjs`: `scoreReading` (products found, false products and their kind, strengths and units per day read, lines kept for products outside the pack), `addScores`, `rates`.

Kept out of the repository (scratch, summarised here so the measures can be redone): the OCR harness (`ocr.html`: Tesseract driven on the page thread through `tesseract.js-core`, so that DevTools CPU throttling applies; the PaddleOCR pipeline on ONNX Runtime Web: DBNet detection at 960 px, connected components with oriented boxes unclipped by 1.5, recognition at 48 px high, CTC greedy decoding, lines rebuilt in reading order), `bench.mjs` (one configuration over the set, renderer working set sampled every 250 ms), `pdf-bench.mjs` (pdf.js text layer and page rendering), `tessjs-worker.mjs` (the real tesseract.js worker with local files, counting requests to other origins), `extract.ts` (the reading prototype of section 4.3), `score.ts`, `misses.ts` (the products missed and the strengths read wrong) and `stats.mjs` (timings and memory). Phase 1 turns `extract.ts` into tested app code and the harness into `pnpm eval:prescription` (section 9).
