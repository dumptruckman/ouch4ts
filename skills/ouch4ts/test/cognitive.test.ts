import { expect, test } from "vitest";
import { analyze, analyzeReport } from "../src/index.js";

test("includes callback nesting in the enclosing function's whitepaper score and OUCH", () => {
  const report = analyzeReport({
    sources: [{ path: "src/callback.ts", text: `function outer() {
  values.map(value => {
    if (value) return 1;
    return 0;
  });
  return values;
}` }],
    lcov: "SF:src/callback.ts\nDA:2,1\nDA:3,1\nDA:4,1\nDA:6,1\nend_of_record\n",
  });
  expect(report.entries.find(entry => entry.name === "outer")).toMatchObject({
    complexity: 1, cognitive: 2, coverage: 100, crap: 1, ouch: 3,
  });
  expect(report.files).toEqual([{ file: "src/callback.ts", complexity: 3, cognitive: 2, functions: 2 }]);
});

test("applies the whitepaper's JavaScript declaration-wrapper exception", () => {
  const report = analyzeReport({
    sources: [{ path: "src/namespace.js", text: `function namespace() {
  var stored;
  holder.run = function () {
    if (ready) work();
  };
}` }],
    lcov: "SF:src/other.js\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries.find(entry => entry.name === "namespace")).toMatchObject({
    cognitive: 1,
  });
  expect(report.files).toEqual([{ file: "src/namespace.js", complexity: 3, cognitive: 1, functions: 2 }]);
});

