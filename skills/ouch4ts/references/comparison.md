# Commit comparisons

Use this mode to explain how a PR changes OUCH scores, including coverage changes from test-only edits.

## Run a comparison

Identify the PR's actual target reference and confirm its history is available locally. `--compare <ref>` resolves the merge base with committed `HEAD`. It ignores local source edits and untracked files. Use `--since` for current scores in working-copy changes.

Run from the target project directory:

```bash
node /path/to/ouch4ts/dist/cli.js --compare origin/develop \
  --coverage-command 'npm run test:cov -- --runInBand --coverageReporters=lcov'

# Regenerate reports after changes to external configuration or environment
node /path/to/ouch4ts/dist/cli.js --compare origin/develop --refresh \
  --coverage-command 'npm run test:cov -- --runInBand --coverageReporters=lcov'
```

On a cache miss, the tool creates a temporary detached Git worktree for that commit, runs setup and fresh coverage there, scores the complete configured source roots, and removes the worktree. The original checkout stays on its branch with its local edits intact. The same commit needs only one report when base and head coincide.

Before running a comparison, inspect both revisions' manifests, lockfiles, test scripts, and coverage configuration. Each revision must already declare compatible runner/provider dependencies and support LCOV with existing configuration or command-line options. If either revision lacks a prerequisite, stop and identify the revision and required setup change. Installed tools in the original checkout do not satisfy these checks.

Setup and coverage defaults use [package-manager detection](coverage.md#choose-a-command) independently in each revision's temporary checkout. Restoring each revision's locked dependencies is allowed only there; verify that the required tools are installed before coverage runs. Default setup freezes the lockfile and skips install lifecycle scripts:

| Package manager | Default setup command |
| --- | --- |
| npm | `npm ci --ignore-scripts` |
| Yarn Classic | `yarn install --frozen-lockfile --ignore-scripts` |
| Yarn 2.4 | `yarn install --immutable --skip-builds` |
| Yarn 3 and newer | `yarn install --immutable --mode=skip-build` |
| pnpm | `pnpm install --frozen-lockfile --ignore-scripts` |
| Bun | `bun install --frozen-lockfile --ignore-scripts` |

Default Yarn setup requires `yarn.lock` in the project or an ancestor within the repository. Its major version comes from `packageManager`. Without version metadata, a lockfile containing `__metadata` identifies modern Yarn, and the tool runs `yarn --version` in that directory to select the compatible script-skipping flag. A failed version check requires an explicit setup command. Yarn 2 releases older than 2.4 also need `--setup-command` because they lack the default script-skipping option. See the install options for [Yarn Classic](https://classic.yarnpkg.com/lang/en/docs/cli/install/), [Yarn 2](https://raw.githubusercontent.com/yarnpkg/berry/%40yarnpkg/cli/2.4.3/packages/plugin-essentials/sources/commands/install.ts), [current Yarn](https://yarnpkg.com/cli/install), [pnpm](https://pnpm.io/cli/install), and [Bun](https://bun.com/docs/pm/cli/install).

Supply `--setup-command` to override installation or add existing build steps that write generated output, following [the project write policy](../SKILL.md#project-writes) and keeping the lockfile frozen. Supply `--coverage-command` for the project's coverage script or installed runner. Both overrides apply to both revisions and bypass their respective defaults. For example:

```bash
node /path/to/ouch4ts/dist/cli.js --compare origin/main \
  --setup-command 'pnpm install --frozen-lockfile --ignore-scripts && pnpm run build' \
  --coverage-command 'pnpm run coverage'
```

Both commands run in each revision's project directory and inherit the launching environment. Use a runtime compatible with both revisions, or commands that select each checkout's required runtime using the user's or project's runtime setup instructions. Local ignored files, including `.env` and project registry configuration, are absent from fresh worktrees; supply required test configuration through the environment or an explicit setup command. Use each revision's matching dependencies and coverage. Shared current-checkout `node_modules` or copied LCOV would invalidate the comparison.

The project directory, source roots, and test setup must be usable in both revisions. Paths must remain inside the Git repository. Setup, coverage, or analysis failure stops the comparison. Successful commit reports remain cached; a previous comparison file remains unchanged after a failed run. `--compare` is separate from `--since` and `--use-existing-coverage`; `--refresh` requires `--compare`.

## Cache and output

Complete per-commit reports live at `.metrics/cache/<commit-sha>-<settings-fingerprint>.json`. The fingerprint includes the analyzer and cognitive-counter implementations, TypeScript and Node versions, platform, project directory, normalized roots, exclusion globs, LCOV path, and setup and coverage commands. Changing exclusions regenerates reports; reordering or repeating the same globs reuses them. Unchanged settings reuse reports across comparisons; path filters do not invalidate them. Invalid cached data, including reports without cognitive complexity or CRAP, is regenerated, and writes replace cache files atomically.

Environment values and external services are outside the fingerprint. Before running a comparison, use `--refresh` when those inputs are known to have changed or when a test run was nondeterministic. A cache hit does not establish that external test conditions are unchanged. Treat the cache as disposable local output; recommend excluding `.metrics/cache/` from version control when tracking other metrics, leaving any ignore-file edits to a separate setup request.

The CLI prints `Using cached report for <commit-sha>` when reusing a commit report and `Analyzing <commit-sha>` when generating one. Record those diagnostics for each distinct commit; describe a report as regenerated only after the comparison succeeds. When base and head are the same commit, one report supplies both sides. `--refresh` regenerates all distinct commit reports.

The table includes base and head CRAP scores and their `CRAP delta` alongside OUCH scores. `Delta` is the OUCH change; sorting remains by descending OUCH delta. The full comparison is saved as `.metrics/ouch-comparison.json`, containing base and head commit hashes and comparison entries. Each entry has `name`, `file`, `status`, full `base` and `head` metrics, and a `delta` for cyclomatic complexity, cognitive complexity, coverage percentage points, CRAP (`crap`), and OUCH (`ouch`). Positional path filters narrow only the printed table. The normal `.metrics/ouch.json` report is preserved.

Positive OUCH deltas indicate increased maintenance hassle; negative deltas indicate improvement. Retain the current absolute score when explaining changes. A decrease from 100 to 90 still leaves a high score. Added and removed functions have no numeric delta. Unknown coverage keeps the affected coverage, CRAP, and OUCH deltas indeterminate, rather than treating them as zero. Both complexity deltas remain available, and cognitive-only changes appear even when coverage is unknown.

## Function matching

The comparison matches functions by file and qualified name, applying Git-detected file renames. Callback line and column labels are ignored for identity when the resulting match is unique. Line shifts alone do not create score changes.

Changed metrics appear even if function source is untouched. File moves with matching metrics appear as `renamed`. Unchanged matches are omitted. New or renamed function names, splits, and ambiguous matches appear as added and removed entries. An ambiguous group with the same metric values in the same file is omitted because no metric difference can be established.

Use the full cached reports and source locations to inspect ambiguous cases. This matching does not establish semantic identity through arbitrary refactoring.
