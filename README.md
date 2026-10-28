# ouch4ts

OUCH stands for Overall Upkeep and Change Hassle. This repository pairs an agent skill with an executable analyzer for JavaScript and TypeScript, including mixed projects.

The score is derived from CRAP, Change Risk Anti-Patterns, inspired by [Uncle Bob's crap4clj](https://github.com/unclebob/crap4clj). OUCH adds cognitive complexity from SonarSource's whitepaper to CRAP's cyclomatic complexity and coverage formula to rank functions for maintenance attention. Higher scores indicate more maintenance hassle. Reports also show file cyclomatic and cognitive complexity to identify files worth examining.

```text
OUCH = CC² × (1 - coverage)³ + CC + cognitive
```

Coverage is a fraction from 0 to 1. A function with cyclomatic complexity 2, cognitive complexity 1, and 50% coverage scores 3.5. A fully covered function scores the sum of its two complexities. The cognitive counter uses the existing TypeScript parser and needs no additional runtime or service.

## Setup

Use Node 22 or newer, following your environment's runtime setup instructions. Development uses the version in `.nvmrc`.

```bash
npm ci --ignore-scripts
npm run build
```

## Install the skill

The self-contained skill lives in [`skills/ouch4ts`](skills/ouch4ts/SKILL.md). After publishing this repository, install it with the [skills CLI](https://github.com/vercel-labs/skills), replacing `<owner>/<repo>` with its GitHub location:

```bash
npx skills add <owner>/<repo> --skill ouch4ts
```

The agent reuses a built analyzer when its runtime dependencies are present. Otherwise, it installs dependencies and builds inside the resolved skill directory, including project-local installations. Dependencies go into the skill's own `node_modules` and build output into its own `dist/`, with lifecycle scripts disabled and npm workspaces disabled. The target project's manifests, lockfiles, dependencies, and configuration stay unchanged. See [analyzer bootstrap](skills/ouch4ts/references/bootstrap.md). The skill includes its source, lockfile, runtime and build configuration, tests, and references; it needs no files from the repository root.

For a local checkout, link the skill directory into your agent's skill location. For a Codex setup using `~/.agents/skills`:

```bash
mkdir -p ~/.agents/skills
ln -s /absolute/path/to/ouch4ts/skills/ouch4ts ~/.agents/skills/ouch4ts
```

Then ask for a JavaScript or TypeScript OUCH report, or invoke `$ouch4ts`. The skill and analyzer work from this checkout; no npm publication is required.

## Run on a project

From the project being measured:

```bash
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js orders billing
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js --use-existing-coverage
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js \
  --exclude '**/generated/**' --exclude '**/*.generated.*'
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js \
  --source-root packages/app/src --source-root packages/shared/src \
  --coverage-command 'pnpm test:coverage' --lcov coverage/lcov.info
```

By default, the analyzer detects npm, Yarn, pnpm, or Bun from the project's `packageManager` metadata or lockfiles and runs `test:coverage` with that manager. Workspace projects can inherit detection from parent directories. Without a hint, it uses npm. If that script is absent, pass a complete command such as `--coverage-command 'yarn run coverage'` or `--coverage-command 'pnpm exec vitest run --coverage --coverage.reporter=lcov'`. See [command selection](skills/ouch4ts/references/coverage.md#choose-a-command) for detection precedence and overrides.

The analyzer scans `src` by default. It discovers `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts` sources, excluding tests, TypeScript declarations, and common build directories. Use repeated `--exclude` globs to skip generated sources before analysis. Patterns match paths relative to the project directory and affect both the table and saved metrics in every report mode. Quote globs to prevent shell expansion. See [source selection rules](skills/ouch4ts/references/measurement.md#source-discovery-and-cyclomatic-complexity). JavaScript projects need no TypeScript configuration or dependency.

The analyzer requires an updated `coverage/lcov.info` and checks freshness using file metadata. A failed command, missing or unchanged report, invalid LCOV, or malformed JavaScript or TypeScript exits with code 1 before writing metrics. `--use-existing-coverage` trusts the existing report and skips command selection and freshness checks. Older metrics remain on disk after a failed run.

The skill checks existing coverage prerequisites before running tests. Missing tools or required configuration changes stop the report with setup recommendations; the agent does not install project dependencies or edit the project's setup. See [coverage prerequisites](skills/ouch4ts/references/coverage.md) for Vitest, Jest, and c8. Coverage must refer to the original JavaScript or TypeScript, with paths relative to the current directory or absolute paths in the same checkout. Include untested files in coverage through existing settings or command-line options.

The skill leaves the target repository unchanged except for reports, coverage files, caches, and other tool-generated artifacts. See [the project write policy](skills/ouch4ts/SKILL.md#project-writes).

As a separate setup action, you can install the built checkout as a local development dependency in a target project:

```bash
npm install --save-dev /absolute/path/to/ouch4ts/skills/ouch4ts
npx --no-install ouch4ts --use-existing-coverage
```

## Output

```text
File complexity
===============
File           CC  Cog  Functions
src/orders.ts   2    1          1

OUCH Report
===========
Function  File             CC  Cog   Cov%  CRAP  OUCH
price     src/orders.ts:1   2    1  50.0%   2.5   3.5
```

Normal analysis replaces `.metrics/ouch.json` with `{ "entries": [...], "files": [...] }`. Function entries contain `name`, `file`, `line`, `endLine`, `complexity`, `cognitive`, `coverage`, `crap`, and `ouch`. `complexity` is independent function cyclomatic complexity; `cognitive` includes nested functions and callbacks with the whitepaper's nesting penalties and recursion increments. `OUCH = CRAP + cognitive`; coverage and cyclomatic complexity remain independent per function. Line numbers are 1-based. Coverage is a percentage; unknown coverage, CRAP, and OUCH are JSON `null` and display as `N/A`, while complexity metrics remain available. See the [score formulas](skills/ouch4ts/references/measurement.md#score).

Each file metric contains `file`, `complexity`, `cognitive`, and `functions`. File CC follows SonarJS's syntax counter; file cognitive complexity follows the whitepaper, including module code and nested functions counted once. See [file measurement rules](skills/ouch4ts/references/measurement.md#file-complexity). File CC uses different syntax rules from function CC. File metrics remain available when coverage is indeterminate. File rows sort by descending cognitive complexity, then path.

Function entries sort by descending OUCH, then file and line. Unknown scores come last. Path fragments filter both tables, using OR matching, while the metrics file always contains all functions and files under the configured roots. Commit `.metrics/` in a measured project if you want to track results over time.

Higher scores identify functions worth examining for missing tests or simpler control flow. Calibrate project limits against representative code. Classic CRAP score bands do not directly apply to OUCH because it adds cognitive complexity.

## Changed-function reports

Use `--since` with the PR's target branch or another Git reference:

```bash
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js --since origin/main
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js --since origin/main --use-existing-coverage orders
```

The analyzer finds the merge base of that reference and `HEAD`, then compares it with the current checkout. It prints functions whose current line ranges overlap added or modified lines. Deletions select a surviving function when the lines immediately before and after the deletion both remain inside that function. Fully deleted functions and pure renames produce no rows. An edited rename uses the new path.

Scores still measure each complete function using current coverage. A nested change can select both the nested and enclosing function. The file summary shows complete current metrics for source files with changed lines, including edits outside functions. Test-only changes can leave both tables empty. Path filters further narrow both tables, while `.metrics/ouch.json` retains all analyzed functions and files.

The diff includes committed changes plus staged and unstaged tracked edits. Untracked files are excluded; the skill reports that limitation without staging them. Run from the project directory as usual, including projects below the Git root. Git and the target reference's history must be available locally; fetch the target branch and enough history when using a shallow checkout. Invalid references or missing merge bases fail before coverage runs.

This reports current scores for changed functions. Use comparison mode to measure the PR's effect on scores.

## Commit comparisons

```bash
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js --compare origin/main
node /absolute/path/to/ouch4ts/skills/ouch4ts/dist/cli.js --compare origin/main --refresh
```

Comparison mode scores the merge base and committed `HEAD` in temporary detached worktrees. On a cache miss it detects each revision's package manager, installs locked dependencies with lifecycle scripts disabled, then runs coverage using that revision's dependencies and source. Customize preparation with `--setup-command` and coverage with `--coverage-command`. See [default setup commands](skills/ouch4ts/references/comparison.md). Local source edits are preserved and excluded from this mode.

The report shows base and head file metrics and their deltas, followed by function complexity, cognitive complexity, coverage, CRAP, OUCH, each score's delta, and added or removed functions. File rows sort by cognitive delta; function rows sort by OUCH delta. Test-only changes can produce score differences. Unknown scores retain `null` deltas. Complete reports are cached at `.metrics/cache/<commit-sha>-<settings-fingerprint>.json`; repeat comparisons reuse both revisions. The agent identifies cached or regenerated reports for each commit in its explanation. Environment values and external services are outside the fingerprint; use `--refresh` when those inputs change or a run was nondeterministic. Excluding the cache directory from version control is a separate setup recommendation when tracking `.metrics/`.

The result is saved to `.metrics/ouch-comparison.json` with function `entries` and file comparisons in `files`; the ordinary `.metrics/ouch.json` is preserved. Path filters narrow both tables, while the saved comparison retains all changed metrics. See [comparison setup, cache rules, and matching conventions](skills/ouch4ts/references/comparison.md).

## Measurement conventions

See [measurement conventions](skills/ouch4ts/references/measurement.md) for source discovery, function identity, complexity counting, and LCOV limitations.

## Library use

```ts
import { analyze } from "ouch4ts";

const entries = analyze({
  sources: [{ path: "src/orders.ts", text: sourceText }],
  lcov: lcovText,
  projectRoot: "/absolute/path/to/project",
});
```

`analyze` returns the same function entries written by the CLI. Use the exported `analyzeReport` with the same options to obtain `{ entries, files }`. `projectRoot` defaults to the working directory. Both accept source text and coverage text without reading target source files from disk.

## Development

The root package delegates to the `ouch4ts` workspace. The same commands work directly in `skills/ouch4ts`. Install or pack that directory when using the analyzer as an npm package.

```bash
npm run typecheck
npm test -- test/analyzer.test.ts
npm test -- test/cli.test.ts
npm run test:coverage
npm run ouch -- --use-existing-coverage
```

CLI tests exercise the command handler against temporary projects so coverage includes reporting, Git comparisons, and caching. A binary check verifies the executable entry point. Subprocesses that run setup and coverage commands do not contribute to the analyzer's coverage report.
