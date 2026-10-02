// World 6 — Changing and expiring data. Facts: docs/research/clickhouse-curriculum.md (World 6).
// Same tiny tables as World 5: one box = one row, with its value printed on it.
import type { Row } from "@/sim/engines";
import type { TableSpec } from "@/sim/table";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

const cols = (spec: [string, string][]) => spec.map(([name, type]) => ({ name, type, bytesPerRow: 1 }));

const customers = (): TableSpec => ({ name: "customers", orderBy: ["id"], columns: cols([["id", "UInt32"], ["city", "String"], ["plan", "String"]]) });
const C = (id: number, city: string, plan: string): Row => ({ id, city, plan });
/** Three parts of three customers: all_1_1_0, all_2_2_0, all_3_3_0. */
const CUSTOMERS: Row[][] = [
  [C(1, "Lima", "free"), C(2, "Madrid", "pro"), C(3, "Quito", "free")],
  [C(4, "Madrid", "free"), C(5, "Bogotá", "pro"), C(6, "Lima", "cancelled")],
  [C(7, "Quito", "free"), C(8, "Santiago", "cancelled"), C(9, "Lima", "pro")],
];

const selectAll = (ctx: LevelCtx) => ctx.show({ columns: ctx.table.columns.map((c) => c.name) }, `SELECT * FROM ${ctx.table.spec.name}`);
const visible = (ctx: LevelCtx) => ctx.table.dataParts.flatMap((p) => ctx.table.visibleRows(p));
/** OPTIMIZE TABLE … FINAL: merge every data part of each partition into one. */
const optimize = async (ctx: LevelCtx) => {
  for (const partition of ctx.table.partitions) {
    const names = ctx.table.dataParts.filter((p) => p.partition === partition).map((p) => p.name);
    if (names.length > 1 || ctx.table.dataParts.some((p) => p.mask?.length) || ctx.table.activeParts.some((p) => p.patch)) await ctx.merge(names);
  }
};

// ---------------------------------------------------------------- 6-1 Mutations

const q61: Question[] = [
  {
    concept: "mutations",
    build: (r) => {
      const rows = randInt(r, 3, 9) * 1000;
      const n = randInt(r, 2, 4);
      return { prompt: msg("6-1.check.cost.q", { n, rows }), input: { type: "number" }, answer: n * rows, explain: msg("6-1.check.cost.why", { n, rows, total: n * rows }) };
    },
  },
  { concept: "mutations", build: (r) => ({ prompt: msg("6-1.check.async.q"), input: choices(r, "6-1.check.async", ["mutations", "done", "parts"]), answer: "mutations", explain: msg("6-1.check.async.why") }) },
  { concept: "mutations", build: (r) => ({ prompt: msg("6-1.check.key.q"), input: choices(r, "6-1.check.key", ["error", "resort", "fine"]), answer: "error", explain: msg("6-1.check.key.why") }) },
  { concept: "mutations", build: (r) => ({ prompt: msg("6-1.check.name.q"), input: choices(r, "6-1.check.name", ["suffix", "same", "level"]), answer: "suffix", explain: msg("6-1.check.name.why") }) },
];

