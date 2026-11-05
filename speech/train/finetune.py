#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Fine-tunes Whisper tiny or base for Wolof (and French) speech for SIAPSO.

NOT RUN in this repository: it needs a GPU (16 GB or more for base, 8 GB is
enough for tiny) and data that SIAPSO does not hold yet. Read
speech/train/README.md first: data plan, licences, the ethics opinion that
must precede any recording of women, consent.

    python speech/train/finetune.py --base openai/whisper-base \\
        --revision e37978b90ca9030d5170a5c07aadb050351a65bb \\
        --data-config speech/train/data.example.json --output-dir <folder outside the repository>

Environment: Linux x86_64, Python 3.11 or 3.12, an NVIDIA driver for CUDA 13.0
(R580 or newer), and

    pip install --require-hashes --only-binary=:all: -r speech/train/requirements.txt

(every version pinned with hashes, published on or before 2026-10-22).

Only trusted repositories are downloaded: the base model must be in
TRUSTED_MODELS and a Hub dataset in TRUSTED_DATASETS, each at the 40-character
commit pinned there (a branch, tag or pull request ref is refused, and so is a
local folder named like the repository), and no model or processor is ever
loaded with remote code (trust_remote_code stays False; datasets 5 cannot run
dataset scripts). Local folders are listed and every file's sampling rate is
read before any download, with --check-only too.

What it does:

1. reads a data config (JSON): a list of sources, each with a Hugging Face
   dataset id and revision or a local folder, a split, the text column, the
   language and its LICENCE. Audio must be 16 kHz (mono or mixed down), as the
   recording protocol of eval/speech/README.md; it is decoded with soundfile.
   A local folder lists its files in metadata.csv, and a file outside the
   folder is refused. A source whose licence is not in the allowlist is
   refused (any non-commercial licence, unknown or unverified); share-alike
   sources are refused unless --allow-share-alike is given, because whether
   weights trained on them must be released share-alike is an open legal
   question (speech/LICENSES.md). A source marked UNVERIFIED-CONFLICT (Kallaama)
   is refused unless named with --allow-source, which is for use only after
   the team has confirmed the licence in writing. A local set of SIAPSO
   recordings (kind consented-folder) needs a consent register reference
   (SIAPSO-CONSENT-YYYY-NNNN) and a CNERS opinion reference (CNERS-YYYY-XXXX);
2. never trains on a FLEURS split that contains test, validation or dev in its
   name (for example train+test), see eval/speech/README.md; the FLEURS test
   audio is cached under <output-dir>/fleurs-cache;
3. fine-tunes the model with the Hugging Face Seq2SeqTrainer (hyperparameters
   below, all overridable), with the decoder prompt the pack uses at run time
   (Wolof: <|startoftranscript|> alone, as the current pack; French: the
   standard prompt), so training and the browser decode the same way;
4. evaluates on the FLEURS wo_sn and fr_fr test splits at the pinned revision,
   first 100 distinct sentences, with the word error rate of
   speech/convert/quick_check.py (lowercase, accents kept, punctuation
   removed), and writes metrics.json with ids, counts and the model revision
   but no reference sentence;
5. saves the model (safetensors) and the tokenizer; export, quantisation and
   packaging are done afterwards with speech/convert/ (convert.py, then
   quantize_q4.py), by adding the new model to PACKS.

Default hyperparameters (the usual recipe of the Hugging Face "Fine-Tune
Whisper" guide, scaled for a small model; they are a starting point to tune on
a validation set, not a result):
  learning rate 1e-5 (tiny: 3.75e-5), linear schedule, 500 warm-up steps,
  AdamW, effective batch size 64 (per device 16 x accumulation 4),
  5000 steps (about 5 epochs per 60 h of audio), bf16, gradient checkpointing,
  max label length 225 tokens, audio clipped to 30 s, seed 42,
  evaluation and checkpoint every 500 steps on a held-out validation split,
  keep the best checkpoint by word error rate.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

# Pinned evaluation data: the same as speech/convert/quick_check.py.
FLEURS_REPO = "google/fleurs"
FLEURS_REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
EVAL_CONFIGS = {"wo": "wo_sn", "fr": "fr_fr"}
EVAL_COUNT = 100

