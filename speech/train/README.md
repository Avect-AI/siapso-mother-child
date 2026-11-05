<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Training a lighter French and Wolof voice model

Status: plan and scripts. No training has been run: only the CPU smoke test of `test_finetune.py` (a tiny random model on synthetic clips, see "Running the script"). Training needs a CUDA GPU and consented data that SIAPSO does not hold yet. What was measured is the post-training 4-bit experiment on the current models (`speech/convert/quantize_q4.py`, results in `eval/speech/results/` and `docs/voice.md`).

## Why a smaller model is needed

| Pack (8-bit)             | Size on disk                                     | Measured on                                                               |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `whisper-small-wolof-q8` | 325.6 MB (298.7 MB model + 26.9 MB ONNX Runtime) | about 2 minutes per short phrase with 6x CPU throttling (`docs/voice.md`) |
| `whisper-base-fr-q8`     | 110.2 MB model (+ 26.9 MB runtime)               | French pack, 0.9 s median per utterance on a laptop in Node               |

Target: a pack under 100 MB that answers in a few seconds on an entry-level phone. Quantisation alone does not get there for Whisper small: 4-bit weights give 207.8 MB (measured) and cost 3.0 points of Wolof word error rate (54.1 % to 57.1 %, 100 FLEURS sentences). The size is a matter of parameter count: Whisper small has 244 M parameters, base 74 M, tiny 39 M (OpenAI Whisper README, model table). A Wolof model based on Whisper base, 4-bit, would be about 83 MB (the measured size of the 4-bit French base pack), 110 MB with the ONNX Runtime files served with the pack. Whisper tiny would be smaller still (estimate from parameter counts, not measured: about 40 MB). Wolof is not in the language list of the Whisper tokenizer (the pack's Wolof model is a community fine-tune of small), so base or tiny must be fine-tuned on Wolof speech: this folder.

## What needs a GPU and consented data

| Step                                                  | Needs                                                                        | In this repository                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Fine-tune Whisper base or tiny for Wolof              | One CUDA GPU (16 GB or more for base; 8 GB for tiny), tens of hours of audio | script `finetune.py`, not run                         |
| Record consented speech from health workers and women | CNERS opinion, consent forms, volunteers, a phone and a quiet room           | protocol in `eval/speech/README.md`, nothing recorded |
| Distillation from the Wolof small model               | GPU, pseudo-labelled audio                                                   | options in `distill.md`                               |
| 4-bit quantisation and measurement                    | a laptop                                                                     | done: `speech/convert/quantize_q4.py`                 |
| Measure on a real entry-level phone                   | the phone                                                                    | not done (`docs/voice.md`)                            |

## Data plan

Rules, in order of precedence:

1. English documents, no identifying data, nothing committed except scripts, ids, counts and hypotheses. Weights and audio stay outside the repository.
2. Only data whose licence allows commercial use and redistribution of a model trained on it. Exclude every non-commercial licence (for example CC BY-NC) and every source whose licence was not found on its own page (`speech/LICENSES.md`). `finetune.py` refuses such sources.
3. The evaluation sets are never trained on: FLEURS `wo_sn` and `fr_fr` test splits (revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`), and the volunteer recordings reserved for evaluation, split by speaker.

| Source                                                                                                            | Language | Licence found                                                                                   | Use                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FLEURS `wo_sn`, `fr_fr`, train split                                                                              | wo, fr   | CC BY 4.0 (`speech/LICENSES.md`)                                                                | yes, train split only; attribute in the model card                                                                                                                                                         |
| Kallaama (agriculture speech, about 125 h in three languages, about 55 h Wolof; OpenSLR SLR151, arXiv 2404.01991) | wo, fr   | OpenSLR page: CC BY 4.0. The RAIL 2024 paper in the ACL Anthology carries a CC BY-NC 4.0 notice | no, refused by default (`UNVERIFIED-CONFLICT`); see below                                                                                                                                                  |
| Zenodo Wolof TTS corpus (BAAMTU)                                                                                  | wo       | CC BY 4.0 (`speech/LICENSES.md`)                                                                | yes, but studio TTS speech from few speakers: limited help for phone microphones                                                                                                                           |
| WAXAL Wolof                                                                                                       | wo       | CC BY-SA 4.0 for the repository; audio repository not checked                                   | no, for now. Share-alike: whether the weights must then be shared alike is an open legal question (`speech/LICENSES.md`). Needs a lawyer's reading; `finetune.py` refuses it without `--allow-share-alike` |
| ALFFA Wolof                                                                                                       | wo       | no data licence found                                                                           | no, unverified                                                                                                                                                                                             |
| `M9and2M/Wolof_ASR_dataset`                                                                                       | wo       | card says MIT, third-party sources not relicensable by it                                       | not used as a source; its parts are used from the original sources above, if cleared                                                                                                                       |
| Consented SIAPSO recordings                                                                                       | wo, fr   | CC BY 4.0, as the consent form states                                                           | yes, after the CNERS opinion; the only data close to the use case (names of medicines and remedies, phones, noise)                                                                                         |
| Meta MMS and any non-commercial data                                                                              | -        | CC BY-NC 4.0 and similar                                                                        | excluded                                                                                                                                                                                                   |

Kallaama needs one more check before training. OpenSLR lists CC BY 4.0, but the paper's copyright line in the ACL Anthology says CC BY-NC 4.0. Read the licence on the OpenSLR download page and in the authors' repository on the day of training, write down what each says, and ask the authors (the contact is in the paper) which one governs the audio and the transcriptions. If any doubt remains, leave Kallaama out. The audio is mostly spontaneous speech from radio programmes, focus groups, voice messages and interviews about agriculture: other speakers' privacy applies, so also check how the authors obtained consent for reuse, and do not publish any of it.

How the script enforces this (`speech/train/test_finetune.py` tests it, and `pnpm test` runs that file when Python is available):

- Kallaama is listed in `data.example.json` with the licence `UNVERIFIED-CONFLICT`, and `finetune.py` refuses it, so `--check-only` on the example fails by default. The opt-in is `--allow-source kallaama-wo` (the source's name). Use it only after the team has confirmed the licence in writing with the authors, and then replace the licence in the config by the confirmed one. The opt-in never lifts a non-commercial or unknown licence.
- A local set of SIAPSO recordings is `kind: consented-folder` and must carry a consent register reference in the form `SIAPSO-CONSENT-YYYY-NNNN` (3 to 6 digits for the number) and the reference of the CNERS opinion in the form `CNERS-YYYY-XXXX` (2 to 12 capital letters or digits). Any other string is refused. The registers themselves stay outside the repository. A published dataset downloaded to a folder is `kind: open-folder`.
- Any FLEURS split whose name contains `test`, `validation` or `dev` (for example `train+test`) is refused. The FLEURS evaluation audio is cached under `<output-dir>/fleurs-cache`, not in the working directory.
- Only trusted repositories are downloaded, each at the one commit pinned in `finetune.py`: the base model `openai/whisper-tiny` (`169d4a4341b33bc18d8881c4b69c2e104e1cc0af`) or `openai/whisper-base` (`e37978b90ca9030d5170a5c07aadb050351a65bb`, the commit of the French pack) in `TRUSTED_MODELS`, and the Hub dataset `google/fleurs` at the FLEURS revision above in `TRUSTED_DATASETS`. `--revision` and the `revision` of a Hub source must be that full 40-character commit: a branch, a tag, a pull request ref (`refs/pr/N`) or a short commit is refused, and so is a local folder named like the repository (for example `openai/whisper-base` in the working directory), which would be loaded in its place. Any other repository is refused before a download; a published dataset from elsewhere is downloaded to a folder (`kind: open-folder`) after its licence is checked. Nothing is loaded with remote code: every `from_pretrained` passes `trust_remote_code=False`, and datasets 5 cannot run dataset scripts. Adding a repository or moving a commit is a reviewed change of those two tables, never a command-line option.
- A folder source lists its files in `metadata.csv` (UTF-8, a byte order mark is accepted; `file_name` and the text column). A missing column, a row without text, a `file_name` that leads outside the folder (`..`, an absolute path, a link or junction) or to a missing file is refused. Before any download, and with `--check-only` too, every folder is listed and the sampling rate of each file is read. Audio must be at 16 kHz (several channels are mixed down), as the recording protocol of `eval/speech/README.md` asks; convert other rates first (`ffmpeg -i in.wav -ar 16000 -ac 1 out.wav`). The script decodes audio with `soundfile`, because datasets 5 decodes only through torchcodec, which needs FFmpeg libraries outside the hashed lock.

Plan for the volume: the current Wolof model was fine-tuned on about 57 h (`speech/LICENSES.md`). Start with FLEURS train and the Zenodo corpus, add Kallaama only if cleared, and add the consented recordings with extra weight (repeat them, or sample them in each batch) because they match the target domain.

## Consent, ethics, women

- No recording of anyone before the opinion of the Comite National d'Ethique pour la Recherche en Sante (CNERS) on the protocol. This applies in particular to recordings of women, including pregnant women and mothers, whose voices could be linked to a health situation. Ask for the opinion in writing with the protocol of `eval/speech/README.md` and this plan; keep the answer outside the repository.
- Adults only, volunteers only, no patient. No health information is recorded or discussed: speakers read lists of names of medicines and remedies (French and Wolof) and short phrases, written by the team.
- Use the consent forms `eval/speech/consent-form.fr.md` and `eval/speech/consent-form.en.md`, read aloud to anyone who prefers it. Add to them, before use, that the recordings may train a speech model published under an open licence, and that the voice can be recognised as personal data. Without a signed or marked form, do not record. Withdrawal removes the files from the next training run and the next release; a trained model cannot forget a voice, so say so in the form.
- Pseudonymous speaker codes only (`spk-NNN`). Forms, names and contacts stay in a register outside the repository.
- Speakers of both sexes, several ages and accents, with a real count in every result. Report per-sex and per-accent error rates when there are enough speakers, to catch a model that works for men only.
- A voice model trained on volunteers' voices is itself derived from personal data: no publication of the weights before the CNERS opinion and the consent forms cover it.

## Running the script (when the GPU and the data exist)

```sh
python3.11 -m venv .venv-train && . .venv-train/bin/activate
pip install --require-hashes --only-binary=:all: -r speech/train/requirements.txt
cp speech/train/data.example.json /data/siapso/data.json        # edit: folders, licences re-checked
python speech/train/finetune.py --check-only --base openai/whisper-base --revision e37978b90ca9030d5170a5c07aadb050351a65bb \
  --data-config /data/siapso/data.json --output-dir /data/siapso/run1
python speech/train/finetune.py --base openai/whisper-base --revision e37978b90ca9030d5170a5c07aadb050351a65bb \
  --data-config /data/siapso/data.json --output-dir /data/siapso/run1
```

`requirements.txt` is the hashed lock of `requirements.in` (Linux x86_64, Python 3.11 or 3.12, the CUDA 13 wheels of torch 2.13, which need an NVIDIA driver for CUDA 13.0, R580 or newer; every version published on or before 2026-10-22). Regenerate it with `speech/convert/lock.py hash --dir speech/train`, check it with `lock.py check --dir speech/train`. Its open security alerts and their mitigation are in `docs/dependencies.md`.

With the lock installed, `python speech/train/test_finetune.py` also runs a smoke test on the CPU, without any download: a tiny randomly initialised Whisper built from a `WhisperConfig`, synthetic 16 kHz clips through the data path of the script, one training step with an evaluation, a checkpoint and a reload. Run it before the first training run on a new machine. Without the lock, the tests that need it (audio decoding, `--check-only` on real audio files, the hub data path with `datasets.load_dataset` replaced by an in-memory dataset, the training step) are skipped: `pnpm test` in CI runs this file with a plain Python, so CI checks only the standard-library gates (licences, splits, trusted repositories and commits, no remote code, folder listing).

Hyperparameters (defaults in the script, documented at its top): learning rate 1e-5 (3.75e-5 for tiny), linear schedule, 500 warm-up steps, effective batch 64, 5000 steps, bf16, gradient checkpointing, labels with the decoder prompt of the pack (Wolof: start of transcript alone, French: the standard prompt), validation split 5 %, best checkpoint by word error rate, seed 42. They are the usual recipe for Whisper fine-tuning, a starting point: tune the learning rate and the number of steps on the validation split. No training time or accuracy is promised here, because none was measured.

Evaluation: `finetune.py` writes `metrics.json` with the word error rate on the first 100 distinct FLEURS test sentences, with the same normalisation and decoding as `speech/convert/quick_check.py` (greedy, at most 96 new tokens), ids and hypotheses only. For the figure that counts, run the harness on the converted pack: `pnpm eval:speech`.

## After training

1. Add the model to `PACKS` in `speech/convert/convert.py` (repository, pinned revision, licence, prompt) and run `pnpm voice:convert --keep-work`.
2. `speech/convert/quantize_q4.py --pack <id>` for the 4-bit variant, then `pnpm eval:speech --dtype q4 ...` and compare size and word error rate with the 8-bit pack.
3. Accept a model only if: the pack is under 100 MB; the Wolof word error rate on FLEURS is not worse than the current pack (54.1 %) and the volunteers' name accuracy (top-1, top-3 after the resolver) is reported; the time on a real entry-level phone is measured, in Chrome, with the numbers of `docs/voice.md` repeated.
4. Update `speech/MODEL_CARD.md`, `speech/LICENSES.md` (the data licences used, with the date) and the credits.

## Open questions

- Share-alike (WAXAL): does it bind the weights? Needs a lawyer.
- Kallaama: CC BY 4.0 or CC BY-NC 4.0 for the audio?
- Is about 100 to 150 hours of Wolof enough for Whisper base to match the small model on FLEURS? Unknown until trained. The measured fact is that the current small model reaches 54.1 %, which is far from usable for free speech; names of medicines read from a short list may be easier, which only the volunteer recordings can show.
