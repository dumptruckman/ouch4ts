import { expect, test } from "vitest";
import { analyze } from "../src/index.js";

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
  expect(entries.map(({ name, cognitive, crap }) => ({ name, cognitive, crap }))).toEqual([
    { name: "outer", cognitive: 1, crap: null },
    { name: "outer.<anonymous@3:16>", cognitive: 1, crap: null },
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
