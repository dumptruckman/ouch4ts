# Measurement conventions

## Score

OUCH stands for Overall Upkeep and Change Hassle. It is derived from CRAP, Change Risk Anti-Patterns, by adding cognitive complexity to the original score:

```text
CRAP = cyclomatic² × (1 - coverage)³ + cyclomatic
```

OUCH retains that coverage penalty and adds a cognitive cost that remains at full coverage:

```text
OUCH = CRAP + cognitive
```

Coverage is a fraction from 0 to 1 in the formula and a percentage in reports. A function with cyclomatic complexity 2, cognitive complexity 1, and 50% coverage scores 2.5 CRAP and 3.5 OUCH. Full coverage leaves CRAP at cyclomatic complexity and OUCH at the sum of the two complexities. Cognitive complexity of zero makes the scores equal. Higher OUCH scores indicate more maintenance hassle; they do not estimate maintenance hours or the probability of a defect. Classic CRAP score bands do not directly apply to OUCH.

Tables show `CRAP` and `OUCH`; JSON reports contain `crap` and `ouch`. Both scores are `null` in JSON and `N/A` in tables when coverage is indeterminate. Cyclomatic complexity in `complexity` and cognitive complexity in `cognitive`, a nonnegative integer, remain available. Current reports sort by OUCH.

Function `Cog incl`, JSON `inclusiveCognitive`, sums the function's own cognitive score and the independent scores of all lexically nested functions, counting each once. It resets nesting at each function boundary and adds no function-nesting surcharge. It explains logic inside callbacks when the enclosing function's own score is low. CRAP and OUCH use only independent function complexity and coverage. File metrics use the separate aggregation below.

## File complexity

The file summary follows SonarJS's [file syntax counter](https://github.com/SonarSource/SonarJS/blob/b9f5c7e4d73887a36918aa052ffe02de5c5a0d5d/packages/analysis/src/jsts/analysis/file-artifacts.ts) and [S3776 file aggregation](https://github.com/SonarSource/SonarJS/blob/b9f5c7e4d73887a36918aa052ffe02de5c5a0d5d/packages/analysis/src/jsts/rules/S3776/rule.ts), using the TypeScript AST and the cognitive syntax conventions below.

- File `CC` counts each function with a body, `if`, ternary, loop, switch clause including `default`, and logical `&&`, `||`, or `??` expression across the entire file. Module-level code counts. Empty files score zero. This differs from the function CC rules below: catches, parameter defaults, optional access, and logical assignments add no file CC points. A `default` switch clause adds a file CC point.
- File `Cog` includes module-level control flow and each top-level function with its descendants. When the top-level function has its own structural control flow, nested structural decisions receive an additional nesting point. Otherwise its immediate nested functions contribute without that outer-function surcharge. Function nesting below those immediate children still increases nesting depth. Logical-only complexity does not trigger the outer-function surcharge.
- React function components receive the treatment without the outer-function surcharge. Following SonarJS, recognition requires a function name or variable identifier starting with an uppercase character and an explicit return of a JSX element or fragment from that function. A nested callback's JSX return does not identify the outer function as a component.
- `Functions` counts all functions with bodies, including nested callbacks. Signatures and ambient declarations are excluded. Files without functions still appear.

Normal JSON reports contain `entries` for functions and `files` for file metrics. Each file metric has `file`, `complexity`, `cognitive`, and `functions`. File rows sort by descending cognitive complexity, then path. File metrics are independent of coverage and remain numeric when function scores are `N/A`. They are contextual measures of file complexity; file size and function count affect their interpretation. They do not represent a file-level CRAP or OUCH score, and summing inclusive function scores would double-count nested code.

## Source discovery and cyclomatic complexity

- Discover JavaScript `.js`, `.jsx`, `.mjs`, and `.cjs` files alongside TypeScript `.ts`, `.tsx`, `.mts`, and `.cts` files. Skip `.d.ts`, `.d.mts`, `.d.cts`, `*.test.*`, and `*.spec.*` files. Skip directories named `node_modules`, `.git`, `dist`, `build`, `coverage`, `test`, `tests`, `__tests__`, and `__mocks__`. Directory symlinks are not followed. Source roots are explicit; `tsconfig` and `jsconfig` include and exclude rules are not consulted.
- Use repeatable `--exclude '<glob>'` options for generated sources. Patterns match project-relative paths using `/` separators, regardless of the selected source roots. `**/generated/**` skips generated directories; `**/*.generated.{js,ts}` skips matching filenames. Matching includes hidden files and directories and is case-sensitive. Each pattern adds an exclusion; leading `!` is literal, not a re-inclusion rule. Matched directories are pruned and matched files are skipped before reading or parsing, so they appear in neither the table nor saved metrics. Exclusions apply to normal reports, `--since`, and both revisions of `--compare`. Quote patterns to keep the shell from expanding them. Coverage commands still use their own inclusion and exclusion settings.
- The analyzer checks syntax according to each file's extension, without typechecking or executing target source. JavaScript projects need no TypeScript configuration or dependency. TypeScript 6 is pinned in the analyzer because its compiler API parses both languages.
- Measure functions with bodies: declarations, expressions, arrows, methods, constructors, getters, and setters. Skip overload signatures and ambient declarations. Named class methods include their class name. Nested names include their enclosing function; anonymous callbacks include line and column.
- Start complexity at 1. Add 1 for each `if`, ternary, `for`, `for-in`, `for-of`, `while`, `do-while`, `catch`, non-default `case`, `&&`, `||`, `??`, `&&=`, `||=`, `??=`, explicit `?.` step, parameter default, and destructuring default. Count nested functions separately. Comments, strings, and conditional types add nothing.

## Cognitive complexity

The counter uses the existing TypeScript AST with [SonarJS S3776-style conventions](https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/S3776/rule.ts):

- Start each function at zero. Score nested functions independently, resetting their nesting depth and excluding their decisions from the parent.
- Count decisions in parameter expressions, parameter decorators, and the function body. Computed method names and method decorators contribute to the enclosing function's cognitive score when there is one, rather than the method's own score.
- Add 1 plus the current nesting depth for `if`, loops, `switch`, `catch`, and ternaries. Each `else if` adds 1 without a nesting surcharge; a final `else` adds 1. Their branch bodies increase nesting depth. Loop headers and conditional tests keep their current depth. Switch cases increase nesting depth but add no separate case points. `try` and `finally` add no points or nesting.
- Add 1 for each logical `&&` sequence, including a new sequence after a different logical operator. Parentheses do not split a sequence. `||` and `??` add no points. Uniform logical chains directly inside a JSX expression are treated as conditional-rendering shorthand and add no logical points; mixed operators and ternaries receive their usual counts.
- A labeled `break` or `continue` adds 1. Unlabeled jumps, early returns, calls, and recursion add no points. Optional chaining, parameter defaults, logical assignments, types, and annotations add no direct points; decisions inside their expressions still count.

These rules define this tool's measurement. Function-valued ternary branches keep subsequent statements at their original nesting depth, intentionally differing from SonarJS 4.0.3's extra nesting point in that case. Other cognitive algorithms and IDE percentage displays can produce different values.

## Coverage

- Coverage is the fraction of LCOV `DA` lines with positive hits within the function body's statement range. Declaration-only lines and multiline nested bodies are excluded. Repeated records for an exact file path merge their hits. No basename or suffix guessing is used.
- LCOV cannot distinguish different functions or branches sharing a source line. Nested bodies on a shared line can leave the parent with no independently attributable lines. Empty bodies and functions with no matching executable lines report `N/A`. Coverage does not establish that tests contain useful assertions.
