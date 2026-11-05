#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""4-bit weight quantisation experiment on a SIAPSO voice pack (SCRUM-42).

Starting from the 32-bit ONNX export that `convert.py --keep-work` leaves in
`<out>/work/<pack id>/export/`, this script writes a variant of the pack whose
graphs hold 4-bit weights, and compares it with the 8-bit pack:

1. Gather (the token embedding) is quantised to int8, exactly as in the 8-bit
   pack (`convert.py`), so the embedding is kept as it is today;
2. every other MatMul with a constant weight, in the encoder and in the
   subgraphs of the merged decoder, becomes a `com.microsoft.MatMulNBits`
   node (ONNX Runtime `MatMulNBitsQuantizer`, round-to-nearest, symmetric,
   block size 32 by default, 4 bits). The output projection (`proj_out`, the
   biggest MatMul) is 4 bits too, or 8 bits with `--lm-head-bits 8`;
3. the graphs are written as `onnx/<name>_q4.onnx` (the `q4` data type of
   Transformers.js) next to the unchanged tokenizer and configuration files,
   with a `voice-pack.json` that lists every file with its size and sha256.

Run inside the conversion venv, from the repository root:

    speech/convert/.venv/Scripts/python speech/convert/quantize_q4.py --pack whisper-small-wolof-q8

(`pnpm voice:convert --keep-work` first, to have the 32-bit export.) The
output goes to `<out>/<pack id>-q4/`, git-ignored like the other packs. Nothing
is committed. No retraining: this is post-training, round-to-nearest
quantisation, the cheapest option; the measured size and word error rate are
in `eval/speech/results/` and `docs/voice.md`.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import convert  # noqa: E402  (same folder: PACKS, GRAPHS, sha256)

OUT = HERE / "out"


def find_output_projection(model, vocab_size: int) -> list[str]:
    """Names of the MatMul nodes whose constant weight has `vocab_size` columns (proj_out)."""
    names: list[str] = []

    def initializers(graph, stack):
        table = {t.name: t for g in stack for t in g.initializer}
        for node in graph.node:
            if node.op_type == "MatMul" and node.name:
                weight = table.get(node.input[1])
                if weight is not None and len(weight.dims) == 2 and weight.dims[1] == vocab_size:
                    names.append(node.name)
            for attribute in node.attribute:
                if attribute.type == attribute.GRAPH:
                    initializers(attribute.g, stack + [attribute.g])

    initializers(model.graph, [model.graph])
    return names


def has_op(graph, op_type: str) -> bool:
    """True if a node of this type is in the graph or in one of its subgraphs."""
    for node in graph.node:
        if node.op_type == op_type:
            return True
        for attribute in node.attribute:
            if attribute.type == attribute.GRAPH and has_op(attribute.g, op_type):
                return True
    return False