# The only repositories the script downloads from, each at the one commit
# reviewed here (Whisper: head of main on 2026-11-05, both last changed on
# 2024-02-29; base is the commit of the French pack in speech/convert/convert.py).
# Adding a repository or moving a commit is a reviewed change of this file,
# never a command-line option; a branch, tag or pull request ref is refused.
TRUSTED_MODELS = {
    "openai/whisper-tiny": "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
    "openai/whisper-base": "e37978b90ca9030d5170a5c07aadb050351a65bb",
}
TRUSTED_DATASETS = {FLEURS_REPO: FLEURS_REVISION}
COMMIT = re.compile(r"[0-9a-f]{40}")

# Whisper takes 16 kHz audio; the recordings are made at that rate (eval/speech/README.md).
SAMPLING_RATE = 16000

# Licences accepted for training data. CC-BY-4.0 requires attribution (keep the
# credits of speech/MODEL_CARD.md up to date). No non-commercial licence, ever.
ALLOWED_LICENCES = {"CC-BY-4.0", "CC0-1.0", "MIT", "Apache-2.0", "CC-BY-3.0"}
SHARE_ALIKE_LICENCES = {"CC-BY-SA-4.0", "CC-BY-SA-3.0"}
REFUSED_MARKERS = ("-NC", "NONCOMMERCIAL", "NON-COMMERCIAL", "UNVERIFIED", "UNKNOWN")

# The decoder prompts of the packs (speech/convert/convert.py).
PROMPTS = {"wo": "sot", "fr": "fr"}


CONFLICT_LICENCE = "UNVERIFIED-CONFLICT"
# Formats of the references that a local recording set must carry (README.md,
# "Consent, ethics, women"): the consent register entry of the team and the
# reference of the CNERS opinion. Both registers live outside the repository.
CONSENT_PATTERN = re.compile(r"^SIAPSO-CONSENT-\d{4}-\d{3,6}$")
CNERS_PATTERN = re.compile(r"^CNERS-\d{4}-[A-Z0-9]{2,12}$")
KINDS = ("hub", "open-folder", "consented-folder")
# Any FLEURS split that contains one of these is an evaluation split.
EVALUATION_SPLIT = re.compile(r"test|validation|dev", re.IGNORECASE)


@dataclass
class Source:
    name: str
    lang: str  # wo or fr
    licence: str
    kind: str  # hub, open-folder (a published dataset downloaded locally) or consented-folder (SIAPSO recordings)
    location: str  # dataset id, or a folder with audio files and metadata.csv (file_name, text column)
    revision: str | None
    split: str
    text_column: str
    config: str | None  # dataset configuration, for example wo_sn
    consent: str | None  # consented-folder: reference of the consent register
    cners: str | None  # consented-folder: reference of the CNERS opinion


def check_licence(source: Source, allow_share_alike: bool, allow_sources: frozenset[str] = frozenset()) -> None:
    """Raises SystemExit when the source may not be used for training."""
    licence = source.licence.strip()
    upper = licence.upper()
    if upper == CONFLICT_LICENCE:
        if source.name not in allow_sources:
            raise SystemExit(
                f"Refused: source {source.name} has conflicting licence statements (UNVERIFIED-CONFLICT). "
                f"Use --allow-source {source.name} only after the team has confirmed the licence in writing "
                "(speech/train/README.md, Kallaama)."
            )
        print(f"WARNING: {source.name} is used under --allow-source although its licence is in conflict.")
        return
    if not licence or any(marker in upper for marker in REFUSED_MARKERS):
        raise SystemExit(f"Refused: source {source.name} has licence {licence!r} (non-commercial or unverified).")
    if licence in SHARE_ALIKE_LICENCES:
        if not allow_share_alike:
            raise SystemExit(
                f"Refused: source {source.name} is {licence} (share-alike). Whether the trained weights must be "
                "released under the same licence is an open question (speech/LICENSES.md). Pass "
                "--allow-share-alike only after that question is settled."
            )
        return
    if licence not in ALLOWED_LICENCES:
        raise SystemExit(f"Refused: source {source.name} has licence {licence!r}, not in {sorted(ALLOWED_LICENCES)}.")


