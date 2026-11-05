# SIAPSO open data

Aggregated counts about how the checks are used, published so that anyone can study them, without ever allowing anyone to identify a woman. Licence: CC BY 4.0.

## Status: the app does not send events yet

The app sends nothing today. By design no personal data leaves the phone. Whether and how devices send events to a server (consent, hosting, who runs it) is a later decision of the team. This folder defines the mechanism so that the decision can be taken with the rules already in place: the event format a device could send, the aggregation, the masking of small counts and the release policy. The files in `published/` and `test-data/` are synthetic test data, not real people and not real usage.

## What is here

| Path                             | Content                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| `fields.md`                      | Field dictionary: event fields, the 14 regions, CSV columns    |
| `schema/event.schema.json`       | JSON Schema of one event, no extra field allowed               |
| `test-data/events.sample.jsonl`  | Synthetic events, labelled TEST DATA                           |
| `published/2026-W45-r1-test.csv` | Aggregated file built from the synthetic events, labelled TEST |

## The rules that protect people

- An event holds no profile id, no product name, no free text, no date finer than the ISO week and no place finer than the region. The schema forbids any other field.
- Counts are published per week and region only, for all 14 regions every week.
- A (week, region) row is published only when it counts more than 10 checks. Otherwise the row is `suppressed` and every value is empty; a region with no check at all looks the same.
- In a published row, a count below 5 is shown as `<5`, the number of checks as a band (`11-20`, `21-50`, `51-100`, `101+`), and the grey share rounded to 5 points, only from 20 checks and only when no level count of the row is `<5`. A `<5` level count is accepted only if every value from 0 to 4 stays possible given the other published cells and the band bounds; otherwise the exact level counts of that row are `withheld`. The other counts (findings, unknown items, unrecognised names) have no published relation that bounds them, because an event may carry any number of findings. A test checks all this on many random weeks.
- The output is deterministic: rows sorted by region, fixed columns, LF line endings.

## Release policy

- Each ISO week is published once, 4 weeks after the week ends (the Sunday), as an immutable file named `<week>-<release id>.csv`, for example `2026-W45-r1.csv` (`-test` is added for synthetic data).
- The build command refuses a week that is not yet 4 weeks old and refuses any week that already has a published file.
- The release lag is a procedural control owned by the maintainer: the release date is declared by the person who runs the build (the tool has no clock and cannot verify it). The source events must be frozen at the cut-off, so that the same snapshot is never extended or rebuilt with later events.
- The input of a build is the snapshot of events taken at that date. Events of other weeks are dropped from the file, and an event that arrives after the snapshot is dropped, never added later.
- Correction procedure: if a published file must be corrected, withdraw it (delete the file from `published/`, with a note in `CHANGELOG.md`), then build the replacement with the next release id (`r2`). There are never two public versions of a week.

## Release scope: the weekly CSV is the only open file

The DHIS2 monthly export (`docs/dhis2.md`) is restricted data for the district's own DHIS2 instance. It is never published and never placed in `published/`; the tool refuses to write it inside `open-data/` except the ignored folder `open-data/dhis2/out/`. The reason is cross-release differencing: subtracting the exact monthly values of a district from the sum of the weekly region rows of the open CSV recovers counts of a suppressed district, and in a region with a single district it is trivial. Raw events that carry `district` must be kept with short retention, restricted access and no export path, never shared or published, and `district` should be sent only for pilot sites that need DHIS2.

## Limits to settle before any real data is accepted

- The threshold of 10 counts events (checks), not women. One woman running many checks counts many times, so a small group could be one person.
- Before the server accepts real data it must cap the contributions of a device per week before aggregation, or count distinct submitters, so that the threshold protects people and not only events. Without that cap the mechanism must not be used with real data.
- The consent, hosting and legal formalities (Loi 2008-12, CDP) are a decision of the team and are not in this repository.

## Build

```
pnpm open-data:build
```

This reads `test-data/events.sample.jsonl` and writes `published/2026-W45-r1-test.csv`; it refuses when that file exists (delete the test file first to rebuild it). For other weeks, run the command line directly:

```
node tools/open-data/bin/siapso-open-data.js build --input events.jsonl --week 2026-W45 --release r1 --release-date 2026-12-06 --out-dir published
```

`pnpm open-data:sample` regenerates the synthetic events (seeded, no clock). The code is in `tools/open-data/` (MIT).

## Reading the files

CSV, UTF-8, comma-separated. The first line may be a `#` comment (the test label): skip it when loading, for example `pandas.read_csv(path, comment="#", na_values=["<5", "withheld", "suppressed"])`.
