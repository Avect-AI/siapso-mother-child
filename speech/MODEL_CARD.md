---
license: mit
language:
  - wo
  - fr
library_name: transformers.js
pipeline_tag: automatic-speech-recognition
base_model:
  - M9and2M/whisper-small-wolof
  - openai/whisper-base
tags:
  - automatic-speech-recognition
  - whisper
  - onnx
  - quantized
  - wolof
  - french
  - transformers.js
  - offline
datasets:
  - google/fleurs
metrics:
  - wer
model-index:
  - name: whisper-small-wolof-q8
    results:
      - task:
          type: automatic-speech-recognition
        dataset:
          name: FLEURS wo_sn, test, first 100 distinct sentences
          type: google/fleurs
          config: wo_sn
          split: test
          revision: 70bb2e84b976b7e960aa89f1c648e09c59f894dd
        metrics:
          - type: wer
            value: 54.1
            name: WER (percent, lowercase, accents kept, punctuation removed)
  - name: whisper-base-fr-q8
    results:
      - task:
          type: automatic-speech-recognition
        dataset:
          name: FLEURS fr_fr, test, first 100 distinct sentences
          type: google/fleurs
          config: fr_fr
          split: test
          revision: 70bb2e84b976b7e960aa89f1c648e09c59f894dd
        metrics:
          - type: wer
            value: 30.3
            name: WER (percent, lowercase, accents kept, punctuation removed)
---

<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# SIAPSO voice packs: Wolof and French speech recognition, 8-bit ONNX

Two converted, quantised speech models used by SIAPSO Mother-Child, an offline app that flags risky medicines and remedies in pregnancy and breastfeeding. They run in the browser with Transformers.js, on the phone, with no network once installed. SIAPSO did not train either model: it only converts and quantises them. The weights are not committed to the SIAPSO repository.

Status of this card: draft for publication. Nothing is published yet. Licence research of the training data is incomplete (see `LICENSES.md`).

## Models

| Pack id                  | Source (revision)                                                          | Language | Source licence                                | Served size (model + ONNX Runtime + notices) |
| ------------------------ | -------------------------------------------------------------------------- | -------- | --------------------------------------------- | -------------------------------------------- |
| `whisper-small-wolof-q8` | `M9and2M/whisper-small-wolof` (`8cc20b3c6e77ecb490210103d3b4fd0b85c3d1d8`) | Wolof    | MIT (declared on its card)                    | 326.0 MB (298.7 MB + 27.3 MB)                |
| `whisper-base-fr-q8`     | `openai/whisper-base` (`e37978b90ca9030d5170a5c07aadb050351a65bb`)         | French   | MIT (OpenAI repository), apache-2.0 (HF card) | 137.5 MB (110.2 MB + 27.3 MB)                |

Origin:

- Wolof: `M9and2M/whisper-small-wolof` is a fine-tune of `openai/whisper-small` (revision `973afd24965f72e36ca33b3055d56a652f456b4d` recorded at conversion). Its card reports 57 hours of training data, 10 hours of test data and a word error rate of 0.17 on its own test set. It was trained with the prompt `<|startoftranscript|>` alone, which the pack records.
- French: `openai/whisper-base`, multilingual, used as released, with the French prompt `<|startoftranscript|><|fr|><|transcribe|><|notimestamps|>`.
- Why two packs: the Wolof fine-tune writes Wolof-like spellings of French words (69.3 percent word error rate on French in the 20-sentence check, above the 40 percent limit), so French has its own pack. Details: `docs/voice.md`.

## Conversion and quantisation

Script: `speech/convert/convert.py` (run with `pnpm voice:convert`; steps in `speech/convert/README.md`). Source model at the pinned revision, export to ONNX with past key values (optimum, `automatic-speech-recognition-with-past`), then ONNX Runtime dynamic quantisation to 8-bit weights (per channel, reduced range; MatMul, and Gather for the token embedding), giving `onnx/encoder_model_quantized.onnx` and `onnx/decoder_model_merged_quantized.onnx` (Transformers.js `q8`). Tool versions are pinned and hashed in `speech/convert/requirements.txt`. Each pack ships `voice-pack.json` with every file, its size and sha256, the source repository and revision, the decoder prompt and the licence.

Quantisation changes the model: the figures below were measured on the 8-bit graphs, not on the original weights. SIAPSO did not measure the original weights.

## Intended use

Recognise a spoken medicine or remedy name (or a short sentence) in Wolof or French, to propose candidates that the user confirms. The transcription is never a decision: the deterministic engine alone decides the level, and keyboard search always works. Audio is processed on the phone, kept in memory only, never stored and never sent; nothing is played back.

Not intended for: medical advice, dictation of clinical notes, transcription of patients' health information, any use where a wrong word has consequences without a human confirming it, surveillance or identification of speakers.

## Languages

Wolof (`wo`, pack `whisper-small-wolof-q8`) and French (`fr`, pack `whisper-base-fr-q8`). The language is chosen by the user; there is no language detection. Code switching inside one utterance is not handled.

## Measured results

