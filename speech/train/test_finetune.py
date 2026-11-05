# SPDX-License-Identifier: MIT
"""Tests of finetune.py (no GPU, no download).

    python speech/train/test_finetune.py

The gates (data licences, splits, trusted repositories, no remote code) need
the standard library only. The training smoke test runs only where the
training lock is installed (speech/train/requirements.txt): it builds a tiny
random Whisper from a config, feeds two synthetic clips through the data path
of the script and runs one training step on the CPU. Elsewhere it is skipped.
"""

from __future__ import annotations

import ast
import importlib.util
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import finetune  # noqa: E402

EXAMPLE = HERE / "data.example.json"
# The pinned commits (head of main on 2026-11-05, both last changed on 2024-02-29).
BASE, BASE_COMMIT = "openai/whisper-base", "e37978b90ca9030d5170a5c07aadb050351a65bb"
TINY, TINY_COMMIT = "openai/whisper-tiny", "169d4a4341b33bc18d8881c4b69c2e104e1cc0af"


def write(directory: str, sources: list[dict]) -> Path:
    path = Path(directory) / "data.json"
    path.write_text(json.dumps({"sources": sources}), encoding="utf-8")
    return path


def check_only(*extra: str, revision: str = BASE_COMMIT, cwd: str | None = None) -> subprocess.CompletedProcess:
    """finetune.py --check-only on the command line (the base defaults to openai/whisper-base)."""
    command = [sys.executable, str(HERE / "finetune.py"), "--check-only", "--revision", revision, "--output-dir", "x"]
    return subprocess.run([*command, *extra], capture_output=True, text=True, cwd=cwd)


def hub(**changes) -> dict:
    entry = {
        "name": "fleurs-wo-train",
        "lang": "wo",
        "kind": "hub",
        "location": "google/fleurs",
        "config": "wo_sn",
        "revision": finetune.FLEURS_REVISION,
        "split": "train",
        "licence": "CC-BY-4.0",
    }
    entry.update(changes)
    return entry


def recordings(**changes) -> dict:
    entry = {
        "name": "siapso-wo",
        "lang": "wo",
        "kind": "consented-folder",
        "location": "/data/siapso",
        "licence": "CC-BY-4.0",
        "consent": "SIAPSO-CONSENT-2026-0001",
        "cners": "CNERS-2026-AB12",
    }
    entry.update(changes)
    return entry


class Gates(unittest.TestCase):
    def read(self, sources, allow_sources=frozenset(), allow_share_alike=False):
        with tempfile.TemporaryDirectory() as directory:
            return finetune.read_sources(write(directory, sources), allow_share_alike, frozenset(allow_sources))

    def test_example_refuses_kallaama_by_default(self):
        with self.assertRaises(SystemExit) as caught:
            finetune.read_sources(EXAMPLE, False)
        self.assertIn("kallaama-wo", str(caught.exception))
        self.assertIn("UNVERIFIED-CONFLICT", str(caught.exception))

    def test_example_with_the_explicit_opt_in(self):
        sources = finetune.read_sources(EXAMPLE, False, frozenset({"kallaama-wo"}))
        self.assertEqual([s.name for s in sources], ["fleurs-wo-train", "kallaama-wo", "fleurs-fr-train"])

    def test_opt_in_names_one_source_only(self):
        with self.assertRaises(SystemExit):
            finetune.read_sources(EXAMPLE, False, frozenset({"another-source"}))

    def test_opt_in_never_lifts_a_non_commercial_licence(self):
        with self.assertRaises(SystemExit):
            self.read([hub(licence="CC-BY-NC-4.0")], allow_sources={"fleurs-wo-train"})

    def test_command_line_check_only(self):
        refused = check_only("--data-config", str(EXAMPLE))
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("kallaama-wo", refused.stderr)
        # With the opt-in, the Kallaama folder of the example is listed too; it is not on this machine.
        missing = check_only("--data-config", str(EXAMPLE), "--allow-source", "kallaama-wo")
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("Refused: kallaama-wo has no metadata.csv", missing.stderr)
        hubs = [s for s in json.loads(EXAMPLE.read_text(encoding="utf-8"))["sources"] if s["kind"] == "hub"]
        with tempfile.TemporaryDirectory() as directory:
            accepted = check_only("--data-config", str(write(directory, hubs)))
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertIn("OK: 2 sources accepted", accepted.stdout)

    def test_share_alike_needs_its_flag(self):
        with self.assertRaises(SystemExit):
            self.read([hub(licence="CC-BY-SA-4.0")])
        self.assertEqual(len(self.read([hub(licence="CC-BY-SA-4.0")], allow_share_alike=True)), 1)

    def test_unknown_licence_refused(self):
        for licence in ("", "unverified", "Proprietary"):
            with self.assertRaises(SystemExit):
                self.read([hub(licence=licence)])

    def test_fleurs_evaluation_splits_refused_in_any_form(self):
        for split in ("test", "validation", "dev", "train+test", "train+validation", "train[:10%]+dev", "TEST"):
            with self.assertRaises(SystemExit, msg=split):
                self.read([hub(split=split)])
        self.assertEqual(len(self.read([hub(split="train")])), 1)

    def test_hub_source_needs_a_pinned_revision(self):
        with self.assertRaises(SystemExit):
            self.read([hub(revision=None)])

    def test_consented_recordings_accept_the_structured_references(self):
        self.assertEqual(len(self.read([recordings()])), 1)

    def test_consented_recordings_refuse_free_text_references(self):
        for changes in (
            {"consent": "yes"},
            {"consent": "SIAPSO-CONSENT-26-1"},
            {"consent": None},
            {"cners": "approved"},
            {"cners": None},
            {"cners": "cners-2026-ab12"},
        ):
            with self.assertRaises(SystemExit, msg=str(changes)):
                self.read([recordings(**changes)])

    def test_unknown_kind_refused(self):
        with self.assertRaises(SystemExit):
            self.read([recordings(kind="folder")])


