# ouch4ts

OUCH stands for Overall Upkeep and Change Hassle. The root `ouch4ts` package provides a CLI and typed API for JavaScript and TypeScript, including mixed projects. The companion agent skill lives in `skills/ouch4ts`.

The score is derived from CRAP, Change Risk Anti-Patterns, inspired by [Uncle Bob's crap4clj](https://github.com/unclebob/crap4clj). OUCH adds cognitive complexity specified by [SonarSource's whitepaper, version 1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf), to CRAP's cyclomatic complexity and coverage formula to rank functions for maintenance attention. Higher scores indicate more maintenance hassle. Reports also show file cyclomatic and cognitive complexity to identify files worth examining.

```text
OUCH = CC² × (1 - coverage)³ + CC + cognitive
```

Coverage is a fraction from 0 to 1. A function with cyclomatic complexity 2, cognitive complexity 1, and 50% coverage scores 3.5. A fully covered function scores the sum of its two complexities. The cognitive counter uses the existing TypeScript parser and needs no additional runtime or service.

## Setup

Use Node 22 or newer. From a full repository checkout, select the development version with nvm and build the root package:

```bash
nvm use
npm ci --ignore-scripts
npm run build
```

## Install the skill

Until the analyzer is published to npm, the [skill](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/SKILL.md) requires a full repository checkout. A copied skill directory contains instructions and references, without analyzer source or build files.

After setup, link the checkout's skill directory into your agent's skill location. For a Codex setup using `~/.agents/skills`:

```bash
mkdir -p ~/.agents/skills
ln -s /absolute/path/to/ouch4ts/skills/ouch4ts ~/.agents/skills/ouch4ts
```

Then ask for a JavaScript or TypeScript OUCH report, or invoke `$ouch4ts`. The agent reuses the root `dist/cli.js` when the build and runtime dependencies are present. Otherwise, it installs dependencies and builds at the checkout root with dependency lifecycle scripts disabled. See [analyzer bootstrap](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/bootstrap.md).

## Run on a project

The launching directory is the default project. `--project` selects one project from another directory, including a monorepo root:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js
node /absolute/path/to/ouch4ts/dist/cli.js orders billing
node /absolute/path/to/ouch4ts/dist/cli.js --use-existing-coverage
node /absolute/path/to/ouch4ts/dist/cli.js \
  --exclude '**/generated/**' --exclude '**/*.generated.*'
node /absolute/path/to/ouch4ts/dist/cli.js \
  --project packages/app --source-root lib --source-root services \
  --coverage-command 'pnpm test:coverage' --lcov coverage/lcov.info
node /absolute/path/to/ouch4ts/dist/cli.js \
  --project packages/app --use-existing-coverage --format json
