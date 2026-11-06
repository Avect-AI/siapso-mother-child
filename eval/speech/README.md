<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Voice evaluation

How well does the app understand a spoken medicine or remedy name in French or Wolof? This folder holds the protocol, the data layout and the committed results. The code is in `speech/eval/`.

## Status

- Baseline on FLEURS (read general sentences, not product names): measured, see `results/`.
- Products named inside a sentence (SCRUM-61): measured on a tuning set of 256 written sentences (`sentences.yaml`, `pnpm eval:sentences`, below), on a first held-out set of 150 written sentences, now used (`sentences-heldout.yaml`, `pnpm eval:sentences:heldout`), on a second held-out set of 68 never tuned on (`sentences-heldout-2.yaml`, `pnpm eval:sentences:heldout-2`), and checked by ear on 80 synthetic clips (22 sentences said by 3 Windows voices, and 14 more).
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

## Products named inside a sentence (SCRUM-61)

`sentences.yaml` holds sentences written the way people speak to the app, or the way the voice writes them (lowercase, little punctuation, French names spelt as the Wolof voice hears them): in French (`fr`), in Wolof (`wo`: Wolof grammar, a medicine keeping its French or brand name as Wolof speakers say it) and mixed (`mix`), each with the products it names. No real patient data: every sentence and first name is invented. `pnpm eval:sentences` reads every sentence with the resolver's `productsInSentence` (`resolver/README.md`) and counts, per language and per type, the products found ticked, by family: right when the sentence names it, false otherwise, and missed when named and not found.

```yaml
- {
    text: 'dama naan doliprane ak nivaquine',
    lang: wo,
    type: plain,
    expect:
      [
        { kind: product, id: doliprane-500-mg-63368332 },
        { kind: product, id: chloroquine-generic },
      ],
  }
- {
    text: 'dama naan kardejik 75',
    lang: wo,
    type: misspelt,
    expect: [{ kind: product, id: kardegic-160-mg-61348441, mg: 75 }],
  }
- { text: 'dama lekk ceeb ak jën', lang: wo, type: none, expect: [] }
```

- `type`: `plain` (names said as written), `misspelt` (a name spelt as heard), `none` (no product: symptoms, food, first names, places, a medicine the base does not have). A sentence of type `none`, and only one, expects `[]`.
- `expect`: one item per product: `{ kind, id }` (any product of its family is right), or `{ any: [...] }` when several families are equally right (the amoxicillin boxes of several laboratories); `mg` when a strength is said with it, counted apart ("strengths said with a name found, read right").
- The expectations are written from the registry, never from the output. An honest sentence that fails stays, as a recorded miss (the short form "para", a name cut short "dolipa", two changes from the name "amoksilin" and "paratamol", "vitamine c" alone; and for the strength, "500 mg de paracétamol" said before the name and "doliprane junni" in Wolof numbers); fix the rules, never the expectation.
- The sentences are read as the voice heard them (`productsInSentence(index, text, { heard: true })`): a name read from words the voice split is offered unticked, to confirm; it never counts as found, and the `checks` column says how many such offers were right and wrong.
- `offered`: the products named that are offered at all, ticked or to confirm. A remedy that is also a food ("bissap", "jinjeer", "ail") is offered unticked by design since the review of #68, so it counts as missed in the recall (ticked) and as offered here.
- Background: the model's transcripts of general FLEURS sentences in `results/*.json` (400, French and Wolof, no product names) are read too: any product found there, ticked, is a false product, and any name offered to confirm there is counted apart.
- `sentences-baseline.json`: the bars CI enforces on the tuning set, overall and in each language: precision at least 0.97, recall (ticked) at least 0.88, offered at least 0.95, no false product in the background and no name offered to confirm there (`backgroundCheckOffers`). Why: a false product is worse than a missed one (it is put before her, even if she confirms it), so the precision bar is the higher; the offered bar keeps every product named in front of her. The recall bar was 0.95 until the review of #68: its foods offered unticked (13 of the 244 products named) took the ticked recall from 0.980 to 0.926 (0.895 in Wolof, where most of them are), every one of them still offered; 0.88 keeps about one product per language of margin. Lower a bar only in a reviewed pull request that says why.
- It also prints the p95 time of one sentence (the 256 sentences and the 400 transcripts, which are much longer than the 80 characters the search field keeps).

