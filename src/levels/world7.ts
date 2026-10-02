// World 7 — Skipping indexes & projections. Facts: docs/research/clickhouse-curriculum.md (World 7).
// Tables of 8 granules (one box per granule and column) whose non-key columns carry per-granule
// stats, so skip indexes and the query condition cache have something to rule out.
import type { ColumnStats, InsertOptions, QuerySpec, SkipIndex, TableSpec } from "@/sim/table";
import { rowsFor } from "./session";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

const ROWS = rowsFor(8);
const col = (name: string, type: string, bytesPerRow: number, distinct?: number) => ({ name, type, bytesPerRow, distinct });

/** orders: ORDER BY date; order_id grows with the date (correlated), total is all over the place. */
const ORDER_COLS: InsertOptions["cols"] = (g) => ({
  order_id: { min: g * 1000, max: g * 1000 + 999 },
  total: { min: g % 3, max: 997 + (g % 3) },
});
const orders = (indexes: SkipIndex[] = []): TableSpec => ({
  name: "orders",
  orderBy: ["date"],
  columns: [col("date", "Date", 2), col("order_id", "UInt64", 8), col("total", "UInt32", 4)],
  indexes,
});
const ordersInitial = [{ rows: ROWS, options: { keyRange: [0, 29] as [number, number], cols: ORDER_COLS } }];

const run = (ctx: LevelCtx, spec: QuerySpec) => ctx.query(spec);
const where = (column: string, v: number, label?: string) => ({ column, min: v, max: v, label });
/** (Re)define an index and build it for every part: ADD INDEX + MATERIALIZE INDEX. */
const rebuild = async (ctx: LevelCtx, index: SkipIndex) => {
  ctx.table.addIndex(index);
  await ctx.materialize("index", index.name);
};

// ---------------------------------------------------------------- 7-1 Skip a block, not a row

const q71: Question[] = [
  { concept: "skip-index", build: (r) => ({ prompt: msg("7-1.check.what.q"), input: choices(r, "7-1.check.what", ["blocks", "rows", "sort"]), answer: "blocks", explain: msg("7-1.check.what.why") }) },
  { concept: "skip-index", build: (r) => ({ prompt: msg("7-1.check.correlation.q"), input: choices(r, "7-1.check.correlation", ["correlated", "random", "any"]), answer: "correlated", explain: msg("7-1.check.correlation.why") }) },
  {
    concept: "skip-index",
    build: (r) => {
      const n = randInt(r, 6, 12);
      return { prompt: msg("7-1.check.random.q", { n }), input: { type: "number" }, answer: n, explain: msg("7-1.check.random.why", { n }) };
    },
  },
  { concept: "skip-index", build: (r) => ({ prompt: msg("7-1.check.cost.q"), input: choices(r, "7-1.check.cost", ["cost", "free", "faster"]), answer: "cost", explain: msg("7-1.check.cost.why") }) },
];

const level71: Level = {
  id: "7-1",
  world: 7,
  title: msg("7-1.title"),
  summary: msg("7-1.summary"),
  table: orders([
    { name: "idx_order", column: "order_id", type: "minmax", granularity: 1 },
    { name: "idx_total", column: "total", type: "minmax", granularity: 1 },
  ]),
  initial: ordersInitial,
  steps: [
    {
      kind: "brief",
      title: msg("7-1.brief.title"),
      body: msg("7-1.brief.body"),
      code: "ALTER TABLE orders\n  ADD INDEX idx_order order_id TYPE minmax GRANULARITY 1,\n  ADD INDEX idx_total total TYPE minmax GRANULARITY 1;",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("7-1.order.q"),
        input: { type: "number" },
        answer: 1,
        explain: msg("7-1.order.why"),
        code: "SELECT total FROM orders WHERE order_id = 3500",
        reveal: async (c) => void (await run(c, { columns: ["total"], where: where("order_id", 3500) })),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("7-1.total.q"),
        input: { type: "number" },
        answer: 8,
        explain: msg("7-1.total.why"),
        code: "SELECT order_id FROM orders WHERE total = 500",
        reveal: async (c) => void (await run(c, { columns: ["order_id"], where: where("total", 500) })),
      }),
    },
    {
      kind: "task",
      title: msg("7-1.cleanup.title"),
      body: msg("7-1.cleanup.body"),
      tools: [
        {
          type: "action",
          id: "qOrder",
          label: msg("7-1.cleanup.qOrder"),
          icon: "play",
          run: async (ctx) => {
            await run(ctx, { columns: ["total"], where: where("order_id", 6200) });
            ctx.settings.ranOrder = true;
          },
        },
        {
          type: "action",
          id: "qTotal",
          label: msg("7-1.cleanup.qTotal"),
          icon: "play",
          run: async (ctx) => {
            await run(ctx, { columns: ["order_id"], where: where("total", 120) });
            ctx.settings.ranTotal = true;
          },
        },
        {
          type: "action",
          id: "drop",
          label: msg("7-1.cleanup.drop"),
          icon: "trash",
          tone: "danger",
          run: async (ctx) => {
            ctx.table.dropIndex("idx_total");
            ctx.settings.dropped = true;
          },
        },
      ],
      progress: (ctx) => ({ done: [ctx.settings.ranOrder, ctx.settings.ranTotal, ctx.settings.dropped].filter(Boolean).length, total: 3 }),
      success: msg("7-1.cleanup.success"),
      panels: ["skipIndex", "explain"],
      solution: { actions: ["qOrder", "qTotal", "drop"] },
    },
  ],
  check: q71,
};