const level61: Level = {
  id: "6-1",
  world: 6,
  title: msg("6-1.title"),
  summary: msg("6-1.summary"),
  table: customers(),
  initialRows: CUSTOMERS,
  steps: [
    {
      kind: "brief",
      title: msg("6-1.brief.title"),
      body: msg("6-1.brief.body"),
      code: "ALTER TABLE customers UPDATE city = 'Cusco' WHERE id = 5;\n\nSELECT command, parts_to_do, is_done\nFROM system.mutations;",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("6-1.one.q"),
        input: { type: "number" },
        answer: 3,
        explain: msg("6-1.one.why"),
        code: "ALTER TABLE customers UPDATE city = 'Cusco' WHERE id = 5",
        reveal: async (c) => void (await c.mutate("UPDATE city = 'Cusco' WHERE id = 5", (r) => (r.id === 5 ? { ...r, city: "Cusco" } : r), ["city"])),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("6-1.three.q"),
        input: { type: "number" },
        answer: 9,
        explain: msg("6-1.three.why"),
        code: "ALTER TABLE customers UPDATE plan = 'pro' WHERE id = 1;\nALTER TABLE customers UPDATE plan = 'pro' WHERE id = 2;\nALTER TABLE customers UPDATE plan = 'pro' WHERE id = 3;",
        reveal: async (c) => {
          for (const id of [1, 2, 3]) await c.mutate(`UPDATE plan = 'pro' WHERE id = ${id}`, (r) => (r.id === id ? { ...r, plan: "pro" } : r), ["plan"]);
        },
      }),
    },
    {
      kind: "task",
      title: msg("6-1.purge.title"),
      body: msg("6-1.purge.body"),
      tools: [
        {
          type: "action",
          id: "delete",
          label: msg("6-1.purge.delete"),
          icon: "trash",
          tone: "danger",
          run: (ctx) => ctx.mutate("DELETE WHERE plan = 'cancelled'", (r) => (r.plan === "cancelled" ? null : r)),
        },
        {
          type: "action",
          id: "select",
          label: msg("6-1.purge.select"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await selectAll(ctx);
            if (!visible(ctx).some((r) => r.plan === "cancelled")) ctx.settings.checked = true;
          },
        },
      ],
      progress: (ctx) => ({ done: (visible(ctx).some((r) => r.plan === "cancelled") ? 0 : 1) + (ctx.settings.checked ? 1 : 0), total: 2 }),
      success: msg("6-1.purge.success"),
      panels: ["mutations", "parts"],
      solution: { actions: ["delete", "select"] },
    },
  ],
  check: q61,
};

// ---------------------------------------------------------------- 6-2 Lightweight DELETE

const q62: Question[] = [
  { concept: "lightweight-delete", build: (r) => ({ prompt: msg("6-2.check.how.q"), input: choices(r, "6-2.check.how", ["mask", "rewrite", "tombstone"]), answer: "mask", explain: msg("6-2.check.how.why") }) },
  { concept: "lightweight-delete", build: (r) => ({ prompt: msg("6-2.check.disk.q"), input: choices(r, "6-2.check.disk", ["merge", "now", "never"]), answer: "merge", explain: msg("6-2.check.disk.why") }) },
  {
    concept: "lightweight-delete",
    build: (r) => {
      const total = randInt(r, 6, 12);
      const gone = randInt(r, 1, 4);
      return { prompt: msg("6-2.check.count.q", { total, gone }), input: { type: "number" }, answer: total - gone, explain: msg("6-2.check.count.why", { total, gone, n: total - gone }) };
    },
  },
  { concept: "drop-partition", build: (r) => ({ prompt: msg("6-2.check.best.q"), input: choices(r, "6-2.check.best", ["drop", "lightweight", "mutation"]), answer: "drop", explain: msg("6-2.check.best.why") }) },
];

const level62: Level = {
  id: "6-2",
  world: 6,
  title: msg("6-2.title"),
  summary: msg("6-2.summary"),
  table: customers(),
  initialRows: CUSTOMERS,
  steps: [
    {
      kind: "brief",
      title: msg("6-2.brief.title"),
      body: msg("6-2.brief.body"),
      code: "DELETE FROM customers WHERE plan = 'cancelled';",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("6-2.cost.q"),
        input: { type: "number" },
        answer: 0,
        explain: msg("6-2.cost.why"),
        code: "DELETE FROM customers WHERE plan = 'cancelled'",
        reveal: async (c) => {
          await c.deleteRows((r) => r.plan === "cancelled");
          await selectAll(c);
        },
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("6-2.space.q"),
        input: choices(ctx.rng, "6-2.space", ["none", "some", "all"]),
        answer: "none",
        explain: msg("6-2.space.why"),
      }),
    },
    {
      kind: "task",
      title: msg("6-2.clean.title"),
      body: msg("6-2.clean.body"),
      tools: [
        { type: "action", id: "delete", label: msg("6-2.clean.delete"), icon: "eraser", tone: "danger", run: (ctx) => ctx.deleteRows((r) => r.city === "Madrid") },
        { type: "action", id: "optimize", label: msg("6-2.clean.optimize"), icon: "press", tone: "accent", run: (ctx) => optimize(ctx) },
        { type: "action", id: "select", label: msg("6-2.clean.select"), icon: "play", run: (ctx) => selectAll(ctx) },
      ],
      progress: (ctx) => {
        const gone = !visible(ctx).some((r) => r.city === "Madrid");
        return { done: (gone ? 1 : 0) + (gone && !ctx.table.dataParts.some((p) => p.mask?.length) ? 1 : 0), total: 2 };
      },
      success: msg("6-2.clean.success"),
      panels: ["parts", "rows"],
      solution: { actions: ["delete", "optimize"] },
    },
  ],
  check: q62,
};

