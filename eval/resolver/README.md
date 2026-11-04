<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Name resolver evaluation set

`queries.yaml` holds realistic queries a mother or a health worker could type, or a speech model could transcribe, to name a medicine or a remedy. `pnpm eval:resolver` builds the knowledge pack in memory, runs every query through `@siapso/resolver` and reports top-1 and top-3 accuracy per type and overall, and the p95 latency.

## Format

```yaml
- { query: doliprane, type: brand, expect: [{ kind: product, id: doliprane-500-mg-63368332 }, ...] }
- { query: nebeday, type: local-wo, expect: { kind: plant, id: moringa } }
- { query: sirop, type: noise, expect: none }
```

- `query`: the text as typed or transcribed.
- `type`: `brand`, `inn`, `misspelling`, `local-fr`, `local-wo`, `voice-like` (lowercase, no accents, words split or merged as a speech model would output them) or `noise` (a form, a colour or a packaging word alone, such as "sirop" or "comprimé blanc", which names no medicine).
- `expect`: one `{ kind, id }`, or a list of acceptable answers. A list is used when several entries are equally right: every product of a brand (the resolver breaks ties by id, so any of them can come first), or the generic product and the branded products of the same substance. A query counts as a hit when one of the candidates is in the list: top-1 for the first candidate, top-3 for the first three. A `noise` query, and only a noise query, has `expect: none`: it is a hit (top-1 and top-3) only when the resolver proposes no candidate at all, so that the app offers "Produit introuvable".

Every expected id must exist in the registry (a test checks it). Do not remove an honest query to make the figures look better; fix the matching or record the miss.

## Baseline

`baseline.json` holds the bar that CI enforces:

- `top3`: the minimum top-3 accuracy (the measured value rounded down to two decimals, never below 0.90);
- `p95Ms`: the maximum p95 latency in milliseconds of one query: each query is timed on its own and the 95th percentile is taken over 20 passes of the whole query set (after one warm-up pass). The target is 50 ms on an entry-level phone; 12 ms on the CI runner leaves room for a 4x slowdown.

The script exits with code 1 when a bar is not met, and also when it cannot measure honestly: an empty query file, a baseline whose `top3` (from 0 to 1) or `p95Ms` (greater than 0) is missing or not a number, or a measure that is not a number.

## What top-3 measures

A query is a hit when one of the first three candidates, which are three different families, is in `expect`. So top-3 checks that the right family is proposed (the right brand, the right generic, the right plant) and, when the query carries a strength ("doliprane 1 g", "ibuprofene400"), that the proposed product has that strength: for such queries `expect` lists only the products of that strength. Top-1 is the same test on the first candidate only.

## Baseline policy

- An honest new query that fails may be added; the baseline may then be lowered in the same pull request, with a justification in the description.
- Removing honest queries, or rewriting their expectations, to make the figures pass is not allowed. Fix the matching instead.
- The expectations are written from the registry (names, brands, ids), never from the output of the resolver.