#: Revisions that are not the pinned commit: branches, tags, pull request refs, short or other commits.
UNPINNED = ("main", "refs/pr/7", "v1.0", "e37978b", BASE_COMMIT.upper(), TINY_COMMIT, "0" * 40, "", None)


class TrustedRepositories(unittest.TestCase):
    def test_the_pinned_commits(self):
        self.assertEqual(finetune.TRUSTED_MODELS, {BASE: BASE_COMMIT, TINY: TINY_COMMIT})
        self.assertEqual(finetune.TRUSTED_DATASETS, {"google/fleurs": finetune.FLEURS_REVISION})
        for commit in (*finetune.TRUSTED_MODELS.values(), *finetune.TRUSTED_DATASETS.values()):
            self.assertRegex(commit, r"^[0-9a-f]{40}$")

    def test_base_model_outside_the_allow_list_refused(self):
        for base in ("someone/whisper-base", "openai/whisper-small", "openai/whisper-base-copy", "./whisper-base", ""):
            with self.assertRaises(SystemExit, msg=base):
                finetune.check_base(base, BASE_COMMIT)
        finetune.check_base(TINY, TINY_COMMIT)
        finetune.check_base(BASE, BASE_COMMIT)

    def test_base_revision_must_be_its_pinned_commit(self):
        for revision in UNPINNED:
            with self.assertRaises(SystemExit, msg=revision) as caught:
                finetune.check_base(BASE, revision)
            self.assertIn("Refused:", str(caught.exception))
            self.assertIn(BASE_COMMIT, str(caught.exception))
        with self.assertRaises(SystemExit):
            finetune.check_base(TINY, BASE_COMMIT)

    def test_hub_dataset_outside_the_allow_list_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(SystemExit) as caught:
                finetune.read_sources(write(directory, [hub(location="someone/fleurs")]), False)
            self.assertIn("someone/fleurs", str(caught.exception))
            self.assertEqual(len(finetune.read_sources(write(directory, [hub()]), False)), 1)

    def test_hub_dataset_revision_must_be_its_pinned_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            for revision in (*UNPINNED, finetune.FLEURS_REVISION[:12], BASE_COMMIT):
                with self.assertRaises(SystemExit, msg=revision) as caught:
                    finetune.read_sources(write(directory, [hub(revision=revision)]), False)
                self.assertIn("Refused:", str(caught.exception))

    def test_command_line_refuses_an_untrusted_base(self):
        result = check_only("--data-config", str(EXAMPLE), "--allow-source", "kallaama-wo", "--base", "someone/whisper-base")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("someone/whisper-base", result.stderr)

    def test_command_line_refuses_an_unpinned_revision_before_anything_else(self):
        for revision in ("main", "refs/pr/7", "e37978b", TINY_COMMIT):
            result = check_only("--data-config", str(EXAMPLE), "--allow-source", "kallaama-wo", revision=revision)
            self.assertNotEqual(result.returncode, 0, revision)
            self.assertIn(f"Refused: {BASE} at revision {revision!r}", result.stderr)

    def test_local_folder_named_like_a_trusted_repository_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "openai" / "whisper-base").mkdir(parents=True)
            (Path(directory) / "google" / "fleurs").mkdir(parents=True)
            previous = os.getcwd()
            os.chdir(directory)
            try:
                with self.assertRaises(SystemExit) as caught:
                    finetune.check_base(BASE, BASE_COMMIT)
                self.assertIn("Refused:", str(caught.exception))
                with self.assertRaises(SystemExit) as caught:
                    finetune.read_sources(write(directory, [hub()]), False)
                self.assertIn("Refused:", str(caught.exception))
                finetune.check_base(TINY, TINY_COMMIT)
            finally:
                os.chdir(previous)

    def test_remote_code_is_never_enabled(self):
        tree = ast.parse((HERE / "finetune.py").read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
        loads = [c for c in calls if isinstance(c.func, ast.Attribute) and c.func.attr == "from_pretrained"]
        self.assertGreaterEqual(len(loads), 2)
        for call in loads:
            self.assertIn("trust_remote_code", {k.arg for k in call.keywords}, ast.unparse(call))
        for call in calls:
            for keyword in call.keywords:
                self.assertNotEqual(keyword.arg, "custom_generate", ast.unparse(call))
                if keyword.arg == "trust_remote_code":
                    self.assertIsInstance(keyword.value, ast.Constant, ast.unparse(call))
                    self.assertIs(keyword.value.value, False, ast.unparse(call))


def folder(location: Path) -> finetune.Source:
    return finetune.Source(
        name="local-fr",
        lang="fr",
        licence="CC0-1.0",
        kind="open-folder",
        location=str(location),
        revision=None,
        split="train",
        text_column="transcription",
        config=None,
        consent=None,
        cners=None,
    )


def layout(root: Path, rows: list[str], files: list[str], header: str = "file_name,transcription", bom: bool = False) -> Path:
    """A folder with empty audio files and a metadata.csv made of the header and the raw rows."""
    location = root / "clips"
    for name in files:
        (location / name).parent.mkdir(parents=True, exist_ok=True)
        (location / name).write_bytes(b"")
    location.mkdir(exist_ok=True)
    text = "\n".join([header, *rows]) + "\n"
    (location / "metadata.csv").write_text(text, encoding="utf-8-sig" if bom else "utf-8")
    return location


def link_directory(link: Path, target: Path) -> bool:
    """A directory symbolic link, or a junction on Windows without the right to create links."""
    try:
        os.symlink(target, link, target_is_directory=True)
        return True
    except (OSError, NotImplementedError):
        pass
    try:
        import _winapi

        _winapi.CreateJunction(str(target), str(link))
        return True
    except (ImportError, AttributeError, OSError):
        return False


class FolderLayout(unittest.TestCase):
    def test_lists_the_files_and_texts_of_metadata_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            location = layout(Path(directory), ["a.wav,bonjour", "spk-001/b.wav,merci"], ["a.wav", "spk-001/b.wav"])
            rows = finetune.list_folder(folder(location))
        resolved = location.resolve()
        self.assertEqual(rows, [(str(resolved / "a.wav"), "bonjour"), (str(resolved / "spk-001" / "b.wav"), "merci")])

    def test_reads_a_metadata_csv_with_a_byte_order_mark(self):
        with tempfile.TemporaryDirectory() as directory:
            location = layout(Path(directory), ["a.wav,bonjour"], ["a.wav"], bom=True)
            rows = finetune.list_folder(folder(location))
        self.assertEqual(rows, [(str(location.resolve() / "a.wav"), "bonjour")])

    def test_refuses_a_header_without_file_name_or_the_text_column(self):
        for header in ("file_name,text", "path,transcription", "transcription"):
            with tempfile.TemporaryDirectory() as directory:
                location = layout(Path(directory), ["a.wav,bonjour"], ["a.wav"], header=header)
                with self.assertRaises(SystemExit, msg=header) as caught:
                    finetune.list_folder(folder(location))
            self.assertIn("Refused:", str(caught.exception))
            self.assertIn("column", str(caught.exception))

    def test_refuses_a_short_row_or_an_empty_text(self):
        for row in ("a.wav", "a.wav,", "a.wav,   "):
            with tempfile.TemporaryDirectory() as directory:
                location = layout(Path(directory), [row], ["a.wav"])
                with self.assertRaises(SystemExit, msg=row) as caught:
                    finetune.list_folder(folder(location))
            self.assertIn("Refused:", str(caught.exception))
            self.assertIn("no text", str(caught.exception))

    def test_refuses_a_folder_without_metadata_csv(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(SystemExit) as caught:
                finetune.list_folder(folder(Path(directory)))
        self.assertIn("Refused: local-fr has no metadata.csv", str(caught.exception))

    def test_refuses_a_file_name_outside_the_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "outside.wav").write_bytes(b"")
            for name in ("../outside.wav", str(root / "outside.wav"), "spk-001/../../outside.wav"):
                location = layout(root, [f"{name},bonjour"], [])
                with self.assertRaises(SystemExit, msg=name) as caught:
                    finetune.list_folder(folder(location))
                self.assertIn(f", outside {location.resolve()}", str(caught.exception))

    def test_refuses_a_link_that_leads_outside_the_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "elsewhere").mkdir()
            (root / "elsewhere" / "x.wav").write_bytes(b"")
            location = layout(root, ["linked/x.wav,bonjour"], [])
            if not link_directory(location / "linked", root / "elsewhere"):
                self.skipTest("neither a symbolic link nor a junction can be created here")
            self.assertTrue((location / "linked" / "x.wav").is_file())
            with self.assertRaises(SystemExit) as caught:
                finetune.list_folder(folder(location))
            self.assertIn(f", outside {location.resolve()}", str(caught.exception))

    def test_refuses_a_missing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            location = layout(Path(directory), ["missing.wav,bonjour"], [])
            with self.assertRaises(SystemExit) as caught:
                finetune.list_folder(folder(location))
            self.assertIn("missing.wav", str(caught.exception))