// ---------------------------------------------------------------- 7-2 set and bloom_filter

/** logs: status 0 info / 1 error / 2 warn (errors only in granule 5); each trace lives in one granule. */
const LOG_COLS: InsertOptions["cols"] = (g) => {
  const out: Record<string, ColumnStats> = {
    status: g === 5 ? { min: 0, max: 2, values: [0, 1, 2] } : { min: 0, max: 2, values: [0, 2] },
    trace_id: { min: g, max: g + 72, values: Array.from({ length: 10 }, (_, k) => g + 8 * k) },
  };
  return out;
};
const logs = (): TableSpec => ({ name: "logs", orderBy: ["ts"], columns: [col("ts", "DateTime", 4), col("status", "Enum8", 1), col("trace_id", "UInt64", 8)] });
const qStatus: QuerySpec = { columns: ["ts"], where: where("status", 1, "'error'") };
const qTrace: QuerySpec = { columns: ["ts"], where: where("trace_id", 42) };

const q72: Question[] = [
  { concept: "bloom-filter", build: (r) => ({ prompt: msg("7-2.check.bloom.q"), input: choices(r, "7-2.check.bloom", ["maybe", "exact", "range"]), answer: "maybe", explain: msg("7-2.check.bloom.why") }) },
  { concept: "bloom-filter", build: (r) => ({ prompt: msg("7-2.check.fpr.q"), input: choices(r, "7-2.check.fpr", ["p025", "p0", "p50"]), answer: "p025", explain: msg("7-2.check.fpr.why") }) },
  { concept: "skip-index", build: (r) => ({ prompt: msg("7-2.check.set.q"), input: choices(r, "7-2.check.set", ["giveUp", "error", "sample"]), answer: "giveUp", explain: msg("7-2.check.set.why") }) },
  { concept: "skip-index", build: (r) => ({ prompt: msg("7-2.check.text.q"), input: choices(r, "7-2.check.text", ["text", "minmax", "projection"]), answer: "text", explain: msg("7-2.check.text.why") }) },
];