These are tuning-set figures: the sentences were written by the developer who wrote the rules, and the rules were changed until they held, so they are optimistic. They measure that the rules hold, not how real speakers talk. Measured on 2026-11-06, after the review of #68 (256 sentences, 244 products named):

| Tuning set | Sentences | Named | Right | False | Missed | Precision | Recall (ticked) | Offered |
| ---------- | --------: | ----: | ----: | ----: | -----: | --------: | --------------: | ------: |
| fr         |       106 |   101 |    95 |     0 |      6 |     1.000 |           0.941 |   0.980 |
| wo         |        98 |    95 |    85 |     0 |     10 |     1.000 |           0.895 |   0.968 |
| mix        |        52 |    48 |    46 |     0 |      2 |     1.000 |           0.958 |   1.000 |
| overall    |       256 |   244 |   226 |     0 |     18 |     1.000 |           0.926 |   0.980 |
| misspelt   |        60 |    65 |    61 |     0 |      4 |     1.000 |           0.938 |   0.938 |

Before the review (foods ticked): recall 0.980 overall, 0.968 at the lowest language, the same precision. Strengths said with a name found: 13, read right 11. Background: 0 false products in 400 transcripts (one name offered unticked: "neeem", read as neem, also a common word).

### Held-out set 1 (review of #68), now used

`sentences-heldout.yaml`: 150 sentences (74 French, 56 Wolof, 20 mixed) written and committed before the rules for products not taken, and measured once, with `pnpm eval:sentences:heldout`, which reports and sets no bar. Its misses then led to the rules of round 2 of the review (another person named before, advice, a past said by a time, the "Ou peut-être" letter check): it is now a used set, no longer a held-out measure; held-out set 2 (below) is. Each has a `case`: `affirmative`, `negation`, `other-person` (taken by or given to another person), `past` (taken before and stopped), `food`, `list` (several products) or `question`. `expect` holds the products the speaker takes or asks about, and `notTaken` the products named but not taken: one of them ticked is a false product (it counts in the precision), offered unticked is right. Five of the 150 are the sentences of the review, which the unit tests also check.

Measured once on 2026-11-06, before round 2, as they came:

| Held-out 1   | Sentences | Named | Right | False | Missed | Precision | Recall (ticked) | Offered | Not taken: ticked / unticked / named |
| ------------ | --------: | ----: | ----: | ----: | -----: | --------: | --------------: | ------: | -----------------------------------: |
| fr           |        74 |    57 |    50 |     4 |      7 |     0.926 |           0.877 |   1.000 |                          4 / 27 / 31 |
| wo           |        56 |    43 |    38 |     0 |      5 |     1.000 |           0.884 |   1.000 |                          0 / 22 / 22 |
| mix          |        20 |    16 |    11 |     1 |      5 |     0.917 |           0.688 |   0.938 |                           1 / 9 / 10 |
| overall      |       150 |   116 |    99 |     5 |     17 |     0.952 |           0.853 |   0.991 |                          5 / 58 / 63 |
| affirmative  |        31 |    29 |    29 |     0 |      0 |     1.000 |           1.000 |   1.000 |                            0 / 0 / 0 |
| negation     |        29 |     8 |     7 |     0 |      1 |     1.000 |           0.875 |   1.000 |                          0 / 26 / 26 |
| other-person |        23 |     5 |     5 |     3 |      0 |     0.625 |           1.000 |   1.000 |                          3 / 16 / 19 |
| past         |        18 |     2 |     2 |     2 |      0 |     0.500 |           1.000 |   1.000 |                          2 / 16 / 18 |
| food         |        16 |    14 |     0 |     0 |     14 |     1.000 |           0.000 |   0.929 |                            0 / 0 / 0 |
| list         |        17 |    40 |    38 |     0 |      2 |     1.000 |           0.950 |   1.000 |                            0 / 0 / 0 |
| question     |        16 |    18 |    18 |     0 |      0 |     1.000 |           1.000 |   1.000 |                            0 / 0 / 0 |

