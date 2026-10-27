# Coverage prerequisites

Apply the preflight in [the skill](../SKILL.md#prepare) before generating coverage. Inspect installed dependencies and existing scripts and configuration without executing them. Keep the project's package manager, runner, and provider. Use command-line options where they can generate LCOV without persistent changes. The configuration examples below are recommendations for the user if the existing setup is insufficient.

Generate LCOV mapped to the original TypeScript files from the same project root used for analysis. Include untested source files so they appear with zero hits rather than being absent. With `--use-existing-coverage`, the runner and provider need not be installed; check the supplied report's source paths and explain that its freshness is trusted.

## Choose a command

The default runs `<package-manager> run test:coverage`. Detection checks `package.json`'s `packageManager` first, then lockfiles for npm, Yarn, pnpm, or Bun. If neither exists in the project directory, it checks parent directories up to the Git root or filesystem root. The nearest directory with metadata or lockfiles supplies the manager. Without a hint, it uses npm. Multiple managers' lockfiles require an explicit command or `packageManager` metadata; both Bun lockfile formats count as one manager.

Inspect the existing scripts and coverage configuration before selecting a command. When `test:coverage` is absent or needs extra arguments, pass the complete shell command with `--coverage-command`. Choose the project's actual script or invoke its installed runner directly. For example:

```bash
# A Jest coverage script named coverage, run with Yarn
node /path/to/ouch4ts/dist/cli.js \
  --coverage-command 'yarn run coverage --runInBand --coverageReporters=lcov'

# Installed Vitest, with no dedicated coverage script
node /path/to/ouch4ts/dist/cli.js \
  --coverage-command 'pnpm exec vitest run --coverage --coverage.reporter=lcov'
```

Explicit commands bypass package-manager detection and the `test:coverage` prerequisite. They run in the target project directory and must succeed and update the selected LCOV file. `--use-existing-coverage` skips command selection entirely. Command overrides also support other package managers; no new project script is required.

Verify that the chosen runner and coverage provider are installed and can emit LCOV through existing settings or command-line options. Use the runner-specific checks below. Recommend missing dependencies or required configuration changes before running coverage.

## Vitest

Check that coverage can emit `lcov` and include the source files being measured. If configuration changes are required, recommend adding these settings to the existing configuration while preserving its other options:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx,mts,cts}"],
    },
  },
});
```

Use the installed Vitest with `vitest run --coverage` as the coverage command. For the V8 provider, verify that `@vitest/coverage-v8` is installed at the same version as the project's Vitest. If missing, stop and recommend that matching version. An existing Istanbul provider works too. See the [Vitest coverage guide](https://vitest.dev/guide/coverage).

## Jest

Keep the project's TypeScript transform and source maps. Check whether the installed Jest can produce the required coverage with command-line options. If configuration changes are required, recommend these fields for its existing configuration:

```ts
coverageReporters: ["text", "lcov"],
collectCoverageFrom: ["src/**/*.{ts,tsx,mts,cts}", "!src/**/*.d.ts"],
```

Use the installed Jest with `jest --coverage --runInBand` as the coverage command. See [Jest's coverage options](https://jestjs.io/docs/configuration#collectcoveragefrom-array).

## c8 and other runners

Use an already installed coverage tool with an LCOV reporter and source maps. For example, when c8 is installed, wrap an existing test command with `c8 --all --reporter=lcov --reporter=text`, preserving its TypeScript loader and test selection. If the tool is missing, stop and recommend the required dependency. See [c8](https://github.com/bcoe/c8).

The analyzer defaults to `coverage/lcov.info`. Use `--lcov` for another report location. Relative `SF:` paths resolve against the working directory; absolute paths must name the same checkout. Reports pointing at compiled JavaScript need source-map remapping before analysis.

If coverage runs with a different Node version or in another environment, generate and remap it first, then run with `--use-existing-coverage`. That flag trusts the report's freshness, so regenerate it after source changes.