AUDIO = all(importlib.util.find_spec(name) is not None for name in ("numpy", "soundfile"))


@unittest.skipUnless(AUDIO, "needs numpy and soundfile (training lock)")
class AudioDecoding(unittest.TestCase):
    def test_a_16_khz_clip_is_read_as_mono_float32(self):
        import io

        import numpy
        import soundfile

        stereo = numpy.stack([numpy.full(1600, 0.25), numpy.full(1600, 0.75)], axis=1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stereo.wav"
            soundfile.write(path, stereo, 16000, subtype="FLOAT")
            buffer = io.BytesIO()
            soundfile.write(buffer, stereo, 16000, format="WAV", subtype="FLOAT")
            for cell in ({"bytes": None, "path": str(path)}, {"bytes": buffer.getvalue(), "path": "stereo.wav"}):
                samples = finetune.read_audio(cell)
                self.assertEqual((samples.dtype, samples.shape), (numpy.float32, (1600,)))
                self.assertTrue(numpy.allclose(samples, 0.5))

    def test_another_sampling_rate_is_refused(self):
        import numpy
        import soundfile

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip-22k.wav"
            soundfile.write(path, numpy.zeros(2205), 22050, subtype="PCM_16")
            with self.assertRaises(ValueError) as caught:
                finetune.read_audio({"bytes": None, "path": str(path)})
        self.assertIn("22050 Hz", str(caught.exception))
        self.assertIn("16 kHz", str(caught.exception))

    def test_check_only_reads_the_rate_of_every_local_file(self):
        import numpy
        import soundfile

        with tempfile.TemporaryDirectory() as directory:
            location = layout(Path(directory), ["a.wav,bonjour", "b.wav,merci"], [])
            soundfile.write(location / "a.wav", numpy.zeros(1600), 16000, subtype="PCM_16")
            soundfile.write(location / "b.wav", numpy.zeros(1600), 16000, subtype="PCM_16")
            config = write(directory, [{"name": "local-fr", "lang": "fr", "kind": "open-folder", "location": str(location), "licence": "CC0-1.0"}])
            accepted = check_only("--data-config", str(config))
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertIn("OK: 1 sources accepted, 2 local audio files at 16 kHz", accepted.stdout)

            soundfile.write(location / "b.wav", numpy.zeros(2205), 22050, subtype="PCM_16")
            refused = check_only("--data-config", str(config))
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("Refused: local-fr:", refused.stderr)
            self.assertIn("22050 Hz, not 16 kHz", refused.stderr)

            (location / "b.wav").write_bytes(b"not audio")
            unreadable = check_only("--data-config", str(config))
            self.assertNotEqual(unreadable.returncode, 0)
            self.assertIn("cannot be read as audio", unreadable.stderr)


TRAINING_LOCK = all(
    importlib.util.find_spec(name) is not None
    for name in ("torch", "transformers", "datasets", "accelerate", "soundfile", "jiwer")
)
SOT, EOT = "<|startoftranscript|>", "<|endoftext|>"
PROMPT = ("<|fr|>", "<|transcribe|>", "<|notimestamps|>")


def byte_alphabet() -> list[str]:
    """The 256 symbols of byte-level BPE (bytes_to_unicode of GPT-2), the base alphabet of Whisper."""
    printable = {*range(0x21, 0x7F), *range(0xA1, 0xAD), *range(0xAE, 0x100)}
    symbols, shifted = [], 0
    for byte in range(256):
        if byte in printable:
            symbols.append(chr(byte))
        else:
            symbols.append(chr(256 + shifted))
            shifted += 1
    return symbols


def tiny_processor():
    """A Whisper processor built locally: default feature extractor, byte-level tokenizer without merges."""
    from transformers import WhisperFeatureExtractor, WhisperProcessor, WhisperTokenizer

    specials = [EOT, SOT, *PROMPT]
    vocab = {symbol: i for i, symbol in enumerate(byte_alphabet() + specials)}
    tokenizer = WhisperTokenizer(vocab=vocab, merges=[], pad_token=EOT, additional_special_tokens=specials[1:])
    return WhisperProcessor(feature_extractor=WhisperFeatureExtractor(), tokenizer=tokenizer)


def tiny_model(tokenizer):
    """A randomly initialised Whisper with one layer each side, from a config (nothing downloaded)."""
    import torch
    from transformers import WhisperConfig, WhisperForConditionalGeneration

    eot = tokenizer.convert_tokens_to_ids(EOT)
    config = WhisperConfig(
        vocab_size=len(tokenizer),
        num_mel_bins=80,
        d_model=16,
        encoder_layers=1,
        decoder_layers=1,
        encoder_attention_heads=2,
        decoder_attention_heads=2,
        encoder_ffn_dim=32,
        decoder_ffn_dim=32,
        max_source_positions=1500,
        max_target_positions=448,
        pad_token_id=eot,
        bos_token_id=eot,
        eos_token_id=eot,
        decoder_start_token_id=tokenizer.convert_tokens_to_ids(SOT),
        begin_suppress_tokens=None,
        suppress_tokens=None,
    )
    torch.manual_seed(0)
    return WhisperForConditionalGeneration(config)


def write_clips(location: Path, clips: list[tuple[str, float, str]]) -> None:
    """An audiofolder layout: 16 kHz mono WAV files (16-bit) and metadata.csv with file_name and transcription."""
    import numpy
    import soundfile

    location.mkdir(parents=True)
    rows = ["file_name,transcription"]
    for name, seconds, text in clips:
        time = numpy.arange(int(seconds * 16000)) / 16000
        soundfile.write(location / name, 0.3 * numpy.sin(2 * math.pi * 440 * time), 16000, subtype="PCM_16")
        rows.append(f"{name},{text}")
    (location / "metadata.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")


def folder_source(name: str, lang: str, location: Path) -> dict:
    return {"name": name, "lang": lang, "kind": "open-folder", "location": str(location), "licence": "CC0-1.0"}


@unittest.skipUnless(TRAINING_LOCK, "needs the training lock (pip install -r speech/train/requirements.txt)")
class TinyTrainingStep(unittest.TestCase):
    """Exercises the transformers and datasets APIs that finetune.py uses, offline, on the CPU."""

    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="finetune-smoke-"))
        cls.environment = {
            "HF_HUB_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1",
            "HF_HOME": str(cls.root / "hf"),
            "HF_DATASETS_CACHE": str(cls.root / "hf" / "datasets"),
        }
        cls.saved = {key: os.environ.get(key) for key in cls.environment}
        os.environ.update(cls.environment)

    @classmethod
    def tearDownClass(cls):
        for key, value in cls.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(cls.root, ignore_errors=True)

    def test_one_training_step_on_synthetic_clips(self):
        work = self.root / "step"
        # Two French clips go through the multiprocess map of the script; the Wolof clip covers the other prompt.
        write_clips(work / "fr", [("fr-0001.wav", 1.0, "bonjour"), ("fr-0002.wav", 2.0, "merci beaucoup")])
        write_clips(work / "wo", [("wo-0001.wav", 1.5, "jerejef")])
        sources = [folder_source("synthetic-fr", "fr", work / "fr"), folder_source("synthetic-wo", "wo", work / "wo")]
        config = work / "data.json"
        config.write_text(json.dumps({"sources": sources}), encoding="utf-8")
        args = finetune.parse_args(
            ["--base", TINY, "--revision", TINY_COMMIT, "--data-config", str(config)]
            + ["--output-dir", str(work / "out"), "--max-steps", "1", "--warmup-steps", "0", "--batch-size", "2"]
            + ["--accumulation", "1", "--eval-steps", "1", "--validation-fraction", "0.3"]
        )
        processor = tiny_processor()
        tokenizer = processor.tokenizer

        data = finetune.load_training_data(finetune.read_sources(args.data_config, False), processor, args.max_seconds)

        def text(words: str) -> list[int]:
            return tokenizer(words, add_special_tokens=False).input_ids

        # French: the standard prompt; Wolof: the start of transcript alone (the prompts of the packs).
        french = tokenizer.convert_tokens_to_ids([SOT, *PROMPT])
        expected = [
            french + text("bonjour") + [tokenizer.eos_token_id],
            french + text("merci beaucoup") + [tokenizer.eos_token_id],
            [tokenizer.convert_tokens_to_ids(SOT)] + text("jerejef") + [tokenizer.eos_token_id],
        ]
        self.assertEqual(sorted(row["labels"] for row in data), sorted(expected))
        for row in data:
            # 80 mel bins x 3000 frames: the clip padded to 30 s, as Whisper expects.
            self.assertEqual((len(row["input_features"]), len(row["input_features"][0])), (80, 3000))

        model = finetune.prepare_model(tiny_model(tokenizer))
        split = data.train_test_split(test_size=args.validation_fraction, seed=args.seed)
        self.assertEqual((len(split["train"]), len(split["test"])), (2, 1))
        trainer = finetune.build_trainer(model, processor, split, args, bf16=False)
        result = trainer.train()

        self.assertEqual(trainer.state.global_step, 1)
        self.assertTrue(math.isfinite(result.training_loss))
        evaluations = [entry for entry in trainer.state.log_history if "eval_wer" in entry]
        self.assertEqual(len(evaluations), 1)
        # The best checkpoint is reloaded from the run's own output folder.
        self.assertTrue((work / "out" / "checkpoint-1").is_dir())

        # The output projection stays tied to the decoder embeddings after that reload.
        import torch

        trained = trainer.model
        self.assertTrue(torch.equal(trained.proj_out.weight, trained.model.decoder.embed_tokens.weight))

        final = work / "out" / "final"
        finetune.save_final(trainer, processor, final)
        reloaded_processor, reloaded = finetune.load_pretrained(str(final), None)
        self.assertEqual(len(reloaded_processor.tokenizer), len(tokenizer))
        weights = trained.state_dict()
        for name, tensor in reloaded.state_dict().items():
            self.assertTrue(torch.equal(tensor, weights[name]), name)

    def test_a_hub_source_goes_through_the_same_data_path(self):
        import io
        from unittest import mock

        import numpy
        import soundfile
        from datasets import Audio, Dataset

        # As google/fleurs on the Hub: parquet rows that carry the audio bytes, with a 16 kHz Audio feature.
        buffer = io.BytesIO()
        time = numpy.arange(16000) / 16000
        soundfile.write(buffer, 0.3 * numpy.sin(2 * math.pi * 440 * time), 16000, format="WAV", subtype="PCM_16")
        cell = {"bytes": buffer.getvalue(), "path": "10005.wav"}
        rows = Dataset.from_dict({"id": [10005], "audio": [cell], "transcription": ["jerejef"]})
        rows = rows.cast_column("audio", Audio(sampling_rate=16000))
        calls = []

        def load_dataset(*args, **kwargs):
            calls.append((args, kwargs))
            return rows

        with tempfile.TemporaryDirectory() as directory:
            sources = finetune.read_sources(write(directory, [hub()]), False)
        processor = tiny_processor()
        tokenizer = processor.tokenizer
        with mock.patch("datasets.load_dataset", load_dataset):
            data = finetune.load_training_data(sources, processor, 30.0)

        self.assertEqual(
            calls,
            [(("google/fleurs",), {"name": "wo_sn", "split": "train", "revision": finetune.FLEURS_REVISION})],
        )
        text = tokenizer("jerejef", add_special_tokens=False).input_ids
        self.assertEqual([row["labels"] for row in data], [[tokenizer.convert_tokens_to_ids(SOT), *text, tokenizer.eos_token_id]])
        features = data[0]["input_features"]
        self.assertEqual((len(features), len(features[0])), (80, 3000))


if __name__ == "__main__":
    unittest.main()
