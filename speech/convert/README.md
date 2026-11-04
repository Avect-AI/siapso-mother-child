<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Voice pack conversion

`convert.py` turns the open Whisper models used by SIAPSO into voice packs that Transformers.js loads in the browser, with no network. `quick_check.py` measures the word error rate of a pack on FLEURS. Why two packs, and the measured results: `docs/voice.md`.

| Pack                     | Source model (revision)                                                    | Licence | Language | Decoder prompt                                                      |
| ------------------------ | -------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------- |
| `whisper-small-wolof-q8` | `M9and2M/whisper-small-wolof` (`8cc20b3c6e77ecb490210103d3b4fd0b85c3d1d8`) | MIT     | Wolof    | `<\|startoftranscript\|>` alone, as in its training                 |
| `whisper-base-fr-q8`     | `openai/whisper-base` (`e37978b90ca9030d5170a5c07aadb050351a65bb`)         | MIT     | French   | `<\|startoftranscript\|><\|fr\|><\|transcribe\|><\|notimestamps\|>` |

## Steps

From the repository root (Python 3.10, 3.11 or 3.12, the range with wheels for the pinned set; Windows x86_64, Linux x86_64 or aarch64, macOS arm64; no GPU needed, about 6 GB of free disk):

```sh
pnpm voice:convert                 # both packs; or: pnpm voice:convert --pack whisper-base-fr-q8
pnpm voice:install-local           # copies them to app/public/voice/ with the ONNX Runtime files
```

`pnpm voice:convert` runs `sh tools/hygiene/py.sh speech/convert/convert.py`, which:

1. stops with a clear message outside Python 3.10 to 3.12, creates the virtual environment `speech/convert/.venv` and installs `requirements.txt` with `pip install --require-hashes --only-binary=:all:` (every version pinned, transitive ones included, all published on or before 2026-10-20, each with the sha256 of its wheels; `torch` is the CPU build, from the PyTorch CPU index), then runs itself inside it. A missing pin, a changed file or a package with no wheel fails the installation;
2. downloads the source model at the pinned revision (`huggingface_hub`);
3. exports it to ONNX with past key values with optimum (`automatic-speech-recognition-with-past`): `encoder_model.onnx` and `decoder_model_merged.onnx` (one decoder for the first step and the cached steps);
4. quantises both graphs with ONNX Runtime dynamic quantisation, int8 weights, per channel, reduced range, subgraphs included: the `q8` data type of Transformers.js (`onnx/<name>_quantized.onnx`). Quantised operators: MatMul, and Gather for the token embedding (159 MB in 32-bit floats for Whisper small, 40 MB in int8; no measurable change in Wolof word error rate with the Wolof prompt, see `docs/voice.md` for the limits of that comparison);
5. copies `config.json`, `generation_config.json` and `preprocessor_config.json`, writes `tokenizer.json` and `tokenizer_config.json` (fast tokenizer), and writes `voice-pack.json`: id, licence, languages, decoder prompt (token ids), source repository and revision, tool versions, every file with its size and sha256, total size.

Output: `speech/convert/out/<pack id>/` (git-ignored, like the venv and `app/public/voice/`). Use `--keep-work` to keep the 32-bit export in `speech/convert/out/work/`.

`pnpm voice:install-local` (`speech/scripts/install-local.mjs`) copies each pack to `app/public/voice/<pack id>/`, adds `runtime/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` from the `onnxruntime-web` version that `@huggingface/transformers` uses and the licence texts (`licenses/`, `NOTICE.md`), and records them in `voice-pack.json`. A deployment serves that folder as it is.

## Changing a pinned version

Edit `requirements.in` (keep every version on or before the cutoff, and the platform markers), then, in the venv:

```sh
speech/convert/.venv/Scripts/python speech/convert/lock.py hash    # rewrites requirements.txt with the hashes
speech/convert/.venv/Scripts/python speech/convert/lock.py check   # every requirement pinned, on every platform
```

`lock.py check` reads the requirements of each pinned version (PyPI, and the PyTorch CPU index for `torch`), evaluates the markers for Windows x86_64, Linux x86_64 and aarch64 and macOS arm64 with Python 3.10, 3.11 and 3.12, and fails if a needed package is not pinned or not satisfied, if a pin has no wheel for a platform, or if a version was published after the cutoff.

## Quick check

```sh
speech/convert/.venv/Scripts/python speech/convert/quick_check.py --data-dir <folder outside the repository>
```

(`speech/convert/.venv/bin/python` on Linux and macOS.) It downloads the FLEURS `fr_fr` and `wo_sn` test splits (CC BY 4.0) at a pinned revision into `--data-dir`, runs the 8-bit graphs as the browser does (merged decoder, greedy decoding, the same suppressed tokens and prompts, at most 96 new tokens), and prints the word error rate of the first 20 sentences of each language for each prompt (`--prompt sot`, `--prompt fr`). Options: `--pack`, `--onnx-dir`, `--language`, `--count`, `--max-new-tokens`, `--json`.

## Windows notes

- Paths over 260 characters: the `onnx` wheel holds long test file names. If `pip` fails with `WinError 206`, enable long paths in Windows or clone the repository to a shorter path.
- An antivirus that inspects HTTPS (it shows as `certificate verify failed`): point `PIP_CERT` and `REQUESTS_CA_BUNDLE` to a bundle that adds its root certificate to the usual ones. Never commit that bundle.
