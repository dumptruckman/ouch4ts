# Coverage setup

Generate LCOV mapped to the original TypeScript files. Run commands from the same project root used for analysis. Keep the project's existing package manager, runner, and provider. Include untested source files so they appear with zero hits rather than being absent.

## Vitest

Add `lcov` to the existing coverage reporters and include the source files you want measured. Preserve other settings.

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

Use `vitest run --coverage` as the coverage command. If missing, install `@vitest/coverage-v8` at the same version as the project's Vitest. An Istanbul provider works too. See the [Vitest coverage guide](https://vitest.dev/guide/coverage).

## Jest

Keep the project's TypeScript transform and source maps. Add these fields to its existing Jest configuration.

```ts
coverageReporters: ["text", "lcov"],
collectCoverageFrom: ["src/**/*.{ts,tsx,mts,cts}", "!src/**/*.d.ts"],
```

Use `jest --coverage --runInBand` as the coverage command. See [Jest's coverage options](https://jestjs.io/docs/configuration#collectcoveragefrom-array).

## c8 and other runners

Use an LCOV reporter and source maps. For example, wrap an existing test command with `c8 --all --reporter=lcov --reporter=text`, preserving its TypeScript loader and test selection. See [c8](https://github.com/bcoe/c8).

The analyzer defaults to `coverage/lcov.info`. Use `--lcov` for another report location. Relative `SF:` paths resolve against the working directory; absolute paths must name the same checkout. Reports pointing at compiled JavaScript need source-map remapping before analysis.

If coverage runs with a different Node version or in another environment, generate and remap it first, then run with `--use-existing-coverage`. That flag trusts the report's freshness, so regenerate it after source changes.