const level72: Level = {
  id: "7-2",
  world: 7,
  title: msg("7-2.title"),
  summary: msg("7-2.summary"),
  table: logs(),
  initial: [{ rows: ROWS, options: { keyRange: [0, 29], cols: LOG_COLS } }],
  settings: { statusIdx: "minmax", traceIdx: "minmax" },
  steps: [
    {
      kind: "brief",
      title: msg("7-2.brief.title"),
      body: msg("7-2.brief.body"),
      code: "INDEX idx_status status   TYPE set(10)            GRANULARITY 1\nINDEX idx_trace  trace_id TYPE bloom_filter(0.025) GRANULARITY 1",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("7-2.set.q"),
        input: { type: "number" },
        answer: 1,
        explain: msg("7-2.set.why"),
        code: "ADD INDEX idx_status status TYPE set(10);\nSELECT ts FROM logs WHERE status = 'error'",
        reveal: async (c) => {
          await rebuild(c, { name: "idx_status", column: "status", type: "set", granularity: 1, n: 10 });
          await run(c, qStatus);
        },
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("7-2.bloom.q"),
        input: choices(ctx.rng, "7-2.bloom", ["one", "oneplus", "all"]),
        answer: "oneplus",
        explain: msg("7-2.bloom.why"),
        code: "ADD INDEX idx_trace trace_id TYPE bloom_filter(0.25);\nSELECT ts FROM logs WHERE trace_id = 42",
        reveal: async (c) => {
          await rebuild(c, { name: "idx_trace", column: "trace_id", type: "bloom_filter", granularity: 1, fpr: 0.25 });
          await run(c, qTrace);
        },
      }),
    },
    {
      kind: "task",
      title: msg("7-2.pick.title"),
      body: msg("7-2.pick.body"),
      tools: [
        { type: "setting", field: "statusIdx", label: msg("7-2.pick.statusIdx"), options: ["minmax", "set"], labels: "7-2.pick.types" },
        { type: "setting", field: "traceIdx", label: msg("7-2.pick.traceIdx"), options: ["minmax", "bloom_filter"], labels: "7-2.pick.types" },
        {
          type: "action",
          id: "qStatus",
          label: msg("7-2.pick.qStatus"),
          icon: "play",
          run: async (ctx) => {
            const type = ctx.settings.statusIdx as "minmax" | "set";
            await rebuild(ctx, { name: "idx_status", column: "status", type, granularity: 1, n: type === "set" ? 10 : undefined });
            const r = await run(ctx, qStatus);
            ctx.settings.statusOk = r.granulesRead <= 2;
          },
        },
        {
          type: "action",
          id: "qTrace",
          label: msg("7-2.pick.qTrace"),
          icon: "play",
          run: async (ctx) => {
            const type = ctx.settings.traceIdx as "minmax" | "bloom_filter";
            await rebuild(ctx, { name: "idx_trace", column: "trace_id", type, granularity: 1 });
            const r = await run(ctx, qTrace);
            ctx.settings.traceOk = r.granulesRead <= 2;
          },
        },
      ],
      progress: (ctx) => ({ done: (ctx.settings.statusOk ? 1 : 0) + (ctx.settings.traceOk ? 1 : 0), total: 2 }),
      success: msg("7-2.pick.success"),
      panels: ["skipIndex", "explain"],
      solution: { settings: { statusIdx: "set", traceIdx: "bloom_filter" }, actions: ["qStatus", "qTrace"] },
    },
  ],
  check: q72,
};

// ---------------------------------------------------------------- 7-3 GRANULARITY and MATERIALIZE

const q73: Question[] = [
  {
    concept: "index-granularity",
    build: (r) => {
      const n = [2, 4, 8][randInt(r, 0, 2)];
      return { prompt: msg("7-3.check.rows.q", { n }), input: { type: "number" }, answer: n * 8192, explain: msg("7-3.check.rows.why", { n, rows: n * 8192 }) };
    },
  },
  { concept: "index-granularity", build: (r) => ({ prompt: msg("7-3.check.add.q"), input: choices(r, "7-3.check.add", ["newOnly", "all", "none"]), answer: "newOnly", explain: msg("7-3.check.add.why") }) },
  { concept: "index-granularity", build: (r) => ({ prompt: msg("7-3.check.materialize.q"), input: choices(r, "7-3.check.materialize", ["mutation", "instant", "merge"]), answer: "mutation", explain: msg("7-3.check.materialize.why") }) },
  { concept: "index-granularity", build: (r) => ({ prompt: msg("7-3.check.tradeoff.q"), input: choices(r, "7-3.check.tradeoff", ["coarse", "finer", "same"]), answer: "coarse", explain: msg("7-3.check.tradeoff.why") }) },
];

const qOrder: QuerySpec = { columns: ["total"], where: where("order_id", 3500) };

const level73: Level = {
  id: "7-3",
  world: 7,
  title: msg("7-3.title"),
  summary: msg("7-3.summary"),
  table: orders(),
  initial: ordersInitial,
  settings: { gran: 4 },
  steps: [
    {
      kind: "brief",
      title: msg("7-3.brief.title"),
      body: msg("7-3.brief.body"),
      code: "ALTER TABLE orders ADD INDEX idx_order order_id TYPE minmax GRANULARITY 4;\nALTER TABLE orders MATERIALIZE INDEX idx_order;",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("7-3.added.q"),
        input: { type: "number" },
        answer: 8,
        explain: msg("7-3.added.why"),
        code: "ALTER TABLE orders ADD INDEX idx_order order_id TYPE minmax GRANULARITY 4;\nSELECT total FROM orders WHERE order_id = 3500",
        reveal: async (c) => {
          c.table.addIndex({ name: "idx_order", column: "order_id", type: "minmax", granularity: 4 });
          await run(c, qOrder);
        },
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("7-3.materialized.q"),
        input: { type: "number" },
        answer: 4,
        explain: msg("7-3.materialized.why"),
        code: "ALTER TABLE orders MATERIALIZE INDEX idx_order;\nSELECT total FROM orders WHERE order_id = 3500",
        reveal: async (c) => {
          await c.materialize("index", "idx_order");
          await run(c, qOrder);
        },
      }),
    },
    {
      kind: "task",
      title: msg("7-3.tune.title"),
      body: msg("7-3.tune.body"),
      tools: [
        { type: "setting", field: "gran", label: msg("7-3.tune.gran"), options: [8, 4, 2, 1], labels: "7-3.tune.grans" },
        {
          type: "action",
          id: "rebuild",
          label: msg("7-3.tune.rebuild"),
          icon: "press",
          tone: "primary",
          run: async (ctx) => {
            await rebuild(ctx, { name: "idx_order", column: "order_id", type: "minmax", granularity: Number(ctx.settings.gran) });
            const r = await run(ctx, qOrder);
            if (r.granulesRead === 1) ctx.settings.tuned = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.tuned ? 1 : 0, total: 1 }),
      success: msg("7-3.tune.success"),
      panels: ["skipIndex", "explain"],
      solution: { settings: { gran: 1 }, actions: ["rebuild"] },
    },
  ],
  check: q73,
};