test.each([
  { expression: "a || b", cognitive: 1 },
  { expression: "a && b || c && d", cognitive: 3 },
  { expression: "<div>{a && b && <span />}</div>", cognitive: 1 },
])("counts whitepaper logical sequences in $expression", ({ expression, cognitive }) => {
  const report = analyzeReport({
    sources: [{ path: "src/logic.tsx", text: `function sample() { return ${expression}; }` }],
    lcov: "SF:src/logic.tsx\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries[0]).toMatchObject({ cognitive });
  expect(report.files[0]?.cognitive).toBe(cognitive);
});

test("adds one whitepaper recursion point per function, regardless of call count", () => {
  const report = analyzeReport({
    sources: [{ path: "src/recursive.ts", text: "function repeat() { repeat(); repeat(); }" }],
    lcov: "SF:src/recursive.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries[0]).toMatchObject({ cognitive: 1, crap: 1, ouch: 2 });
  expect(report.files).toEqual([{ file: "src/recursive.ts", complexity: 1, cognitive: 1, functions: 1 }]);
});

test.each(["js", "ts"])("finds mutual recursion across .%s modules without charging callers outside the cycle", extension => {
  const report = analyzeReport({
    sources: [
      { path: `src/first.${extension}`, text: "import { second } from './second.js';\nexport function first() { second(); }" },
      { path: `src/second.${extension}`, text: "import { first } from './first.js';\nexport function second() { first(); }" },
      { path: `src/observer.${extension}`, text: "import { first } from './first.js';\nexport function observer() { first(); }" },
    ],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(Object.fromEntries(report.entries.map(entry => [entry.name, entry.cognitive]))).toEqual({
    first: 1, second: 1, observer: 0,
  });
});

test("resolves recursive methods and aliases without mistaking a shadowed function for recursion", () => {
  const report = analyzeReport({
    sources: [{ path: "src/scopes.ts", text: `function repeat() { const repeat = () => 0; repeat(); }
const invoke = recursive;
function recursive() { invoke(); }
class Worker { run() { return this.run(); } }` }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(Object.fromEntries(report.entries.map(entry => [entry.name, entry.cognitive]))).toEqual({
    repeat: 0, "repeat.repeat": 0, recursive: 1, "Worker.run": 1,
  });
});

test("keeps parameter control flow from qualifying as a declaration-only wrapper", () => {
  const report = analyzeReport({
    sources: [{ path: "src/default.ts", text: "function outer(value = a ? b : c) { function inner() { if (ready) work(); } }" }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries.find(entry => entry.name === "outer")).toMatchObject({ cognitive: 3 });
});

test.each([
  { name: "overloaded functions", text: "function repeat(n: number): number; function repeat(n: number) { return repeat(n); }" },
  { name: "constructors", text: "class Loop { constructor() { new Loop(); } }" },
  { name: "overloaded constructors", text: "class Loop { constructor(n: number); constructor(n: number) { new Loop(n); } }" },
  { name: "template tags", text: "function repeat() { return repeat`again`; }" },
])("resolves recursion through $name", ({ text }) => {
  const report = analyzeReport({
    sources: [{ path: "src/recursive.ts", text }],
    lcov: "SF:src/recursive.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries[0]).toMatchObject({ cognitive: 1, ouch: 2 });
});

test("resolves an overloaded function selected by a conditional call", () => {
  const report = analyzeReport({
    sources: [{ path: "src/recursive.ts", text: `function repeat(n: number): number;
function repeat(n: number) { return (choose ? repeat : other)(n); }
function other(n: number) { return n; }` }],
    lcov: "SF:src/recursive.ts\nDA:2,1\nDA:3,1\nend_of_record\n",
  });
  expect(report.entries).toMatchObject([
    { name: "repeat", complexity: 2, cognitive: 2, crap: 2, ouch: 4 },
    { name: "other", complexity: 1, cognitive: 0, crap: 1, ouch: 1 },
  ]);
});

test.each([
  "class Box { get value() { return this.value; } }",
  "class Box { set value(v) { this.value = v; } }",
  "class Box { get value() { return this['value']; } }",
])("counts recursive accessor invocations in %s", text => {
  const report = analyzeReport({
    sources: [{ path: "src/accessor.ts", text }],
    lcov: "SF:src/accessor.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries[0]).toMatchObject({ cognitive: 1, ouch: 2 });
});

test.each([
  "const repeat: () => number = () => repeat();",
  "let repeat: () => number = () => repeat();",
  "const obj: { repeat(): number } = { repeat() { return obj.repeat(); } };",
  "class Worker { repeat: () => number = () => this.repeat(); }",
])("finds recursive implementations behind explicit types in %s", text => {
  const report = analyzeReport({
    sources: [{ path: "src/typed.ts", text }],
    lcov: "SF:src/typed.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries[0]).toMatchObject({ cognitive: 1, ouch: 2 });
});

test.each([
  { text: "function repeat() { repeat = () => 0; return repeat(); }", cognitive: [0, 0] },
  { text: "let obj = { get value() { obj = { value: 0 }; return obj.value; } };", cognitive: [0] },
])("does not infer a recursion cycle through reassigned bindings in $text", ({ text, cognitive }) => {
  const report = analyzeReport({
    sources: [{ path: "src/reassigned.ts", text }],
    lcov: "SF:src/reassigned.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries.map(entry => entry.cognitive)).toEqual(cognitive);
});

test("resolves element-access keys by value instead of the key variable's name", () => {
  const report = analyzeReport({
    sources: [{ path: "src/key.ts", text: `const key = 'other';
const obj: { key(): number; other(): number } = {
  key() { return obj[key](); }, other() { return 0; }
};` }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries.map(entry => entry.cognitive)).toEqual([0, 0]);
});

test("distinguishes getter reads from setter writes on an explicitly typed object", () => {
  const report = analyzeReport({
    sources: [{ path: "src/accessors.ts", text: `const obj: { value: number } = {
  get value() { return 0; }, set value(v) { obj.value = v; }
};` }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(Object.fromEntries(report.entries.map(entry => [entry.name, entry.cognitive]))).toEqual({
    "get value": 0, "set value": 1,
  });
});

test.each([
  { text: "class Box { get value() { ({value: this.value} = {value: 1}); return 0; } set value(v) {} }",
    cognitive: { "Box.get value": 0, "Box.set value": 0 } },
  { text: "class Box { set value(v) { ({value: this.value} = {value: v}); } }",
    cognitive: { "Box.set value": 1 } },
])("recognizes accessor writes inside destructuring assignment in $text", ({ text, cognitive }) => {
  const report = analyzeReport({
    sources: [{ path: "src/accessor.ts", text }],
    lcov: "SF:src/accessor.ts\nDA:1,1\nend_of_record\n",
  });
  expect(Object.fromEntries(report.entries.map(entry => [entry.name, entry.cognitive]))).toEqual(cognitive);
});

test("includes nested function decisions in whitepaper cognitive scores while keeping CC independent", () => {
  const report = analyzeReport({
    sources: [{ path: "src/nested.ts", text: `function outer() {
  if (flag) work();
  function inner() {
    if (other) work();
  }
}` }],
    lcov: "SF:src/nested.ts\nDA:2,1\nDA:4,1\nend_of_record\n",
  });
  expect(report).toMatchObject({
    files: [{ file: "src/nested.ts", complexity: 4, cognitive: 3, functions: 2 }],
    entries: [
      { name: "outer", complexity: 2, cognitive: 3, crap: 2, ouch: 5 },
      { name: "outer.inner", complexity: 2, cognitive: 1, crap: 2, ouch: 3 },
    ],
  });
});

test.each([
  { name: "a parenthesized arrow in the consequent", expression: "a ? (() => true) : other", cognitive: 2, ouch: 5,
    fileComplexity: 4, functions: 2 },
  { name: "a function expression in the alternate", expression: "a ? other : function () { return true; }", cognitive: 2, ouch: 5,
    fileComplexity: 4, functions: 2 },
  { name: "functions in both branches", expression: "a ? () => true : () => false", cognitive: 2, ouch: 5,
    fileComplexity: 5, functions: 3 },
])("restores whitepaper nesting after $name", ({ expression, cognitive, ouch, fileComplexity, functions }) => {
  const report = analyzeReport({
    sources: [{ path: "src/branch.ts", text: `function sample() {
  const selected = ${expression};
  if (b) {}
}` }],
    lcov: "SF:src/branch.ts\nDA:2,1\nDA:3,1\nend_of_record\n",
  });
  expect(report.entries.find(entry => entry.name === "sample")).toMatchObject({
    complexity: 3, cognitive, crap: 3, ouch,
  });
  expect(report.files).toEqual([{ file: "src/branch.ts", complexity: fileComplexity, cognitive: 2, functions }]);
});

test("restores file nesting after a nested function-valued branch", () => {
  const report = analyzeReport({
    sources: [{ path: "src/branch.ts", text: `function outer() {
  function sample() {
    const selected = a ? () => true : other;
    if (b) {}
  }
  if (c) {}
}` }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.files).toEqual([{ file: "src/branch.ts", complexity: 6, cognitive: 5, functions: 3 }]);
});

test.each([
  { path: "src/branch.js", statement: "if (a) function nested() {}", cognitive: 2, fileCognitive: 5 },
  { path: "src/branch.ts", statement: "if (a) {} else function nested() {}", cognitive: 3, fileCognitive: 6 },
])("restores nesting after functions used directly as control-flow bodies in $path", ({ path, statement, cognitive, fileCognitive }) => {
  const report = analyzeReport({
    sources: [{ path, text: `function outer() {
  function middle() {
    ${statement}
    if (b) {}
  }
  if (c) {}
}` }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(report.entries.find(entry => entry.name === "outer.middle")).toMatchObject({
    cognitive,
  });
  expect(report.files).toEqual([{ file: path, complexity: 6, cognitive: fileCognitive, functions: 3 }]);
});

test.each([
  { name: "a declaration-only outer function", text: "function outer() { function inner() { if (a) {} } }", cognitive: 1 },
  { name: "a logical-only outer function", text: "function outer() { a && b; function inner() { if (c) {} } }", cognitive: 3 },
  { name: "control flow after the nested function", text: "function outer() { function inner() { if (a) {} } if (b) {} }", cognitive: 3 },
  { name: "deeper declaration-wrapper nesting", text: "function outer() { function middle() { function inner() { if (a) {} } } }", cognitive: 1 },
  { name: "a callback inside a conditional", text: "function outer() { if (a) { values.map(v => { if (v) work(); }); } }", cognitive: 4 },
  { name: "a nested alternative", text: "function outer() { if (a) {} function inner() { if (b) {} else {} } }", cognitive: 4 },
])("uses whitepaper file aggregation for $name", ({ text, cognitive }) => {
  const report = analyzeReport({ sources: [{ path: "src/nested.ts", text }], lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n" });
  expect(report.files[0]?.cognitive).toBe(cognitive);
});

test.each([
  { name: "a declaration", text: "function View() { if (a) {} function handler() { if (b) {} } return <div />; }" },
  { name: "an arrow", text: "const View = () => { if (a) {} const handler = () => { if (b) {} }; return <>Hello</>; };" },
  { name: "a parenthesized arrow", text: "const View = (() => { if (a) {} const handler = () => { if (b) {} }; return <div />; });" },
  { name: "a parenthesized function expression", text: "const View = (function () { if (a) {} const handler = () => { if (b) {} }; return <div />; });" },
])("applies whitepaper nesting to a React component defined as $name", ({ text }) => {
  const report = analyzeReport({ sources: [{ path: "src/view.tsx", text }], lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n" });
  expect(report.files).toEqual([{ file: "src/view.tsx", complexity: 4, cognitive: 3, functions: 2 }]);
});

test("counts Sonar file CC across module code, defaults, and functions without counting TypeScript syntax", () => {
  const report = analyzeReport({ sources: [{ path: "src/module.ts", text: `
type Choice<T> = T extends string ? 1 : 0;
declare function signature(value: number): void;
const result = a?.b ?? fallback;
if (result) {
  const worker = (value = 0) => {
    try {
      switch (value) {
        case 1: return value && ok;
        default: throw new Error();
      }
    } catch { return alternate; }
  };
}` }], lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n" });
  expect(report.files).toEqual([{ file: "src/module.ts", complexity: 6, cognitive: 6, functions: 1 }]);
  expect(report.entries[0]).toMatchObject({ complexity: 5, cognitive: 3, coverage: null, crap: null, ouch: null });
});

test("includes files with no functions and sorts file metrics by cognitive complexity", () => {
  const report = analyzeReport({ sources: [
    { path: "src/empty.ts", text: "export {};" },
    { path: "src/module.js", text: "if (a) { while (b) work(); }" },
  ], lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n" });
  expect(report).toEqual({ entries: [], files: [
    { file: "src/module.js", complexity: 2, cognitive: 3, functions: 0 },
    { file: "src/empty.ts", complexity: 0, cognitive: 0, functions: 0 },
  ] });
});

test.each([
  { name: "straight-line code", body: "return value;", cognitive: 0 },
  { name: "one conditional", body: "if (a) return 1;", cognitive: 1 },
  { name: "an alternative", body: "if (a) return 1; else return 2;", cognitive: 2 },
  { name: "an else-if chain", body: "if (a) {} else if (b) {} else {}", cognitive: 3 },
  { name: "three nested conditions", body: "if (a) { if (b) { if (c) {} } }", cognitive: 6 },
  { name: "a condition inside an else block", body: "if (a) {} else { if (b) {} }", cognitive: 4 },
  { name: "a nested else-if chain", body: "if (a) { if (b) {} else if (c) {} }", cognitive: 4 },
  { name: "a condition inside a loop", body: "for (;;) { if (a) {} }", cognitive: 3 },
  { name: "each loop form", body: "for (;;) {} for (const k in a) {} for (const v of a) {} while (a) {} do {} while (a);", cognitive: 5 },
  { name: "a switch with conditional case logic", body: "switch (a) { case 1: break; case 2: if (b) break; default: break; }", cognitive: 3 },
  { name: "catch nesting without try/finally nesting", body: "try { if (a) {} } catch (e) { if (b) {} } finally { if (c) {} }", cognitive: 5 },
  { name: "a nested ternary branch", body: "return a ? b ? 1 : 2 : 3;", cognitive: 3 },
  { name: "a ternary in a condition", body: "return (a ? b : c) ? 1 : 2;", cognitive: 2 },
  { name: "a labeled break", body: "outer: for (;;) { for (;;) { if (a) break outer; continue; } }", cognitive: 7 },
  { name: "a labeled continue", body: "outer: while (a) { continue outer; }", cognitive: 2 },
  { name: "one logical AND sequence", body: "return a && b && c;", cognitive: 1 },
  { name: "parenthesized logical AND", body: "return a && (b && c);", cognitive: 1 },
  { name: "AND sequences separated by OR", body: "return a && (b || c) && d;", cognitive: 3 },
  { name: "a negated nested AND sequence", body: "return a && !(b && c);", cognitive: 2 },
  { name: "readable fallback and optional access", body: "return (a?.b ?? c) || d;", cognitive: 1 },
  { name: "logical assignments", body: "a &&= b; a ||= b; a ??= b;", cognitive: 0 },
  { name: "a function-valued ternary followed by a condition", body: "const x = a ? () => true : other; if (b) {}", cognitive: 2 },
])("measures cognitive complexity for $name", ({ body, cognitive }) => {
  const entries = analyze({
    sources: [{ path: "src/sample.ts", text: `function sample() { ${body} }` }],
    lcov: "SF:src/sample.ts\nDA:1,1\nend_of_record\n",
  });
  expect(entries.find(entry => entry.name === "sample")?.cognitive).toBe(cognitive);
});

test.each([
  { name: "computed method names", text: 'class Worker { [a ? "one" : "two"]() { return 1; } }', cognitive: 0 },
  { name: "parameter expressions", text: "function sample(value = a ? b : c) { return value; }", cognitive: 1 },
])("counts function code separately from $name", ({ text, cognitive }) => {
  const [entry] = analyze({
    sources: [{ path: "src/function.ts", text }],
    lcov: "SF:src/function.ts\nDA:1,1\nend_of_record\n",
  });
  expect(entry?.cognitive).toBe(cognitive);
});

test.each([
  { name: "conditional rendering", expression: "a && b && <span />", cognitive: 1 },
  { name: "parenthesized conditional rendering", expression: "(a && <span />)", cognitive: 1 },
  { name: "mixed logical rendering", expression: "(a && b) || (c && d)", cognitive: 3 },
  { name: "a conditional inside rendering logic", expression: "a && (b ? <A /> : <B />)", cognitive: 2 },
  { name: "a JSX ternary", expression: "a ? <A /> : <B />", cognitive: 1 },
])("measures JSX $name", ({ expression, cognitive }) => {
  const [entry] = analyze({
    sources: [{ path: "src/view.tsx", text: `function View() { return <div>{${expression}}</div>; }` }],
    lcov: "SF:src/view.tsx\nDA:1,1\nend_of_record\n",
  });
  expect(entry?.cognitive).toBe(cognitive);
});

test("reports callback scores separately and includes their nesting in the enclosing function", () => {
  const entries = analyze({
    sources: [{ path: "src/callbacks.ts", text: `function outer() {
  if (a) {
    values.map(value => {
      if (value) return 1;
      return 0;
    });
  }
}` }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(entries.map(({ name, cognitive, ouch }) => ({ name, cognitive, ouch }))).toEqual([
    { name: "outer", cognitive: 4, ouch: null },
    { name: "outer.<anonymous@3:16>", cognitive: 1, ouch: null },
  ]);
});

test.each([
  { name: "computed method names", text: `function outer() {
  const worker = { [a ? "a" : "b"]() { if (c) {} } };
}`, expected: [{ name: "outer", cognitive: 3 }, { name: 'outer.[a ? "a" : "b"]', cognitive: 1 }] },
  { name: "method decorators", text: `function outer() {
  class Worker {
    @decorate(a ? b : c)
    run() { if (d) {} }
  }
}`, expected: [{ name: "outer", cognitive: 3 }, { name: "outer.Worker.run", cognitive: 1 }] },
  { name: "parameter decorators", text: `function outer() {
  class Worker {
    run(@decorate(a ? b : c) value: unknown) { if (d) {} }
  }
}`, expected: [{ name: "outer", cognitive: 2 }, { name: "outer.Worker.run", cognitive: 2 }] },
])("assigns $name to their function scope", ({ text, expected }) => {
  const entries = analyze({
    sources: [{ path: "src/scopes.ts", text }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(entries.map(({ name, cognitive }) => ({ name, cognitive }))).toEqual(expected);
});
