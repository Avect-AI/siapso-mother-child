<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Voice evaluation

How well does the app understand a spoken medicine or remedy name in French or Wolof? This folder holds the protocol, the data layout and the committed results. The code is in `speech/eval/`.

## Status

- Baseline on FLEURS (read general sentences, not product names): measured, see `results/`.
- Name accuracy after the resolver (top-1, top-3) on product and remedy names: **pending recordings**. No volunteer recording exists yet; the manifest is empty. The FLEURS figures say little about names, and the Wolof one may be optimistic (the fine-tune's training data lists FLEURS Wolof).

## Run it

```sh
pnpm voice:convert                       # once: builds the packs (speech/convert/README.md)
pnpm eval:speech --data-dir <folder outside the repository>
```

`--data-dir` receives the FLEURS subsets (downloaded at run time through `speech/eval/fetch_fleurs.py` in the conversion venv; CC BY 4.0, pinned dataset revision; never committed). Options: `--pack-dir` (default `app/public/voice`, else `speech/convert/out`), `--pack <id>` (repeatable), `--count` (utterances per language, default 100), `--date`, `--out-dir`, `--no-fleurs`.

It runs the same ONNX graphs as the browser with Transformers.js in Node: same files, the decoder prompt recorded in each pack, greedy decoding, at most 96 new tokens. Differences from the browser: onnxruntime-node (CPU) instead of ONNX Runtime Web (WebAssembly), so times are from the host machine, not from a phone, and a word may differ. It writes `results/<date>-<pack>.json` (per pack: model revision, graph hashes, runtime, every hypothesis) and `results/<date>-summary.md`.

## Measures

- Word error rate per language and per pack: lowercase, accents kept, punctuation removed, an apostrophe breaks a word; total errors over total reference words (`speech/eval/wer.ts`). Wolof spelling varies, and each variant counts as an error.
- Name accuracy for entries with `expect`: the transcription goes to the resolver, and the entry counts as top-1 (or top-3) when the expected id is the first (or among the first three) candidates.
- Time per utterance (mean, median, 95th percentile) on the host.

## Data layout

```
eval/speech/
  manifest.yaml        one entry per recording (empty list for now)
  manifest.schema.json
  audio/               the WAV files, 16 kHz, 16-bit, mono (not present yet)
  results/             committed result files
```

Manifest entry (validated against `manifest.schema.json` on every run and in the tests):

| Field     | Meaning                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `file`    | path of the WAV file under `eval/speech/audio/`, forward slashes, no `..` |
| `text`    | what the speaker says, as written                                         |
| `lang`    | `fr`, `wo` or `mix` (both in one utterance)                               |
| `expect`  | id of the product or plant the resolver should return (optional)          |
| `speaker` | pseudonymous id, `spk-` and 3 to 6 digits                                 |
| `consent` | reference of the consent record, kept outside the repository              |
| `licence` | `CC-BY-4.0`                                                               |

An entry with `lang: wo` runs on the Wolof pack, `fr` on the French pack, `mix` on both. Word error rate and name accuracy are reported per pack and per set (`volunteers-wo`, `volunteers-fr`, `volunteers-mix`); mixed entries are never pooled with a language. The committed result files hold no FLEURS reference sentence (see `results/ATTRIBUTION.md`).

## Protocol for volunteer recordings

For the team, who collect them. None exist yet.

1. Volunteers are adults. No patient is asked, and no health information is recorded or discussed. Use the consent form in French (`consent-form.fr.md`) or English (`consent-form.en.md`); complete the contact placeholder first. Read it aloud to anyone who prefers it. Without a signed or marked form, do not record.
2. Keep the signed forms outside the repository, in a place the team controls, with a register: consent reference, speaker code, date. Never commit a form, a name or a contact. The manifest holds the reference only.
3. Give each volunteer a code `spk-NNN`. Never use a name in a file name, a manifest or a result.
4. List of names to read: a mix of brand medicines, generic names, and traditional remedies and plants (French and Wolof names), each with its `expect` id from the knowledge pack. The same names across speakers; several speakers per name. Include names that sound alike (for example ibuprofen and its brands, local plant names).
5. Recording: a quiet room first, then one noisy setting (a market, a waiting room) for some of the names, because that is where the app is used. Use a mid-range phone as the app's users do, not a studio microphone. Say each name alone, then once in a short phrase ("je prends du paracétamol"). Leave a second of silence before and after. Re-record on a mistake; never edit the audio.
6. Format: WAV, 16 kHz, 16-bit, mono (`ffmpeg -i in.m4a -ar 16000 -ac 1 -sample_fmt s16 out.wav`). File names `<lang>/spk-NNN-NNNN.wav`.
7. Add one manifest entry per file. Run `pnpm eval:speech` (the manifest is validated first).
8. Speakers of both sexes and several ages and accents; report how many speakers and how many utterances each figure rests on. With few speakers, say so.
9. Publication: the recordings and manifest are published under CC BY 4.0 as the form states. A withdrawal removes the speaker's files and entries from the next release.

## Reading the results

- Sample sizes are small: 100 sentences per language on FLEURS. Treat figures as indications.
- Never present a FLEURS figure as name accuracy.
- The Wolof fine-tune's training data lists FLEURS `wo_sn`, so some FLEURS test sentences may have been seen in training.
