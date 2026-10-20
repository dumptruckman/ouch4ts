---
name: crap4ts
description: Calculate CRAP scores for TypeScript functions using cyclomatic complexity and test coverage. Use for TypeScript CRAP reports, including PR changes, complexity analysis, or identifying functions that need tests before refactoring.
---

# CRAP for TypeScript

Use the analyzer bundled with this skill to rank functions by change risk.

## Prepare

1. Inspect the target project's test scripts, package manager, source roots, and coverage setup. Use its existing runner. Read [references/coverage.md](references/coverage.md) when configuring LCOV for Vitest, Jest, or c8.
2. Resolve this skill's directory to an absolute path. A packaged install already has `dist/cli.js`. For a source checkout, use `nvm use` in the skill's directory, install dependencies with `npm ci` if needed, and run `npm run build`. The analyzer requires Node 22 or newer. Keep the target project's runtime requirements when running its tests.
3. Run the analyzer from the target project's root. Replace `/path/to/crap4ts` below with this skill's directory. If the project uses an older Node version, generate coverage with its runtime first, then use a compatible Node version for `--use-existing-coverage`.

## Run

```bash
# Default coverage command: npm run test:coverage
node /path/to/crap4ts/dist/cli.js

# Use the project's own coverage command and source roots
node /path/to/crap4ts/dist/cli.js \
  --source-root packages/app/src --source-root packages/shared/src \
  --coverage-command 'pnpm test:coverage' --lcov coverage/lcov.info

# Reuse a report known to match the current sources
node /path/to/crap4ts/dist/cli.js --use-existing-coverage

# Show only matching file paths in the table
node /path/to/crap4ts/dist/cli.js --use-existing-coverage orders billing

# Report functions touched by a PR relative to its target branch
node /path/to/crap4ts/dist/cli.js --since origin/main
```

A normal run requires the coverage command to succeed and update the LCOV file. A failed command or unchanged report stops analysis. `--use-existing-coverage` skips both the command and the freshness check.

The default source root is `src`. Roots can be repeated. The analyzer discovers `.ts`, `.tsx`, `.mts`, and `.cts` files, excluding declarations, test files, and common dependency, test, and build directories. It reads source without executing it.

For PR reports, use `--since` with the PR's actual target reference and ensure its history is available locally. The filter compares the merge base with the current checkout, including staged and unstaged tracked edits. New files enter the diff after being added to Git. It selects current function ranges overlapping changed lines, including internal deletions, and retains each function's complete score. Deleted functions and pure renames are omitted. Changes outside function ranges can yield an empty table. See the README's PR reports section for deletion and nested-function conventions.

## Read the results

The table lists function, file and line, cyclomatic complexity, covered executable lines, and CRAP score, worst first. Every successful run replaces `.metrics/crap.json` with all functions under the configured roots. Path filters and `--since` affect only the table. Present the riskiest functions with their locations and explain whether complexity or missing tests drives the score. PR reports show current scores; score differences between revisions require coverage for both revisions.

```text
CRAP = CC² × (1 - coverage)³ + CC
```

The formula uses coverage as a fraction. The report displays it as a percentage. Complexity starts at 1 and adds a decision for conditionals, loops, catch clauses, non-default switch cases, short-circuit operators and assignments, optional-chain steps, and parameter or destructuring defaults. Nested functions receive separate scores.

| Score | Interpretation |
| --- | --- |
| Below 5 | Low change risk |
| 5 to below 30 | Consider focused tests or simpler control flow |
| 30 or above | Prioritize before changing the function |

`N/A` means the report has no matching executable lines for that function. Check LCOV paths, coverage inclusion, and source maps before drawing conclusions. An omitted file is unknown, not proven untested. Missing coverage does not produce a numeric CRAP score.

LCOV supplies line coverage, not branch coverage or proof of assertions. Functions sharing a line can share hits. Multiline nested bodies are excluded from the parent's coverage; shared lines may be indeterminate. Use the runner's detailed report to investigate suspicious results. See [README.md](README.md) for the exact conventions and limitations.

A report request authorizes analysis. Propose focused tests or refactoring for the worst scores; perform those changes when requested.
