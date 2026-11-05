# Field dictionary

This file describes every field of the aggregated open data. Nothing else is published. The licence is CC BY 4.0.

Intended use of the data: understand, in aggregate, how the SIAPSO checks are used and which findings are most frequent, per ISO week and region of Senegal. It is not health data about any person.

## Event fields (what a device could later send)

An event is one check, summarised. The schema (`schema/event.schema.json`) allows no other field (`additionalProperties: false`) and no free text: every field is a number, an enumeration or a fixed pattern.

| Field               | Type                     | Meaning                                                                                                                    |
| ------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `week`              | ISO week, `YYYY-Www`     | Week of the check. No finer date. Week 53 only in years that have one.                                                     |
| `region`            | enumeration (14 ids)     | Region of Senegal (see below). No finer place.                                                                             |
| `mode`              | `woman` or `accompanied` | Who ran the check. Validated but never published, so it cannot split a row.                                                |
| `level`             | enumeration              | Highest level of the result: `unknown` (grey), `next-contact`, `before-next-dose`, `danger`. A grey result has no finding. |
| `findings`          | `C1` to `C12`, integers  | Number of findings for each check id in this check. Each count is 0 to 20 and the sum is at most 30.                       |
| `unknownItems`      | integer 0 to 20          | Items whose substance could not be determined.                                                                             |
| `unrecognisedNames` | integer 0 to 20          | Typed names that were not recognised. Only the count is sent, never the name.                                              |

Never in an event: profile identifier, product or plant name, free text, exact date or time, place finer than the region, device or network identifier.

## Regions

| Id            | Official name |
| ------------- | ------------- |
| `dakar`       | Dakar         |
| `diourbel`    | Diourbel      |
| `fatick`      | Fatick        |
| `kaffrine`    | Kaffrine      |
| `kaolack`     | Kaolack       |
| `kedougou`    | Kédougou      |
| `kolda`       | Kolda         |
| `louga`       | Louga         |
| `matam`       | Matam         |
| `saint-louis` | Saint-Louis   |
| `sedhiou`     | Sédhiou       |
| `tambacounda` | Tambacounda   |
| `thies`       | Thiès         |
| `ziguinchor`  | Ziguinchor    |

## Marks used in the published CSV

| Mark                               | Meaning                                                                                                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suppressed`                       | In the `status` column: the region had 10 checks or fewer that week (including none), so the whole row is empty. A region with no check cannot be told from one with a few. In the `grey_share_percent` column: the row has fewer than 20 checks, or the value is withheld. |
| `<5`                               | The count is 0, 1, 2, 3 or 4. The exact value is not published.                                                                                                                                                                                                             |
| `withheld`                         | A level count that is 5 or more but is not published, because publishing it would let a reader recompute a `<5` cell of the same row.                                                                                                                                       |
| `11-20`, `21-50`, `51-100`, `101+` | Band of the number of checks in the row.                                                                                                                                                                                                                                    |

## Columns of the published CSV

Every published week has exactly one row for each of the 14 regions, sorted by region id. Counts are integers. Encoding UTF-8, line endings LF, separator comma, no quoting needed.

| Column                   | Meaning                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `week`                   | ISO week, `YYYY-Www`.                                                                            |
| `region`                 | Region id (see the table above).                                                                 |
| `status`                 | `published`, or `suppressed` when every following cell is empty.                                 |
| `checks`                 | Band of the number of checks: `11-20`, `21-50`, `51-100` or `101+`.                              |
| `level_unknown`          | Checks whose highest level is `unknown` (the grey result). Number, `<5` or `withheld`.           |
| `level_next_contact`     | Checks whose highest level is `next-contact`. Number, `<5` or `withheld`.                        |
| `level_before_next_dose` | Checks whose highest level is `before-next-dose`. Number, `<5` or `withheld`.                    |
| `level_danger`           | Checks whose highest level is `danger`. Number, `<5` or `withheld`.                              |
| `grey_share_percent`     | Share of grey results in percent, rounded to the nearest 5 points. `suppressed` below 20 checks. |
| `findings_c1`            | Total findings for check C1 over the checks of the row. Number or `<5`.                          |
| `findings_c2`            | Total findings for check C2. Number or `<5`.                                                     |
| `findings_c3`            | Total findings for check C3. Number or `<5`.                                                     |
| `findings_c4`            | Total findings for check C4. Number or `<5`.                                                     |
| `findings_c5`            | Total findings for check C5. Number or `<5`.                                                     |
| `findings_c6`            | Total findings for check C6. Number or `<5`.                                                     |
| `findings_c7`            | Total findings for check C7. Number or `<5`.                                                     |
| `findings_c8`            | Total findings for check C8. Number or `<5`.                                                     |
| `findings_c9`            | Total findings for check C9. Number or `<5`.                                                     |
| `findings_c10`           | Total findings for check C10. Number or `<5`.                                                    |
| `findings_c11`           | Total findings for check C11. Number or `<5`.                                                    |
| `findings_c12`           | Total findings for check C12. Number or `<5`.                                                    |
| `unknown_items`          | Total items whose substance could not be determined. Number or `<5`.                             |
| `unrecognised_names`     | Total typed names that were not recognised. Number or `<5`.                                      |

The only comment line is an optional label first (for test files, `TEST DATA`). There is no footer.

## Suppression and masking rules

- A (week, region) row is published only when its number of checks is greater than 10 (at least 11). Otherwise the whole row is suppressed, not one column. The number of checks counts events, not women.
- In a published row, every count below 5 is published as `<5`, the number of checks as a band, and the grey share rounded to 5 points and only from 20 checks.
- No published combination narrows a `<5` level cell: every value from 0 to 4 must stay possible given the other cells and the band bounds. When it would not, the exact level counts of the row are `withheld`. The grey share is `suppressed` whenever a level cell of the row is `<5` or withheld.
- Each week is published once, 4 weeks after it ends, as an immutable file (see `README.md`).