// ---------------------------------------------------------------- 6-3 Lightweight UPDATE (patch parts)

const q63: Question[] = [
  { concept: "lightweight-update", build: (r) => ({ prompt: msg("6-3.check.what.q"), input: choices(r, "6-3.check.what", ["patch", "rewrite", "mask"]), answer: "patch", explain: msg("6-3.check.what.why") }) },
  { concept: "lightweight-update", build: (r) => ({ prompt: msg("6-3.check.status.q"), input: choices(r, "6-3.check.status", ["beta", "ga", "removed"]), answer: "beta", explain: msg("6-3.check.status.why") }) },
  {
    concept: "lightweight-update",
    build: (r) => {
      const rows = randInt(r, 2, 6);
      const changed = randInt(r, 1, 3);
      return { prompt: msg("6-3.check.boxes.q", { rows, changed }), input: { type: "number" }, answer: rows * (changed + 1), explain: msg("6-3.check.boxes.why", { rows, changed, n: rows * (changed + 1) }) };
    },
  },
  { concept: "lightweight-update", build: (r) => ({ prompt: msg("6-3.check.when.q"), input: choices(r, "6-3.check.when", ["merge", "never", "select"]), answer: "merge", explain: msg("6-3.check.when.why") }) },
];

const level63: Level = {
  id: "6-3",
  world: 6,
  title: msg("6-3.title"),
  summary: msg("6-3.summary"),
  table: customers(),
  initialRows: CUSTOMERS,
  steps: [
    {
      kind: "brief",
      title: msg("6-3.brief.title"),
      body: msg("6-3.brief.body"),
      code: "-- Beta since 25.8 (patch parts)\nUPDATE customers SET plan = 'pro' WHERE id = 2;",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("6-3.size.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("6-3.size.why"),
        code: "UPDATE customers SET plan = 'pro' WHERE id = 4",
        reveal: async (c) => void (await c.patchUpdate((r) => r.id === 4, { plan: "pro" })),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("6-3.read.q"),
        input: choices(ctx.rng, "6-3.read", ["pro", "free", "both"]),
        answer: "pro",
        explain: msg("6-3.read.why"),
        code: "SELECT * FROM customers",
        reveal: async (c) => void (await selectAll(c)),
      }),
    },
    {
      kind: "task",
      title: msg("6-3.absorb.title"),
      body: msg("6-3.absorb.body"),
      tools: [
        { type: "action", id: "patch", label: msg("6-3.absorb.patch"), icon: "pencil", tone: "accent", run: (ctx) => ctx.patchUpdate((r) => r.city === "Lima", { plan: "pro" }) },
        { type: "action", id: "optimize", label: msg("6-3.absorb.optimize"), icon: "press", tone: "primary", run: (ctx) => optimize(ctx) },
        { type: "action", id: "select", label: msg("6-3.absorb.select"), icon: "play", run: (ctx) => selectAll(ctx) },
      ],
      progress: (ctx) => {
        const lima = visible(ctx).filter((r) => r.city === "Lima");
        const done = lima.every((r) => r.plan === "pro");
        return { done: (done ? 1 : 0) + (done && !ctx.table.activeParts.some((p) => p.patch) ? 1 : 0), total: 2 };
      },
      success: msg("6-3.absorb.success"),
      panels: ["parts", "rows"],
      solution: { actions: ["patch", "optimize"] },
    },
  ],
  check: q63,
};

// ---------------------------------------------------------------- 6-4 TTL

const TTL_DAYS = 30;
const events = (): TableSpec => ({ name: "events", orderBy: ["day"], columns: cols([["day", "Date"], ["user", "UInt32"]]) });
const E = (day: number, user: number): Row => ({ day, user });
const expiredRows = (ctx: LevelCtx) => visible(ctx).filter((r) => Number(r.day) + TTL_DAYS <= Number(ctx.settings.today)).length;

