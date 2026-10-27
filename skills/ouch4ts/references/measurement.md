# Measurement conventions

## Score

OUCH stands for Overall Upkeep and Change Hassle. It is derived from CRAP, Change Risk Anti-Patterns, by adding cognitive complexity to the original score:

```text
CRAP = cyclomatic² × (1 - coverage)³ + cyclomatic
```

OUCH retains that coverage penalty and adds a cognitive cost that remains at full coverage:

```text
OUCH = cyclomatic² × (1 - coverage)³ + cyclomatic + cognitive
```

Coverage is a fraction from 0 to 1 in the formula and a percentage in reports. A function with cyclomatic complexity 2, cognitive complexity 1, and 50% coverage scores 3.5. Full coverage leaves the sum of the two complexities. Cognitive complexity of zero preserves the coverage penalty. Higher OUCH scores indicate more maintenance hassle; they do not estimate maintenance hours or the probability of a defect. Classic CRAP score bands do not directly apply to OUCH.

JSON reports contain the score in `ouch`, cyclomatic complexity in `complexity`, and cognitive complexity in `cognitive`, a nonnegative integer. Both complexities remain available when coverage and OUCH are indeterminate.

## Source discovery and cyclomatic complexity

- Discover JavaScript `.js`, `.jsx`, `.mjs`, and `.cjs` files alongside TypeScript `.ts`, `.tsx`, `.mts`, and `.cts` files. Skip `.d.ts`, `.d.mts`, `.d.cts`, `*.test.*`, and `*.spec.*` files. Skip directories named `node_modules`, `.git`, `dist`, `build`, `coverage`, `test`, `tests`, `__tests__`, and `__mocks__`. Directory symlinks are not followed. Source roots are explicit; `tsconfig` and `jsconfig` include and exclude rules are not consulted.
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
