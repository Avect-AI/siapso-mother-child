<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# DHIS2 aggregate export

SIAPSO Mother-Child can export monthly aggregates, per health district, in the format DHIS2 (the national health information system) imports. No individual data is exported: only counts, with the disclosure rules of the open data adapted to months and districts. The app sends nothing today; like the rest of `open-data/`, this is a mechanism defined so that the decision to use it can be taken with the rules already in place.

## Release scope: restricted data, never open data

The DHIS2 export is never published. It is restricted data for the district's own authenticated DHIS2 instance. The weekly CSV of `open-data/` is the only open file.

Why: the two outputs describe the same events. A reader who has the open weekly CSV (per region) and the exact monthly values of a district can subtract: the sum of the weekly region rows of a month, minus the exact monthly values of the districts that are exported, leaves the values of the districts that are suppressed or masked, and so recovers counts that the disclosure rules hide in each file taken alone. In a region that has a single district the region row and the district cell are the same cell, so the difference is trivial. Each file passes the rules on its own; the combination does not, and the rules cannot be checked across releases once a file is public. So the rule is about where the file goes, not about its content.

What the tool enforces:

- The command writes only to `open-data/dhis2/out/` (ignored by version control) or to a folder outside the repository. It refuses any output folder inside `open-data/` (including `published/`, `test-data/` and `dhis2/` outside `out/`) and any folder named `published`.
- Files are named `<YYYYMM>-<release id>-restricted[-test].json`. A sidecar `<same name>.notice.txt` holds the text `not for publication; for the district DHIS2 instance only`. The data file itself stays a plain `dataValueSets` document with only the `dataValues` key: DHIS2's import tolerance of extra top-level properties is not documented on the data page, so no extra property is added that could make an import fail.

What the team must do with the events:

- Raw events that carry `district` are sensitive. Store them with a short retention, restricted access and no export path, and never share or publish them. The open data build ignores `district`, but the file itself must stay inside the system that holds it.
- Send `district` only for the pilot sites that need DHIS2. An event without a district is never exported to DHIS2.

## Format

