# SPDX-License-Identifier: MIT
"""Writes the scanned page fixtures of ocr/test/fixtures/ (README.md there).

A synthetic printed prescription (fake names), drawn with the font built
into Pillow, encoded as a scanner would put it in a PDF:

- scan-g4.ccitt: CCITT Group 4 (T.6), 1 bit, 1240 x 1754 (A4 at 150 dpi),
  white runs for the paper, one strip (libtiff, through Pillow);
- scan-mmr.jbig2: the same bitmap as an embedded JBIG2 stream (a page
  information segment and an immediate lossless generic region coded with
  MMR, that is the T.6 data above with JBIG2 segment headers);
- scan.j2k: the page at half size (620 x 877), 8-bit grey, as a JPEG 2000
  codestream (OpenJPEG, through Pillow, lossy, 20:1).

Run once with Python 3 and Pillow 12 (built with libtiff and OpenJPEG):
    py -3 ocr/test/fixtures/make-scans.py
The files are committed; the tests only read them.
"""

from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, TiffImagePlugin

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = 1240, 1754

LINES = [
    (60, "CENTRE DE SANTE DE TEST", 34),
    (150, "ORDONNANCE", 48),
    (260, "Nom et prenom : Awa Diop   Age : 27 ans", 32),
    (360, "1. Doliprane 1000 mg cp", 34),
    (410, "    1 cp x 3/j si douleur", 30),
    (480, "2. Amoxicilline 500 mg gel", 34),
    (530, "    2 gel x 3/j pendant 7 jours", 30),
    (600, "3. Fer + Acide folique cp : 1 cp/jour pendant 3 mois", 34),
    (670, "4. Spasfon Lyoc 80 mg", 34),
    (720, "    1 lyoc x 3/j si douleur", 30),
    (1500, "Signature et cachet", 32),
    (1550, "Dr Moussa Test", 32),
]


def page() -> Image.Image:
    image = Image.new("L", (WIDTH, HEIGHT), 255)
    draw = ImageDraw.Draw(image)
    for y, text, size in LINES:
        font = ImageFont.load_default(size=size)
        x = (WIDTH - draw.textlength(text, font=font)) / 2 if size >= 48 else 110
        draw.text((x, y), text, fill=0, font=font)
    return image


def group4(bitmap: Image.Image) -> bytes:
    """The T.6 data of `bitmap` (mode 1), one strip, white runs for the paper."""
    TiffImagePlugin.STRIP_SIZE = 1 << 30
    out = io.BytesIO()
    # WhiteIsZero, as a fax or a scanner codes a page: Pillow inverts the
    # bits for it, so the paper is coded as white runs.
    bitmap.save(out, "TIFF", compression="group4", tiffinfo={262: 0})
    if Image.open(io.BytesIO(out.getvalue())).tag_v2[262] != 0:
        raise SystemExit("expected PhotometricInterpretation WhiteIsZero")
    tiff = Image.open(io.BytesIO(out.getvalue()))
    offsets = tiff.tag_v2[273]
    counts = tiff.tag_v2[279]
    if len(offsets) != 1:
        raise SystemExit(f"expected one strip, got {len(offsets)}")
    data = out.getvalue()
    return data[offsets[0] : offsets[0] + counts[0]]


def segment(number: int, kind: int, data: bytes) -> bytes:
    """A JBIG2 segment: header (no referred segment, page 1) and data."""
    return struct.pack(">IBBBI", number, kind, 0, 1, len(data)) + data


def jbig2(mmr: bytes) -> bytes:
    page_info = struct.pack(">IIIIBH", WIDTH, HEIGHT, 5906, 5906, 0, 0)
    region = struct.pack(">IIIIB", WIDTH, HEIGHT, 0, 0, 0) + bytes([0x01]) + mmr
    end_of_page = b""
    return segment(0, 48, page_info) + segment(1, 38, region) + segment(2, 49, end_of_page)


def main() -> None:
    grey = page()
    bitmap = grey.point(lambda v: 255 if v >= 128 else 0, mode="1")
    g4 = group4(bitmap)
    (HERE / "scan-g4.ccitt").write_bytes(g4)
    (HERE / "scan-mmr.jbig2").write_bytes(jbig2(g4))
    out = io.BytesIO()
    grey.resize((WIDTH // 2, HEIGHT // 2), Image.LANCZOS).save(
        out, "JPEG2000", no_jp2=True, irreversible=True, quality_mode="rates", quality_layers=[20]
    )
    (HERE / "scan.j2k").write_bytes(out.getvalue())
    for name in ("scan-g4.ccitt", "scan-mmr.jbig2", "scan.j2k"):
        print(name, (HERE / name).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