Both on the FLEURS test split (google/fleurs, dataset revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`, CC-BY-4.0), 8-bit graphs, greedy decoding with at most 96 new tokens, the decoder prompt of each pack, Transformers.js 4.3.1 in Node (CPU). Word error rate: lowercase, accents kept, punctuation removed; total errors over total reference words. Run of 2026-11-04 (`eval/speech/results/2026-11-04-summary.md`).

| Pack                     | Test set                           | Utterances | Words | Word error rate |
| ------------------------ | ---------------------------------- | ---------: | ----: | --------------: |
| `whisper-small-wolof-q8` | FLEURS `wo_sn`, first 100 distinct |        100 |  2289 |          54.1 % |
| `whisper-base-fr-q8`     | FLEURS `fr_fr`, first 100 distinct |        100 |  2652 |          30.3 % |

Earlier check on the first 20 sentences (`speech/convert/quick_check.py`, 441 Wolof words, 534 French words): Wolof pack 55.6 %, French pack 30.0 %. French through the Wolof pack: 69.3 %.

Read these figures with care:

- The Wolof figure may be optimistic. The fine-tune's training dataset (`M9and2M/Wolof_ASR_dataset`) lists FLEURS `wo_sn` among its sources without stating which splits, so some test sentences may have been seen in training. Only recordings never used in training measure the model fairly.
- 100 sentences is a small sample; treat the figures as indications. Wolof spelling varies (`nuy` and `ñuy`, `diwaan` and `diiwaan`), and each variant counts as an error.
- FLEURS is read general text, not medicine or remedy names. Top-1 and top-3 name accuracy after the resolver is not measured yet (pending consented recordings, `eval/speech/README.md`).
- The browser uses ONNX Runtime Web (WebAssembly): same graphs and decoding, another runtime build, so a word or two may differ.
- The fine-tune's own card reports 0.17 word error rate on its test set. Our 54.1 percent on FLEURS is far higher: one word in six wrong on its own data does not carry over to other speakers and recording conditions.

Timings (Wolof pack, 3.3 s clip, headless Chromium 156 on a 12-core Windows laptop, WebAssembly, offline): 13.1 s median on one thread, 6.7 s cross-origin isolated; with CPU throttling on the page thread, 73.8 s at 4x and 122.7 s at 6x (stand-ins for phones, not phone measurements). On one thread, an entry-level phone would need about two minutes per utterance, which is not usable. Details and what must be measured on real phones: `docs/voice.md`.

## Known limitations

- About one word in two wrong on Wolof FLEURS, and about one in three on French FLEURS; names of medicines are likely harder (rare words, brand names).
- Accents and regional varieties of Wolof and French are not evaluated; code switching between Wolof and French is not handled.
- Noisy environments (a health post, a market, a crying child) are not evaluated.
- Children's and elderly voices are not evaluated.
- Whisper always encodes a 30-second window, so a short name costs almost as much as a long sentence. Recording stops after 8 seconds.
- A wrong prompt makes the model repeat itself; the decoding limit of 96 new tokens cuts loops short.
- Whisper models can write words that were not said. A transcription must always be confirmed by a person.
- Wolof spelling is not standardised in the training data.

## Privacy

Audio is captured by the browser, resampled and sent to a Web Worker on the same device, transcribed there, and dropped. No upload, no storage of audio (no IndexedDB, no Cache API for audio), no analytics. The model files are downloaded once, on request, from the app origin, then read from the Cache API offline.

## Training data and licence status

SIAPSO adds no training data of its own: no new training or fine-tuning has been done. Consented recordings will be collected later, following the protocol in `eval/speech/README.md`, after the opinion of the Senegalese national ethics committee for health research (CNERS), and will be used first to evaluate, not to train.

The Wolof pack inherits the training data of `M9and2M/Wolof_ASR_dataset`. Its card lists ALFFA, FLEURS, WAXAL Wolof and a Wolof TTS corpus on Zenodo, and declares MIT for the whole dataset, without a licence for each source. Source by source (pages opened on 2026-11-05, URLs and quoted lines in `LICENSES.md`):

| Source                            | Licence found on its own page                                                  | Status                                       |
| --------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------- |
| FLEURS `wo_sn` (`google/fleurs`)  | cc-by-4.0                                                                      | verified                                     |
| Wolof TTS corpus (Zenodo 4498861) | Creative Commons Attribution 4.0 International                                 | verified                                     |
| WAXAL Wolof                       | Creative Commons Attribution-ShareAlike 4.0 International (repository LICENSE) | verified; share-alike effect on weights open |
| ALFFA Wolof                       | no licence for the data; repository file says MIT; mirror states none          | unverified for the audio data                |

Open questions, not resolved by this card: whether the CC-BY-SA 4.0 of WAXAL applies to model weights trained on it, and what licence ALFFA's Wolof audio carries. Until a legal review answers (with the repository audit, SCRUM-44), the Wolof pack must be treated as having an unresolved data licence, and the repository stays private.

Excluded: Meta MMS (CC BY-NC 4.0) and any non-commercial data are not used by SIAPSO.

## Publication steps for the team (not executed)

1. Create the Hugging Face organisation for SIAPSO (`<org>`).
2. Create a private model repository, one per pack, for example `<org>/siapso-whisper-small-wolof-q8` and `<org>/siapso-whisper-base-fr-q8`. Keep them private during development.
3. Build the packs (`pnpm voice:convert`), then upload the files and this card, adapting the front matter to the pack:

```sh
huggingface-cli upload <org>/<repo> speech/convert/out/<pack-id> . --repo-type model --private
huggingface-cli upload <org>/<repo> speech/MODEL_CARD.md README.md --repo-type model
huggingface-cli upload <org>/<repo> speech/LICENSES.md LICENSES.md --repo-type model
```

4. Switch a repository to public only after the repository audit (SCRUM-44) and the licence questions above are answered.

## Citation and credit

OpenAI Whisper: Radford et al., "Robust Speech Recognition via Large-Scale Weak Supervision" (2022). Wolof fine-tune: `M9and2M/whisper-small-wolof`. FLEURS: Conneau et al. (2022). ALFFA Wolof: Gauthier et al., "Collecting Resources in Sub-Saharan African Languages for Automatic Speech Recognition: a Case Study of Wolof" (LREC 2016). Wolof TTS corpus: Diop, Aw, Jaane, Badiane (BAAMTU Datamation), Zenodo.
