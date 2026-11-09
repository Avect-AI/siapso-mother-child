// SPDX-License-Identifier: MIT
// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PINNED_MODELS,
  PINNED_TEXTS,
  checkDetectionSettings,
  dictionaryOf,
  pdfjsCopies,
  pinnedText,
} from '../scripts/install-local.mjs';
import { PDFJS_VERSION, PDF_FILES } from '../src/ocr-pack.js';

const REC_YML = `Global:
  model_name: latin_PP-OCRv5_mobile_rec
PostProcess:
  name: CTCLabelDecode
  character_dict:
  - '0'
  - A
  - é
  - ' '
`;

const DET_YML = `PreProcess:
  transform_ops:
  - DecodeImage:
      img_mode: BGR
  - DetResizeForTest:
      resize_long: 960
PostProcess:
  name: DBPostProcess
  thresh: 0.3
  box_thresh: 0.6
  max_candidates: 1000
  unclip_ratio: 1.5
`;

describe('the pinned models', () => {
  it('names each file by its repository, full revision, size and SHA-256', () => {
    expect(PINNED_MODELS.detection).toMatchObject({
      repo: 'PaddlePaddle/PP-OCRv5_mobile_det_onnx',
      revision: 'e6f4fa85f00e168c862bc462aebca69eef9b3d3d',
      onnx: { sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d' },
      yml: { sha256: '98069072e1b6b37d727fd9d9f11725faa46d6ea0de012f2ed26caea011c37699' },
    });
    expect(PINNED_MODELS.recognition).toMatchObject({
      repo: 'PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx',
      revision: '89d3a50e2c27e2e7cceeab0e944c25c807d5db4f',
      onnx: { sha256: '7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498' },
      yml: { sha256: '0bbe984570f597af3638e50bdf2e8276f3ab26a61966096538b3b0d1849f5c84' },
    });
  });
});

describe('dictionaryOf', () => {
  it('reads the characters of the recognition model, each as a string', () => {
    expect(dictionaryOf(REC_YML)).toEqual(['0', 'A', 'é', ' ']);
  });

  it('refuses a configuration without a CTC dictionary', () => {
    expect(() => dictionaryOf('PostProcess:\n  name: Other\n')).toThrow(/character_dict/);
  });
});

describe('checkDetectionSettings', () => {
  it('accepts the settings the worker uses', () => {
    expect(() => {
      checkDetectionSettings(DET_YML);
    }).not.toThrow();
  });

  it('refuses a detection model configured otherwise: the worker would read it wrong', () => {
    expect(() => {
      checkDetectionSettings(DET_YML.replace('unclip_ratio: 1.5', 'unclip_ratio: 2.0'));
    }).toThrow(/unclip_ratio/);
    expect(() => {
      checkDetectionSettings(DET_YML.replace('resize_long: 960', 'resize_long: 736'));
    }).toThrow(/resize_long/);
  });
});

describe('the pdf.js files of the pack', () => {
  const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

  it('copies every pdf.js file the worker reads, its decoders of scanned images included', () => {
    const copied = pdfjsCopies(PDFJS_VERSION).map(([to]) => to);
    for (const file of Object.values(PDF_FILES)) expect(copied).toContain(file);
  });

  it('ships the licence of each decoder with it, and takes every file from the installed pdfjs-dist', () => {
    const copies = pdfjsCopies(PDFJS_VERSION);
    const licences = copies.map(([to]) => to).filter((to) => to.startsWith('licenses/'));
    expect(licences).toEqual([
      'licenses/pdfjs-dist-LICENSE.txt',
      'licenses/pdfjs-dist-wasm-LICENSE_JBIG2.txt',
      'licenses/pdfjs-dist-wasm-LICENSE_PDFJS_JBIG2.txt',
      'licenses/pdfjs-dist-wasm-LICENSE_OPENJPEG.txt',
      'licenses/pdfjs-dist-wasm-LICENSE_PDFJS_OPENJPEG.txt',
    ]);
    for (const [, from] of copies) expect(existsSync(path.join(pdfjsDir, from)), from).toBe(true);
  });
});

describe('the licence texts taken from their projects', () => {
  const ortDir = path.dirname(
    path.dirname(createRequire(import.meta.url).resolve('onnxruntime-web')),
  );

  it('pins each text by the full commit of its repository, its size and its SHA-256', () => {
    for (const text of Object.values(PINNED_TEXTS)) {
      expect(text.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(text.url).toBe(
        `https://raw.githubusercontent.com/${text.repo}/${text.commit}/${text.file}`,
      );
      expect(text.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(text.bytes).toBeGreaterThan(0);
      expect(text.path.startsWith('licenses/')).toBe(true);
    }
  });

  it("ships PaddleOCR's own licence, and ONNX Runtime's licence and third-party notices", () => {
    expect(PINNED_TEXTS.paddleocr).toMatchObject({
      repo: 'PaddlePaddle/PaddleOCR',
      file: 'LICENSE',
      path: 'licenses/paddleocr-LICENSE.txt',
    });
    expect(PINNED_TEXTS.onnxruntime).toMatchObject({
      repo: 'microsoft/onnxruntime',
      file: 'LICENSE',
      path: 'licenses/onnxruntime-web-LICENSE.txt',
    });
    expect(PINNED_TEXTS.onnxruntimeNotices).toMatchObject({
      repo: 'microsoft/onnxruntime',
      file: 'ThirdPartyNotices.txt',
      path: 'licenses/onnxruntime-ThirdPartyNotices.txt',
    });
  });

  it('takes the texts of ONNX Runtime at the commit the installed onnxruntime-web was built from', () => {
    const built = readFileSync(path.join(ortDir, '__commit.txt'), 'utf8').trim();
    expect(PINNED_TEXTS.onnxruntime.commit).toBe(built);
    expect(PINNED_TEXTS.onnxruntimeNotices.commit).toBe(built);
  });

  it('reads a text from a local folder when it is there, checked by its hash', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'siapso-ocr-texts-'));
    try {
      const body = 'Apache License\n';
      const pinned = {
        ...PINNED_TEXTS.paddleocr,
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
      };
      await mkdir(path.join(dir, 'licenses'), { recursive: true });
      await writeFile(path.join(dir, 'licenses', 'paddleocr-LICENSE.txt'), body);
      const network = vi.fn();
      expect((await pinnedText(pinned, dir, network)).toString()).toBe(body);
      expect(network).not.toHaveBeenCalled();
      await writeFile(path.join(dir, 'licenses', 'paddleocr-LICENSE.txt'), 'another text');
      await expect(pinnedText(pinned, dir, network)).rejects.toThrow(/not the pinned file/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('downloads it at the pinned commit otherwise, and refuses another text', async () => {
    const body = 'MIT License\n';
    const pinned = {
      ...PINNED_TEXTS.onnxruntime,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
    const network = vi.fn(() => Promise.resolve(new Response(body)));
    expect((await pinnedText(pinned, undefined, network)).toString()).toBe(body);
    expect(network).toHaveBeenCalledWith(pinned.url);
    const changed = vi.fn(() => Promise.resolve(new Response('MIT License, changed\n')));
    await expect(pinnedText(pinned, undefined, changed)).rejects.toThrow(/not the pinned file/);
  });
});
