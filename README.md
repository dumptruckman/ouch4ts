# ouch4ts

`ouch4ts` reports file complexity and function maintenance scores for JavaScript,
TypeScript, and mixed projects. It provides a CLI, a typed ESM API, and an
[agent skill](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/SKILL.md).
The analyzer requires Node 22 or newer.

OUCH stands for Overall Upkeep and Change Hassle. It adds cognitive complexity to
CRAP, Change Risk Anti-Patterns:

```text
OUCH = cyclomatic² × (1 - coverage)³ + cyclomatic + cognitive
```

Coverage is a fraction from 0 to 1 in the formula. A function with cyclomatic
complexity 2, cognitive complexity 1, and 50% coverage scores 3.5. Higher scores
identify functions worth examining for missing tests or simpler control flow.
Scores do not estimate maintenance hours or defect probability.

The scoring draws on [Uncle Bob's crap4clj](https://github.com/unclebob/crap4clj)
and [SonarSource's Cognitive Complexity whitepaper, version 1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf).

## Documentation

The guides and references cover these tasks and details:

- [Analyze a project](https://github.com/dumptruckman/ouch4ts/blob/main/docs/analyze-project.md):
  build the analyzer, generate reports, compare commits, and install the agent skill.
- [CLI reference](https://github.com/dumptruckman/ouch4ts/blob/main/docs/cli.md):
  options, configuration, report fields, filtering, and exit codes.
- [Library reference](https://github.com/dumptruckman/ouch4ts/blob/main/docs/library.md):
  `analyze`, `analyzeReport`, and `AnalysisOptions`.
- [Measurement conventions](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/references/measurement.md):
  score formulas, complexity rules, source selection, and coverage limits.
- [Develop and package ouch4ts](https://github.com/dumptruckman/ouch4ts/blob/main/docs/development.md):
  local checks, package contents, and release labels.
- [Release process](https://github.com/dumptruckman/ouch4ts/blob/main/docs/releases.md):
  previews, stable releases, maintenance branches, and publication recovery.

## Licenses

The analyzer and root npm package use the
[MIT license](https://github.com/dumptruckman/ouch4ts/blob/main/LICENSE).
The companion skill and all files under `skills/ouch4ts` use the separate
[0BSD license](https://github.com/dumptruckman/ouch4ts/blob/main/skills/ouch4ts/LICENSE).
The npm package excludes skill assets.
