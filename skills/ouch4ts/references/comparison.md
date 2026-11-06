# Commit comparisons

Use this mode to explain how a PR changes OUCH scores, including coverage changes from test-only edits.

## Run a comparison

Identify the PR's actual target reference and confirm that its history is
available locally. `--compare <ref>` resolves the merge base with committed
`HEAD`. Local source edits and untracked files are excluded. Use `--since` for
current scores in working-copy changes.

Run from the target project directory:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --compare origin/develop \
	--coverage-command 'npm run test:cov -- --runInBand --coverageReporters=lcov'

# Regenerate reports after changes to external configuration or environment
node /absolute/path/to/ouch4ts/dist/cli.js --compare origin/develop --refresh \
	--coverage-command 'npm run test:cov -- --runInBand --coverageReporters=lcov'
```

Replace `/absolute/path/to/ouch4ts` with the resolved analyzer checkout root.
On a cache miss, the analyzer creates a temporary detached Git worktree for that
commit. It runs setup and fresh coverage, scores all configured sources, then
removes the worktree. The original checkout stays on its branch with local edits
intact. When base and head are the same commit, one report supplies both sides.

Before running a comparison, inspect both revisions' manifests, lockfiles, test
scripts, and coverage configuration. Each revision must declare compatible
runner and provider dependencies and support LCOV through existing settings or
command-line options. If either revision lacks a prerequisite, stop and identify
the revision and required setup change. Installed tools in the original checkout
do not satisfy these checks.

Setup and coverage defaults use
[package-manager detection](coverage.md#choose-a-command) independently in each
revision's temporary checkout. Restore locked dependencies only in those
worktrees. Verify that the required tools are installed before coverage runs.
Default setup preserves the lockfile and skips install lifecycle scripts:

| Package manager | Default setup command |
| --- | --- |
| npm | `npm ci --ignore-scripts` |
| Yarn Classic | `yarn install --frozen-lockfile --ignore-scripts` |
| Yarn 2.4 | `yarn install --immutable --skip-builds` |
| Yarn 3 and newer | `yarn install --immutable --mode=skip-build` |
| pnpm | `pnpm install --frozen-lockfile --ignore-scripts` |
| Bun | `bun install --frozen-lockfile --ignore-scripts` |

Default Yarn setup requires `yarn.lock` in the project or an ancestor within the
repository. The major version comes from `packageManager`. Without version
metadata, a lockfile containing `__metadata` identifies modern Yarn. The analyzer
then runs `yarn --version` in that directory to select the compatible
script-skipping flag. A failed version check requires an explicit setup command.
Yarn 2 releases older than 2.4 also need `--setup-command` because they lack the
default script-skipping option.

The package managers document their install options:

- [Yarn Classic install options](https://classic.yarnpkg.com/lang/en/docs/cli/install/).
- [Yarn 2.4.3 install implementation](https://raw.githubusercontent.com/yarnpkg/berry/%40yarnpkg/cli/2.4.3/packages/plugin-essentials/sources/commands/install.ts).
- [Current Yarn install options](https://yarnpkg.com/cli/install).
- [pnpm install options](https://pnpm.io/cli/install).
- [Bun install options](https://bun.com/docs/pm/cli/install).

Supply `--setup-command` to override installation or add existing build steps
that write generated output. Follow the [project write policy](../SKILL.md#project-writes)
and keep the lockfile unchanged. Supply `--coverage-command` for the project's
coverage script or installed runner. Both overrides apply to both revisions and
bypass their respective defaults. For example:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --compare origin/main \
	--setup-command 'pnpm install --frozen-lockfile --ignore-scripts && pnpm run build' \
	--coverage-command 'pnpm run coverage'
```

Both commands run in each revision's project directory and inherit the launching
environment. Use a runtime compatible with both revisions. If the revisions need
different runtimes, select each runtime in the commands using the user's or
project's setup instructions.

Ignored files, including `.env` and local registry configuration, are absent from
fresh worktrees. Supply required test configuration through the environment or
an explicit setup command. Use each revision's matching dependencies and coverage.
Sharing the current checkout's `node_modules` or copying LCOV invalidates the
comparison.

