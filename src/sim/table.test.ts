import { describe, expect, it } from "vitest";
import { GRANULE_ROWS, PARTS_TO_DELAY, PARTS_TO_THROW, Table, TooManyPartitionsError, TooManyPartsError, granulesFor, sortedGranules, type TableEvent } from "./table";

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
    expect(t.insert(1000)!.name).toBe("all_1_1_0");
    expect(t.insert(1000)!.name).toBe("all_2_2_0");
    expect(t.insert(10, { partition: "202609" })!.name).toBe("202609_3_3_0");
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
    expect(t.insert(1, { partition: "202610" })!.name).toMatch(/^202610_/);
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

describe("background merge selector", () => {
  it("picks small contiguous parts in one partition", () => {
    const t = orders();
    t.insert(GRANULE_ROWS * 10);
    t.insert(100);
    t.insert(200);
    t.insert(GRANULE_ROWS * 5);
    expect(t.selectMerge()).toEqual(["all_2_2_0", "all_3_3_0"]);
  });
  it("never merges across partitions and respects the size cap", () => {
    const t = new Table({ name: "x", columns: [{ name: "a", type: "", bytesPerRow: 1 }], settings: { maxMergeRows: 150 } });
    t.insert(100, { partition: "202609" });
    t.insert(100, { partition: "202610" });
    expect(t.selectMerge()).toBeNull();
    t.insert(40, { partition: "202610" });
    expect(t.selectMerge()).toEqual(["202610_2_2_0", "202610_3_3_0"]);
  });
});

describe("scaled thresholds", () => {
  it("throws TOO_MANY_PARTS at the configured limit", () => {
    const t = new Table({ name: "x", columns: [{ name: "a", type: "", bytesPerRow: 1 }], settings: { partsToDelay: 3, partsToThrow: 5 } });
    for (let i = 0; i < 5; i++) t.insert(1);
    expect(() => t.insert(1)).toThrow(TooManyPartsError);
  });
});

describe("insert deduplication", () => {
  it("drops a retried block with the same token inside the window", () => {
    const t = new Table({ name: "x", columns: [{ name: "a", type: "", bytesPerRow: 1 }], settings: { dedupWindow: 100 } });
    expect(t.insert(10, { token: "b1" })).not.toBeNull();
    expect(t.insert(10, { token: "b1" })).toBeNull();
    expect(t.insert(10, { token: "b2" })).not.toBeNull();
    expect(t.activeParts).toHaveLength(2);
  });
  it("is off when the window is 0 (plain MergeTree default)", () => {
    const t = new Table({ name: "x", columns: [{ name: "a", type: "", bytesPerRow: 1 }] });
    t.insert(10, { token: "b1" });
    expect(t.insert(10, { token: "b1" })).not.toBeNull();
  });
});

describe("multi-column sorting key", () => {
  const cols = [
    { name: "city", type: "", bytesPerRow: 1 },
    { name: "customer_id", type: "", bytesPerRow: 1 },
    { name: "total", type: "", bytesPerRow: 1 },
  ];
  const dist = { city: 6, customer_id: 10000 };
  const make = (orderBy: string[]) => {
    const t = new Table({ name: "x", columns: cols, orderBy });
    t.insert(GRANULE_ROWS * 24, { dist });
    return t;
  };
  it("low-cardinality first lets the second column prune (generic exclusion)", () => {
    const t = make(["city", "customer_id"]);
    expect(t.plan({ columns: ["total"], where: { column: "city", min: 2, max: 2 } }).granulesRead).toBe(4);
    expect(t.plan({ columns: ["total"], where: { column: "customer_id", min: 4200, max: 4200 } }).granulesRead).toBe(6);
  });
  it("high-cardinality first: great on its own column, useless for the second", () => {
    const t = make(["customer_id", "city"]);
    expect(t.plan({ columns: ["total"], where: { column: "customer_id", min: 4200, max: 4200 } }).granulesRead).toBe(1);
    expect(t.plan({ columns: ["total"], where: { column: "city", min: 2, max: 2 } }).granulesRead).toBe(24);
  });
  it("re-sorts when the ORDER BY changes", () => {
    const t = make(["customer_id", "city"]);
    t.setOrderBy(["city", "customer_id"]);
    expect(t.plan({ columns: ["total"], where: { column: "city", min: 2, max: 2 } }).granulesRead).toBe(4);
  });
  it("granule ranges are monotonic on the first key", () => {
    const gs = sortedGranules(GRANULE_ROWS * 24, ["city", "customer_id"], dist);
    expect(gs[0].keys!.city).toEqual([0, 0]);
    expect(gs[23].keys!.city).toEqual([5, 5]);
  });
});

describe("partitions", () => {
  it("one insert block creates one part per partition, up to the limit", () => {
    const t = new Table({ name: "x", columns: [{ name: "a", type: "", bytesPerRow: 1 }], settings: { maxPartitionsPerInsert: 3 } });
    expect(t.insertBlock([{ partition: "202609", rows: 10 }, { partition: "202610", rows: 10 }])).toHaveLength(2);
    expect(() => t.insertBlock(["1", "2", "3", "4"].map((p) => ({ partition: p, rows: 1 })))).toThrow(TooManyPartitionsError);
  });
  it("partition pruning skips whole parts and shows in the EXPLAIN funnel", () => {
    const t = new Table({ name: "x", columns: [{ name: "a", type: "", bytesPerRow: 1 }] });
    t.insert(GRANULE_ROWS * 2, { partition: "202608" });
    t.insert(GRANULE_ROWS * 2, { partition: "202609" });
    t.insert(GRANULE_ROWS * 2, { partition: "202610" });
    const r = t.plan({ columns: ["a"], partitions: ["202609"] });
    expect(r.granulesRead).toBe(2);
    expect(r.explain[0]).toEqual({ stage: "Partition", parts: [1, 3], granules: [2, 6] });
  });
  it("DROP PARTITION removes its parts; a mutation rewrites them; lightweight delete masks rows", () => {
    const t = new Table({ name: "x", columns: [{ name: "a", type: "", bytesPerRow: 1 }] });
    t.insert(100, { partition: "202609" });
    t.insert(100, { partition: "202610" });
    t.insert(100, { partition: "202610" });
    expect(t.lightweightDelete("202610")).toHaveLength(2);
    expect(t.merge(["202610_2_2_0", "202610_3_3_0"]).rows).toBe(0);
    const m = t.mutateDelete("202609");
    expect(m.bytes).toBe(100);
    expect(t.partitions).toEqual(["202610"]);
    t.dropPartition("202610");
    expect(t.activeParts).toHaveLength(0);
  });
});
