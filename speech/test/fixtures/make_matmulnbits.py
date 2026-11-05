#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Writes the tiny MatMulNBits fixture of speech/test/wasm-matmulnbits.test.ts.

One node, `com.microsoft.MatMulNBits` (4 bits, block size 32, K = 64, N = 8,
no zero point so the default 8 applies), and the expected output computed with
numpy from the dequantised weights. Run inside the conversion venv:

    speech/convert/.venv/Scripts/python speech/test/fixtures/make_matmulnbits.py

The two files it writes are committed (a few hundred bytes).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper

HERE = Path(__file__).resolve().parent
K, N, BLOCK = 64, 8, 32

rng = np.random.default_rng(42)
levels = rng.integers(0, 16, size=(N, K), dtype=np.uint8)  # unsigned 4-bit values
blocks = K // BLOCK
scales = rng.uniform(0.01, 0.1, size=(N, blocks)).astype(np.float32)
# Dequantised weights: (q - 8) * scale of the block (default zero point 8).
weights = (levels.astype(np.float32) - 8.0) * np.repeat(scales, BLOCK, axis=1)
# Packed layout of MatMulNBits: B is [N, blocks, BLOCK / 2] bytes, element 2i in the low nibble.
pairs = levels.reshape(N, blocks, BLOCK // 2, 2)
packed = (pairs[..., 0] | (pairs[..., 1] << 4)).astype(np.uint8)

a = rng.uniform(-1, 1, size=(1, K)).astype(np.float32)
expected = a @ weights.T

node = helper.make_node(
    "MatMulNBits",
    ["A", "B", "scales"],
    ["Y"],
    domain="com.microsoft",
    K=K,
    N=N,
    bits=4,
    block_size=BLOCK,
)
graph = helper.make_graph(
    [node],
    "matmulnbits",
    [helper.make_tensor_value_info("A", TensorProto.FLOAT, [1, K])],
    [helper.make_tensor_value_info("Y", TensorProto.FLOAT, [1, N])],
    initializer=[
        helper.make_tensor("B", TensorProto.UINT8, packed.shape, packed.tobytes(), raw=True),
        helper.make_tensor("scales", TensorProto.FLOAT, [N * blocks], scales.reshape(-1).tolist()),
    ],
)
model = helper.make_model(
    graph,
    opset_imports=[helper.make_opsetid("", 17), helper.make_opsetid("com.microsoft", 1)],
    ir_version=9,
)
onnx.save(model, str(HERE / "matmulnbits-4bit.onnx"))
(HERE / "matmulnbits-4bit.json").write_text(
    json.dumps({"input": a.reshape(-1).tolist(), "expected": expected.reshape(-1).tolist()}, indent=1) + "\n",
    encoding="utf-8",
)
print("written")
