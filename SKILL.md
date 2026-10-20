---
name: crap4ts
description: Analyze TypeScript change risk with CRAP scores. Use for project risk reports, changed-function reports, or before-and-after PR comparisons with cached commit reports.
---

# CRAP for TypeScript

Use the bundled analyzer's full-function scores to explain change risk.

## Prepare

1. Inspect the target project's source roots, test scripts, package manager, and runtime requirements. Keep its existing test runner. Read [coverage setup](references/coverage.md) when configuring LCOV or investigating source-map problems.
2. Resolve this skill's directory to an absolute path. Packaged installs include `dist/cli.js`. For a source checkout, use `nvm use` in the skill directory, install dependencies with `npm ci` if needed, and run `npm run build`.
3. Run from the target project directory. The analyzer needs Node 22 or newer. Keep the project's runtime when generating coverage; with an older project runtime, generate coverage first and use a compatible Node for `--use-existing-coverage`.

## Choose the report

- For the effect of a PR on risk, read [commit comparisons](references/comparison.md). `--compare <target-ref>` scores the merge base and committed `HEAD`, reusing matching cached reports. Complete setup, cache, and function-matching rules live in that reference.
- For current risk in touched functions, use `--since <target-ref>`. It compares the merge base with the working checkout, including staged and unstaged tracked edits. New files enter this diff after being added to Git. Internal deletions select surviving functions; deleted functions and pure renames have no current function to score. Nested edits can select both parent and child.
- For current project risk, omit both flags. Use the project's actual target reference for PR requests.

```bash
node /path/to/crap4ts/dist/cli.js --compare origin/main
node /path/to/crap4ts/dist/cli.js --since origin/main
node /path/to/crap4ts/dist/cli.js --coverage-command 'npm run test:cov -- --runInBand'
```

Replace `/path/to/crap4ts` with the resolved skill directory. Use `--help` for options, including repeated source roots, LCOV paths, and positional path filters. Normal analysis requires the coverage command to succeed and update LCOV. `--use-existing-coverage` trusts an existing report's freshness.

## Interpret the result

Report the largest current scores and score increases with function locations. Explain whether complexity or coverage drives each result. Scores below 5 indicate low measured risk; 5 to below 30 suggest focused tests or simpler control flow; 30 or more deserve priority before changes. These are heuristics.

`N/A` means coverage is indeterminate. Check coverage inclusion, paths, and source maps before attributing it to missing tests. LCOV measures executable lines; shared lines can share hits, and coverage does not establish useful assertions or full branch coverage. Use the runner's detailed report to investigate suspicious scores. See [measurement conventions](README.md#measurement-conventions) when those details matter.

Normal runs save all analyzed functions in `.metrics/crap.json`. `--since` and path filters affect the displayed table. A report request authorizes analysis; propose tests or refactoring and perform those changes when requested.
