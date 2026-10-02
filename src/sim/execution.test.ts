import { describe, expect, it } from "vitest";
import { GRANULE_ROWS, Table, type InsertOptions } from "./table";

const ROWS = GRANULE_ROWS * 8 - 1200;
// status = 1 (error) only in granule 5; total peaks in granule 3
const cols: InsertOptions["cols"] = (g) => ({
  status: g === 5 ? { min: 0, max: 2, values: [0, 1, 2] } : { min: 0, max: 2, values: [0, 2] },
  total: { min: 0, max: g === 3 ? 9999 : 500 },
});
const logs = (settings = {}) => {
  const t = new Table({
    name: "logs",
    orderBy: ["ts"],
    settings,
    columns: [
      { name: "ts", type: "DateTime", bytesPerRow: 4 },
      { name: "status", type: "Enum8", bytesPerRow: 1 },
      { name: "total", type: "UInt32", bytesPerRow: 4 },
      { name: "payload", type: "String", bytesPerRow: 200 },
    ],
  });
  t.insert(ROWS, { keyRange: [0, 29], cols });
  return t;
};
const readBoxes = (r: ReturnType<Table["plan"]>, column: string) => r.boxes.filter((b) => b.read && b.column === column).length;

describe("PREWHERE", () => {
  it("reads the filter column everywhere and the wide column only where rows can match", () => {
    const on = logs().plan({ columns: ["payload"], where: { column: "status", min: 1, max: 1 } });
    expect(readBoxes(on, "status")).toBe(8);
    expect(readBoxes(on, "payload")).toBe(1);
    const off = logs({ prewhere: false }).plan({ columns: ["payload"], where: { column: "status", min: 1, max: 1 } });
    expect(readBoxes(off, "payload")).toBe(8);
    expect(off.bytesRead).toBeGreaterThan(on.bytesRead * 5);
  });
});

describe("lazy materialization", () => {
  it("ORDER BY total DESC LIMIT 3 reads payload only for the granule that holds the top rows", () => {
    const spec = { columns: ["payload"], orderLimit: { column: "total", n: 3 } };
    const lazy = logs().plan(spec);
    expect(readBoxes(lazy, "total")).toBe(8);
    expect(readBoxes(lazy, "payload")).toBe(1);
    expect(lazy.boxes.find((b) => b.read && b.column === "payload")!.granule).toBe(3);
    expect(readBoxes(logs({ lazyMaterialization: false }).plan(spec), "payload")).toBe(8);
  });
});
