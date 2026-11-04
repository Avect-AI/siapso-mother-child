#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Quick check of the converted voice pack on FLEURS (CC BY 4.0).

Runs the 8-bit ONNX graphs of the pack as the browser runs them (merged
decoder, greedy decoding, the same suppressed tokens, the same prompt, at
most 96 new tokens) on the first 20
sentences of the FLEURS `fr_fr` and `wo_sn` test splits, and prints the word
error rate of each language for each decoder prompt. Run inside the
conversion venv:

    speech/convert/.venv/Scripts/python speech/convert/quick_check.py --data-dir <folder>

The audio is downloaded at a pinned dataset revision into --data-dir (keep it
outside the repository); only the selected files are extracted.

Prompts (--prompt, repeatable):
  sot   <|startoftranscript|> alone: the prompt the Wolof fine-tune was
        trained with (it writes the text right after it, with no language,
        task or timestamp token);
  <xx>  <|startoftranscript|><|xx|><|transcribe|><|notimestamps|>, the
        standard Whisper prompt for language xx (for example fr).
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import tarfile
import time
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_PACK = HERE / "out" / "whisper-small-wolof-q8"

FLEURS_REPO = "google/fleurs"
# Head of main on 2026-11-04 (last change 2026-05-15).
FLEURS_REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
LANGUAGES = {"fr": "fr_fr", "wo": "wo_sn"}
# The browser worker stops after 96 new tokens (MAX_NEW_TOKENS in speech/src/worker.ts).
MAX_NEW_TOKENS = 96

csv.field_size_limit(1 << 24)


def fetch_split(config: str, data_dir: Path, count: int) -> list[dict]:
    """Returns the first `count` sentences of the test split of `config`, with their audio extracted."""
    from huggingface_hub import hf_hub_download

    tsv = hf_hub_download(
        FLEURS_REPO,
        f"data/{config}/test.tsv",
        repo_type="dataset",
        revision=FLEURS_REVISION,
        cache_dir=str(data_dir / "hub"),
    )
    with open(tsv, encoding="utf-8", newline="") as handle:
        rows = [
            {"id": r[0], "file": r[1], "raw": r[2], "text": r[3], "samples": int(r[5])}
            for r in csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
        ]
    # FLEURS repeats a sentence for several speakers: keep the first reading of each.
    seen: set[str] = set()
    selected = []
    for row in rows:
        if row["id"] in seen:
            continue
        seen.add(row["id"])
        selected.append(row)
        if len(selected) == count:
            break

    audio_dir = data_dir / "audio" / config
    audio_dir.mkdir(parents=True, exist_ok=True)
    wanted = {row["file"] for row in selected if not (audio_dir / row["file"]).exists()}
    if wanted:
        archive = hf_hub_download(
            FLEURS_REPO,
            f"data/{config}/audio/test.tar.gz",
            repo_type="dataset",
            revision=FLEURS_REVISION,
            cache_dir=str(data_dir / "hub"),
        )
        with tarfile.open(archive, "r:gz") as tar:
            for member in tar:
                name = Path(member.name).name
                if member.isfile() and name in wanted:
                    source = tar.extractfile(member)
                    if source is not None:
                        (audio_dir / name).write_bytes(source.read())
                        wanted.discard(name)
                if not wanted:
                    break
    if wanted:
        raise SystemExit(f"Missing audio in the {config} archive: {sorted(wanted)}")
    for row in selected:
        row["path"] = str(audio_dir / row["file"])
    return selected


def normalise(text: str) -> list[str]:
    """Lowercase, accents kept, punctuation removed (FLEURS `transcription` style)."""
    text = unicodedata.normalize("NFC", text.lower())
    text = re.sub(r"[^\w\s']|_", " ", text)
    text = text.replace("'", " ")
    return text.split()


def edit_distance(ref: list[str], hyp: list[str]) -> int:
    previous = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        current = [i]
        for j, h in enumerate(hyp, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (r != h)))
        previous = current
    return previous[-1]