def check_trusted(name: str, repository: str, revision: str | None, pinned: str) -> None:
    """Raises SystemExit unless revision is the pinned commit and no local path shadows the repository id."""
    if not revision or not COMMIT.fullmatch(revision) or revision != pinned:
        raise SystemExit(
            f"Refused: {name} at revision {revision!r}; only the pinned commit {pinned} is trusted "
            "(no branch, tag, pull request ref or short commit)."
        )
    if Path(repository).exists():
        raise SystemExit(
            f"Refused: a local path {repository!r} exists in {Path.cwd()} and would be loaded instead of the "
            "trusted repository; run from another folder."
        )


def check_base(base: str, revision: str | None) -> None:
    """Raises SystemExit unless the base model is a trusted repository at its pinned commit."""
    if base not in TRUSTED_MODELS:
        raise SystemExit(f"Refused: base model {base!r} is not a trusted repository {sorted(TRUSTED_MODELS)}.")
    check_trusted(base, base, revision, TRUSTED_MODELS[base])


def check_split(source: Source) -> None:
    if source.kind not in KINDS:
        raise SystemExit(f"Refused: {source.name} has kind {source.kind!r}, expected one of {KINDS}.")
    if FLEURS_REPO in source.location and EVALUATION_SPLIT.search(source.split):
        raise SystemExit(f"Refused: {source.name} uses the FLEURS split {source.split!r}; only train may be used.")
    if source.kind == "hub":
        if source.location not in TRUSTED_DATASETS:
            raise SystemExit(
                f"Refused: {source.name} downloads {source.location!r}, not a trusted dataset "
                f"{sorted(TRUSTED_DATASETS)}. Download a published dataset to a folder (kind open-folder) after "
                "checking its licence."
            )
        check_trusted(source.name, source.location, source.revision, TRUSTED_DATASETS[source.location])
    if source.kind == "consented-folder":
        if not source.consent or not CONSENT_PATTERN.fullmatch(source.consent):
            raise SystemExit(
                f"Refused: {source.name} needs a consent register reference like SIAPSO-CONSENT-2026-0001 "
                f"(got {source.consent!r}); see speech/train/README.md."
            )
        if not source.cners or not CNERS_PATTERN.fullmatch(source.cners):
            raise SystemExit(
                f"Refused: {source.name} needs the reference of the CNERS opinion like CNERS-2026-AB12 "
                f"(got {source.cners!r}); no recording may be used without that opinion."
            )


def read_sources(path: Path, allow_share_alike: bool, allow_sources: frozenset[str] = frozenset()) -> list[Source]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    sources = []
    for entry in raw["sources"]:
        source = Source(
            name=entry["name"],
            lang=entry["lang"],
            licence=entry.get("licence", ""),
            kind=entry["kind"],
            location=entry["location"],
            revision=entry.get("revision"),
            split=entry.get("split", "train"),
            text_column=entry.get("textColumn", "transcription"),
            config=entry.get("config"),
            consent=entry.get("consent"),
            cners=entry.get("cners"),
        )
        check_licence(source, allow_share_alike, allow_sources)
        check_split(source)
        sources.append(source)
    if not sources:
        raise SystemExit("No data source in the config.")
    return sources


def normalise(text: str) -> list[str]:
    """As speech/convert/quick_check.py: lowercase, accents kept, punctuation removed."""
    text = unicodedata.normalize("NFC", text.lower())
    text = re.sub(r"[^\w\s']|_", " ", text)
    return text.replace("'", " ").split()


def word_error_rate(references: list[str], hypotheses: list[str]) -> float:
    import jiwer

    refs = [" ".join(normalise(r)) for r in references]
    hyps = [" ".join(normalise(h)) for h in hypotheses]
    pairs = [(r, h) for r, h in zip(refs, hyps) if r]
    return jiwer.wer([r for r, _ in pairs], [h for _, h in pairs])