const q64: Question[] = [
  { concept: "ttl", build: (r) => ({ prompt: msg("6-4.check.when.q"), input: choices(r, "6-4.check.when", ["merge", "instant", "select"]), answer: "merge", explain: msg("6-4.check.when.why") }) },
  {
    concept: "ttl",
    build: (r) => {
      const day = randInt(r, 1, 20);
      const days = [7, 30, 90][randInt(r, 0, 2)];
      return { prompt: msg("6-4.check.expires.q", { day, days }), input: { type: "number" }, answer: day + days, explain: msg("6-4.check.expires.why", { day, days, n: day + days }) };
    },
  },
  { concept: "ttl", build: (r) => ({ prompt: msg("6-4.check.timeout.q"), input: choices(r, "6-4.check.timeout", ["h4", "s1", "d1"]), answer: "h4", explain: msg("6-4.check.timeout.why") }) },
  { concept: "ttl", build: (r) => ({ prompt: msg("6-4.check.dropParts.q"), input: choices(r, "6-4.check.dropParts", ["whole", "rows", "never"]), answer: "whole", explain: msg("6-4.check.dropParts.why") }) },
];

const level64: Level = {
  id: "6-4",
  world: 6,
  title: msg("6-4.title"),
  summary: msg("6-4.summary"),
  table: events(),
  initialRows: [
    [E(1, 3), E(2, 5), E(3, 1)],
    [E(8, 2), E(25, 4), E(38, 6)],
    [E(36, 7), E(39, 8)],
  ],
  settings: { today: 40, ttlColumn: "day", ttlDays: TTL_DAYS },
  steps: [
    {
      kind: "brief",
      title: msg("6-4.brief.title"),
      body: msg("6-4.brief.body"),
      code: "CREATE TABLE events (day Date, user UInt32)\nENGINE = MergeTree ORDER BY day\nTTL day + INTERVAL 30 DAY;",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("6-4.before.q"),
        input: { type: "number" },
        answer: 8,
        explain: msg("6-4.before.why"),
        code: "-- today = day 40\nSELECT count() FROM events",
        reveal: async (c) => void (await selectAll(c)),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("6-4.merge.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("6-4.merge.why"),
        reveal: async (c) => {
          await c.ttlMerge("day", TTL_DAYS);
          await selectAll(c);
        },
      }),
    },
    {
      kind: "task",
      title: msg("6-4.calendar.title"),
      body: msg("6-4.calendar.body"),
      tools: [
        {
          type: "action",
          id: "advance",
          label: msg("6-4.calendar.advance"),
          icon: "truck",
          tone: "accent",
          run: async (ctx) => {
            const today = Number(ctx.settings.today) + 10;
            ctx.settings.today = today;
            await ctx.insertRows([E(today - 4, randInt(ctx.rng, 1, 99)), E(today, randInt(ctx.rng, 1, 99))]);
          },
        },
        { type: "action", id: "ttl", label: msg("6-4.calendar.ttl"), icon: "press", tone: "primary", run: (ctx) => ctx.ttlMerge("day", TTL_DAYS) },
        { type: "action", id: "select", label: msg("6-4.calendar.select"), icon: "play", run: (ctx) => selectAll(ctx) },
      ],
      progress: (ctx) => {
        const reached = Number(ctx.settings.today) >= 70;
        return { done: (reached ? 1 : 0) + (reached && expiredRows(ctx) === 0 ? 1 : 0), total: 2 };
      },
      success: msg("6-4.calendar.success"),
      panels: ["ttl", "parts"],
      solution: { actions: ["advance", "advance", "advance", "ttl"] },
    },
  ],
  check: q64,
};

// ---------------------------------------------------------------- 6-5 Tiered storage

const HOT_CAPACITY = 4;
const metrics = (): TableSpec => ({ name: "metrics", orderBy: ["month"], columns: cols([["month", "UInt32"], ["value", "UInt32"]]) });
const MONTHS = ["202601", "202602", "202603", "202604", "202605", "202606", "202607", "202608", "202609", "202610", "202611", "202612"];
const monthRows = (m: string, seed: number): Row[] => [{ month: Number(m), value: 10 + seed }, { month: Number(m), value: 30 + seed }];
const hotParts = (ctx: LevelCtx) => ctx.table.dataParts.filter((p) => (p.disk ?? "hot") === "hot");
/** TTL month + INTERVAL 2 MONTH TO VOLUME 'cold': all but the two newest months leave the SSD. */
const ttlMove = (ctx: LevelCtx) => {
  const months = [...new Set(ctx.table.dataParts.map((p) => p.partition))].sort();
  const old = months.slice(0, -2);
  return ctx.moveParts(ctx.table.dataParts.filter((p) => old.includes(p.partition)).map((p) => p.name), "s3");
};

