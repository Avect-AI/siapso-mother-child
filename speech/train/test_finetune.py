# SPDX-License-Identifier: MIT
"""Tests of the data gates of finetune.py (no GPU, no download, standard library only).

    python speech/train/test_finetune.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import finetune  # noqa: E402

EXAMPLE = HERE / "data.example.json"


def write(directory: str, sources: list[dict]) -> Path:
    path = Path(directory) / "data.json"
    path.write_text(json.dumps({"sources": sources}), encoding="utf-8")
    return path


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
        base = [sys.executable, str(HERE / "finetune.py"), "--revision", "x", "--output-dir", "x", "--check-only"]
        refused = subprocess.run([*base, "--data-config", str(EXAMPLE)], capture_output=True, text=True)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("kallaama-wo", refused.stderr)
        accepted = subprocess.run(
            [*base, "--data-config", str(EXAMPLE), "--allow-source", "kallaama-wo"], capture_output=True, text=True
        )
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertIn("OK: 3 sources accepted", accepted.stdout)

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


if __name__ == "__main__":
    unittest.main()
