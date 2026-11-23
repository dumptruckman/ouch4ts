# Measurement conventions

## Score

OUCH stands for Overall Upkeep and Change Hassle. It adds cognitive complexity
to CRAP, Change Risk Anti-Patterns:

```text
CRAP = cyclomatic² × (1 - coverage)³ + cyclomatic
```

OUCH retains that coverage penalty and adds a cognitive cost that remains at full coverage:

```text
OUCH = CRAP + cognitive
```

Coverage is a fraction from 0 to 1 in the formula and a percentage in reports.
A function with cyclomatic complexity 2, cognitive complexity 1, and 50% coverage
scores 2.5 CRAP and 3.5 OUCH. Full coverage leaves CRAP at cyclomatic complexity
and OUCH at the sum of the two complexities. Cognitive complexity of zero makes
the scores equal.

Higher OUCH scores indicate more maintenance hassle. They do not estimate
maintenance hours or defect probability. Classic CRAP score bands do not
directly apply to OUCH.

Tables show `CRAP` and `OUCH`. JSON reports contain `crap` and `ouch`. When
coverage is indeterminate, both scores are `null` in JSON and `N/A` in tables.
Cyclomatic complexity in `complexity` and cognitive complexity in `cognitive`
remain available. Cognitive complexity is a nonnegative integer. Current function
reports sort by descending OUCH.

Function `Cog`, the JSON `cognitive` field, includes nested functions and
callbacks with the whitepaper's nesting penalties. Nested scores are already
included. CRAP uses independent function cyclomatic complexity and line coverage.
OUCH adds the full cognitive score.

## File complexity

