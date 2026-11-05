<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 4-bit weight quantisation experiment, 2026-11-05 (SCRUM-42)

Post-training 4-bit weights (`speech/convert/quantize_q4.py`: `MatMulNBits`, round to nearest, symmetric, block size 32, output projection also 4 bits, token embedding in int8 as in the 8-bit packs) against the shipped 8-bit packs, same 100 FLEURS sentences, same decoding. Node only: see "Browser support" below.

| Pack                     | Bits |                  Model files | Test set     | Words | Substitutions | Deletions | Insertions |        WER | Median time per utterance (Node) |
| ------------------------ | ---- | ---------------------------: | ------------ | ----: | ------------: | --------: | ---------: | ---------: | -------------------------------: |
| `whisper-small-wolof-q8` | 8    | 298,678,832 bytes (298.7 MB) | FLEURS wo_sn |  2289 |           910 |       180 |        149 | **54.1 %** |                            2.7 s |
| `whisper-small-wolof-q4` | 4    | 207,840,620 bytes (207.8 MB) | FLEURS wo_sn |  2289 |           904 |       259 |        143 | **57.1 %** |                            3.4 s |
| `whisper-base-fr-q8`     | 8    | 110,222,672 bytes (110.2 MB) | FLEURS fr_fr |  2652 |           580 |        89 |        134 | **30.3 %** |                            0.8 s |
| `whisper-base-fr-q4`     | 4    |   82,996,672 bytes (83.0 MB) | FLEURS fr_fr |  2652 |           640 |        97 |        114 | **32.1 %** |                            1.0 s |

Model files exclude the ONNX Runtime files that every pack also carries (26.9 MB). Word error rate: lowercase, accents kept, punctuation removed; the rate of a set is the total of errors over the total of reference words. The 8-bit rows are a fresh run on 2026-11-05 and reproduce the figures of 2026-11-04 exactly (54.1 % and 30.3 %); their result files are those of 2026-11-04. The per-utterance results of the 4-bit packs are in `2026-11-05-whisper-small-wolof-q4.json` and `2026-11-05-whisper-base-fr-q4.json` (ids, error counts, hypotheses; no reference sentence, see `ATTRIBUTION.md`).

## Reading the figures

- The Wolof model is 30 % smaller and 3.0 points worse (54.1 % to 57.1 %), mostly more deleted words (180 to 259). The French base model is 25 % smaller and 1.8 points worse. With 100 sentences these differences are indications, not precise rates.
- The 100 MB goal is not reached for Whisper small: 207.8 MB of model files. Where the bytes are, and the options: `speech/train/distill.md`.
- Times are medians in Node on a laptop, from separate runs that did not have identical machine load, so the 8-bit/4-bit time gap (2.7 s against 3.4 s for Wolof) is only an indication that 4-bit was not faster. They say nothing about a phone.

## Browser support

- Transformers.js 4.3.1 knows the `q4` data type (file suffix `_q4`, `src/utils/dtypes.js`) and pins ONNX Runtime Web `1.31.0-dev.20260914-8d85527a0`. Its four WebAssembly binaries (`ort-wasm-simd-threaded{,.asyncify,.jsep,.jspi}.wasm`) contain the strings `MatMulNBits` and `GatherBlockQuantized`.
- Run, not only searched: the 4-bit French encoder and one first decoder step ran to the end, with finite outputs, on the ONNX Runtime Web WebAssembly build (one thread, in Node, not in a browser; synthetic input), by the committed script `speech/eval/wasm-q4-check.mjs`; its output is `2026-11-05-wasm-q4-check.json`. The encoder took 3.1 s against 2.1 s for its 8-bit twin and the first decoder step 0.51 s against 0.17 s (one run per graph, indicative only), so 4-bit weights were slower here, not faster: MatMulNBits dequantises as it multiplies, which saves memory and download size, not compute. A committed test (`speech/test/wasm-matmulnbits.test.ts`) checks that every WebAssembly binary of the pinned build contains `MatMulNBits` and that a one-node 4-bit fixture gives the numpy result on the WebAssembly backend.
- Not done: the end-to-end run in a browser (the bench and the worker are fixed on `q8`, `speech/src/runtime-config.ts`) and on a phone. The voice pack loader and its manifest would need a `q4` data type before a browser could use such a pack.

## Run

- Packs built by `speech/convert/convert.py --keep-work` then `speech/convert/quantize_q4.py` (conversion tools: torch 2.10.0+cpu, transformers 4.57.6, optimum 2.1.0, optimum-onnx 0.1.0, onnx 1.22.0, onnxruntime 1.23.2, Python 3.10).
- Decoding: greedy, at most 96 new tokens, the decoder prompt recorded in each pack (Wolof: `<|startoftranscript|>` alone; French: `<|startoftranscript|><|fr|><|transcribe|><|notimestamps|>`), as the browser worker.
- Runtime: Transformers.js 4.3.1 in Node v26.13.0 with onnxruntime-node (CPU), win32 x64, AMD Ryzen 5 8640HS w/ Radeon 760M Graphics, 12 logical cores.
- Test sets: FLEURS `wo_sn` and `fr_fr` test splits, first 100 distinct sentences, one reading each (google/fleurs, revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`, CC-BY-4.0); downloaded at run time, not committed. The Wolof fine-tune's training data lists FLEURS `wo_sn`, so the Wolof figures may be optimistic for both bit widths.