// ---------------------------------------------------------------- 7-4 Projections

const PROJ = { name: "by_customer", orderBy: "customer_id", columns: ["customer_id", "total"] };
const sales = (): TableSpec => ({
  name: "orders",
  orderBy: ["date"],
  columns: [col("date", "Date", 2), col("customer_id", "UInt32", 4, 5000), col("total", "UInt32", 4), col("status", "Enum8", 1)],
});
const qCustomer: QuerySpec = { columns: ["total"], where: where("customer_id", 1234) };

const q74: Question[] = [
  { concept: "projections", build: (r) => ({ prompt: msg("7-4.check.what.q"), input: choices(r, "7-4.check.what", ["hidden", "view", "index"]), answer: "hidden", explain: msg("7-4.check.what.why") }) },
  { concept: "projections", build: (r) => ({ prompt: msg("7-4.check.query.q"), input: choices(r, "7-4.check.query", ["auto", "name", "hint"]), answer: "auto", explain: msg("7-4.check.query.why") }) },
  { concept: "projections", build: (r) => ({ prompt: msg("7-4.check.cost.q"), input: choices(r, "7-4.check.cost", ["both", "free", "reads"]), answer: "both", explain: msg("7-4.check.cost.why") }) },
  { concept: "projections", build: (r) => ({ prompt: msg("7-4.check.missing.q"), input: choices(r, "7-4.check.missing", ["base", "error", "partial"]), answer: "base", explain: msg("7-4.check.missing.why") }) },
];

const level74: Level = {
  id: "7-4",
  world: 7,
  title: msg("7-4.title"),
  summary: msg("7-4.summary"),
  table: sales(),
  initial: [{ rows: ROWS, options: { keyRange: [0, 29] } }],
  // ADD PROJECTION after the data was there: the old part doesn't have it yet
  setup: (t) => t.addProjection(PROJ),
  steps: [
    {
      kind: "brief",
      title: msg("7-4.brief.title"),
      body: msg("7-4.brief.body"),
      code: "ALTER TABLE orders ADD PROJECTION by_customer (\n  SELECT customer_id, total ORDER BY customer_id\n);",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("7-4.before.q"),
        input: { type: "number" },
        answer: 8,
        explain: msg("7-4.before.why"),
        code: "SELECT total FROM orders WHERE customer_id = 1234",
        reveal: async (c) => void (await run(c, qCustomer)),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("7-4.after.q"),
        input: choices(ctx.rng, "7-4.after", ["proj", "base", "both"]),
        answer: "proj",
        explain: msg("7-4.after.why"),
        code: "ALTER TABLE orders MATERIALIZE PROJECTION by_customer;\nSELECT total FROM orders WHERE customer_id = 1234",
        reveal: async (c) => {
          await c.materialize("projection", PROJ.name);
          await run(c, qCustomer);
        },
      }),
    },
    {
      kind: "task",
      title: msg("7-4.paths.title"),
      body: msg("7-4.paths.body"),
      tools: [
        {
          type: "action",
          id: "qDate",
          label: msg("7-4.paths.qDate"),
          icon: "play",
          run: async (ctx) => {
            await run(ctx, { columns: ["total"], where: where("date", 3) });
            ctx.settings.ranDate = true;
          },
        },
        {
          type: "action",
          id: "qCustomer",
          label: msg("7-4.paths.qCustomer"),
          icon: "play",
          run: async (ctx) => {
            await run(ctx, { columns: ["total"], where: where("customer_id", 4321) });
            ctx.settings.ranCustomer = true;
          },
        },
        {
          type: "action",
          id: "qStatus",
          label: msg("7-4.paths.qStatus"),
          icon: "play",
          run: async (ctx) => {
            await run(ctx, { columns: ["status"], where: where("customer_id", 4321) });
            ctx.settings.ranStatus = true;
          },
        },
      ],
      progress: (ctx) => ({ done: [ctx.settings.ranDate, ctx.settings.ranCustomer, ctx.settings.ranStatus].filter(Boolean).length, total: 3 }),
      success: msg("7-4.paths.success"),
      panels: ["explain", "reading"],
      solution: { actions: ["qDate", "qCustomer", "qStatus"] },
    },
  ],
  check: q74,
};