class Whisper:
    """Greedy decoding with the merged decoder, as Transformers.js does it."""

    def __init__(self, pack: Path, onnx_dir: Path) -> None:
        import numpy as np
        import onnxruntime as ort
        from transformers import WhisperFeatureExtractor, WhisperTokenizerFast

        self.np = np
        self.encoder = ort.InferenceSession(str(onnx_dir / "encoder_model_quantized.onnx"))
        self.decoder = ort.InferenceSession(str(onnx_dir / "decoder_model_merged_quantized.onnx"))
        self.outputs = [o.name for o in self.decoder.get_outputs()]
        self.features = WhisperFeatureExtractor.from_pretrained(str(pack))
        self.tokenizer = WhisperTokenizerFast.from_pretrained(str(pack))
        generation = json.loads((pack / "generation_config.json").read_text(encoding="utf-8"))
        config = json.loads((pack / "config.json").read_text(encoding="utf-8"))
        self.lang_to_id: dict[str, int] = generation["lang_to_id"]
        self.sot = generation["decoder_start_token_id"]
        self.transcribe = generation["task_to_id"]["transcribe"]
        self.no_timestamps = generation["no_timestamps_token_id"]
        self.eos = generation["eos_token_id"]
        self.suppress = generation.get("suppress_tokens", [])
        self.begin_suppress = generation.get("begin_suppress_tokens", [])
        self.max_length = generation.get("max_length", 448)
        self.layers = config["decoder_layers"]
        self.heads = config["decoder_attention_heads"]
        self.head_dim = config["d_model"] // self.heads

    def prompt(self, name: str) -> list[int]:
        if name == "sot":
            return [self.sot]
        return [self.sot, self.lang_to_id[f"<|{name}|>"], self.transcribe, self.no_timestamps]

    def encode(self, audio):
        features = self.features(audio, sampling_rate=16000, return_tensors="np").input_features
        return self.encoder.run(None, {"input_features": features.astype(self.np.float32)})[0]

    def _empty_past(self):
        shape = (1, self.heads, 0, self.head_dim)
        past = {}
        for i in range(self.layers):
            for kind in ("decoder", "encoder"):
                for part in ("key", "value"):
                    past[f"past_key_values.{i}.{kind}.{part}"] = self.np.zeros(shape, dtype=self.np.float32)
        return past

    def _step(self, tokens, hidden, past, use_cache):
        feeds = {
            "input_ids": self.np.array([tokens], dtype=self.np.int64),
            "encoder_hidden_states": hidden,
            "use_cache_branch": self.np.array([use_cache]),
            **past,
        }
        result = dict(zip(self.outputs, self.decoder.run(None, feeds)))
        new_past = {}
        for name, value in result.items():
            if name.startswith("present."):
                key = name.replace("present.", "past_key_values.")
                # The cross-attention cache is computed once, on the first step.
                if use_cache and ".encoder." in key:
                    value = past[key]
                new_past[key] = value
        return result["logits"][0, -1], new_past

    def decode(self, hidden, prompt: list[int], max_new_tokens: int) -> str:
        logits, past = self._step(prompt, hidden, self._empty_past(), False)
        generated: list[int] = []
        while len(generated) < max_new_tokens and len(prompt) + len(generated) < self.max_length:
            logits = logits.copy()
            logits[self.suppress] = -self.np.inf
            if not generated:
                logits[self.begin_suppress] = -self.np.inf
            token = int(logits.argmax())
            if token == self.eos:
                break
            generated.append(token)
            logits, past = self._step([token], hidden, past, True)
        return self.tokenizer.decode(generated, skip_special_tokens=True).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pack", type=Path, default=DEFAULT_PACK)
    parser.add_argument("--onnx-dir", type=Path, help="graphs to check (default: <pack>/onnx)")
    parser.add_argument("--data-dir", type=Path, required=True, help="download folder, outside the repository")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--prompt", action="append", help="`sot` or a language code (default: sot and fr)")
    parser.add_argument("--language", action="append", choices=sorted(LANGUAGES), help="default: fr and wo")
    parser.add_argument(
        "--max-new-tokens",
        type=int,
        default=MAX_NEW_TOKENS,
        help=f"decoding limit (default {MAX_NEW_TOKENS}, as the browser worker)",
    )
    parser.add_argument("--json", type=Path, help="write the detailed results to this file")
    args = parser.parse_args()
    prompts = args.prompt or ["sot", "fr"]
    languages = {lang: LANGUAGES[lang] for lang in (args.language or LANGUAGES)}

    import soundfile

    model = Whisper(args.pack, args.onnx_dir or args.pack / "onnx")
    report = {
        "pack": args.pack.name,
        "graphs": str(args.onnx_dir or "onnx"),
        "source": json.loads((args.pack / "voice-pack.json").read_text(encoding="utf-8")).get("source"),
        "dataset": {"repo": FLEURS_REPO, "revision": FLEURS_REVISION, "licence": "CC-BY-4.0", "split": "test"},
        "prompts": {name: model.tokenizer.convert_ids_to_tokens(model.prompt(name)) for name in prompts},
        "maxNewTokens": args.max_new_tokens,
        "results": {},
    }
    for lang, config in languages.items():
        rows = fetch_split(config, args.data_dir, args.count)
        totals = {prompt: [0, 0] for prompt in prompts}
        utterances = []
        seconds = 0.0
        for row in rows:
            audio, rate = soundfile.read(row["path"], dtype="float32")
            if rate != 16000:
                raise SystemExit(f"{row['file']} is not 16 kHz")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            seconds += len(audio) / 16000
            hidden = model.encode(audio)
            entry = {"file": row["file"], "reference": row["text"], "hypotheses": {}}
            ref = normalise(row["text"])
            for prompt in prompts:
                started = time.perf_counter()
                text = model.decode(hidden, model.prompt(prompt), args.max_new_tokens)
                errors = edit_distance(ref, normalise(text))
                totals[prompt][0] += errors
                totals[prompt][1] += len(ref)
                entry["hypotheses"][prompt] = {
                    "text": text,
                    "errors": errors,
                    "decodeSeconds": round(time.perf_counter() - started, 3),
                }
            utterances.append(entry)
            print(f"[{lang}] {row['file']}", flush=True)
        report["results"][lang] = {
            "config": config,
            "utterances": len(rows),
            "audioSeconds": round(seconds, 1),
            "words": totals[prompts[0]][1],
            "wer": {prompt: round(e / max(n, 1), 4) for prompt, (e, n) in totals.items()},
            "details": utterances,
        }

    print()
    for lang, result in report["results"].items():
        wer = ", ".join(f"prompt {prompt}: {100 * value:.1f} %" for prompt, value in result["wer"].items())
        print(f"{lang} ({result['config']}, {result['utterances']} sentences, {result['words']} words): WER {wer}")
    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
