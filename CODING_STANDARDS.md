# Coding standards

## Code clarity

- Keep each function at one level of abstraction. High-level functions should describe the steps of an operation;
  helpers should contain the mechanics of those steps. Separate domain decisions from the actions that apply
  them when doing so makes the caller clearer. For example, `defaultCoverageCommand` chooses the coverage command,
  while `updateCoverage` runs it and checks that it updated the report.
- Extract helpers around meaningful concepts. A helper should name an operation or decision so the caller can be
  understood without reading its implementation. A helper can be useful with only one caller.
- Express compound domain conditions as named predicates when the name explains the decision better than the
  inline expression. Prefer positive names such as `canResolveMissingPath` or `isCallableImplementation` so callers
  can state when an action applies. Keep guard clauses when they make control flow clearer; do not replace them
  with nested positive branches just to avoid negation.
- Make helper contracts self-contained. Handle the inputs permitted by the parameter types, or narrow those types
  to express the required preconditions. A helper accepting `unknown` should not rely on an undocumented caller
  check to safely handle `null`. Predicates must return `true` or `false` for every permitted input, including
  absent values when the parameter type permits them. For example, `isManifestObject` rejects `null` and arrays
  itself. `isCallableImplementation` checks `node !== undefined` before inspecting the node. Do not let `undefined`
  leak through an expression such as `node && hasImplementation(node)`.
- Prefer established library utilities when they clearly express the intended operation. Check the libraries
  already in use before duplicating their functionality. Use TypeScript's node guards and `ts.forEachChild` for
  AST inspection, and `picomatch` for exclusion globs.
- Prefer functional array construction when each output can be derived directly from its input. Use `map`, `filter`,
  or `flatMap` for transformations and spread to combine named groups in their intended order. Use `reduce` when
  accumulation is the natural operation. Avoid mixing these approaches with `push` or `pop` mutation while building
  the same result. For example, `definitionExpressions` combines computed-name expressions with mapped decorator
  expressions using spread. Keep loops when they express stateful or sequential work more clearly, as `readLcov`
  does when reading records.
- Name variables for their role at the point of use. Prefer names that explain what a value represents over vague
  relationship names that require readers to trace the assignment. Name functions for the operation or decision
  they perform, including scope and boundaries callers need to understand. For example, `matchesFile` and
  `matchesFunction` distinguish a file with changed lines from a function whose line range overlaps a change.
  `isStructural` checks one node, while `hasStructuralCode` also searches descendants, skipping nested function
  bodies.
- Extract for understanding, not line count. Keep straightforward code inline when a helper would add navigation
  without adding meaning. Do not introduce helpers solely to satisfy a function-length or complexity target.

Apply these rules with judgment. In reviews, identify the concrete ambiguity, hidden assumption, or unnecessary
navigation a change introduces. A short helper is not automatically needless indirection, and a long function is
not automatically unclear.

## Tests

- Use `test.each` or `describe.each` when multiple independent cases share the same test structure and differ
  mainly in inputs and/or expected outcomes. Use ordinary tests for single cases or distinct behaviors. Keep batch
  tests when verifying interactions requires multiple entries in one execution. For example, analyze mutually
  recursive modules together to verify the call cycle and a caller outside it.
- When a test covers multiple input/output cases, keep each case's setup and expected outcome together in one
  case table. For tests that execute a batch, derive the input and expected-result arrays from that table instead
  of maintaining separate arrays matched by position. Apply this to nested data such as table rows too. Keep
  expected outcomes explicit and independent of the behavior under test. For example, pair each scoring case's
  function body and LCOV input with literal expected complexity, coverage, CRAP, and OUCH values.