// ---------------------------------------------------------------- 7-5 Query condition cache

/** Timeouts (message code 7) only show up in granules 2 and 6. */
const MSG_COLS: InsertOptions["cols"] = (g) => ({ message: g === 2 || g === 6 ? { min: 1, max: 7, values: [1, 3, 7] } : { min: 1, max: 5, values: [1, 3, 5] } });
const qTimeout: QuerySpec = { columns: ["user"], where: where("message", 7, "LIKE '%timeout%'") };

const q75: Question[] = [
  { concept: "condition-cache", build: (r) => ({ prompt: msg("7-5.check.stores.q"), input: choices(r, "7-5.check.stores", ["bits", "results", "rows"]), answer: "bits", explain: msg("7-5.check.stores.why") }) },
  { concept: "condition-cache", build: (r) => ({ prompt: msg("7-5.check.default.q"), input: choices(r, "7-5.check.default", ["on", "off", "cloud"]), answer: "on", explain: msg("7-5.check.default.why") }) },
  {
    concept: "condition-cache",
    build: (r) => {
      const hits = randInt(r, 1, 3);
      const total = randInt(r, 8, 12);
      return { prompt: msg("7-5.check.second.q", { hits, total }), input: { type: "number" }, answer: hits, explain: msg("7-5.check.second.why", { hits, total }) };
    },
  },
  { concept: "condition-cache", build: (r) => ({ prompt: msg("7-5.check.newPart.q"), input: choices(r, "7-5.check.newPart", ["full", "cached", "skipped"]), answer: "full", explain: msg("7-5.check.newPart.why") }) },
];

const level75: Level = {
  id: "7-5",
  world: 7,
  title: msg("7-5.title"),
  summary: msg("7-5.summary"),
  table: { name: "logs", orderBy: ["ts"], columns: [col("ts", "DateTime", 4), col("message", "String", 24), col("user", "UInt32", 4)], settings: { conditionCache: true } },
  initial: [{ rows: ROWS, options: { keyRange: [0, 29], cols: MSG_COLS } }],
  steps: [
    {
      kind: "brief",
      title: msg("7-5.brief.title"),
      body: msg("7-5.brief.body"),
      code: "SELECT user FROM logs WHERE message LIKE '%timeout%';\n-- use_query_condition_cache = 1 (default since 25.4)",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("7-5.first.q"),
        input: { type: "number" },
        answer: 8,
        explain: msg("7-5.first.why"),
        code: "SELECT user FROM logs WHERE message LIKE '%timeout%'",
        reveal: async (c) => void (await run(c, qTimeout)),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("7-5.second.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("7-5.second.why"),
        reveal: async (c) => void (await run(c, qTimeout)),
      }),
    },
    {
      kind: "task",
      title: msg("7-5.fresh.title"),
      body: msg("7-5.fresh.body"),
      tools: [
        {
          type: "action",
          id: "insert",
          label: msg("7-5.fresh.insert"),
          icon: "truck",
          tone: "accent",
          run: async (ctx) => {
            await ctx.insert(ROWS, { keyRange: [30, 59], cols: MSG_COLS });
            ctx.settings.inserted = true;
            ctx.settings.cachedAll = false;
          },
        },
        {
          type: "action",
          id: "query",
          label: msg("7-5.fresh.query"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            const r = await run(ctx, qTimeout);
            if (ctx.settings.inserted && r.granulesRead === 2 * ctx.table.activeParts.length) ctx.settings.cachedAll = true;
          },
        },
      ],
      progress: (ctx) => ({ done: (ctx.settings.inserted ? 1 : 0) + (ctx.settings.cachedAll ? 1 : 0), total: 2 }),
      success: msg("7-5.fresh.success"),
      panels: ["cache", "reading"],
      solution: { actions: ["insert", "query", "query"] },
    },
  ],
  check: q75,
};

export const WORLD7: Level[] = [level71, level72, level73, level74, level75];
