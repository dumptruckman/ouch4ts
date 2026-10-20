# Commit comparisons

Use this mode to explain how a PR changes measured risk, including coverage changes from test-only edits.

## Run a comparison

Identify the PR's actual target reference and confirm its history is available locally. `--compare <ref>` resolves the merge base with committed `HEAD`. It ignores local source edits and untracked files. Use `--since` for current risk in working-copy changes.

Run from the target project directory:

```bash
node /path/to/crap4ts/dist/cli.js --compare origin/develop \
  --coverage-command 'npm run test:cov -- --runInBand --coverageReporters=lcov'

# Regenerate reports after changes to external configuration or environment
node /path/to/crap4ts/dist/cli.js --compare origin/develop --refresh \
  --coverage-command 'npm run test:cov -- --runInBand --coverageReporters=lcov'
```

On a cache miss, the tool creates a temporary detached Git worktree for that commit, runs setup and fresh coverage there, scores the complete configured source roots, and removes the worktree. The original checkout stays on its branch with its local edits intact. The same commit needs only one report when base and head coincide.

Setup defaults to `npm ci --ignore-scripts`. This uses each revision's lockfile and skips install lifecycle scripts. Supply `--setup-command` for another package manager or required generation steps. For example:

```bash
node /path/to/crap4ts/dist/cli.js --compare origin/main \
  --setup-command 'pnpm install --frozen-lockfile --ignore-scripts && pnpm generate' \
  --coverage-command 'pnpm test:coverage'
```

Both commands run in each revision's project directory and inherit the launching environment. Use a runtime compatible with both revisions, or commands that load nvm and select the required runtime in each checkout. Local ignored files, including `.env` and project registry configuration, are absent from fresh worktrees; supply required test configuration through the environment or an explicit setup command. Use each revision's matching dependencies and coverage. Shared current-checkout `node_modules` or copied LCOV would invalidate the comparison.

The project directory, source roots, and test setup must be usable in both revisions. Paths must remain inside the Git repository. Setup, coverage, or analysis failure stops the comparison. Successful commit reports remain cached; a previous comparison file remains unchanged after a failed run. `--compare` is separate from `--since` and `--use-existing-coverage`; `--refresh` requires `--compare`.

## Cache and output

Complete per-commit reports live at `.metrics/cache/<commit-sha>-<settings-fingerprint>.json`. The fingerprint includes the analyzer implementation, TypeScript and Node versions, platform, project directory, normalized roots, LCOV path, and setup and coverage commands. Unchanged settings reuse reports across comparisons; path filters do not invalidate them. Invalid cached data is regenerated, and writes replace cache files atomically.

Environment values and external services are outside the fingerprint. Use `--refresh` when those inputs change or when a test run was nondeterministic. Treat the cache as disposable local output; exclude `.metrics/cache/` from version control when tracking other metrics.

The full comparison is saved as `.metrics/crap-comparison.json`, containing base and head commit hashes and comparison entries. Each entry has `name`, `file`, `status`, full `base` and `head` metrics, and a `delta` for complexity, coverage percentage points, and CRAP. Positional path filters narrow only the printed table. The normal `.metrics/crap.json` report is preserved.

Positive CRAP deltas indicate increased measured risk; negative deltas indicate improvement. Retain the current absolute score when explaining changes. A decrease from 100 to 90 still leaves a high score. Added and removed functions have no numeric delta. Unknown coverage keeps the affected coverage and CRAP deltas indeterminate, rather than treating them as zero.

## Function matching

The comparison matches functions by file and qualified name, applying Git-detected file renames. Callback line and column labels are ignored for identity when the resulting match is unique. Line shifts alone do not create score changes.

Changed metrics appear even if function source is untouched. File moves with matching metrics appear as `renamed`. Unchanged matches are omitted. New or renamed function names, splits, and ambiguous matches appear as added and removed entries. An ambiguous group with the same metric values in the same file is omitted because no metric difference can be established.

Use the full cached reports and source locations to inspect ambiguous cases. This matching does not establish semantic identity through arbitrary refactoring.
