# Analyze a project

Use this guide to generate current scores, report changed functions, or compare
commits. See the [CLI reference](cli.md) for all options and report fields.

## Build the analyzer

Use a full `dumptruckman/ouch4ts` repository checkout. The bundled skill also
requires that checkout. A copied skill directory has no analyzer source or build
configuration.

1. From the checkout root, select the development Node version with nvm:

   ```bash
   nvm use
   ```

2. Install dependencies with lifecycle scripts disabled:

   ```bash
   npm ci --ignore-scripts
   ```

3. Build the analyzer:

   ```bash
   npm run build
   ```

The executable is `dist/cli.js`. Replace `/absolute/path/to/ouch4ts` in the
examples below with your checkout path.

## Generate a current report

Install the target project's dependencies and configure its coverage command to
emit LCOV for original sources. See the
[coverage prerequisites](../skills/ouch4ts/references/coverage.md) for Vitest,
Jest, and c8 settings.

From the target project directory, run the analyzer:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js
```

The default command runs the project's `test:coverage` script with its detected
package manager. The report contains file complexity and function scores, and the
complete result is saved to `.metrics/ouch.json`.

If your coverage script has another name, pass its complete shell command:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js \
	--coverage-command 'yarn run coverage' --lcov coverage/lcov.info
```

Check commands from configuration files before running them. Coverage and setup
commands execute through the shell, inherit your environment, and can write files
according to their own behavior. Ordinary analysis does not install the target
project's dependencies or edit its configuration.

## Select a project and its sources

To analyze a project from another directory, pass `--project`. To replace the
default `src` root, pass one or more `--source-root` options:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js \
	--project packages/app --source-root lib --source-root services
```

One invocation analyzes one project. Source roots do not select independent
workspace projects.

To exclude generated sources, quote each glob so the shell does not expand it:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js \
	--exclude '**/generated/**' --exclude '**/*.generated.*'
```

## Reuse an existing coverage report

To skip coverage generation, pass `--use-existing-coverage`:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --use-existing-coverage
```

This option trusts the report's freshness. Regenerate coverage after source
changes. If the target project needs an older Node version, generate coverage
with that runtime first, then run the analyzer with Node 22 or newer.

## Filter the displayed report

To display only paths containing `orders` or `billing`, pass those fragments:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js orders billing
```

Matching is case-sensitive. Filters narrow stdout. The saved report still contains
all configured sources.

To write the selected rows as JSON, pass `--format json`:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --use-existing-coverage --format json
```

## Show current scores for changed functions

Use the PR's target branch or another local Git reference:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --since origin/main
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
node /absolute/path/to/ouch4ts/dist/cli.js --compare origin/main
```

The analyzer scores the merge base and committed `HEAD` in temporary detached
worktrees. On a cache miss, it installs locked dependencies with lifecycle scripts
disabled, then generates coverage. Local source edits are excluded.

If the defaults do not fit either revision, pass commands that work for both:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --compare origin/main \
	--setup-command 'pnpm install --frozen-lockfile --ignore-scripts && pnpm run build' \
	--coverage-command 'pnpm run coverage'
```

To regenerate cached reports after environment changes or a nondeterministic test
run, pass `--refresh`:

```bash
node /absolute/path/to/ouch4ts/dist/cli.js --compare origin/main --refresh
```

Results are saved to `.metrics/ouch-comparison.json`. See
[commit comparisons](../skills/ouch4ts/references/comparison.md) for setup
commands, cache rules, and function matching.

## Install the agent skill

After building the analyzer, link the checkout's skill directory into your
agent's skill location. For Codex using `~/.agents/skills`, run:

```bash
mkdir -p ~/.agents/skills
ln -s /absolute/path/to/ouch4ts/skills/ouch4ts ~/.agents/skills/ouch4ts
```

Ask for a JavaScript or TypeScript OUCH report, or invoke `$ouch4ts`. The agent
reuses the build and runtime dependencies when present. See
[analyzer bootstrap](../skills/ouch4ts/references/bootstrap.md) for missing
dependencies or builds and the [project write policy](../skills/ouch4ts/SKILL.md#project-writes)
for the skill's limits.

## Install the built checkout in a target project

To add the analyzer as a local development dependency, run these commands from
the target project:

```bash
npm install --save-dev /absolute/path/to/ouch4ts
npx --no-install ouch4ts --use-existing-coverage
```

This installation changes the target project's manifest and lockfile. For repeated
use, add `"metrics": "ouch4ts"` to its npm scripts, then run
`npm run metrics -- --use-existing-coverage`.
