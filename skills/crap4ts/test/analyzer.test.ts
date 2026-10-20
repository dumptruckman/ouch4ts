import { expect, test } from "vitest";
import { resolve } from "node:path";
import { analyze } from "../src/index.js";

test("scores a function from its complexity and executable line coverage", () => {
  const entries = analyze({
    sources: [{
      path: "src/orders.ts",
      text: "export function price(vip: boolean) {\n  if (vip) return 10;\n  return 20;\n}\n",
    }],
    lcov: "SF:src/orders.ts\nDA:2,1\nDA:3,0\nend_of_record\n",
  });

  expect(entries).toEqual([{
    name: "price", file: "src/orders.ts", line: 1, endLine: 4,
    complexity: 2, coverage: 50, crap: 2.5,
  }]);
});

test("rejects malformed TypeScript rather than scoring the parser's recovery tree", () => {
  expect(() => analyze({
    sources: [{ path: "src/broken.ts", text: "export function broken( {" }],
    lcov: "SF:src/broken.ts\nDA:1,1\nend_of_record\n",
  })).toThrow(/src\/broken.ts.*[Ss]yntax/);
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
  expect(entries.map(({ name, coverage, crap }) => ({ name, coverage, crap }))).toEqual([
    { name: "outer.inner", coverage: 0, crap: 6 },
    { name: "outer", coverage: 100, crap: 1 },
  ]);
});

test("maps exact file paths, merges LCOV records, and sorts known risks before unknown coverage", () => {
  const entries = analyze({
    sources: ["a", "b", "c"].map(folder => ({
      path: `src/${folder}/index.ts`, text: "export function run() { return 1; }",
    })),
    lcov: `SF:${resolve("src/a/index.ts")}\nDA:1,0\nend_of_record\n` +
      "SF:src/a/index.ts\nDA:1,2,checksum\nend_of_record\nSF:src/b/index.ts\nDA:1,0\nend_of_record\n",
  });
  expect(entries.map(({ file, coverage, crap }) => ({ file, coverage, crap }))).toEqual([
    { file: "src/b/index.ts", coverage: 0, crap: 2 },
    { file: "src/a/index.ts", coverage: 100, crap: 1 },
    { file: "src/c/index.ts", coverage: null, crap: null },
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

test("names runtime implementations while skipping declarations and overload signatures", () => {
  const entries = analyze({
    sources: [{ path: "src/functions.ts", text: `
declare function external(): void;
function overloaded(value: string): string;
function overloaded(value: number): number;
function overloaded(value: string | number) { return value; }
class Worker {
  constructor() {}
  set ready(value: boolean) { console.log(value); }
  task = () => 1;
}
const tasks = { run: function () { return 1; } };
const named = function alias() { return 1; };
` }],
    lcov: "SF:src/other.ts\nDA:1,1\nend_of_record\n",
  });
  expect(entries.map(entry => entry.name)).toEqual([
    "overloaded", "Worker.constructor", "Worker.set ready", "Worker.task", "run", "alias",
  ]);
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

  expect(entries.map(({ name, complexity, coverage, crap }) => ({ name, complexity, coverage, crap }))).toEqual([
    { name: "Worker.run", complexity: 1, coverage: null, crap: null },
    { name: "Worker.run.select", complexity: 2, coverage: null, crap: null },
    { name: "Worker.run.<anonymous@5:23>", complexity: 2, coverage: null, crap: null },
    { name: "Worker.get ready", complexity: 1, coverage: null, crap: null },
    { name: "default", complexity: 1, coverage: null, crap: null },
  ]);
});