The project directory, source roots, and test setup must be usable in both
revisions. Paths must remain inside the Git repository. Setup, coverage, or
analysis failure stops the comparison. Successful commit reports remain cached.
A previous comparison file remains unchanged after a failed run.

`--compare` cannot combine with `--since` or `--use-existing-coverage`.
`--refresh` and `--setup-command` require `--compare`.

## Cache and output

### Cache identity

Complete per-commit reports contain function entries and file metrics at
`<output-dir>/cache/<commit-sha>-<settings-fingerprint>.json`. The default output
directory is `.metrics`.

The fingerprint includes these inputs:

- Analyzer and cognitive-counter implementations.
- TypeScript and Node versions, platform, and architecture.
- Project directory, normalized source roots, exclusion globs, and LCOV path.
- Setup and coverage commands.

Changing exclusions regenerates reports. Reordering or repeating the same globs
reuses them. Unchanged settings reuse reports across comparisons. Path filters
do not invalidate caches. Invalid cached data is regenerated, including reports
without file metrics or cognitive scores. Cache writes are atomic.

Environment values and external services are outside the fingerprint. When those
inputs have changed or a test run was nondeterministic, use `--refresh`. A cache
hit does not establish that external test conditions are unchanged.

Treat the cache as disposable local output. When tracking other metrics,
recommend excluding `<output-dir>/cache/` from version control. Leave ignore-file
edits to a separate setup request.

### Cache diagnostics

The CLI prints `Using cached report for <commit-sha>` when reusing a commit
report and `Analyzing <commit-sha>` when generating one. Record the diagnostics
for each distinct commit. Describe a report as regenerated only after the
comparison succeeds. When base and head are the same commit, one report supplies
both sides. `--refresh` regenerates all distinct commit reports.

### Report fields

The file table shows base and head CC, cognitive complexity, function counts, and
complexity deltas. Rows sort by descending cognitive delta. File matching applies
Git-detected renames. Added and removed files have an absent side and `null`
deltas. Unchanged file metrics are omitted. Files with only module-level code can
appear even when there are no function changes.

The function table includes cognitive scores, base and head CRAP, and
`CRAP delta` alongside OUCH. `Delta` is the OUCH change. Function rows sort by
descending OUCH delta. Nested-function edits can change the enclosing function's
cognitive and OUCH scores.

The full comparison is saved as `<output-dir>/ouch-comparison.json` with these
fields:

| Field | Contents |
| --- | --- |
| `base`, `head` | Commit hashes |
| `entries` | Function comparisons with `name`, `file`, `status`, full `base` and `head` metrics, and `delta` |
| `files` | File comparisons with `file`, `status`, `base`, `head`, and `delta` |

Function `delta` contains `complexity`, `cognitive`, `coverage` in percentage
points, `crap`, and `ouch`. File `delta` contains `complexity`, `cognitive`, and
`functions`. Positional path filters narrow both printed tables. Saved
comparisons retain all metric changes. The ordinary `<output-dir>/ouch.json`
report is preserved.

Positive OUCH deltas indicate increased maintenance hassle. Negative deltas
indicate improvement. Retain the current absolute score when explaining changes.
A decrease from 100 to 90 still leaves a high score. Added and removed functions
have no numeric delta.

Unknown coverage keeps the affected coverage, CRAP, and OUCH deltas `null`.
Both complexity deltas remain available. Cognitive-only changes appear even
when coverage is unknown.

## Function matching

The comparison matches functions by file and qualified name, applying Git-detected file renames. Callback line and column labels are ignored for identity when the resulting match is unique. Line shifts alone do not create score changes.

Changed metrics appear even if function source is untouched. File moves with matching metrics appear as `renamed`. Unchanged matches are omitted. New or renamed function names, splits, and ambiguous matches appear as added and removed entries. An ambiguous group with the same metric values in the same file is omitted because no metric difference can be established.

Use the full cached reports and source locations to inspect ambiguous cases. This matching does not establish semantic identity through arbitrary refactoring.
