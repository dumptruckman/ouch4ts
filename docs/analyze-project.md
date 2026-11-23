# Analyze a project

Use this guide to generate current scores, report changed functions, or compare
commits. See the [CLI reference](cli.md) for all options and report fields.

## Choose how to run the analyzer

Run commands from the package you want to analyze with Node 22 or newer.
If the project or its workspace already provides `ouch4ts`, use that version.
For an npm project with its own installation, check the binary with
`./node_modules/.bin/ouch4ts --version`. For a shared install, use the
workspace binary from the selected package directory.

If you want to add the analyzer to the project, use its package manager to
install `ouch4ts` as a dev dependency of the selected package. For npm:

```bash
npm install --save-dev ouch4ts
```

If the project already declares the dependency, restore it with the project's
normal install. The examples below use the project-local npm binary.

For a one-off run, replace `./node_modules/.bin/ouch4ts` in the examples with
`npx --yes ouch4ts@latest`. npm can download the stable release into its cache.
This path needs no project dependency or script. Check the available options with
`--help`.

## Generate a current report

Install the target project's dependencies and configure its coverage command to
emit LCOV for original sources. See the
[coverage prerequisites](coverage.md) for Vitest,
Jest, and c8 settings.

From the target project directory, run the analyzer:

```bash
./node_modules/.bin/ouch4ts
```

The default command runs the project's `test:coverage` script with its detected
package manager. The report contains file complexity and function scores, and the
complete result is saved to `.metrics/ouch.json`.

If your coverage script has another name, pass its complete shell command:

```bash
./node_modules/.bin/ouch4ts \
	--coverage-command 'yarn run coverage' --lcov coverage/lcov.info
```

Check commands from configuration files before running them. Coverage and setup
commands execute through the shell, inherit your environment, and can write files
according to their own behavior. Ordinary analysis does not install the target
project's dependencies or edit its configuration.

## Select a project and its sources

To analyze `packages/app` from the repository root, pass `--project packages/app`.
This example uses the binary installed in that package and selects two source roots.

```bash
./packages/app/node_modules/.bin/ouch4ts \
	--project packages/app --source-root lib --source-root services
```

One invocation analyzes one project. Source roots do not select independent
workspace projects.

To exclude generated sources, quote each glob so the shell does not expand it:

```bash
./node_modules/.bin/ouch4ts \
	--exclude '**/generated/**' --exclude '**/*.generated.*'
```

## Reuse an existing coverage report

To skip coverage generation, pass `--use-existing-coverage`:

```bash
./node_modules/.bin/ouch4ts --use-existing-coverage
```

This option trusts the report's freshness. Regenerate coverage after source
changes. If the target project needs an older Node version, generate coverage
with that runtime first, then run the analyzer with Node 22 or newer.

## Filter the displayed report

To display only paths containing `orders` or `billing`, pass those fragments:

```bash
./node_modules/.bin/ouch4ts orders billing
```

Matching is case-sensitive. Filters narrow stdout. The saved report still contains
all configured sources.

To write the selected rows as JSON, pass `--format json`:

```bash
./node_modules/.bin/ouch4ts --use-existing-coverage --format json
```

## Show current scores for changed functions

Use the PR's target branch or another local Git reference:

```bash
./node_modules/.bin/ouch4ts --since origin/main
```

`--since` selects functions touched since the merge base, including staged and
unstaged tracked edits. Untracked files are excluded. The scores measure complete
current functions, without score deltas. See the
[changed-function selection rules](cli.md#changed-function-selection).

If Git cannot find the reference or merge base, fetch the target branch and enough
history before retrying.

## Compare committed scores

Inspect both revisions' manifests, lockfiles, coverage settings, and runtime
requirements before running a comparison. Each revision needs compatible
dependencies and an LCOV command. Ignored files such as `.env` are absent from
temporary worktrees, so supply required values through the environment or an
explicit setup command.

Run the comparison against the PR's target reference:

```bash
./node_modules/.bin/ouch4ts --compare origin/main
```

The analyzer scores the merge base and committed `HEAD` in temporary detached
worktrees. On a cache miss, it installs locked dependencies with lifecycle scripts
disabled, then generates coverage. Local source edits are excluded.

If the defaults do not fit either revision, pass commands that work for both:

```bash
./node_modules/.bin/ouch4ts --compare origin/main \
	--setup-command 'pnpm install --frozen-lockfile --ignore-scripts && pnpm run build' \
	--coverage-command 'pnpm run coverage'
```

To regenerate cached reports after environment changes or a nondeterministic test
run, pass `--refresh`:

```bash
./node_modules/.bin/ouch4ts --compare origin/main --refresh
```

Results are saved to `.metrics/ouch-comparison.json`. See
[commit comparisons](comparison.md) for setup
commands, cache rules, and function matching.

## Install the agent skill

Copy the complete [`skills/ouch4ts` directory](https://github.com/dumptruckman/ouch4ts/tree/main/skills/ouch4ts), including its
license and references, into your agent's skill directory. For Codex, the
destination is `~/.agents/skills/ouch4ts/`. The copy works independently of
the analyzer repository. You can also link that directory from a checkout.

Invoke `$ouch4ts` with a question such as "How did this PR change maintenance
hassle compared with its base?" The skill uses the selected project's analyzer
when available. Otherwise it asks whether to add the dependency or run the
published analyzer once. See the [skill's project write policy](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/SKILL.md#project-writes).
