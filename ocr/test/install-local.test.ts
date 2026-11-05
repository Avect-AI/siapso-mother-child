// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PINNED_MODELS, checkDetectionSettings, dictionaryOf } from '../scripts/install-local.mjs';

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
