export function formatScore(value: number | null) {
  return value === null ? "N/A" : value.toFixed(1);
}

export function formatCoverage(value: number | null) {
  return value === null ? "N/A" : value.toFixed(1) + "%";
}

export function formatPair(base: number | undefined, head: number | undefined) {
  return `${base ?? "-"} / ${head ?? "-"}`;
}

export function formatDelta(value: number | null) {
  if (value === null) return "-";
  return (value > 0 ? "+" : "") + value.toFixed(1);
}

export function formatTable(title: string, rows: string[][], leftColumns = 2) {
  const header = rows[0];
  if (header === undefined) throw new Error("Table must include a header row");
  if (rows.some(row => row.length !== header.length)) {
    throw new Error("Table rows must match the header column count");
  }
  const widths = header.map((_, column) =>
    rows.reduce((width, row) => Math.max(width, row[column]!.length), 0)
  );
  const formatted = rows.map(row => {
    const columns = row.map((value, column) =>
      column < leftColumns ? value.padEnd(widths[column]!) : value.padStart(widths[column]!)
    );
    return columns.join("  ").trimEnd();
  });
  return [title, "=".repeat(title.length), ...formatted].join("\n");
}
