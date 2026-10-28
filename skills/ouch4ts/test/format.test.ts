import { expect, test } from "vitest";
import { formatTable } from "../src/format.js";

test.each([
  { name: "missing header", rows: [], message: "Table must include a header row" },
  { name: "short row", rows: [["Fn", "CC"], ["f"]], message: "Table rows must match the header column count" },
  { name: "long row", rows: [["Fn"], ["f", "1"]], message: "Table rows must match the header column count" },
])("rejects a table with a $name", ({ rows, message }) => {
  expect(() => formatTable("Test", rows)).toThrow(message);
});

test("formats large tables with aligned columns and every row preserved", () => {
  const rows = [
    ["Fn", "CC"],
    ...Array.from({ length: 150_000 }, () => ["f", "1"]),
    ["long", "100"],
  ];

  const lines = formatTable("Test", rows, 1).split("\n");

  expect(lines).toHaveLength(150_004);
  expect(lines.slice(0, 4)).toEqual(["Test", "====", "Fn     CC", "f       1"]);
  expect(lines.at(-1)).toBe("long  100");
});
