import { describe, expect, it } from "vitest";
import { Table } from "./table";

const users = () => {
  const t = new Table({ name: "users", orderBy: ["id"], columns: ["id", "city"].map((name) => ({ name, type: "", bytesPerRow: 1 })) });
  t.insertRows([{ id: 1, city: "Lima" }, { id: 2, city: "Madrid" }, { id: 3, city: "Quito" }]);
  t.insertRows([{ id: 4, city: "Madrid" }, { id: 5, city: "Bogotá" }, { id: 6, city: "Lima" }]);
  return t;
};

describe("mutations", () => {
  it("rewrite every part with a matching row, whole, under a new name", () => {
    const t = users();
    const { mutation, changes } = t.mutate("UPDATE city = 'Lima' WHERE id = 4", (r) => (r.id === 4 ? { ...r, city: "Lima" } : r), ["city"]);
    expect(changes).toHaveLength(1);
    expect(changes[0].from.name).toBe("all_2_2_0");
    expect(changes[0].to!.name).toBe("all_2_2_0_3");
    expect(changes[0].to!.rows).toBe(3);
    expect(mutation.partsToDo).toBe(1);
    expect(t.dataParts.map((p) => p.name)).toEqual(["all_1_1_0", "all_2_2_0_3"]);
  });
  it("refuse to update a key column", () => {
    expect(() => users().mutate("UPDATE id = 9", (r) => r, ["id"])).toThrow(/key column/);
  });
});

describe("lightweight DELETE", () => {
  it("masks rows in place; a merge drops them", () => {
    const t = users();
    const hit = t.deleteRows((r) => r.city === "Madrid");
    expect(hit.map((h) => h.rows.length)).toEqual([1, 1]);
    expect(t.plan({ columns: ["city"] }).rows).toHaveLength(4);
    const m = t.merge(["all_1_1_0", "all_2_2_0"]);
    expect(m.rows).toBe(4);
  });
});

describe("lightweight UPDATE (patch parts)", () => {
  it("applies on read and is absorbed by the merge", () => {
    const t = users();
    const patch = t.patchUpdate((r) => r.id === 2, { city: "Lima" })!;
    expect(patch.patch!.targets).toEqual(["all_1_1_0"]);
    expect(t.plan({ columns: ["city"] }).rows!.find((r) => r.id === 2)!.city).toBe("Lima");
    expect(t.selectMerge()).toEqual(["all_1_1_0", "all_2_2_0"]);
    const m = t.merge(["all_1_1_0", "all_2_2_0"]);
    expect(m.data!.find((r) => r.id === 2)!.city).toBe("Lima");
    expect(t.activeParts.some((p) => p.patch)).toBe(false);
  });
});

describe("TTL", () => {
  it("removes expired rows only when a TTL merge runs; fully expired parts are dropped", () => {
    const t = new Table({ name: "events", orderBy: ["day"], columns: ["day"].map((name) => ({ name, type: "", bytesPerRow: 1 })) });
    t.insertRows([{ day: 1 }, { day: 2 }]);
    t.insertRows([{ day: 3 }, { day: 20 }]);
    expect(t.plan({ columns: ["day"] }).rows).toHaveLength(4);
    const changes = t.ttlMerge(35, "day", 30);
    expect(changes.map((c) => c.to?.name ?? null)).toEqual([null, "all_2_2_1"]);
    expect(t.plan({ columns: ["day"] }).rows).toEqual([{ day: 20 }]);
  });
});

describe("tiered storage", () => {
  it("moves whole parts between disks", () => {
    const t = new Table({ name: "x", columns: [{ name: "a", type: "", bytesPerRow: 1 }] });
    const p = t.insert(10, { partition: "202607", disk: "hot" })!;
    expect(t.moveParts([p.name], "s3")).toHaveLength(1);
    expect(p.disk).toBe("s3");
  });
});
