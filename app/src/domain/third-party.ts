// SPDX-License-Identifier: MIT
// The third-party software and models of the voice, with their licences
// (speech/LICENSES.md, docs/voice.md): the speech worker bundles the
// software; the models come with the voice pack. Shown on the licences
// screen with the full texts from LICENSES/. The versions are checked
// against the installed packages (third-party.test.ts).
import apache from '../../../LICENSES/Apache-2.0.txt?raw';
import mit from '../../../LICENSES/MIT.txt?raw';

export interface ThirdParty {
  id: string;
  name: string;
  version?: string;
  /** SPDX identifier; null when no licence was found. */
  licence: string | null;
  copyright?: string;
  /** Where it comes from (shown as text: links need the Internet). */
  source: string;
  /**
   * What the licence rests on, when it is not a licence file: declared on a
   * model card, share-alike with an open question, or none found.
   */
  note?: 'declared' | 'share-alike' | 'none';
}

export const VOICE_SOFTWARE: readonly ThirdParty[] = [
  {
    id: 'transformers',
    name: 'Transformers.js',
    version: '4.3.1',
    licence: 'Apache-2.0',
    copyright: 'Copyright Hugging Face',
    source: 'https://github.com/huggingface/transformers.js',
  },
  {
    id: 'tokenizers',
    name: '@huggingface/tokenizers',
    version: '0.2.0',
    licence: 'Apache-2.0',
    copyright: 'Copyright Hugging Face',
    source: 'https://github.com/huggingface/tokenizers.js',
  },
  {
    id: 'jinja',
    name: '@huggingface/jinja',
    version: '0.5.10',
    licence: 'MIT',
    copyright: 'Copyright (c) 2023 Hugging Face',
    source: 'https://github.com/huggingface/huggingface.js',
  },
  {
    id: 'onnxruntime',
    name: 'ONNX Runtime Web',
    version: '1.31.0-dev.20260914-8d85527a0',
    licence: 'MIT',
    copyright: 'Copyright (c) Microsoft Corporation',
    source: 'https://github.com/microsoft/onnxruntime',
  },
];

export const VOICE_MODELS: readonly ThirdParty[] = [
  {
    id: 'whisper',
    name: 'OpenAI Whisper (small, base)',
    licence: 'MIT',
    copyright: 'Copyright (c) 2022 OpenAI',
    source: 'https://github.com/openai/whisper',
  },
  {
    id: 'wolof',
    name: 'M9and2M/whisper-small-wolof',
    licence: 'MIT',
    source: 'https://huggingface.co/M9and2M/whisper-small-wolof',
    note: 'declared',
  },
];

/** The sources of the Wolof fine-tune's training data, as found on their own pages (speech/LICENSES.md). */
export const VOICE_DATA: readonly ThirdParty[] = [
  {
    id: 'fleurs',
    name: 'FLEURS (wo_sn), Conneau et al., 2022',
    licence: 'CC-BY-4.0',
    source: 'https://huggingface.co/datasets/google/fleurs',
  },
  {
    id: 'tts',
    name: 'WOLOF TTS (Text To Speech) Data, Thierno Ibrahima Diop, Demba AW, Ami jaane, Mamadou Badiane (BAAMTU Datamation)',
    licence: 'CC-BY-4.0',
    source: 'https://zenodo.org/records/4498861',
  },
  {
    id: 'waxal',
    name: 'WAXAL Wolof',
    licence: 'CC-BY-SA-4.0',
    source: 'https://github.com/Waxal-Multilingual/speech-data',
    note: 'share-alike',
  },
  {
    id: 'alffa',
    name: 'ALFFA Wolof',
    licence: null,
    source: 'https://github.com/getalp/ALFFA_PUBLIC',
    note: 'none',
  },
];

/** The Apache License 2.0, word for word. */
export const APACHE_2_0: string = apache;

/** The MIT License without its placeholder line: each component above gives its own copyright. */
export const MIT_TEXT: string = mit.replace(/\nCopyright \(c\) <year> <copyright holders>\n/, '');
