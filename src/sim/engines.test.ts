import { describe, expect, it } from "vitest";
import { argMaxByKey, collapse, sumByKey } from "./engines";
import { Table } from "./table";

const cols = (names: string[]) => names.map((name) => ({ name, type: "", bytesPerRow: 1 }));

describe("ReplacingMergeTree", () => {
  const t = () => new Table({ name: "users", orderBy: ["id"], engine: { type: "Replacing", ver: "ver", isDeleted: "deleted" }, columns: cols(["id", "ver", "city", "deleted"]) });

  it("keeps duplicates until the parts merge; then the highest version wins", () => {
    const table = t();
    table.insertRows([{ id: 7, ver: 1, city: "Lima", deleted: 0 }]);
    table.insertRows([{ id: 7, ver: 2, city: "Quito", deleted: 0 }]);
    expect(table.plan({ columns: ["city"] }).rows).toHaveLength(2);
    expect(table.plan({ columns: ["city"], final: true }).rows).toEqual([{ id: 7, ver: 2, city: "Quito", deleted: 0 }]);
    table.merge(["all_1_1_0", "all_2_2_0"]);
    expect(table.plan({ columns: ["city"] }).rows).toEqual([{ id: 7, ver: 2, city: "Quito", deleted: 0 }]);
  });

  it("FINAL hides rows marked deleted; a plain SELECT still sees them", () => {
    const table = t();
    table.insertRows([{ id: 1, ver: 1, city: "Lima", deleted: 0 }]);
    table.insertRows([{ id: 1, ver: 2, city: "Lima", deleted: 1 }]);
    expect(table.plan({ columns: ["city"], final: true }).rows).toEqual([]);
    table.merge(["all_1_1_0", "all_2_2_0"]);
    expect(table.plan({ columns: ["city"] }).rows).toHaveLength(1);
  });

  it("argMax gets the latest value without FINAL", () => {
    const rows = [{ id: 7, ver: 1, city: "Lima" }, { id: 7, ver: 3, city: "Bogotá" }, { id: 7, ver: 2, city: "Quito" }];
    expect(argMaxByKey(rows, ["id"], "city", "ver")).toEqual([{ id: 7, city: "Bogotá" }]);
  });
});

describe("SummingMergeTree", () => {
  it("sums per key on merge and drops rows that sum to zero", () => {
    const table = new Table({ name: "views", orderBy: ["page"], engine: { type: "Summing" }, columns: cols(["page", "views"]) });
    table.insertRows([{ page: 1, views: 5 }, { page: 2, views: 3 }]);
    table.insertRows([{ page: 1, views: 2 }, { page: 2, views: -3 }]);
    expect(sumByKey(table.plan({ columns: ["views"] }).rows!, ["page"], ["views"])).toEqual([{ page: 1, views: 7 }]);
    table.merge(["all_1_1_0", "all_2_2_0"]);
    expect(table.plan({ columns: ["views"] }).rows).toEqual([{ page: 1, views: 7 }]);
  });
});

describe("AggregatingMergeTree", () => {
  it("merges uniq states (unions) instead of counting twice", () => {
    const out = collapse([{ day: 1, users: [1, 2, 3] }, { day: 1, users: [2, 3, 4] }], { type: "Aggregating", states: ["users"] }, ["day"]);
    expect(out).toEqual([{ day: 1, users: [1, 2, 3, 4] }]);
  });
});

describe("CollapsingMergeTree", () => {
  it("a −1 row cancels its +1 state row", () => {
    const rows = [{ user: 1, views: 5, sign: 1 }, { user: 1, views: 5, sign: -1 }, { user: 1, views: 6, sign: 1 }];
    expect(collapse(rows, { type: "Collapsing", sign: "sign" }, ["user"])).toEqual([{ user: 1, views: 6, sign: 1 }]);
    expect(sumByKey(rows, ["user"], ["views"], "sign")).toEqual([{ user: 1, views: 6 }]);
  });
});

describe("CoalescingMergeTree", () => {
  it("keeps the latest non-NULL value per column", () => {
    const rows = [{ id: 1, city: "Lima", phone: null }, { id: 1, city: null, phone: 555 }];
    expect(collapse(rows, { type: "Coalescing" }, ["id"])).toEqual([{ id: 1, city: "Lima", phone: 555 }]);
  });
});
