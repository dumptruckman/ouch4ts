# Develop and package ouch4ts

Run development commands from the repository root. Use
[Build the analyzer](analyze-project.md#build-the-analyzer) to select Node,
install dependencies, and compile the package.

## Check a change

Before changing or reviewing code, read the
[coding standards](../CODING_STANDARDS.md). Before committing, read the
[commit guidelines](agents/commit-guidelines.md).

Run the checks required by CI:

```bash
npm run typecheck
npm test
npm run build
npm pack --ignore-scripts --dry-run
```

To run a specific test file, pass its path to Vitest:

```bash
npm test -- test/analyzer.test.ts
npm test -- test/cli.test.ts
```

To generate coverage and inspect the analyzer's own OUCH report, run:

```bash
npm run test:coverage
npm run ouch -- --use-existing-coverage
```

CLI tests use temporary projects to cover reporting, Git comparisons, and caching.
A binary check verifies the executable entry point. Setup and coverage
subprocesses do not contribute to the analyzer's coverage report.

## Inspect the npm package

To build and create a local tarball, run:

```bash
npm pack
```

The build clears `dist` before compilation and rejects type errors. The package
contains compiled JavaScript, TypeScript declarations, the README, package
metadata, and the MIT license. It excludes source files, tests, source maps, and
skill assets. `npm pack --ignore-scripts --dry-run` lists the contents of the
current build without creating a tarball.

## Select a release label

Apply exactly one release label to each PR:

- `release:major` for a major release.
- `release:minor` for a minor release, including breaking changes during `0.x`.
- `release:patch` for a compatible patch release.
- `no release` when the change does not require publication.

For `maintenance/<major>.<minor>` branches, use only `release:patch` or `no release`.
Do not write changeset files for ordinary changes. Labels determine versions,
independently of commit messages. See the [release process](releases.md) for
previews and stable publication.
