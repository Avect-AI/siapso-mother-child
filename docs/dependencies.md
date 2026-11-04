<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Dependencies: open alerts and revisit dates

Dependabot version updates wait 14 days after a release (`cooldown` in `.github/dependabot.yml`, the same as `minimumReleaseAge` in `pnpm-workspace.yaml`). A fixed version is therefore not proposed, and cannot be installed, until it is 14 days old. Four Dependabot alerts were open on 2026-11-04. All four are build-time only, never shipped in the app or run on a phone: serialize-javascript, deepmerge and minimatch 5 come from `workbox-build` (pulled in by `vite-plugin-pwa`) to generate the service worker; minimatch 10 and glob come from development tooling (ESLint and the build).

| Alert | Package                      | Fixed version | Severity | Eligible (14 days old) | Revisit    |
| ----- | ---------------------------- | ------------- | -------- | ---------------------- | ---------- |
| 2     | serialize-javascript (7.1.2) | 7.1.3         | low      | 2026-11-05             | 2026-11-05 |
| 4     | glob (11.1.0)                | 14.0.2        | medium   | 2026-11-10             | 2026-11-10 |
| 1     | minimatch (10.2.6 and 5.1.9) | 11.0.1        | medium   | 2026-11-10             | 2026-11-10 |
| 3     | deepmerge                    | none yet      | low      | no fixed version       | 2026-11-17 |

## Plan

1. On each revisit date, check whether Dependabot opened a pull request for the package (`gh pr list --label dependencies`), and merge it through the usual gate when CI is green.
2. If Dependabot cannot update because the range declared by `workbox-build` excludes the fixed version (glob and minimatch are several majors ahead of the range `workbox-build` declares), add a pnpm override in `pnpm-workspace.yaml`, for example `overrides: { 'serialize-javascript@<7.1.3': '7.1.3' }`, then run `pnpm install`, `pnpm build` and the app tests. The service worker must still be generated and `pnpm budget:app` must still pass. Remove the override as soon as `workbox-build` ships a range that includes the fixed version.
3. If an override breaks the build (a major API change in glob or minimatch), do not force it: record the reason here, keep the alert open with its dismissal reason ("not used at runtime, build-time only"), and revisit when `workbox-build` or `vite-plugin-pwa` is updated.
4. deepmerge has no fixed version: check the advisory on the revisit date and again whenever `workbox-build` changes. Dismiss it as "not used at runtime" if nothing is fixed by then, with a note in this file.

Update this table when an alert is closed.
