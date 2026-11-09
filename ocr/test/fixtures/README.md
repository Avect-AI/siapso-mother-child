<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Scanned page fixtures

Three encodings of one synthetic printed prescription (fake names only: "Awa Diop", "Dr Moussa Test", the four products of the bench page), as an office scanner or a fax puts a page in a PDF. `ocr/test/pdf-fixtures.ts` wraps each one in a PDF at test time (`ccittScan`, `jbig2Scan`, `jpxScan`), so no PDF is committed, and `ocr/test/pdf.test.ts` checks that pdf.js decodes them with the WebAssembly decoders the reading pack carries.

| File             | Encoding                                                                                                                                                          | Size         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `scan-g4.ccitt`  | CCITT Group 4 (T.6), 1 bit, 1240 x 1754 pixels (A4 at 150 dpi), white runs for the paper, one strip                                                               | 4,823 bytes  |
| `scan-mmr.jbig2` | The same bitmap as an embedded JBIG2 stream: a page information segment and an immediate lossless generic region coded with MMR (the T.6 data above), end of page | 4,893 bytes  |
| `scan.j2k`       | The page at half size (620 x 877 pixels), 8-bit grey, as a JPEG 2000 codestream, lossy (20:1)                                                                     | 27,198 bytes |

Made with `make-scans.py` in this folder (Python 3.10 and Pillow 12.0.0, which writes Group 4 through libtiff and JPEG 2000 through OpenJPEG; the text is drawn with the font built into Pillow). The JBIG2 segment headers are written by the script itself: no open JBIG2 encoder was at hand, so the JBIG2 fixture covers the MMR generic region only, not the arithmetic coding nor the symbol dictionaries that `jbig2enc` writes (those go through the same `jbig2.wasm` decoder of pdf.js). To make them again: `py -3 ocr/test/fixtures/make-scans.py`.
