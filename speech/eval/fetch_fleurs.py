#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Downloads the FLEURS test subsets used by `pnpm eval:speech` (CC BY 4.0).

Reuses `speech/convert/quick_check.py` (same pinned dataset revision, same
choice of sentences: the first reading of each of the first N sentences of the
test split), then writes `<data-dir>/fleurs-<lang>.json` for the Node runner:
the dataset revision, the licence and, for each utterance, the audio path and
the reference transcription. Run inside the conversion venv:

    speech/convert/.venv/Scripts/python speech/eval/fetch_fleurs.py --data-dir <folder>

Keep --data-dir outside the repository: the audio is never committed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "convert"))

import quick_check  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, required=True, help="download folder, outside the repository")
    parser.add_argument("--count", type=int, default=100, help="utterances per language (default 100)")
    parser.add_argument(
        "--language", action="append", choices=sorted(quick_check.LANGUAGES), help="default: fr and wo"
    )
    args = parser.parse_args()
    for lang in args.language or sorted(quick_check.LANGUAGES):
        config = quick_check.LANGUAGES[lang]
        rows = quick_check.fetch_split(config, args.data_dir, args.count)
        dataset = {
            "repo": quick_check.FLEURS_REPO,
            "revision": quick_check.FLEURS_REVISION,
            "config": config,
            "split": "test",
            "licence": "CC-BY-4.0",
            "lang": lang,
            "utterances": [{"id": r["id"], "file": r["file"], "path": r["path"], "text": r["text"]} for r in rows],
        }
        target = args.data_dir / f"fleurs-{lang}.json"
        target.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{lang}: {len(rows)} utterances -> {target}")


if __name__ == "__main__":
    main()
