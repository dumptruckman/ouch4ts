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

During `0.x`, breaking changes to the API, CLI, returned metrics, or saved JSON
require a minor release. Patch releases preserve compatibility.
