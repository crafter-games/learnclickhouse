import { describe, expect, it } from "vitest";
import { GRANULE_ROWS, Table, type ColumnStats, type InsertOptions } from "./table";

const ROWS = GRANULE_ROWS * 8 - 1200;
const cols: InsertOptions["cols"] = (g) => {
  const out: Record<string, ColumnStats> = {
    order_id: { min: g * 1000, max: g * 1000 + 999 },
    total: { min: 0, max: 999 },
    status: { min: 0, max: g === 5 ? 2 : 1, values: g === 5 ? [0, 1, 2] : [0, 1] },
    trace: { min: g * 10, max: g * 10 + 9, values: Array.from({ length: 10 }, (_, i) => g * 10 + i) },
  };
  return out;
};
const orders = (settings = {}) => {
  const t = new Table({
    name: "orders",
    orderBy: ["date"],
    settings,
    columns: [
      { name: "date", type: "Date", bytesPerRow: 2 },
      { name: "order_id", type: "UInt64", bytesPerRow: 8 },
      { name: "total", type: "UInt32", bytesPerRow: 4 },
      { name: "status", type: "UInt8", bytesPerRow: 1 },
      { name: "trace", type: "UInt64", bytesPerRow: 8 },
      { name: "customer_id", type: "UInt32", bytesPerRow: 4, distinct: 5000 },
    ],
  });
  return t;
};
const q = (t: Table, column: string, v: number, read = [column]) => t.query({ columns: read, where: { column, min: v, max: v } });

describe("skip indexes", () => {
  it("minmax skips blocks on a column correlated with the key, nothing on a random one", () => {
    const t = orders();
    t.addIndex({ name: "idx_id", column: "order_id", type: "minmax", granularity: 1 });
    t.addIndex({ name: "idx_total", column: "total", type: "minmax", granularity: 1 });
    t.insert(ROWS, { keyRange: [0, 29], cols });
    expect(q(t, "order_id", 3500).granulesRead).toBe(1);
    expect(q(t, "total", 500).granulesRead).toBe(8);
  });
  it("ADD INDEX covers new parts only; MATERIALIZE INDEX builds it for old ones", () => {
    const t = orders();
    t.insert(ROWS, { keyRange: [0, 29], cols });
    t.addIndex({ name: "idx_id", column: "order_id", type: "minmax", granularity: 1 });
    expect(q(t, "order_id", 3500).granulesRead).toBe(8);
    expect(t.materializeIndex("idx_id")).toHaveLength(1);
    expect(q(t, "order_id", 3500).granulesRead).toBe(1);
  });
  it("GRANULARITY groups granules: GRANULARITY 4 reads a whole block of 4", () => {
    const t = orders();
    t.addIndex({ name: "idx_id", column: "order_id", type: "minmax", granularity: 4 });
    t.insert(ROWS, { keyRange: [0, 29], cols });
    expect(q(t, "order_id", 3500).granulesRead).toBe(4);
  });
  it("set(N) skips blocks without the value, and gives up when a block has more than N values", () => {
    const t = orders();
    t.addIndex({ name: "idx_status", column: "status", type: "set", granularity: 1, n: 3 });
    t.insert(ROWS, { keyRange: [0, 29], cols });
    expect(q(t, "status", 2).granulesRead).toBe(1);
    t.addIndex({ name: "idx_status", column: "status", type: "set", granularity: 1, n: 1 });
    t.materializeIndex("idx_status");
    const r = q(t, "status", 2);
    expect(r.granulesRead).toBe(8);
    expect(r.skip!.parts[0].blocks.every((b) => b === "full")).toBe(true);
  });
  it("bloom_filter finds the one granule; false positives cost extra reads", () => {
    const exact = orders();
    exact.addIndex({ name: "idx_trace", column: "trace", type: "bloom_filter", granularity: 1, fpr: 0 });
    exact.insert(ROWS, { keyRange: [0, 29], cols });
    expect(q(exact, "trace", 42).granulesRead).toBe(1);
    const loose = orders();
    loose.addIndex({ name: "idx_trace", column: "trace", type: "bloom_filter", granularity: 1, fpr: 0.5 });
    loose.insert(ROWS, { keyRange: [0, 29], cols });
    const r = q(loose, "trace", 42);
    const fps = r.skip!.parts[0].blocks.filter((b) => b === "fp").length;
    expect(r.granulesRead).toBe(1 + fps);
    expect(r.explain.map((e) => e.stage)).toEqual(["PrimaryKey", "Skip"]);
  });
});

describe("projections", () => {
  it("the optimizer reads the projection when it needs fewer granules", () => {
    const t = orders();
    t.insert(ROWS, { keyRange: [0, 29], cols });
    expect(q(t, "customer_id", 1234, ["customer_id", "total"]).granulesRead).toBe(8);
    t.addProjection({ name: "by_customer", orderBy: "customer_id", columns: ["customer_id", "total"] });
    expect(q(t, "customer_id", 1234, ["customer_id", "total"]).projection).toBeUndefined();
    t.materializeProjection("by_customer");
    const r = q(t, "customer_id", 1234, ["customer_id", "total"]);
    expect(r.projection).toBe("by_customer");
    expect(r.granulesRead).toBe(1);
    expect(r.boxes.filter((b) => b.read).every((b) => b.column.startsWith("by_customer:"))).toBe(true);
    // A column the projection doesn't have: back to the base table
    expect(q(t, "customer_id", 1234, ["customer_id", "status"]).projection).toBeUndefined();
  });
});

describe("query condition cache", () => {
  it("the second run skips granules the first found empty; a new part is read in full", () => {
    const t = orders({ conditionCache: true });
    t.insert(ROWS, { keyRange: [0, 29], cols });
    expect(q(t, "status", 2).granulesRead).toBe(8);
    const second = q(t, "status", 2);
    expect(second.granulesRead).toBe(1);
    expect(second.cacheSkipped).toBe(7);
    t.insert(ROWS, { keyRange: [30, 59], cols });
    expect(q(t, "status", 2).granulesRead).toBe(1 + 8);
    expect(q(t, "status", 1).granulesRead).toBe(16);
  });
});