def quantise_graph(source: Path, target: Path, block_size: int, lm_head_bits: int, vocab_size: int) -> dict:
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer

    staging = target.with_suffix(".gather.onnx")
    # Step 1: the embedding to int8, as convert.py does (Gather only).
    # Only the decoder has one (the encoder takes features, not tokens).
    if has_op(onnx.load(str(source)).graph, "Gather"):
        quantize_dynamic(
            model_input=str(source),
            model_output=str(staging),
            op_types_to_quantize=["Gather"],
            per_channel=True,
            reduce_range=True,
            weight_type=QuantType.QInt8,
            extra_options={"EnableSubgraph": True},
        )
        model = onnx.load(str(staging))
        staging.unlink()
    else:
        model = onnx.load(str(source))
    projection = find_output_projection(model, vocab_size)

    def run(model, bits: int, include: list[str] | None, exclude: list[str]):
        config = DefaultWeightOnlyQuantConfig(block_size=block_size, is_symmetric=True, bits=bits)
        quantizer = MatMulNBitsQuantizer(
            model, algo_config=config, nodes_to_exclude=exclude, nodes_to_include=include, block_size=block_size
        )
        quantizer.process()
        return quantizer.model.model

    if lm_head_bits == 8 and projection:
        model = run(model, 8, projection, [])
    model = run(model, 4, None, projection if lm_head_bits == 8 else [])
    onnx.save(model, str(target))
    counts: dict[str, int] = {}

    def count(graph):
        for node in graph.node:
            counts[node.op_type] = counts.get(node.op_type, 0) + 1
            for attribute in node.attribute:
                if attribute.type == attribute.GRAPH:
                    count(attribute.g)

    count(model.graph)
    return {
        "outputProjectionNodes": projection,
        "matMulNBits": counts.get("MatMulNBits", 0),
        "matMulLeft": counts.get("MatMul", 0) + counts.get("MatMulInteger", 0),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pack", choices=sorted(convert.PACKS), default="whisper-small-wolof-q8")
    parser.add_argument("--out", type=Path, default=OUT, help="folder of convert.py (default: speech/convert/out)")
    parser.add_argument("--block-size", type=int, default=32, choices=[16, 32, 64, 128, 256])
    parser.add_argument("--lm-head-bits", type=int, default=4, choices=[4, 8], help="bits of the output projection")
    parser.add_argument("--suffix", default="q4", help="pack id suffix (default q4: <pack id minus -q8>-q4)")
    args = parser.parse_args()

    base_id = args.pack.removesuffix("-q8")
    pack_id = f"{base_id}-{args.suffix}"
    export = args.out / "work" / args.pack / "export"
    eight_bit = args.out / args.pack
    if not (export / "encoder_model.onnx").exists():
        raise SystemExit(f"No 32-bit export in {export}: run `pnpm voice:convert --keep-work` first")
    pack = args.out / pack_id
    if pack.exists():
        shutil.rmtree(pack)
    (pack / "onnx").mkdir(parents=True)

    config = json.loads((eight_bit / "config.json").read_text(encoding="utf-8"))
    report = {}
    for name in convert.GRAPHS:
        target = pack / "onnx" / f"{name}_q4.onnx"
        print(f"Quantising {name} to 4 bits (block {args.block_size}, output projection {args.lm_head_bits} bits)")
        report[name] = quantise_graph(
            export / f"{name}.onnx", target, args.block_size, args.lm_head_bits, config["vocab_size"]
        )
        report[name]["bytes"] = target.stat().st_size
        print(f"  {report[name]}")

    for source in eight_bit.iterdir():
        if source.is_file() and source.name != "voice-pack.json":
            shutil.copyfile(source, pack / source.name)

    manifest = json.loads((eight_bit / "voice-pack.json").read_text(encoding="utf-8"))
    manifest.update(id=pack_id, dtype="q4")
    manifest["quantisation"] = {
        "method": "MatMulNBits, round to nearest, symmetric, post-training",
        "bits": 4,
        "blockSize": args.block_size,
        "outputProjectionBits": args.lm_head_bits,
        "embedding": "int8 (as the 8-bit pack)",
        "graphs": report,
    }
    manifest["tools"] = convert.versions()
    files = []
    for path in sorted(p for p in pack.rglob("*") if p.is_file() and p.name != "voice-pack.json"):
        files.append(
            {"path": path.relative_to(pack).as_posix(), "bytes": path.stat().st_size, "sha256": convert.sha256(path)}
        )
    manifest["files"] = files
    manifest["totalBytes"] = sum(f["bytes"] for f in files)
    (pack / "voice-pack.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    old = json.loads((eight_bit / "voice-pack.json").read_text(encoding="utf-8"))["totalBytes"]
    print(f"Pack written to {pack}")
    for entry in files:
        print(f"  {entry['bytes']:>12}  {entry['path']}")
    print(f"Total: {manifest['totalBytes']} bytes ({manifest['totalBytes'] / 1e6:.1f} MB); 8-bit pack: {old} bytes")


if __name__ == "__main__":
    main()
