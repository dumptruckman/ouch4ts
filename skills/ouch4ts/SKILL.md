---
name: ouch4ts
description: Analyze TypeScript maintenance hassle from cyclomatic complexity, cognitive complexity, and coverage. Use for project maintenance reports, changed-function reports, or before-and-after PR comparisons with cached commit reports.
---

# OUCH for TypeScript

Use the bundled analyzer's full-function OUCH scores, Overall Upkeep and Change Hassle, to identify functions needing maintenance attention. The score is derived from CRAP, Change Risk Anti-Patterns, with an added cognitive complexity cost.

## Project writes

A report request allows generated coverage files and `.metrics` reports and caches. Keep source, tests, snapshots, configuration, manifests, and lockfiles unchanged in every checkout. Preserve the original checkout's installed dependencies. Project setup changes require a separate explicit request. Temporary comparison checkouts may restore locked dependencies and generate required build output as described in [commit comparisons](references/comparison.md).

Before execution, record existing tracked edits and untracked files. Inspect the selected commands, invoked scripts, and package-manager hooks for installs, formatting, snapshot updates, or source generation. Choose commands or options limited to the allowed output; otherwise stop with a recommendation. Avoid package runners that download missing tools.

After execution, compare the checkout with its initial state. If unexpected project changes appear, stop and report the affected files, preserving the user's existing work. Do not automatically revert, reset, or clean files. This policy guides agent actions; it does not enforce filesystem restrictions on project commands.

## Prepare

1. Inspect the target project's source roots, test scripts, package manager, and runtime requirements. Verify that compatible runtimes and package-manager executables needed for the selected mode are available. For fresh coverage in the current checkout, verify that its runner and coverage provider are installed and can produce LCOV through existing configuration or command-line options. For comparisons, apply the per-revision checks in [commit comparisons](references/comparison.md). Existing LCOV needs no installed runner or provider. Read [coverage prerequisites](references/coverage.md) for runner-specific checks or source-map problems. If prerequisites are missing, stop with exact runtime, dependency/version, or configuration recommendations.
2. Resolve this skill's directory to an absolute real path. Reuse its `dist/cli.js` when that build and its declared runtime dependencies are present. npm package installs include the build. For missing dependencies or a missing build, follow [analyzer bootstrap](references/bootstrap.md); install and build only outside the target repository.
3. Run from the target project directory. The analyzer needs Node 22 or newer. Keep the project's runtime when generating coverage; with an older project runtime, generate coverage first and use a compatible Node for `--use-existing-coverage`.

## Choose the report

- For the effect of a PR on maintenance hassle, read [commit comparisons](references/comparison.md). `--compare <target-ref>` scores the merge base and committed `HEAD`, reusing matching cached reports. Complete setup, cache, and function-matching rules live in that reference.
- For current scores in touched functions, use `--since <target-ref>`. It compares the merge base with the working checkout, including staged and unstaged tracked edits. Untracked files are excluded; report this limitation rather than staging files for analysis. Internal deletions select surviving functions; deleted functions and pure renames have no current function to score. Nested edits can select both parent and child.
- For current project scores, omit both flags. Use the project's actual target reference for PR requests.

```bash
node /path/to/ouch4ts/dist/cli.js --compare origin/main
node /path/to/ouch4ts/dist/cli.js --since origin/main
node /path/to/ouch4ts/dist/cli.js --coverage-command 'npm run test:cov -- --runInBand'
```

Replace `/path/to/ouch4ts` with the resolved skill directory. Use `--help` for options, including repeated source roots, LCOV paths, and positional path filters. Normal analysis requires the coverage command to succeed and update LCOV. `--use-existing-coverage` trusts an existing report's freshness.

## Interpret the result

Report the largest current scores and score increases with function locations. Explain the cyclomatic (`CC`), cognitive (`Cog`), and coverage contributions. Full coverage leaves both complexity costs in the score. Read [measurement conventions](references/measurement.md) for the formula and cognitive counting rules. Calibrate project-specific limits against representative code rather than applying classic CRAP score bands.

`N/A` means coverage is indeterminate. Check coverage inclusion, paths, and source maps before attributing it to missing tests. LCOV measures executable lines; shared lines can share hits, and coverage does not establish useful assertions or full branch coverage. Use the runner's detailed report to investigate suspicious scores. See [measurement conventions](references/measurement.md) when those details matter.

Normal runs save all analyzed functions in `.metrics/ouch.json`. `--since` and path filters affect the displayed table. A report request authorizes analysis; propose tests or refactoring and perform those changes when requested.
