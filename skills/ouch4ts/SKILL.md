---
name: ouch4ts
description: Report JavaScript and TypeScript file complexity and function maintenance hassle. Use for project reports, changed-source reports, or PR score comparisons.
---

# OUCH for JavaScript and TypeScript

## Choose the report

Identify the package the user wants to analyze and the question the report must answer.

- **How did this PR change maintenance hassle?** Compare committed `HEAD` with the merge
  base of the PR's actual target branch. This measures score changes, including changes due
  to tests alone.
- **What are the scores of the functions I touched?** Request current scores for tracked
  changes since the target reference. This includes staged and unstaged edits. Mention any
  untracked sources the report omits.
- **Where is this project hardest to maintain?** Request current file complexity and
  function scores. Narrow the displayed results if the user asked about a particular path.

## Select the analyzer

1. From the selected package, locate its installed `ouch4ts` binary or one it can run from
   its workspace. Use the verified path, such as `./node_modules/.bin/ouch4ts`, or the
   package manager's local binary command. Check where the command resolves. A global
   executable or an earlier `npx` download does not count. Keep the project's installed
   version.
2. If there is no usable installation, ask
   **"Add `ouch4ts` to this project, or run `ouch4ts@latest` once with `npx`?"** If the
   project already declares the dependency, offer to restore its declared version with the
   project's normal install. Wait for the choice before installing or fetching.
   - **Project install.** Use the project's package manager to add `ouch4ts` as a dev
     dependency of the selected package, or restore the existing dependency as agreed.
     Locate the resulting binary.
   - **One-off.** Use `npx --yes ouch4ts@latest` as the command. npm may download into
     its cache. If npm cannot resolve `latest`, report the failure. If an exact version
     is cached, name the version and ask before using `npx --offline --yes ouch4ts@<version>`.
3. Select a Node runtime that satisfies the analyzer's `engines.node`. Use the chosen
   command with `--version` and `--help`. If you need more detail, consult the matching
   README or `docs/cli.md` at the stable release's `v<version>` tag in the
   [analyzer repository](https://github.com/dumptruckman/ouch4ts).

## Run the report

Inspect the project's source roots, exclusions, package manager, runtime, and coverage
command. Check commands in project configuration before running them. Use the selected
executable's help to supply the arguments for the report.

- For fresh coverage, use the project's runtime and an existing script or installed runner
  that emits LCOV for the original sources. Include untested sources. If coverage needs a
  dependency or config edit, tell the user exactly what is missing.
- For a current report with existing LCOV, check that the paths match the sources and state
  that the report trusts its freshness. If the project needs an older Node, generate LCOV
  with the project's runtime first, then analyze that file with a supported Node.
- For a comparison, inspect the manifest, lockfile, and coverage setup at both revisions.
  On a cache miss the analyzer restores dependencies and runs coverage in a temporary
  worktree for that revision. Use the runtime each revision needs. Identify any missing
  prerequisites before running the comparison.

Once the prerequisites are in place, run the chosen command with the report arguments.

## Project writes

A report request covers analysis output, including coverage, reports, and caches. Choosing
a project install also authorizes its dependency and lockfile changes. The one-off path
needs no project installation. Ask separately before editing scripts, coverage
configuration, source, or tests.

## Interpret the result

Answer the user's question with file paths and function locations. For a project report,
start with the highest file cognitive complexity and function OUCH scores. For a
comparison, show the largest relevant changes alongside their current scores. State which
commits the analyzer measured and which reports it reused from cache.

Report CRAP alongside OUCH. CRAP reflects cyclomatic complexity and line coverage. OUCH
adds cognitive complexity, so a fully covered function can still be hard to follow. Use the
[measurement conventions](references/measurement.md) to explain a score.

For `N/A`, check LCOV inclusion, paths, and source maps before drawing conclusions about
tests. LCOV counts executable lines. A hit alone tells you nothing about what a test
asserted.

## License

This skill and its references use [0BSD](LICENSE). The published analyzer uses MIT.
