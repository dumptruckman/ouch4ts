import { expect, test } from "vitest";
import { resolve } from "node:path";
import { analyze } from "../src/index.js";

test("reports OUCH from cyclomatic complexity, cognitive complexity, and executable line coverage", () => {
  const entries = analyze({
    sources: [{
      path: "src/orders.ts",
      text: "export function price(vip: boolean) {\n  if (vip) return 10;\n  return 20;\n}\n",
    }],
    lcov: "SF:src/orders.ts\nDA:2,1\nDA:3,0\nend_of_record\n",
  });

  expect(entries).toEqual([{
    name: "price", file: "src/orders.ts", line: 1, endLine: 4,
    complexity: 2, cognitive: 1, coverage: 50, ouch: 3.5,
  }]);
});

test.each([
  { name: "uncovered nested conditions", body: "if (a) { if (b) { if (c) return 1; } }\nreturn 0;",
    lines: "DA:2,0\nDA:3,0", expected: { complexity: 4, cognitive: 6, coverage: 0, ouch: 26 } },
  { name: "partly covered nested conditions", body: "if (a) { if (b) { if (c) return 1; } }\nreturn 0;",
    lines: "DA:2,1\nDA:3,0", expected: { complexity: 4, cognitive: 6, coverage: 50, ouch: 12 } },
  { name: "fully covered nested conditions", body: "if (a) { if (b) { if (c) return 1; } }\nreturn 0;",
    lines: "DA:2,1\nDA:3,1", expected: { complexity: 4, cognitive: 6, coverage: 100, ouch: 10 } },
  { name: "uncovered optional access", body: "return a?.b ?? 0;", lines: "DA:2,0",
    expected: { complexity: 3, cognitive: 0, coverage: 0, ouch: 12 } },
  { name: "fully covered optional access", body: "return a?.b ?? 0;", lines: "DA:2,1",
    expected: { complexity: 3, cognitive: 0, coverage: 100, ouch: 3 } },
])("scores $name without letting coverage erase cognitive complexity", ({ body, lines, expected }) => {
  const [entry] = analyze({
    sources: [{ path: "src/sample.ts", text: `function sample() {\n${body}\n}` }],
    lcov: `SF:src/sample.ts\n${lines}\nend_of_record\n`,
  });
  expect(entry).toMatchObject(expected);
});

test.each(["js", "jsx", "mjs", "cjs"])("scores JavaScript .%s functions using original-source coverage", extension => {
  const path = `src/orders.${extension}`;
  const entries = analyze({
    sources: [{ path, text: "function price(vip) {\n  if (vip) return 10;\n  return 20;\n}\n" +
      (extension === "cjs" ? "module.exports = { price };" : "export { price };") }],
    lcov: `SF:${path}\nDA:2,1\nDA:3,0\nend_of_record\n`,
  });
  expect(entries).toEqual([{
    name: "price", file: path, line: 1, endLine: 4,
    complexity: 2, cognitive: 1, coverage: 50, ouch: 3.5,
  }]);
});

test("scores JSX conditional rendering in JavaScript", () => {
  const entries = analyze({
    sources: [{ path: "src/view.jsx", text: "export function View({ ready }) {\n  return <div>{ready && <span />}</div>;\n}" }],
    lcov: "SF:src/view.jsx\nDA:2,1\nend_of_record\n",
  });
  expect(entries).toEqual([{
    name: "View", file: "src/view.jsx", line: 1, endLine: 3,
    complexity: 2, cognitive: 0, coverage: 100, ouch: 2,
  }]);
});

test.each(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"])("rejects malformed .%s source", extension => {
  const path = `src/broken.${extension}`;
  expect(() => analyze({
    sources: [{ path, text: "export function broken( {" }],
    lcov: `SF:${path}\nDA:1,1\nend_of_record\n`,
  })).toThrow(`${path}: syntax error:`);
});

test.each(["js", "jsx", "mjs", "cjs"])("rejects TypeScript annotations in .%s files", extension => {
  const path = `src/typed.${extension}`;
  expect(() => analyze({
    sources: [{ path, text: "export const price = (vip: boolean) => vip ? 10 : 20;" }],
    lcov: `SF:${path}\nDA:1,1\nend_of_record\n`,
  })).toThrow(`${path}: syntax error:`);
});

test.each([
  "",
  "not a coverage report",
  "SF:src/sample.ts\nDA:1,nope\nend_of_record\n",
  "SF:src/sample.ts\nDA:0,1\nend_of_record\n",
  "SF:src/sample.ts\nDA:1,-1\nend_of_record\n",
  "DA:1,1\nend_of_record\n",
  "SF:src/sample.ts\nDA:1,1\n",
])("rejects unusable LCOV instead of producing a misleading score: %j", lcov => {
  expect(() => analyze({
    sources: [{ path: "src/sample.ts", text: "function sample() { return 1; }" }], lcov,
  })).toThrow(/LCOV/);
});