Without the five sentences of the review: precision 0.950 (95 right, 5 false), recall 0.848, not taken 5 ticked of 57. The five false products are products not taken that came ticked: another person the rules do not see ("la voisine m'a parlé du cytotec", where "m'" reads as given to her; "c'est pour ma mère, elle prend du kardégic" and "sama doom dafa am sibiru, je lui donne de la nivaquine", where the person is in the clause before, and the next clause has a subject of its own), and a past use said with a date only ("l'année dernière on m'a donné de la quinine", "il y a deux ans j'ai pris du cytotec"). Every negation came unticked. The foods are offered unticked as designed (one, "kola", is not found at all, and "neem" comes unticked as a common word). One wrong offer to confirm: "j'ai arrêté le fer il y a un mois" offers FERTIFOL as "Ou peut-être", unticked, as the clause guard reads "fer il y a un" as a longer name. These were the next rules to write, with sentences of their own (held-out set 2).

After round 2 (a used set now, so an optimistic figure): precision 1.000, recall (ticked) 0.853, offered 0.991, 0 of the 63 products not taken ticked (other person 0 of 19, past 0 of 18), no FERTIFOL; still missed "sans paracétamol je n'arrive pas à dormir" (offered unticked) and "dama naan neem ak kola".

### Held-out set 2 (round 2 of the review of #68)

`sentences-heldout-2.yaml`: 68 sentences (43 French, 20 Wolof, 5 mixed) written and committed before the rules of round 2, without reading again the sentences held-out set 1 failed on, and never tuned on: another person named before, then a pronoun (`other-person`, 18), someone else who told her of a product, advised it or prescribed it (`advice`, 12: a neighbour, a friend, a relative or a healer only talks of it, not taken; a health worker prescribes it, taken), a past said by a time (`past`, 14), and sentences taken now (`affirmative`, 24, some with a time: "il y a deux jours", "hier soir", "démb"). `pnpm eval:sentences:heldout-2` reports it with no bar.

Measured once on 2026-11-06, after the rules of round 2, as it came:

| Held-out 2   | Sentences | Named | Right | False | Missed | Precision | Recall (ticked) | Offered | Not taken: ticked / unticked / named |
| ------------ | --------: | ----: | ----: | ----: | -----: | --------: | --------------: | ------: | -----------------------------------: |
| fr           |        43 |    21 |    19 |     2 |      2 |     0.905 |           0.905 |   1.000 |                          2 / 22 / 24 |
| wo           |        20 |    10 |    10 |     2 |      0 |     0.833 |           1.000 |   1.000 |                           2 / 9 / 11 |
| mix          |         5 |     4 |     3 |     0 |      1 |     1.000 |           0.750 |   1.000 |                            0 / 2 / 2 |
| overall      |        68 |    35 |    32 |     4 |      3 |     0.889 |           0.914 |   1.000 |                          4 / 33 / 37 |
| affirmative  |        24 |    27 |    24 |     0 |      3 |     1.000 |           0.889 |   1.000 |                            0 / 0 / 0 |
| other-person |        18 |     3 |     3 |     2 |      0 |     0.600 |           1.000 |   1.000 |                          2 / 14 / 16 |
| past         |        14 |     0 |     0 |     2 |      0 |     0.000 |           1.000 |   1.000 |                          2 / 12 / 14 |
| advice       |        12 |     5 |     5 |     0 |      0 |     1.000 |           1.000 |   1.000 |                            0 / 7 / 7 |

The four false products are products not taken that came ticked: another person named by a first name only ("Awa est malade, elle prend du coartem", "Fatou dafa feebar, dafay naan doliprane"), a time the lists do not hold ("l'année passée"), and a past said in the clause before a clause with a subject of its own ("bi ma ëmbee woon sama taaw, dama naan nebeday"). Every product told of or advised by someone else came unticked, and every one prescribed by a health worker ticked. Missed (offered unticked): "depuis la semaine dernière je prends du fer" (a use since then, read as past), "j'ai commencé la nivaquine avec mon mari" (read as his), and the bissap of "je bois bissap ak kinkéliba" (a food, by design). No rule was changed for them (decision of the coordinator): the four false products are known limits, to measure again with the recordings of SCRUM-32 (real voices; `docs/voice.md`, Known limits).

