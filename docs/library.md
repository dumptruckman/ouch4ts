# Library reference

The `ouch4ts` package supports ESM only. Its named root exports are `analyze`,
`analyzeReport`, and the `AnalysisOptions` type. Internal modules are private.

## AnalysisOptions

Both functions accept the same options:

| Property | Type | Meaning |
| --- | --- | --- |
| `sources` | `readonly { path: string; text: string }[]` | Original JavaScript or TypeScript source paths and text |
| `lcov` | `string` | LCOV text mapped to those sources |
| `projectRoot` | `string`, optional | Root for source and LCOV paths. Defaults to `process.cwd()` |

The analyzer parses supplied text without reading target source files from disk
or executing them. It rejects invalid source syntax and LCOV. Semantic type errors
do not block reports.

## analyze

`analyze(options)` returns the function entries written by the CLI:

```ts
import { analyze } from "ouch4ts";

const entries = analyze({
	sources: [{
		path: "src/orders.ts",
		text: "export const price = (amount: number) => amount > 0 ? amount : 0;",
	}],
	lcov: "SF:src/orders.ts\nDA:1,1\nend_of_record\n",
	projectRoot: "/absolute/path/to/project",
});
```

Entries sort by descending OUCH, then file and line. Unknown scores come last.
The [function fields](cli.md#function-fields) describe each entry.

## analyzeReport

`analyzeReport(options)` returns `{ entries, files }` from the same analysis.
`entries` contains the function scores, and `files` contains
[file metrics](cli.md#file-fields).

## Compatibility

The public contract covers the package's root exports and their types, documented
CLI and configuration behavior, returned metrics, and saved JSON formats.
Starting with `1.0.0`, breaking changes require a major release. Minor releases
can add compatible features. Patch releases can fix bugs.

The [measurement conventions](measurement.md) define how the analyzer calculates
each metric. Changing a rule for an existing metric requires a major release.
For example, excluding nested callbacks from their enclosing function's
cognitive complexity would change that rule.

A patch can correct a calculation that disagrees with a published rule. The
same source and coverage can then produce a different score after an upgrade.
Release notes for scoring fixes identify the affected metrics and the cases
where scores can change. The top-level `analyzerVersion` field in the CLI's
saved reports and JSON stdout identifies the release that generated the report.
Older reports can lack this field.

During `0.x`, breaking changes require a minor release. Patch releases preserve
compatibility.
