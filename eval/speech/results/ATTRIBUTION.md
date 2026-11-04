<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Attribution

The baseline in this folder was measured on a subset of FLEURS.

- Dataset: FLEURS (Few-shot Learning Evaluation of Universal Representations of Speech), Google, `google/fleurs` on Hugging Face (https://huggingface.co/datasets/google/fleurs), revision `70bb2e84b976b7e960aa89f1c648e09c59f894dd`. Its card states the licence CC BY 4.0. Paper: Conneau et al., "FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech", 2022. The sentences come from the FLoRes-101 benchmark (Goyal et al.), whose own licence terms are CC BY-SA 4.0 according to its repository; this is why the reference sentences are not copied here.
- Used at run time: the audio and the reference sentences of the first 100 distinct sentences of the `wo_sn` and `fr_fr` test splits. They are downloaded into a folder outside the repository by `speech/eval/fetch_fleurs.py`; they are never committed.
- Stored in the result files: the utterance ids, the dataset revision, the error counts per utterance (substitutions, deletions, insertions, number of reference words), duration and time, and the text produced by our model (the hypotheses). No reference sentence and no audio. To recompute the figures, run `pnpm eval:speech` again: it re-fetches the references at the pinned revision.
- Changes: the audio is used as is, with no modification; the model output is compared with the references after lowercasing and removing punctuation.
