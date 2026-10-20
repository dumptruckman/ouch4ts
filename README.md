# crap4ts

CRAP metrics for TypeScript, inspired by [Uncle Bob's crap4clj](https://github.com/unclebob/crap4clj). This repository pairs an agent skill with an executable analyzer.

CRAP combines cyclomatic complexity with test coverage to rank functions that are risky to change.

```text
CRAP = CC² × (1 - coverage)³ + CC
```

Coverage is a fraction from 0 to 1. A function with complexity 2 and 50% coverage scores 2.5. A fully covered function scores its complexity.

## Setup

Use Node 22 or newer. Development uses the version in `.nvmrc`.

```bash
. "$HOME/.nvm/nvm.sh"
nvm use
npm ci
npm run build
```

To use the skill, add this repository as a skill directory in your agent's skill location. For a Codex setup using `~/.agents/skills`:

```bash
mkdir -p ~/.agents/skills
ln -s /absolute/path/to/crap4ts ~/.agents/skills/crap4ts
```

Then ask for a TypeScript CRAP report, or invoke `$crap4ts`. The entry point is [SKILL.md](SKILL.md). The skill and analyzer work from this checkout; no npm publication is required.

## Run on a project

From the project being measured:

```bash
node /absolute/path/to/crap4ts/dist/cli.js
node /absolute/path/to/crap4ts/dist/cli.js orders billing
node /absolute/path/to/crap4ts/dist/cli.js --use-existing-coverage
node /absolute/path/to/crap4ts/dist/cli.js \
  --source-root packages/app/src --source-root packages/shared/src \
  --coverage-command 'pnpm test:coverage' --lcov coverage/lcov.info
```

By default, the analyzer runs `npm run test:coverage`, requires an updated `coverage/lcov.info`, and scans `src`. It checks freshness using file metadata. A failed command, missing or unchanged report, invalid LCOV, or malformed TypeScript exits with code 1 before writing metrics. `--use-existing-coverage` trusts the existing report and skips the command and freshness check. Older metrics remain on disk after a failed run.

See [coverage setup](references/coverage.md) for Vitest, Jest, and c8. Coverage must refer to the original TypeScript, with paths relative to the current directory or absolute paths in the same checkout. Include untested files in the runner's coverage configuration.

You can also install the built checkout as a local development dependency in a target project:

```bash
npm install --save-dev /absolute/path/to/crap4ts
npx --no-install crap4ts --use-existing-coverage
```

## Output

```text
CRAP Report
===========
Function  File               CC   Cov%  CRAP
price     src/orders.ts:1      2  50.0%   2.5
```

Every successful run replaces `.metrics/crap.json` with `{ "entries": [...] }`. Entries contain `name`, `file`, `line`, `endLine`, `complexity`, `coverage`, and `crap`. Line numbers are 1-based. Coverage is a percentage; unknown coverage and CRAP are JSON `null` and display as `N/A`.

Entries sort by descending score, then file and line. Unknown scores come last. Path fragments filter the table, using OR matching, while the metrics file always contains all functions under the configured roots. Commit `.metrics/` in a measured project if you want to track results over time.

Scores below 5 indicate low change risk. Scores from 5 to below 30 suggest focused tests or simpler control flow. Prioritize scores of 30 or more before changing those functions. These are heuristics, not a quality gate.

## Measurement conventions

- Discover `.ts`, `.tsx`, `.mts`, and `.cts`. Skip `.d.ts`, `.d.mts`, `.d.cts`, `*.test.*`, and `*.spec.*` files. Skip directories named `node_modules`, `.git`, `dist`, `build`, `coverage`, `test`, `tests`, `__tests__`, and `__mocks__`. Directory symlinks are not followed. Source roots are explicit; `tsconfig` include and exclude rules are not consulted.
- Measure functions with bodies: declarations, expressions, arrows, methods, constructors, getters, and setters. Skip overload signatures and ambient declarations. Named class methods include their class name. Nested names include their enclosing function; anonymous callbacks include line and column.
- Start complexity at 1. Add 1 for each `if`, ternary, `for`, `for-in`, `for-of`, `while`, `do-while`, `catch`, non-default `case`, `&&`, `||`, `??`, `&&=`, `||=`, `??=`, explicit `?.` step, parameter default, and destructuring default. Count nested functions separately. Comments, strings, and conditional types add nothing.
- Coverage is the fraction of LCOV `DA` lines with positive hits within the function body's statement range. Declaration-only lines and multiline nested bodies are excluded. Repeated records for an exact file path merge their hits. No basename or suffix guessing is used.
- LCOV cannot distinguish different functions or branches sharing a source line. Nested bodies on a shared line can leave the parent with no independently attributable lines. Empty bodies and functions with no matching executable lines report `N/A`. Coverage does not establish that tests contain useful assertions.
- The analyzer checks syntax, without typechecking or executing target source. TypeScript 6 is pinned because this implementation uses its compiler API.

## Library use

```ts
import { analyze } from "crap4ts";

const entries = analyze({
  sources: [{ path: "src/orders.ts", text: sourceText }],
  lcov: lcovText,
  projectRoot: "/absolute/path/to/project",
});
```

`analyze` returns the same entries written by the CLI. `projectRoot` defaults to the working directory. It accepts source text and coverage text without reading target source files from disk.

## Development

```bash
npm run typecheck
npm test -- test/analyzer.test.ts
npm test -- test/cli.test.ts
npm run test:coverage
npm run crap -- --use-existing-coverage
```

CLI tests build and execute the real binary against temporary projects. The test coverage report instruments the analyzer in the test process; CLI subprocesses do not contribute to it.