const q65: Question[] = [
  { concept: "tiered-storage", build: (r) => ({ prompt: msg("6-5.check.unit.q"), input: choices(r, "6-5.check.unit", ["parts", "rows", "columns"]), answer: "parts", explain: msg("6-5.check.unit.why") }) },
  { concept: "tiered-storage", build: (r) => ({ prompt: msg("6-5.check.query.q"), input: choices(r, "6-5.check.query", ["transparent", "restore", "lost"]), answer: "transparent", explain: msg("6-5.check.query.why") }) },
  {
    concept: "tiered-storage",
    build: (r) => {
      const size = [100, 200, 500, 1000][randInt(r, 0, 3)];
      return { prompt: msg("6-5.check.factor.q", { size }), input: { type: "number" }, answer: size / 10, explain: msg("6-5.check.factor.why", { size, n: size / 10 }) };
    },
  },
  { concept: "ttl", build: (r) => ({ prompt: msg("6-5.check.actions.q"), input: choices(r, "6-5.check.actions", ["volume", "update", "index"]), answer: "volume", explain: msg("6-5.check.actions.why") }) },
];

const level65: Level = {
  id: "6-5",
  world: 6,
  title: msg("6-5.title"),
  summary: msg("6-5.summary"),
  table: metrics(),
  // Months 202601–202604 start on the hot SSD, one partition each
  initialRows: MONTHS.slice(0, 4).map((m, i) => ({ rows: monthRows(m, i), options: { partition: m, disk: "hot" } })),
  steps: [
    {
      kind: "brief",
      title: msg("6-5.brief.title"),
      body: msg("6-5.brief.body"),
      code: "CREATE TABLE metrics (month UInt32, value UInt32)\nENGINE = MergeTree\nPARTITION BY month ORDER BY month\nTTL toDate(month) + INTERVAL 2 MONTH TO VOLUME 'cold'\nSETTINGS storage_policy = 'hot_to_s3';",
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("6-5.move.q"),
        input: choices(ctx.rng, "6-5.move", ["copy", "rewrite", "delete"]),
        answer: "copy",
        explain: msg("6-5.move.why"),
        code: "ALTER TABLE metrics MOVE PARTITION 202601 TO VOLUME 'cold'",
        reveal: async (c) => void (await c.moveParts(c.table.dataParts.filter((p) => p.partition === "202601").map((p) => p.name), "s3")),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("6-5.query.q"),
        input: choices(ctx.rng, "6-5.query", ["all", "hot", "error"]),
        answer: "all",
        explain: msg("6-5.query.why"),
        code: "SELECT * FROM metrics",
        reveal: async (c) => void (await selectAll(c)),
      }),
    },
    {
      kind: "task",
      title: msg("6-5.months.title"),
      body: msg("6-5.months.body", { cap: HOT_CAPACITY }),
      onEnter: (ctx) => {
        ctx.settings.next = 4;
      },
      tools: [
        {
          type: "action",
          id: "newMonth",
          label: msg("6-5.months.newMonth"),
          icon: "truck",
          tone: "accent",
          run: async (ctx) => {
            const i = Number(ctx.settings.next);
            if (i >= MONTHS.length) return;
            if (hotParts(ctx).length >= HOT_CAPACITY) {
              ctx.stats.rejected++;
              await ctx.stage.turnAway("full");
              return;
            }
            ctx.settings.next = i + 1;
            await ctx.insertRows(monthRows(MONTHS[i], i), { partition: MONTHS[i], disk: "hot" });
          },
        },
        { type: "action", id: "ttlMove", label: msg("6-5.months.ttlMove"), icon: "press", tone: "primary", run: (ctx) => ttlMove(ctx) },
        { type: "action", id: "select", label: msg("6-5.months.select"), icon: "play", run: (ctx) => selectAll(ctx) },
      ],
      progress: (ctx, start) => ({ done: Math.min(3, ctx.stats.inserts - start.inserts), total: 3 }),
      success: msg("6-5.months.success"),
      panels: ["disks", "parts"],
      solution: { actions: ["ttlMove", "newMonth", "newMonth", "ttlMove", "newMonth"] },
    },
  ],
  check: q65,
};

export const WORLD6: Level[] = [level61, level62, level63, level64, level65];