def list_folder(source: Source) -> list[tuple[str, str]]:
    """(audio file, text) pairs of a local folder: metadata.csv with file_name and the text column.

    A file_name that resolves outside the folder (.., an absolute path, a link)
    is refused, as are a missing file, a missing column and a row without text.
    The file may start with a byte order mark (spreadsheet exports).
    """
    import csv

    location = Path(source.location).resolve()
    metadata = location / "metadata.csv"
    if not metadata.is_file():
        raise SystemExit(f"Refused: {source.name} has no metadata.csv in {location}.")
    with open(metadata, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = sorted({"file_name", source.text_column} - set(reader.fieldnames or []))
        if missing:
            raise SystemExit(f"Refused: {source.name}: metadata.csv has no column {', '.join(missing)}.")
        rows = list(reader)
    pairs = []
    for number, row in enumerate(rows, start=1):
        text = row[source.text_column]
        if not row["file_name"] or text is None or not text.strip():
            raise SystemExit(f"Refused: {source.name}: row {number} of metadata.csv has no file name or no text.")
        path = (location / row["file_name"]).resolve()
        if not path.is_relative_to(location):
            raise SystemExit(f"Refused: {source.name} lists {row['file_name']!r}, outside {location}.")
        if not path.is_file():
            raise SystemExit(f"Refused: {source.name} lists {row['file_name']!r}, which is not a file.")
        pairs.append((str(path), text))
    return pairs


def check_folders(sources: list[Source]) -> int:
    """Lists every folder source and reads the sampling rate of each file, before any download.

    Returns the number of files; raises SystemExit on an unreadable file or a rate other than 16 kHz.
    """
    files = 0
    for source in sources:
        if source.kind == "hub":
            continue
        pairs = list_folder(source)
        try:
            import soundfile
        except ImportError:
            raise SystemExit(
                "Refused: reading the sampling rate of local files needs soundfile; install "
                "speech/train/requirements.txt first."
            ) from None
        for path, _ in pairs:
            try:
                rate = soundfile.info(path).samplerate
            except RuntimeError as error:
                raise SystemExit(f"Refused: {source.name}: {path} cannot be read as audio ({error}).") from None
            if rate != SAMPLING_RATE:
                raise SystemExit(
                    f"Refused: {source.name}: {path} is {rate} Hz, not 16 kHz; convert it first "
                    "(ffmpeg -i in.wav -ar 16000 -ac 1 out.wav)."
                )
            files += 1
    return files


def read_audio(cell: dict):
    """Samples of an audio cell ({"bytes", "path"}) as float32 mono, refused unless at 16 kHz.

    datasets 5 encodes and decodes audio only through torchcodec, which needs
    FFmpeg libraries installed outside the hashed lock; soundfile (pinned)
    ships libsndfile in its wheel.
    """
    import io

    import soundfile

    samples, rate = soundfile.read(io.BytesIO(cell["bytes"]) if cell.get("bytes") else cell["path"], dtype="float32")
    if rate != SAMPLING_RATE:
        raise ValueError(
            f"{cell.get('path')}: {rate} Hz. Convert the audio to 16 kHz first, as in eval/speech/README.md "
            "(ffmpeg -i in.wav -ar 16000 -ac 1 out.wav)."
        )
    return samples.mean(axis=1) if samples.ndim > 1 else samples


def load_training_data(sources: list[Source], processor, max_seconds: float):
    from datasets import Audio, Dataset, concatenate_datasets, load_dataset

    parts = []
    for source in sources:
        if source.kind == "hub":
            data = load_dataset(source.location, name=source.config, split=source.split, revision=source.revision)
            data = data.cast_column("audio", Audio(decode=False))
        else:
            pairs = list_folder(source)
            data = Dataset.from_dict(
                {"audio": [{"bytes": None, "path": p} for p, _ in pairs], source.text_column: [t for _, t in pairs]}
            )
        prompt = PROMPTS[source.lang]
        # Prompt ids, as at run time: see speech/convert/convert.py decoder_prompt().
        tokenizer = processor.tokenizer

        def prepare(example, source=source, prompt=prompt, tokenizer=tokenizer):
            audio = read_audio(example["audio"])
            example["input_features"] = processor.feature_extractor(
                audio, sampling_rate=SAMPLING_RATE
            ).input_features[0]
            example["seconds"] = len(audio) / SAMPLING_RATE
            ids = tokenizer(example[source.text_column], add_special_tokens=False).input_ids
            start = tokenizer.convert_tokens_to_ids("<|startoftranscript|>")
            if prompt == "sot":
                head = [start]
            else:
                head = [
                    start,
                    tokenizer.convert_tokens_to_ids(f"<|{source.lang}|>"),
                    tokenizer.convert_tokens_to_ids("<|transcribe|>"),
                    tokenizer.convert_tokens_to_ids("<|notimestamps|>"),
                ]
            example["labels"] = head + ids + [tokenizer.eos_token_id]
            return example

        data = data.map(prepare, remove_columns=data.column_names, num_proc=4)
        data = data.filter(lambda s: 0.5 <= s <= max_seconds, input_columns=["seconds"])
        parts.append(data.remove_columns(["seconds"]))
        print(f"{source.name} ({source.licence}, {source.lang}): {len(parts[-1])} utterances")
    return concatenate_datasets(parts).shuffle(seed=42)


def evaluate_fleurs(model, processor, lang: str, device: str, cache_dir: Path) -> dict:
    """Greedy decoding, at most 96 new tokens, the prompt of the pack, on the pinned FLEURS test subset."""
    import soundfile
    import torch

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "convert"))
    import quick_check  # noqa: E402  (fetch_split: same sentences as the evaluation harness)

    rows = quick_check.fetch_split(quick_check.LANGUAGES[lang], cache_dir, EVAL_COUNT)
    tokenizer = processor.tokenizer
    start = tokenizer.convert_tokens_to_ids("<|startoftranscript|>")
    if PROMPTS[lang] == "sot":
        prompt = [start]
    else:
        prompt = [start] + tokenizer.convert_tokens_to_ids([f"<|{lang}|>", "<|transcribe|>", "<|notimestamps|>"])
    hypotheses, references, ids = [], [], []
    model.eval()
    for row in rows:
        audio, rate = soundfile.read(row["path"], dtype="float32")
        features = processor.feature_extractor(audio, sampling_rate=rate, return_tensors="pt").input_features
        with torch.no_grad():
            out = model.generate(
                input_features=features.to(device),
                decoder_input_ids=torch.tensor([prompt], device=device),
                max_new_tokens=96,
                do_sample=False,
            )
        hypotheses.append(tokenizer.decode(out[0], skip_special_tokens=True).strip())
        references.append(row["text"])
        ids.append(row["id"])
    return {
        "dataset": {"repo": FLEURS_REPO, "revision": FLEURS_REVISION, "config": EVAL_CONFIGS[lang], "split": "test"},
        "utterances": len(rows),
        "wer": round(word_error_rate(references, hypotheses), 4),
        # No reference sentence in the result (licence caution, eval/speech/results/ATTRIBUTION.md).
        "results": [{"id": i, "hypothesis": h} for i, h in zip(ids, hypotheses)],
    }