The file is a DHIS2 `dataValueSets` JSON document, as described in the DHIS2 Web API documentation, section "Sending data values" ([docs.dhis2.org, Data values](https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/data.html#webapi_sending_data_values)):

```json
{
  "dataValues": [
    {
      "dataElement": "<data element id>",
      "period": "202611",
      "orgUnit": "<organisation unit id>",
      "categoryOptionCombo": "<optional>",
      "value": 12
    }
  ]
}
```

- `period` is the DHIS2 monthly period `YYYYMM` (for example `202611` for November 2026; the DHIS2 documentation examples use this form, e.g. `201401`). The period formats are listed in the "Date and period format" section of the same page.
- `categoryOptionCombo` is written only when the mapping gives one.
- `value` is always a number. A value that is masked or withheld is not exported at all (no entry), never a text such as `<5`.

## Indicators

A cell is one (month, district). The month of an event is the month of the Thursday of its ISO week (ISO 8601 convention), so a week belongs to exactly one month. Events of other months are dropped.

| Indicator key            | Definition                                                                                                       | Exported when                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `checks`                 | Number of checks in the cell (events, not women).                                                                | Only when all four level values are exported; otherwise omitted. |
| `level_unknown`          | Checks whose highest level is `unknown` (the grey result).                                                       | The count is 5 or more and the feasibility rule below keeps it.  |
| `level_next_contact`     | Checks whose highest level is `next-contact`.                                                                    | Same.                                                            |
| `level_before_next_dose` | Checks whose highest level is `before-next-dose`.                                                                | Same.                                                            |
| `level_danger`           | Checks whose highest level is `danger`, that is checks where a danger orientation was shown. One value for both. | Same.                                                            |
| `iptp_reminders_shown`   | Checks in which the IPTp reminder (preventive malaria treatment in pregnancy, accompanied mode) was shown.       | The count is 5 or more.                                          |

The four level indicators are the findings per level: each check has exactly one highest level, so they add up to the number of checks. A danger orientation is shown exactly when the highest level is `danger`, so `level_danger` is also the "danger orientations shown" indicator and is not exported twice.

## Disclosure rules

1. A cell is exported only when its number of checks is greater than 10 (at least 11). Otherwise nothing is exported for the district that month, and a district with no check looks the same as one with a few.
2. A count below 5 is not exported (DHIS2 values are numbers, so there is nothing to put in its place).
3. No omitted value can be recomputed from the exported ones in the same cell. The number of checks is exported only when all four levels are exported (it is then their sum and reveals nothing more). Otherwise it is omitted, and the level values are checked with the same feasibility rule as the open data (`maskLevels` in `tools/open-data/src/aggregate.ts`): every value from 0 to 4 must stay possible for each omitted level, given the exported values and the fact that the cell has at least 11 checks. When it would not, the exact level values of the cell are withheld too.
4. Release policy as for the open data: a month is exported once, 28 days after the month ends, as an immutable restricted file named `<YYYYMM>-<release id>-restricted[-test].json` (for example `202611-r1-restricted.json`). The command refuses an earlier release date and refuses any month that already has a file, whatever its release id. Events that arrive after the snapshot are dropped, never added later. To correct a file, withdraw it and build the next release id.
5. The same limits as `open-data/README.md` apply: the threshold counts events, not women, so a per-device cap or distinct-submitter count is needed before real data is accepted.

The district is a place finer than the region. It is optional in an event and only the DHIS2 export reads it; the CSV of the open data ignores it. An event with a district that is not in the list, or whose region differs from the region of its district, is refused. Events without a district are not exported.

### The IPTp indicator and the accompanied mode

The IPTp reminder is shown only in accompanied mode. So an exported `iptp_reminders_shown` of 5 or more implies at least 5 accompanied-mode checks in that district and month. This is accepted: the number of accompanied checks is not otherwise exported, and the reveal is a lower bound, not a person.

The reminder is not tied to a level. Checked in the code: `knowledge/rules/iptp-reminder.yaml` is a `reminder` rule whose conditions are the pregnancy window (12-19, 20-29, 30-plus) and the absence of cotrimoxazole, with no level condition. The engine collects reminders in a list separate from the findings (`engine/src/evaluate.ts`), and the result view (`app/src/domain/result-view.ts`) shows them in accompanied mode only. A check with a reminder can therefore have any highest level, including `danger`, and the reminder count cannot be derived from the level counts.

## What the district must provide

- `districts.yaml`: the list of health districts (id and region), completed from the official list. Senegal has 79 health districts; the repository does not guess them. Start from `open-data/dhis2/districts.example.yaml`, which is empty, and the command refuses an empty list.
- `mapping.yaml`: the DHIS2 identifiers of the data elements (one per indicator above, with an optional category option combination) and of the organisation unit of each district. Start from `open-data/dhis2/mapping.example.yaml`. Every identifier is 11 characters, a letter then letters or digits. The command refuses to run while a `<to be provided by the district>` placeholder remains, or when an identifier is malformed, or when a district has no organisation unit. No identifier is invented in this repository.
- The data elements must exist in the DHIS2 instance, be numeric (integer, zero or positive) and be assigned to a data set that includes the organisation units.

## Run

```
node tools/open-data/bin/siapso-open-data.js dhis2 --input events.jsonl --month 2026-11 --release r1 --release-date 2026-12-28 --districts districts.yaml --mapping mapping.yaml --out-dir open-data/dhis2/out
```

Use `--out-dir open-data/dhis2/out` (or a folder outside the repository). An event whose district is not in the list stops the run (fail closed); the message names the district: add it to `districts.yaml` or correct the event source. `--test` adds `-test` to the file name. The fake districts and identifiers in `open-data/test-data/dhis2/` are for tests only. Import the file with the DHIS2 data values import (`POST /api/dataValueSets`) or the import/export app, after a dry run in a test instance.