```

After publication, the npm executable accepts the same arguments through npm exec, npx, a local npm script, or a global installation:

```bash
npm exec -- ouch4ts --project packages/app --use-existing-coverage --format json
npx ouch4ts --project packages/app --use-existing-coverage
```

A project with `ouch4ts` installed can define `"metrics": "ouch4ts"` in its npm scripts and run `npm run metrics -- --use-existing-coverage`. A global installation exposes `ouch4ts --use-existing-coverage`. `--help` and `--version` work without project setup. One invocation analyzes one project; source roots do not select independent workspace projects.

`--project` resolves relative to the launching directory. Source roots, LCOV, exclusions, output storage, and command working directories use the selected project. Report paths are relative to that project.

By default, the analyzer detects npm, Yarn, pnpm, or Bun from the project's `packageManager` metadata or lockfiles and runs `test:coverage` with that manager. Workspace projects can inherit detection from parent directories. Without a hint, it uses npm. If that script is absent, pass a complete command such as `--coverage-command 'yarn run coverage'` or `--coverage-command 'pnpm exec vitest run --coverage --coverage.reporter=lcov'`. See [command selection](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/coverage.md#choose-a-command) for detection precedence and overrides.

The analyzer scans `src` by default. It discovers `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts` sources, excluding tests, TypeScript declarations, and common build directories. Use repeated `--exclude` globs to skip generated sources before analysis. Patterns match paths relative to the project directory and affect both the table and saved metrics in every report mode. Quote globs to prevent shell expansion. See [source selection rules](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/measurement.md#source-discovery-and-cyclomatic-complexity). JavaScript projects need no TypeScript configuration or dependency.

The analyzer requires an updated `coverage/lcov.info` and checks freshness using file metadata. Source discovery runs after fresh coverage succeeds, so sources generated by that command participate in analysis. A failed command, missing or unchanged report, invalid LCOV, or malformed JavaScript or TypeScript exits with code 1 before writing metrics. `--use-existing-coverage` trusts the existing report, regardless of age, and skips command selection and execution. It still requires valid coverage input. Older metrics remain on disk after a failed run.

Before ordinary analysis, install the target project's dependencies and configure its coverage command to emit LCOV for original sources. The analyzer does not install those dependencies or edit manifests, lockfiles, or coverage configuration. For Vitest, Jest, or c8, enable LCOV reporting and source maps when transforming sources. Include untested files through the runner's settings or command-line options. See [coverage prerequisites](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/coverage.md) for runner-specific details.

LCOV paths must identify the original JavaScript or TypeScript sources, relative to the selected project or absolute within the same checkout. Paths to compiled output can leave original-source coverage unknown. Missing dependencies require a separate project setup step; a missing `test:coverage` script requires a suitable `--coverage-command` or an existing report with `--use-existing-coverage`.

Coverage and setup commands execute through the shell, inherit the environment, and send output to stderr. Those commands can write coverage, generated sources, and other files according to their own behavior. Check commands from configuration files before running them.

The skill leaves the target repository unchanged except for reports, coverage files, caches, and other tool-generated artifacts. See [the project write policy](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/SKILL.md#project-writes).

As a separate setup action, you can install the built checkout as a local development dependency in a target project:

```bash
npm install --save-dev /absolute/path/to/ouch4ts
npx --no-install ouch4ts --use-existing-coverage
```

## Configuration

The analyzer reads `ouch4ts.config.json` only at the selected project's root. A missing default file is allowed. `--config <file>` selects a file relative to the launching directory; missing or unreadable explicit files fail. `--no-config` skips config loading.

The config accepts only the following optional properties:

```json
{
  "sourceRoots": ["src"],
  "exclude": ["**/generated/**"],
  "lcov": "coverage/lcov.info",
  "coverageCommand": "npm run test:coverage",
  "setupCommand": "npm ci --ignore-scripts",
  "outputDir": ".metrics"
}
```

`sourceRoots` is a nonempty list of nonempty strings. `exclude` is a list of nonempty strings and can be empty. Other properties are nonempty strings. Invalid JSON, wrong types, blank values, and unknown keys fail before commands run. Executable configs and inheritance are unsupported.

Precedence is built-in defaults, then config, then flags. Repeated `--source-root` and `--exclude` flags replace the corresponding configured list. All configured paths use the selected project, even when the config file lives elsewhere. Config selection never changes the project.

Defaults are `src`, no additional exclusions, `coverage/lcov.info`, automatic command selection, and `.metrics` storage. Report mode, Git references, path filters, format, coverage reuse, and refresh are invocation options and cannot appear in config. Configured `setupCommand` stays inactive during ordinary analysis. Configured `coverageCommand` stays inactive with `--use-existing-coverage`.

The following explicit combinations fail before command execution:

- `--compare` with `--since` or `--use-existing-coverage`.
- `--refresh` or `--setup-command` without `--compare`.
- `--coverage-command` with `--use-existing-coverage`.
- `--config` with `--no-config`.

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

Normal analysis atomically replaces `.metrics/ouch.json` with `{ "entries": [...], "files": [...] }`. `--output-dir <directory>` selects another storage directory relative to the project. Final reports replace the previous file only after successful analysis. A report left on disk after a failed run can belong to an earlier run; successful comparison caches may survive a later failure.

Function entries contain `name`, `file`, `line`, `endLine`, `complexity`, `cognitive`, `coverage`, `crap`, and `ouch`. `complexity` is independent function cyclomatic complexity; `cognitive` includes nested functions and callbacks with the whitepaper's nesting penalties and recursion increments. `OUCH = CRAP + cognitive`; coverage and cyclomatic complexity remain independent per function. Line numbers are 1-based. Coverage is a percentage; unknown coverage, CRAP, and OUCH are JSON `null` and display as `N/A`, while complexity metrics remain available. Both current and comparison reports warn about unknown coverage and still succeed. See the [score formulas](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/measurement.md#score).

Each file metric contains `file`, `complexity`, `cognitive`, and `functions`. File CC follows SonarJS's syntax counter; file cognitive complexity follows the whitepaper, including module code and nested functions counted once. See [file measurement rules](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/measurement.md#file-complexity). File CC uses different syntax rules from function CC. File metrics remain available when coverage is indeterminate. File rows sort by descending cognitive complexity, then path.

Function entries sort by descending OUCH, then file and line. Unknown scores come last. Positional path fragments use case-sensitive OR matching. Fragments and `--since` filter stdout, while saved current reports contain all configured sources and saved comparisons contain all changed metrics. Filters do not affect analysis or caches.

`--format json` writes one JSON report to stdout with the same selected rows and ordering as the tables. Comparisons also include `base` and `head` commit identifiers. JSON mode still saves the complete report. Diagnostics, warnings, cache status, and child-command output go to stderr. Failed runs emit no result JSON.

Successful reports, help, and version exit `0`. Invalid arguments or config, unavailable inputs, failed commands, invalid LCOV or source syntax, and output-write failures exit `1`. Scores do not impose CI quality gates.

Higher scores identify functions worth examining for missing tests or simpler control flow. Calibrate project limits against representative code. Classic CRAP score bands do not directly apply to OUCH because it adds cognitive complexity.

## Changed-function reports

Use `--since` with the PR's target branch or another Git reference:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --since origin/main
node /absolute/path/to/ouch4ts/dist/cli.js --since origin/main --use-existing-coverage orders
```