def load_pretrained(location: str, revision: str | None):
    """Processor and model from a trusted base (checked by check_base) or from this script's own output.

    Never with remote code: a repository's custom modelling, processing or
    generation code is not run.
    """
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    processor = WhisperProcessor.from_pretrained(location, revision=revision, trust_remote_code=False)
    model = WhisperForConditionalGeneration.from_pretrained(location, revision=revision, trust_remote_code=False)
    return processor, model


def prepare_model(model):
    """No forced prompt at generation (the labels carry the prompt of the pack), no cache while training."""
    model.generation_config.forced_decoder_ids = None
    model.config.use_cache = False
    return model


def build_trainer(model, processor, data, args: argparse.Namespace, bf16: bool = True):
    """The Seq2SeqTrainer of a run (hyperparameters at the top of this file); bf16 on the GPU."""
    import torch
    from transformers import Seq2SeqTrainer, Seq2SeqTrainingArguments

    pad = processor.tokenizer.pad_token_id

    def collate(batch):
        features = torch.tensor([b["input_features"] for b in batch])
        longest = max(len(b["labels"]) for b in batch)
        labels = torch.full((len(batch), longest), -100, dtype=torch.long)
        for i, b in enumerate(batch):
            labels[i, : len(b["labels"])] = torch.tensor(b["labels"])
        # The model shifts the labels to build the decoder input: the first token
        # (the start of transcript) is the decoder start and is not predicted.
        if (labels[:, 0] == model.config.decoder_start_token_id).all():
            labels = labels[:, 1:]
        return {"input_features": features, "labels": labels}

    def compute_metrics(prediction):
        ids = prediction.predictions
        labels = prediction.label_ids.copy()
        labels[labels == -100] = pad
        return {
            "wer": word_error_rate(
                processor.batch_decode(labels, skip_special_tokens=True),
                processor.batch_decode(ids, skip_special_tokens=True),
            )
        }

    learning_rate = args.learning_rate or (3.75e-5 if args.base.endswith("tiny") else 1e-5)
    training = Seq2SeqTrainingArguments(
        output_dir=str(args.output_dir),
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.accumulation,
        learning_rate=learning_rate,
        warmup_steps=args.warmup_steps,
        max_steps=args.max_steps,
        lr_scheduler_type="linear",
        bf16=bf16,
        gradient_checkpointing=True,
        eval_strategy="steps",
        eval_steps=args.eval_steps,
        save_steps=args.eval_steps,
        save_total_limit=2,
        predict_with_generate=True,
        generation_max_length=225,
        metric_for_best_model="wer",
        greater_is_better=False,
        load_best_model_at_end=True,
        logging_steps=25,
        seed=args.seed,
        report_to=[],
        remove_unused_columns=False,
    )
    return Seq2SeqTrainer(
        model=model,
        args=training,
        train_dataset=data["train"],
        eval_dataset=data["test"],
        data_collator=collate,
        compute_metrics=compute_metrics,
        processing_class=processor.feature_extractor,
    )


