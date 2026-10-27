import { expect, test } from "vitest";
import { analyze, analyzeReport } from "../src/index.js";

test("reports Sonar file complexity while keeping nested function scores independent", () => {
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
      { name: "outer", complexity: 2, cognitive: 1, inclusiveCognitive: 2, crap: 2, ouch: 3 },
      { name: "outer.inner", complexity: 2, cognitive: 1, inclusiveCognitive: 1, crap: 2, ouch: 3 },
    ],
  });
});

test.each([
  { name: "a declaration-only outer function", text: "function outer() { function inner() { if (a) {} } }", cognitive: 1 },
  { name: "a logical-only outer function", text: "function outer() { a && b; function inner() { if (c) {} } }", cognitive: 2 },
  { name: "control flow after the nested function", text: "function outer() { function inner() { if (a) {} } if (b) {} }", cognitive: 3 },
  { name: "deeper function nesting", text: "function outer() { function middle() { function inner() { if (a) {} } } }", cognitive: 2 },
  { name: "a callback inside a conditional", text: "function outer() { if (a) { values.map(v => { if (v) work(); }); } }", cognitive: 4 },
  { name: "a nested alternative", text: "function outer() { if (a) {} function inner() { if (b) {} else {} } }", cognitive: 4 },
])("uses Sonar's file aggregation for $name", ({ text, cognitive }) => {
  const report = analyzeReport({ sources: [{ path: "src/nested.ts", text }], lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n" });
  expect(report.files[0]?.cognitive).toBe(cognitive);
});

test.each([
  { name: "a declaration", text: "function View() { if (a) {} function handler() { if (b) {} } return <div />; }" },
  { name: "an arrow", text: "const View = () => { if (a) {} const handler = () => { if (b) {} }; return <>Hello</>; };" },
  { name: "a parenthesized arrow", text: "const View = (() => { if (a) {} const handler = () => { if (b) {} }; return <div />; });" },
  { name: "a parenthesized function expression", text: "const View = (function () { if (a) {} const handler = () => { if (b) {} }; return <div />; });" },
])("recognizes a React component defined as $name in file cognitive complexity", ({ text }) => {
  const report = analyzeReport({ sources: [{ path: "src/view.tsx", text }], lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n" });
  expect(report.files).toEqual([{ file: "src/view.tsx", complexity: 4, cognitive: 2, functions: 2 }]);
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
  { name: "AND sequences separated by OR", body: "return a && (b || c) && d;", cognitive: 2 },
  { name: "a negated nested AND sequence", body: "return a && !(b && c);", cognitive: 2 },
  { name: "readable fallback and optional access", body: "return (a?.b ?? c) || d;", cognitive: 0 },
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
  { name: "conditional rendering", expression: "a && b && <span />", cognitive: 0 },
  { name: "parenthesized conditional rendering", expression: "(a && <span />)", cognitive: 0 },
  { name: "mixed logical rendering", expression: "(a && b) || (c && d)", cognitive: 2 },
  { name: "a conditional inside rendering logic", expression: "a && (b ? <A /> : <B />)", cognitive: 2 },
  { name: "a JSX ternary", expression: "a ? <A /> : <B />", cognitive: 1 },
])("measures JSX $name", ({ expression, cognitive }) => {
  const [entry] = analyze({
    sources: [{ path: "src/view.tsx", text: `function View() { return <div>{${expression}}</div>; }` }],
    lcov: "SF:src/view.tsx\nDA:1,1\nend_of_record\n",
  });
  expect(entry?.cognitive).toBe(cognitive);
});

test("scores callbacks independently of their enclosing function and nesting", () => {
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
    { name: "outer", cognitive: 1, ouch: null },
    { name: "outer.<anonymous@3:16>", cognitive: 1, ouch: null },
  ]);
});

test.each([
  { name: "computed method names", text: `function outer() {
  const worker = { [a ? "a" : "b"]() { if (c) {} } };
}`, expected: [{ name: "outer", cognitive: 1 }, { name: 'outer.[a ? "a" : "b"]', cognitive: 1 }] },
  { name: "method decorators", text: `function outer() {
  class Worker {
    @decorate(a ? b : c)
    run() { if (d) {} }
  }
}`, expected: [{ name: "outer", cognitive: 1 }, { name: "outer.Worker.run", cognitive: 1 }] },
  { name: "parameter decorators", text: `function outer() {
  class Worker {
    run(@decorate(a ? b : c) value: unknown) { if (d) {} }
  }
}`, expected: [{ name: "outer", cognitive: 0 }, { name: "outer.Worker.run", cognitive: 2 }] },
])("assigns $name to their function scope", ({ text, expected }) => {
  const entries = analyze({
    sources: [{ path: "src/scopes.ts", text }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(entries.map(({ name, cognitive }) => ({ name, cognitive }))).toEqual(expected);
});