The analyzer finds the merge base of that reference and `HEAD`, then compares it with the current checkout. It prints functions whose current line ranges overlap added or modified lines. Deletions select a surviving function when the lines immediately before and after the deletion both remain inside that function. Fully deleted functions and pure renames produce no rows. An edited rename uses the new path.

Scores still measure each complete function using current coverage. A nested change can select both the nested and enclosing function. The file summary shows complete current metrics for source files with changed lines, including edits outside functions. Test-only changes can leave both tables empty. Path filters further narrow both tables, while `.metrics/ouch.json` retains all analyzed functions and files.

The diff includes committed changes plus staged and unstaged tracked edits. Untracked files are excluded; the skill reports that limitation without staging them. Run from the project directory as usual, including projects below the Git root. Git and the target reference's history must be available locally; fetch the target branch and enough history when using a shallow checkout. Invalid references or missing merge bases fail before coverage runs.

This reports current scores for changed functions. Use comparison mode to measure the PR's effect on scores.

## Commit comparisons

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --compare origin/main
node /absolute/path/to/ouch4ts/dist/cli.js --compare origin/main --refresh
```

Comparison mode scores the merge base and committed `HEAD` in temporary detached worktrees. On a cache miss it detects each revision's package manager, installs locked dependencies with lifecycle scripts disabled, then runs coverage using that revision's dependencies and source. Customize preparation with `--setup-command` and coverage with `--coverage-command`. See [default setup commands](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/comparison.md). Local source edits are preserved and excluded from this mode.

Config resolves once from the launching checkout and applies to both revisions. Local config edits can therefore affect both measurements. Project, source, and LCOV paths rebase into each checkout and must stay inside the Git repository, including through symlinks. Reports remain in the launching checkout's chosen output directory. Ignored local files such as `.env` are not copied. Provide required environment variables or an explicit setup command when a revision needs them.

Git, the target reference, and enough history to find its merge base must be available locally. Each revision needs a compatible package manager and lockfile for default setup. Fetch missing history or references before retrying. Failed setup or coverage identifies the failed step; correct the project's prerequisites or supply the corresponding command override. Temporary worktrees are removed after success or failure.

The report shows base and head file metrics and their deltas, followed by function complexity, cognitive complexity, coverage, CRAP, OUCH, each score's delta, and added or removed functions. File rows sort by cognitive delta; function rows sort by OUCH delta. Test-only changes can produce score differences. Unknown scores retain `null` deltas. Complete reports are cached at `<output-dir>/cache/<commit-sha>-<settings-fingerprint>.json`; repeat comparisons reuse both revisions. Effective settings from config and flags share the same fingerprint rules. Environment values and external services are outside the fingerprint; use `--refresh` when those inputs change or a run was nondeterministic. Excluding the cache directory from version control is a separate setup recommendation when tracking reports.

The result is saved to `.metrics/ouch-comparison.json` with function `entries` and file comparisons in `files`; the ordinary `.metrics/ouch.json` is preserved. Path filters narrow both tables, while the saved comparison retains all changed metrics. See [comparison setup, cache rules, and matching conventions](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/comparison.md).

## Measurement conventions

See [measurement conventions](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/measurement.md) for source discovery, function identity, complexity counting, and LCOV limitations.

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

The named root exports are `analyze`, `analyzeReport`, and the `AnalysisOptions` type. Internal modules are private. The package supports ESM only. During `0.x`, breaking changes to the API, CLI, returned metrics, or saved JSON require a minor release. Patch releases preserve compatibility.

## Development

Run development commands from the repository root:

```bash
npm run typecheck
npm test -- test/analyzer.test.ts
npm test -- test/cli.test.ts
npm run test:coverage
npm run ouch -- --use-existing-coverage
```

CLI tests exercise the command handler against temporary projects so coverage includes reporting, Git comparisons, and caching. A binary check verifies the executable entry point. Subprocesses that run setup and coverage commands do not contribute to the analyzer's coverage report.

`npm run build` clears `dist` before compilation and rejects type errors. `npm pack` builds the package and includes compiled JavaScript, TypeScript declarations, this README, package metadata, and the MIT license. Source files, tests, source maps, and skill assets are excluded.

## Licenses

The analyzer and root npm package use the [MIT license](https://github.com/dumptruckman/ouch4ts/blob/main/LICENSE). The companion skill and everything under `skills/ouch4ts` use the separate [0BSD license](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/LICENSE). Skill assets are not distributed in the analyzer's npm package.