def save_final(trainer, processor, folder: Path) -> None:
    """The trained model (safetensors) and its processor, in the run's output folder."""
    trainer.save_model(str(folder))
    processor.save_pretrained(str(folder))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="openai/whisper-base", help="openai/whisper-base or openai/whisper-tiny")
    parser.add_argument("--revision", required=True, help="commit of the base model, the one pinned in TRUSTED_MODELS")
    parser.add_argument("--data-config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True, help="outside the repository; weights are never committed")
    parser.add_argument("--allow-share-alike", action="store_true", help="accept CC-BY-SA sources (see the README)")
    parser.add_argument("--learning-rate", type=float, default=None, help="default 1e-5 (tiny: 3.75e-5)")
    parser.add_argument("--max-steps", type=int, default=5000)
    parser.add_argument("--warmup-steps", type=int, default=500)
    parser.add_argument("--batch-size", type=int, default=16, help="per device")
    parser.add_argument("--accumulation", type=int, default=4)
    parser.add_argument("--eval-steps", type=int, default=500)
    parser.add_argument("--validation-fraction", type=float, default=0.05)
    parser.add_argument("--max-seconds", type=float, default=30.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--allow-source",
        action="append",
        default=[],
        metavar="NAME",
        help="use the source NAME although its licence is UNVERIFIED-CONFLICT; only after the team has "
        "confirmed the licence in writing (README.md)",
    )
    parser.add_argument("--check-only", action="store_true", help="validate the data config and stop")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    check_base(args.base, args.revision)
    sources = read_sources(args.data_config, args.allow_share_alike, frozenset(args.allow_source))
    files = check_folders(sources)
    if args.check_only:
        print(f"OK: {len(sources)} sources accepted, {files} local audio files at 16 kHz")
        return

    import torch

    if not torch.cuda.is_available():
        raise SystemExit("No GPU: this script is meant for a CUDA GPU.")
    processor, model = load_pretrained(args.base, args.revision)
    prepare_model(model)

    data = load_training_data(sources, processor, args.max_seconds).train_test_split(
        test_size=args.validation_fraction, seed=args.seed
    )
    trainer = build_trainer(model, processor, data, args)
    trainer.train()
    save_final(trainer, processor, args.output_dir / "final")

    metrics = {
        "base": args.base,
        "baseRevision": args.revision,
        "sources": [
            {"name": s.name, "lang": s.lang, "licence": s.licence, "location": s.location, "revision": s.revision}
            for s in sources
        ],
        "hyperparameters": {k: v for k, v in trainer.args.to_dict().items() if k in (
            "learning_rate", "max_steps", "warmup_steps", "per_device_train_batch_size",
            "gradient_accumulation_steps", "lr_scheduler_type", "seed")},
        "parameters": sum(p.numel() for p in model.parameters()),
        "fleurs": {lang: evaluate_fleurs(model, processor, lang, "cuda", args.output_dir / "fleurs-cache") for lang in EVAL_CONFIGS},
    }
    (args.output_dir / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({lang: r["wer"] for lang, r in metrics["fleurs"].items()}))


if __name__ == "__main__":
    main()
