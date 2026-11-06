# Coverage prerequisites

Apply [the skill's preparation steps](../SKILL.md#prepare) before generating
coverage. Inspect installed dependencies, scripts, and configuration without
executing them. Keep the project's package manager, runner, and provider. Use
command-line options when they can generate LCOV without persistent changes.
Recommend the configuration examples below if the existing setup cannot emit
the required LCOV.

Generate LCOV mapped to the original sources from the same project root used for
analysis. Include untested source files so they appear with zero hits. With
`--use-existing-coverage`, the runner and provider need not be installed. Check
the supplied report's source paths and explain that its freshness is trusted.

## Choose a command

The default runs `<package-manager> run test:coverage`. Detection checks
`package.json`'s `packageManager` first, then lockfiles for npm, Yarn, pnpm, or
Bun. If neither exists in the project directory, detection checks parents up to
the Git root or filesystem root. The nearest directory with metadata or lockfiles
supplies the manager. Without a hint, the analyzer uses npm.

Multiple managers' lockfiles require an explicit command or `packageManager`
metadata. Both Bun lockfile formats count as one manager.

Inspect existing scripts and coverage configuration before selecting a command.
When `test:coverage` is absent or needs extra arguments, pass the complete shell
command with `--coverage-command`. Use the project's script or its installed
runner. For example:

```bash
# A Jest coverage script named coverage, run with Yarn
node /absolute/path/to/ouch4ts/dist/cli.js \
	--coverage-command 'yarn run coverage --runInBand --coverageReporters=lcov'

# Installed Vitest, with no dedicated coverage script
node /absolute/path/to/ouch4ts/dist/cli.js \
	--coverage-command 'pnpm exec vitest run --coverage --coverage.reporter=lcov'
```

Replace `/absolute/path/to/ouch4ts` with the resolved analyzer checkout root.
Explicit commands bypass package-manager detection and the `test:coverage`
prerequisite. They run in the target project directory and must succeed and
update the selected LCOV file. `--use-existing-coverage` skips command selection.
Command overrides also support other package managers without a new project
script.

Verify that the runner and coverage provider are installed and can emit LCOV
through existing settings or command-line options. Use the runner-specific
checks below. Recommend missing dependencies or required configuration changes
before running coverage.

## Vitest

Check that coverage can emit `lcov` and include the measured sources. If
configuration changes are required, recommend adding these settings while
preserving the existing options:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
		},
	},
});
```

Use `vitest run --coverage` with the installed Vitest. For the V8 provider, verify
that `@vitest/coverage-v8` matches the project's Vitest version. If the provider is
missing, stop and recommend that version. An existing Istanbul provider works
too. See the [Vitest coverage guide](https://vitest.dev/guide/coverage).

## Jest

Keep existing transforms and source maps for JSX, TypeScript, or compiled
JavaScript. Plain JavaScript needs no TypeScript transform. Check whether the
installed Jest can produce the required coverage with command-line options. If
configuration changes are required, recommend these fields:

```ts
coverageReporters: ["text", "lcov"],
collectCoverageFrom: ["src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}", "!src/**/*.d.{ts,mts,cts}"],
```

Use the installed Jest with `jest --coverage --runInBand` as the coverage command. See [Jest's coverage options](https://jestjs.io/docs/configuration#collectcoveragefrom-array).

## c8 and other runners

Use an installed coverage tool with an LCOV reporter. When sources are
transformed, preserve source maps. For example, when c8 is installed, wrap an
existing test command with `c8 --all --reporter=lcov --reporter=text`. Preserve
the command's loaders and test selection. If the tool is missing, stop and
recommend the required dependency. See [c8](https://github.com/bcoe/c8).

The analyzer defaults to `coverage/lcov.info`. Use `--lcov` for another report
location. Relative `SF:` paths resolve against the selected project directory.
Absolute paths must name the same checkout. Reports pointing at transpiled or
bundled output need source-map remapping to original sources before analysis.
Coverage of untransformed JavaScript can refer directly to its source files.

If coverage runs with a different Node version or in another environment, generate and remap it first, then run with `--use-existing-coverage`. That flag trusts the report's freshness, so regenerate it after source changes.
