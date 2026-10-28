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

Function `Cog`, JSON `cognitive`, includes nested functions and callbacks with the whitepaper's nesting penalties. Nested scores are already included and are not added again. CRAP still uses independent function cyclomatic complexity and line coverage; OUCH adds the full cognitive score.

## File complexity

File cyclomatic complexity follows SonarJS's [file syntax counter](https://github.com/SonarSource/SonarJS/blob/b9f5c7e4d73887a36918aa052ffe02de5c5a0d5d/packages/analysis/src/jsts/analysis/file-artifacts.ts). File cognitive complexity uses the whitepaper rules below.

- File `CC` counts each function with a body, `if`, ternary, loop, switch clause including `default`, and logical `&&`, `||`, or `??` expression across the entire file. Module-level code counts. Empty files score zero. This differs from the function CC rules below: catches, parameter defaults, optional access, and logical assignments add no file CC points. A `default` switch clause adds a file CC point.
- File `Cog` traverses module code and function bodies once, preserving control-flow and nested-function depth. Top-level functions add no function-nesting increment. JavaScript declaration wrappers receive the whitepaper's Appendix A exception. React components and JSX receive the same rules as other functions and expressions.
- `Functions` counts all functions with bodies, including nested callbacks. Signatures and ambient declarations are excluded. Files without functions still appear.

Normal JSON reports contain `entries` for functions and `files` for file metrics. Each file metric has `file`, `complexity`, `cognitive`, and `functions`. File rows sort by descending cognitive complexity, then path. File metrics are independent of coverage and remain numeric when function scores are `N/A`. They are contextual measures of file complexity; file size and function count affect their interpretation. They do not represent a file-level CRAP or OUCH score, and summing function cognitive scores would double-count nested code.

## Source discovery and cyclomatic complexity

- Discover JavaScript `.js`, `.jsx`, `.mjs`, and `.cjs` files alongside TypeScript `.ts`, `.tsx`, `.mts`, and `.cts` files. Skip `.d.ts`, `.d.mts`, `.d.cts`, `*.test.*`, and `*.spec.*` files. Skip directories named `node_modules`, `.git`, `dist`, `build`, `coverage`, `test`, `tests`, `__tests__`, and `__mocks__`. Directory symlinks are not followed. Source roots are explicit; `tsconfig` and `jsconfig` include and exclude rules are not consulted.
- Use repeatable `--exclude '<glob>'` options for generated sources. Patterns match project-relative paths using `/` separators, regardless of the selected source roots. `**/generated/**` skips generated directories; `**/*.generated.{js,ts}` skips matching filenames. Matching includes hidden files and directories and is case-sensitive. Each pattern adds an exclusion; leading `!` is literal, not a re-inclusion rule. Matched directories are pruned and matched files are skipped before reading or parsing, so they appear in neither the table nor saved metrics. Exclusions apply to normal reports, `--since`, and both revisions of `--compare`. Quote patterns to keep the shell from expanding them. Coverage commands still use their own inclusion and exclusion settings.
- The analyzer checks syntax according to each file's extension and uses TypeScript's call resolution to identify recursion across the supplied sources. Semantic type errors do not block reports. It neither executes target source nor loads additional source files, libraries, or project configuration. JavaScript projects need no TypeScript configuration or dependency. TypeScript 6 is pinned in the analyzer because its compiler API parses both languages.
- Measure functions with bodies: declarations, expressions, arrows, methods, constructors, getters, and setters. Skip overload signatures and ambient declarations. Named class methods include their class name. Nested names include their enclosing function; anonymous callbacks include line and column.
- Start complexity at 1. Add 1 for each `if`, ternary, `for`, `for-in`, `for-of`, `while`, `do-while`, `catch`, non-default `case`, `&&`, `||`, `??`, `&&=`, `||=`, `??=`, explicit `?.` step, parameter default, and destructuring default. Count nested functions separately. Comments, strings, and conditional types add nothing.

## Cognitive complexity

The specification is SonarSource's [Cognitive Complexity whitepaper, version 1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf). Appendix B lists the increments and nesting rules, subject to Appendix A's language exceptions. The rules below summarize its application to JavaScript and TypeScript; the whitepaper takes precedence if this summary disagrees. This intentionally differs from SonarJS S3776's independent function scoring.

- Start each reported function at nesting zero. Include its nested functions and callbacks, increasing nesting when entering them. Their decisions contribute to the enclosing function's cognitive score. Separately reported nested functions start at zero for their own score.
- Count decisions in parameter expressions, parameter decorators, and the function body. Computed method names and method decorators contribute to the enclosing function's cognitive score when there is one, rather than the method's own score.
- Add 1 plus the current nesting depth for `if`, loops, `switch`, `catch`, and ternaries. Each `else if` adds 1 without a nesting surcharge; a final `else` adds 1. Their branch bodies increase nesting depth. Loop headers and conditional tests keep their current depth. Switch cases increase nesting depth but add no separate case points. `try` and `finally` add no points or nesting.
- Add 1 for each sequence of `&&` or `||`, including a new sequence when the operator changes. Parentheses do not split a sequence. JSX follows the same rules. Null-coalescing `??` is ignored as shorthand, and boolean expressions inside its operands are scored separately.
- Add 1 per function in a direct or indirect recursion cycle, regardless of the number of recursive calls. The whitepaper defines this increment in its Recursion section and Appendix B.
- A labeled `break` or `continue` adds 1. Unlabeled jumps, early returns, and ordinary calls add no points. Optional chaining, parameter defaults, logical assignments, types, and annotations add no direct points; decisions inside their expressions still count.

Appendix A exempts JavaScript functions used purely as declaration wrappers from function-nesting increments. A wrapper contains only declarations or assignments of functions/classes, with no structural control flow outside its nested functions. Parentheses and TypeScript assertions do not change whether an assignment declares a function or class. Other functions, including ones containing returns or ordinary expression statements, receive normal nesting. Nesting ends when its branch or function ends; SonarJS's retained-nesting quirks are not reproduced.

### Call-resolution limits

The whitepaper does not prescribe a call-resolution algorithm. The analyzer uses TypeScript's symbols and signatures to identify cycles among the supplied sources, including relative imports, typed bindings, methods, overloads, constructors, template tags, and accessor reads/writes.

Bindings written anywhere in those sources are excluded throughout alias lookup, without guessing the order of assignments at runtime. Object calls use the effective property after spreads and repeated property names. A later unresolved spread prevents choosing an earlier property as the target. A conditional callee can contribute to a possible recursion cycle when TypeScript resolves its signature to an implementation; otherwise dynamically selected or unresolved targets are excluded. These are static-analysis choices, not additional whitepaper increments.

## Coverage

- Coverage is the fraction of LCOV `DA` lines with positive hits within the function body's statement range. Declaration-only lines and multiline nested bodies are excluded. Repeated records for an exact file path merge their hits. No basename or suffix guessing is used.
- LCOV cannot distinguish different functions or branches sharing a source line. Nested bodies on a shared line can leave the parent with no independently attributable lines. Empty bodies and functions with no matching executable lines report `N/A`. Coverage does not establish that tests contain useful assertions.