test("keeps an uncalled nested function's body out of its parent's line coverage", () => {
  const entries = analyze({
    sources: [{ path: "src/nested.ts", text: `function outer() {
  const inner = (x: number) => {
    if (x) return 1;
    return 0;
  };
  return inner;
}` }],
    lcov: "SF:src/nested.ts\nDA:2,1\nDA:3,0\nDA:4,0\nDA:6,1\nend_of_record\n",
  });
  expect(entries.map(({ name, coverage, ouch }) => ({ name, coverage, ouch }))).toEqual([
    { name: "outer.inner", coverage: 0, ouch: 7 },
    { name: "outer", coverage: 100, ouch: 1 },
  ]);
});

test("maps exact file paths, merges LCOV records, and sorts known scores before unknown coverage", () => {
  const entries = analyze({
    sources: ["a", "b", "c"].map(folder => ({
      path: `src/${folder}/index.ts`, text: "export function run() { return 1; }",
    })),
    lcov: `SF:${resolve("src/a/index.ts")}\nDA:1,0\nend_of_record\n` +
      "SF:src/a/index.ts\nDA:1,2,checksum\nend_of_record\nSF:src/b/index.ts\nDA:1,0\nend_of_record\n",
  });
  expect(entries.map(({ file, coverage, ouch }) => ({ file, coverage, ouch }))).toEqual([
    { file: "src/b/index.ts", coverage: 0, ouch: 2 },
    { file: "src/a/index.ts", coverage: 100, ouch: 1 },
    { file: "src/c/index.ts", coverage: null, ouch: null },
  ]);
});

test.each([
  ["if (x) {} else if (x) {}", 3],
  ["for (;;) {} while (x) {} do {} while (x);", 4],
  ["for (const k in x) {} for (const v of x) {}", 3],
  ["try {} catch (e) {}", 2],
  ["switch (x) { case 1: break; case 2: break; default: break; }", 3],
  ["return x && x || x ?? x;", 4],
  ["x &&= 1; x ||= 1; x ??= 1;", 4],
  ["return x?.a?.(x);", 3],
  ["return x ? 1 : 0;", 2],
  ["const { value = 1 } = x; return value;", 2],
  ["const text = 'if (x)'; /* while (x) {} */ return text;", 1],
  ["type T = X extends Y ? A : B; return x;", 1],
])("counts runtime decisions in %s", (body, complexity) => {
  const [entry] = analyze({
    sources: [{ path: "src/sample.ts", text: `function sample(x: unknown) { ${body} }` }],
    lcov: "SF:src/sample.ts\nDA:1,0\nend_of_record\n",
  });
  expect(entry?.complexity).toBe(complexity);
});

test("counts default parameters as decisions", () => {
  const [entry] = analyze({
    sources: [{ path: "src/sample.ts", text: "const sample = (x = 1) => x;" }],
    lcov: "SF:src/sample.ts\nDA:1,1\nend_of_record\n",
  });
  expect(entry?.complexity).toBe(2);
});

test.each([
  { name: "overload implementations", text: `
declare function external(): void;
function overloaded(value: string): string;
function overloaded(value: number): number;
function overloaded(value: string | number) { return value; }
`, names: ["overloaded"] },
  { name: "class members", text: `
class Worker {
  constructor() {}
  set ready(value: boolean) { console.log(value); }
  task = () => 1;
}
`, names: ["Worker.constructor", "Worker.set ready", "Worker.task"] },
  { name: "property-assigned expressions", text: "const tasks = { run: function () { return 1; } };", names: ["run"] },
  { name: "named expressions", text: "const named = function alias() { return 1; };", names: ["alias"] },
])("names $name while skipping signatures without bodies", ({ text, names }) => {
  const entries = analyze({
    sources: [{ path: "src/functions.ts", text }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(entries.map(entry => entry.name)).toEqual(names);
});

test("reports methods, arrows and callbacks separately, without charging nested decisions to parents", () => {
  const entries = analyze({
    sources: [{ path: "src/work.tsx", text: `
class Worker {
  run(values: number[]) {
    const select = (n: number) => n > 0 ? n : 0;
    return values.map(n => n || 1);
  }
  get ready() { return true; }
}
export default function () { return <div />; }
` }],
    lcov: "SF:src/other.ts\nDA:1,0\nend_of_record\n",
  });

  expect(entries.map(({ name, complexity, coverage, ouch }) => ({ name, complexity, coverage, ouch }))).toEqual([
    { name: "Worker.run", complexity: 1, coverage: null, ouch: null },
    { name: "Worker.run.select", complexity: 2, coverage: null, ouch: null },
    { name: "Worker.run.<anonymous@5:23>", complexity: 2, coverage: null, ouch: null },
    { name: "Worker.get ready", complexity: 1, coverage: null, ouch: null },
    { name: "default", complexity: 1, coverage: null, ouch: null },
  ]);
});