### Audio check (2026-11-06)

Fourteen French sentences said by the Windows voice Microsoft Hortense (System.Speech, 16 kHz, a short silence first), played through Chromium's fake microphone into the app served by the development server, transcribed by the real French voice pack (`whisper-base-fr-q8`, in the browser), then read by this branch's code as the medicine search screen does. A synthetic voice in a quiet room: an indication, not a measure of real speakers.

| Said                                                  | Heard                                                 | Offered                        |
| ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| J'ai pris du Doliprane ce matin.                      | J'ai pris du douleur libraine ce matin                | nothing (wrong)                |
| J'ai pris de l'Advil et du Coartem.                   | J'ai pris de l'advile et du co-artant                 | ADVIL only (wrong)             |
| Hier, j'ai pris du Doliprane et de la Nivaquine.      | Hier, j'ai pris du dôliprane et de la niva-kin        | DOLIPRANE, chloroquine (right) |
| La sage-femme m'a donné du fer et de l'acide folique. | La sache femme m'a donné du fer et de la site folique | iron only (wrong)              |
| Je bois du jus de bissap.                             | Je bois du jus de bisap                               | bissap (right)                 |
| Le pharmacien m'a vendu du Cytotec.                   | Le farmacien m'a vendu du citotec                     | misoprostol (right)            |
| Je prends de la tisane de kinkéliba le matin.         | Je prends de la tisanne de King Kyliba le matin       | nothing (wrong)                |
| J'ai pris un Doliprane 1000.                          | J'ai pris un d'olipranmille                           | nothing (wrong)                |
| Je mets de l'huile de ricin sur le ventre.            | Je mets de l'huile de risque à un sur le ventre       | nothing (wrong)                |
| Elle a pris de l'ibuprofène pour le mal de dos.       | Elle a pris de Libu Profaine pour le mal de dose      | nothing (wrong)                |
| Je prends du paracétamol et de la quinine.            | Je prends du paracétamol et de la kinime              | paracetamol only (wrong)       |
| On m'a donné de l'amoxicilline à la pharmacie.        | On m'a donné de l'amoxiceline à la pharmacie          | amoxicillin (right)            |
| J'ai mal à la tête depuis hier.                       | J'ai mal à la tête depuis hier                        | nothing (right)                |
| J'ai mangé du riz avec du poisson.                    | J'ai mangé du riz avec du poisson                     | nothing (right)                |

6 of 14 spoken sentences end with exactly the right products (4 of the 12 that name a product, and the 2 that name none; 8 of the 16 products said are offered), and no false product. Every miss comes from the voice, not from the reading: the French base model writes a name as French words ("douleur libraine", "risque à un", "King Kyliba", "Libu Profaine"), splits it ("co-artant", "d'olipranmille"), or changes a letter of a short name ("kinime").

The set was then extended to 80 clips: 22 more sentences, each said by 3 synthetic voices (Hortense, Julie and Paul, OneCore voices, at -15 %, default and +20 % speaking rates), so 66 clips, and the 14 above. All are affirmative sentences of synthetic voices: they say nothing of negations, of other people or of real speakers. They were measured twice more: with the words the voice split read joined, to confirm (before and after: 44 then 44 products ticked of 88, plus 9 to confirm, false ticked products from 2 to 0, no wrong offer), and with the names of the base given to the decoder, now on for the French voice (75 of 88 ticked instead of 50, none wrongly, FLEURS word error rate 30.0 % against 30.3 %, but "kinkéliba" heard as "quinine qu'il y va" three times, now offered to confirm, never ticked; a second prompt adding the remedies that sound like medicines did not remove it; since the review of #68 the prompt holds no "quinine": re-read with the code of the review, 70 of 88 ticked instead of 67 with it and 43 without names, none wrongly, kinkéliba no longer heard as quinine). Both are in `docs/voice.md`, Names heard in a sentence, with the sounds that are not speech (silence, noise, a cough, "euh") heard with and without the names.

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