File cyclomatic complexity follows SonarJS's
[file syntax counter](https://github.com/SonarSource/SonarJS/blob/b9f5c7e4d73887a36918aa052ffe02de5c5a0d5d/packages/analysis/src/jsts/analysis/file-artifacts.ts).
File cognitive complexity uses the whitepaper rules below. The file table has
these columns:

- File `CC` counts each function with a body, `if`, ternary, loop, switch clause,
  and logical `&&`, `||`, or `??` expression. Switch clauses include `default`.
  Module-level code counts. Empty files score zero. Unlike function CC, file CC
  adds no points for catches, parameter defaults, optional access, or logical
  assignments.
- File `Cog` traverses module code and function bodies once, preserving
  control-flow and nested-function depth. Top-level functions add no
  function-nesting increment. JavaScript declaration wrappers receive the
  whitepaper's Appendix A exception. React components and JSX receive the same
  rules as other functions and expressions.
- `Functions` counts all functions with bodies, including nested callbacks. Signatures and ambient declarations are excluded. Files without functions still appear.

Normal JSON reports contain `entries` for functions and `files` for file metrics.
Each file metric has `file`, `complexity`, `cognitive`, and `functions`. File rows
sort by descending cognitive complexity, then path. File metrics are independent
of coverage and remain numeric when function scores are `N/A`.

File size and function count affect how file complexity is interpreted. File
metrics do not represent a file-level CRAP or OUCH score. Summing function
cognitive scores would double-count nested code.

## Source discovery and cyclomatic complexity

### Source discovery

The analyzer discovers JavaScript `.js`, `.jsx`, `.mjs`, and `.cjs` files and
TypeScript `.ts`, `.tsx`, `.mts`, and `.cts` files. It skips `.d.ts`, `.d.mts`,
`.d.cts`, `*.test.*`, and `*.spec.*` files.

Excluded directory names are `node_modules`, `.git`, `dist`, `build`, `coverage`,
`test`, `tests`, `__tests__`, and `__mocks__`. Directory symlinks are not followed.
Source roots are explicit. Discovery does not use `tsconfig` or `jsconfig`
inclusion and exclusion rules.

### Syntax and function identity

The analyzer checks syntax according to each file's extension. It uses
TypeScript's call resolution to identify recursion across supplied sources.
Semantic type errors do not block reports. The analyzer does not execute target
source or load additional sources, libraries, or project configuration.
JavaScript projects need no TypeScript configuration or dependency. The analyzer
pins TypeScript 6 because its compiler API parses both languages.

Measured functions have bodies and include declarations, expressions, arrows,
methods, constructors, getters, and setters. Overload signatures and ambient
declarations are excluded. Named class methods include their class name. Nested
names include the enclosing function. Anonymous callback names include line and
column.

### Function cyclomatic complexity

Function complexity starts at 1. Each of these constructs adds 1:

- `if`, ternary, `for`, `for-in`, `for-of`, `while`, `do-while`, `catch`, and
  non-default `case`.
- `&&`, `||`, `??`, `&&=`, `||=`, and `??=`.
- Each explicit `?.` step.
- Parameter defaults and destructuring defaults.

Nested functions are counted separately. Comments, strings, and conditional
types add nothing.

## Cognitive complexity

The specification is SonarSource's
[Cognitive Complexity whitepaper, version 1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf).
Appendix B lists increments and nesting rules, subject to Appendix A's language
exceptions. The following rules summarize their application to JavaScript and
TypeScript. The whitepaper takes precedence if this summary disagrees. This
scoring differs from SonarJS S3776's independent function scores.

- Each reported function starts at nesting zero. Nested functions and callbacks
  increase nesting when entered. Their decisions contribute to the enclosing
  function's cognitive score. Separately reported nested functions start at zero
  for their own score.
- Decisions count in parameter expressions, parameter decorators, and the
  function body. Computed method names and method decorators contribute to the
  enclosing function's cognitive score when one exists. They do not contribute
  to the method's own score.
- Each `if`, loop, `switch`, `catch`, and ternary adds 1 plus the current nesting
  depth. Each `else if` adds 1 without a nesting surcharge. A final `else`
  adds 1. Their branch bodies increase nesting depth. Loop headers and conditional
  tests keep their current depth. Switch cases increase nesting depth but add no
  separate case points. `try` and `finally` add no points or nesting.
- Each sequence of `&&` or `||` adds 1. An operator change starts a new sequence.
  Parentheses and TypeScript's type-only expression wrappers preserve a sequence,
  including `as`, `satisfies`, angle-bracket assertions, and non-null assertions.
  JSX follows the same rules. Null-coalescing `??` is ignored as shorthand.
  Boolean expressions inside its operands are scored separately.
- Each function in a direct or indirect recursion cycle adds 1, regardless of
  the number of recursive calls. The whitepaper defines this increment in its
  Recursion section and Appendix B.
- A labeled `break` or `continue` adds 1. Unlabeled jumps, early returns, and
  ordinary calls add no points. Optional chaining, parameter defaults, logical
  assignments, types, and annotations add no direct points. Decisions inside
  their expressions still count.

Appendix A exempts JavaScript functions used purely as declaration wrappers from
function-nesting increments. A wrapper contains only declarations or assignments
of functions or classes, with no structural control flow outside nested
functions. Parentheses and TypeScript assertions do not change whether an
assignment declares a function or class.

Other functions, including those with returns or ordinary expression statements,
receive normal nesting. Nesting ends when its branch or function ends. The
analyzer does not reproduce SonarJS's retained-nesting behavior.

### Call-resolution limits

The whitepaper does not prescribe a call-resolution algorithm. The analyzer uses
TypeScript's symbols and signatures to identify cycles among supplied sources.
Resolution includes relative imports, typed bindings, methods, overloads,
constructors, template tags, and accessor reads and writes.

Bindings written anywhere in those sources are excluded throughout alias lookup.
The analyzer does not guess assignment order at runtime. Writes include
assignments, updates, destructuring targets, and existing bindings used as
`for-in` or `for-of` targets. Default initializers and computed property keys in
destructuring are reads. They preserve recursion detection for the bindings they
reference.

Object calls use the effective property after spreads and repeated property
names. A later unresolved spread prevents choosing an earlier property as the
target. A conditional callee can contribute to a possible recursion cycle when
TypeScript resolves its signature to an implementation. Otherwise, dynamically
selected or unresolved targets are excluded. These are static-analysis choices,
without additional whitepaper increments.

## Coverage

Coverage is the fraction of LCOV `DA` lines with positive hits within the
function body's statement range. Declaration-only lines and multiline nested
bodies are excluded. Repeated records for an exact file path merge their hits.
The analyzer does not guess matches by basename or suffix.

LCOV cannot distinguish functions or branches that share a source line. Nested
bodies on a shared line can leave the parent with no independently attributable
lines. Empty bodies and functions with no matching executable lines report
`N/A`. Coverage does not establish that tests contain useful assertions.
