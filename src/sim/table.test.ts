import { describe, expect, it } from "vitest";
import { GRANULE_ROWS, PARTS_TO_DELAY, PARTS_TO_THROW, Table, TooManyPartsError, granulesFor, type TableEvent } from "./table";

const orders = () =>
  new Table({
    name: "orders",
    orderBy: ["customer_id"],
    columns: [
      { name: "date", type: "Date", bytesPerRow: 2 },
      { name: "customer_id", type: "UInt32", bytesPerRow: 4 },
      { name: "city", type: "LowCardinality(String)", bytesPerRow: 1 },
      { name: "total", type: "Decimal(10,2)", bytesPerRow: 8 },
    ],
  });

describe("granules", () => {
  it("splits rows into granules of 8192", () => {
    expect(granulesFor(8192)).toHaveLength(1);
    expect(granulesFor(8193).map((g) => g.rows)).toEqual([8192, 1]);
    expect(granulesFor(8_870_000)).toHaveLength(1083); // the docs' sample table
  });

  it("spreads a sorted key range across granules", () => {
    const gs = granulesFor(GRANULE_ROWS * 4, [0, 400]);
    expect(gs[0].min).toBe(0);
    expect(gs[3].max).toBeCloseTo(400);
    for (let i = 1; i < gs.length; i++) expect(gs[i].min!).toBeGreaterThan(gs[i - 1].max!);
  });
});

describe("inserts create immutable parts", () => {
  it("names parts partition_min_max_level", () => {
    const t = orders();
    const events: TableEvent[] = [];
    t.events.on((e) => events.push(e));
    expect(t.insert(1000).name).toBe("all_1_1_0");
    expect(t.insert(1000).name).toBe("all_2_2_0");
    expect(t.insert(10, { partition: "202609" }).name).toBe("202609_3_3_0");
    expect(events.filter((e) => e.type === "partCreated")).toHaveLength(3);
  });

  it("delays then rejects inserts with too many active parts per partition", () => {
    const t = orders();
    const events: TableEvent[] = [];
    for (let i = 0; i < PARTS_TO_DELAY; i++) t.insert(1);
    t.events.on((e) => events.push(e));
    t.insert(1);
    expect(events.some((e) => e.type === "insertDelayed")).toBe(true);
    for (let i = t.activeCount("all"); i < PARTS_TO_THROW; i++) t.insert(1);
    expect(() => t.insert(1)).toThrow(TooManyPartsError);
    // Other partitions have their own count
    expect(t.insert(1, { partition: "202610" }).name).toMatch(/^202610_/);
  });
});

describe("merges", () => {
  it("merges contiguous parts into level+1 and outdates the sources", () => {
    const t = orders();
    t.insert(100);
    t.insert(200);
    t.insert(300);
    const m = t.merge(["all_1_1_0", "all_2_2_0"]);
    expect(m.name).toBe("all_1_2_1");
    expect(m.rows).toBe(300);
    expect(t.activeParts.map((p) => p.name)).toEqual(["all_1_2_1", "all_3_3_0"]);
    expect(t.merge(["all_1_2_1", "all_3_3_0"]).name).toBe("all_1_3_2");
  });

  it("refuses non-contiguous or cross-partition merges", () => {
    const t = orders();
    t.insert(1);
    t.insert(1);
    t.insert(1);
    expect(() => t.merge(["all_1_1_0", "all_3_3_0"])).toThrow(/contiguous/);
    t.insert(1, { partition: "202609" });
    expect(() => t.merge(["all_3_3_0", "202609_4_4_0"])).toThrow(/partitions/);
  });
});

describe("reading", () => {
  it("only opens the columns a query names", () => {
    const t = orders();
    t.insert(GRANULE_ROWS * 3);
    const r = t.query({ columns: ["total"] });
    expect(r.boxesTotal).toBe(12);
    expect(r.boxesRead).toBe(3);
    expect(r.granulesRead).toBe(3);
    expect(r.bytesRead).toBe(GRANULE_ROWS * 3 * 8);
    expect(r.bytesRead / r.bytesTotal).toBeCloseTo(8 / 15);
  });

  it("skips granules whose key range cannot match (sparse index)", () => {
    const t = orders();
    t.insert(GRANULE_ROWS * 10, { keyRange: [0, 999] });
    const r = t.query({ columns: ["total"], where: { column: "customer_id", min: 420, max: 420 } });
    expect(r.granulesTotal).toBe(10);
    expect(r.granulesRead).toBe(1);
    // the filter column is read too
    expect(r.boxesRead).toBe(2);
  });

  it("can't prune on a column that is not the first sorting key", () => {
    const t = orders();
    t.insert(GRANULE_ROWS * 10, { keyRange: [0, 999] });
    const r = t.query({ columns: ["total"], where: { column: "date", min: 1, max: 1 } });
    expect(r.granulesRead).toBe(10);
  });
});

describe("row vs column storage", () => {
  it("a row store opens every box, whatever the query names", () => {
    const t = orders();
    t.setStorage("row");
    t.insert(GRANULE_ROWS * 3);
    const r = t.query({ columns: ["total"] });
    expect(r.boxesRead).toBe(r.boxesTotal);
    expect(r.bytesRead).toBe(r.bytesTotal);
    t.setStorage("column");
    expect(t.query({ columns: ["total"] }).boxesRead).toBe(3);
  });
});

describe("compression", () => {
  it("sorting by a column makes it compress better", () => {
    const t = new Table({
      name: "orders",
      orderBy: ["total"],
      columns: [
        { name: "city", type: "LowCardinality(String)", bytesPerRow: 1, raw: 8, ratio: { sorted: 40, unsorted: 6 } },
        { name: "total", type: "Decimal(10,2)", bytesPerRow: 1, raw: 8, ratio: { sorted: 2.2, unsorted: 2 } },
      ],
    });
    t.insert(1000);
    const before = t.columnSizes().find((c) => c.name === "city")!.compressed;
    t.setOrderBy(["city"]);
    const after = t.columnSizes().find((c) => c.name === "city")!.compressed;
    expect(before / after).toBeCloseTo(40 / 6);
  });
});
