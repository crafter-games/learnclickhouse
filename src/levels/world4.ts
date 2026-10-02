// World 4 — Partitions. Facts: docs/research/clickhouse-curriculum.md (World 4).
import { GRANULE_ROWS, type TableSpec } from "@/sim/table";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

const DIST = { customer_id: 10000 };
const orders = (orderBy: string[] = ["customer_id"], settings: TableSpec["settings"] = {}): TableSpec => ({
  name: "orders",
  orderBy,
  partitionBy: "toYYYYMM(date)",
  columns: [
    { name: "date", type: "Date", bytesPerRow: 0.2 },
    { name: "customer_id", type: "UInt32", bytesPerRow: 2.5 },
    { name: "total", type: "Decimal(10,2)", bytesPerRow: 3.6 },
  ],
  settings,
});
const month = (m: string, granules = 2, orderByDate = false) => ({ rows: GRANULE_ROWS * granules - 900, options: { partition: m, ...(orderByDate ? {} : { dist: DIST }) } });

// ---------------------------------------------------------------- 4-1 Separate halls

const q41: Question[] = [
  {
    concept: "partitions",
    build: (r) => {
      const n = randInt(r, 2, 6);
      return { prompt: msg("4-1.check.parts.q", { n }), input: { type: "number" }, answer: n, explain: msg("4-1.check.parts.why", { n }) };
    },
  },
  { concept: "partitions", build: (r) => ({ prompt: msg("4-1.check.merge.q"), input: choices(r, "4-1.check.merge", ["never", "night", "optimize"]), answer: "never", explain: msg("4-1.check.merge.why") }) },
  { concept: "partition-pruning", build: (r) => ({ prompt: msg("4-1.check.prune.q"), input: choices(r, "4-1.check.prune", ["minmax", "name", "scan"]), answer: "minmax", explain: msg("4-1.check.prune.why") }) },
  { concept: "partitions", build: (r) => ({ prompt: msg("4-1.check.purpose.q"), input: choices(r, "4-1.check.purpose", ["manage", "speed", "unique"]), answer: "manage", explain: msg("4-1.check.purpose.why") }) },
];

const level41: Level = {
  id: "4-1",
  world: 4,
  title: msg("4-1.title"),
  summary: msg("4-1.summary"),
  table: orders(),
  initial: [month("202607"), month("202608"), month("202608", 1)],
  steps: [
    {
      kind: "brief",
      title: msg("4-1.brief.title"),
      body: msg("4-1.brief.body"),
      mapping: [{ icon: "warehouse", thing: msg("4-1.map.hall"), real: msg("4-1.map.partition") }],
      breaks: msg("4-1.brief.breaks"),
      code: "CREATE TABLE orders (…)\nENGINE = MergeTree\nPARTITION BY toYYYYMM(date)\nORDER BY customer_id",
    },
    {
      kind: "watch",
      title: msg("4-1.split.title"),
      body: msg("4-1.split.body"),
      panels: ["parts"],
      script: async (ctx) => {
        await ctx.wait(1000);
        await ctx.insertBlock([
          { partition: "202609", rows: GRANULE_ROWS - 500, dist: DIST },
          { partition: "202610", rows: GRANULE_ROWS - 2500, dist: DIST },
        ]);
      },
    },
    { kind: "predict", build: () => ({ prompt: msg("4-1.three.q"), input: { type: "number" }, answer: 3, explain: msg("4-1.three.why") }) },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("4-1.cross.q"),
        input: choices(ctx.rng, "4-1.cross", ["no", "yes"]),
        answer: "no",
        explain: msg("4-1.cross.why"),
        reveal: async (c) => void (await c.merge(["202608_2_2_0", "202608_3_3_0"])),
      }),
    },
    {
      kind: "task",
      title: msg("4-1.sept.title"),
      body: msg("4-1.sept.body"),
      tools: [{ type: "query", partitions: ["202608"], select: "sum(total) … WHERE date >= '2026-08-01' AND date < '2026-09-01'", goal: (_, r) => r.partsRead === 1 }],
      progress: (ctx, start) => ({ done: ctx.stats.goodQueries - start.goodQueries, total: 1 }),
      success: msg("4-1.sept.success"),
      panels: ["explain", "reading"],
      solution: { columns: ["total"] },
    },
  ],
  check: q41,
};

// ---------------------------------------------------------------- 4-2 Partitioning doesn't speed things up

const q42: Question[] = [
  { concept: "partitions", build: (r) => ({ prompt: msg("4-2.check.speed.q"), input: choices(r, "4-2.check.speed", ["orderBy", "partition", "both"]), answer: "orderBy", explain: msg("4-2.check.speed.why") }) },
  { concept: "partition-pruning", build: (r) => ({ prompt: msg("4-2.check.whenHelps.q"), input: choices(r, "4-2.check.whenHelps", ["partitionKey", "anyFilter", "never"]), answer: "partitionKey", explain: msg("4-2.check.whenHelps.why") }) },
  { concept: "partitions", build: (r) => ({ prompt: msg("4-2.check.need.q"), input: choices(r, "4-2.check.need", ["often", "always", "pk"]), answer: "often", explain: msg("4-2.check.need.why") }) },
  {
    concept: "partition-pruning",
    build: (r) => {
      const months = randInt(r, 3, 12);
      return { prompt: msg("4-2.check.months.q", { months }), input: { type: "number" }, answer: months, explain: msg("4-2.check.months.why", { months }) };
    },
  },
];

const level42: Level = {
  id: "4-2",
  world: 4,
  title: msg("4-2.title"),
  summary: msg("4-2.summary"),
  table: orders(["date"]),
  initial: [month("202606", 2, true), month("202607", 2, true), month("202608", 2, true), month("202609", 2, true)],
  steps: [
    { kind: "brief", title: msg("4-2.brief.title"), body: msg("4-2.brief.body") },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("4-2.customer.q"),
        input: { type: "number" },
        answer: 8,
        explain: msg("4-2.customer.why"),
        code: "-- PARTITION BY toYYYYMM(date)  ORDER BY date\nSELECT sum(total) FROM orders\nWHERE customer_id = 4200",
        reveal: async (c) => void (await c.query({ columns: ["total"], where: { column: "customer_id", min: 4200, max: 4200 } })),
      }),
    },
    {
      kind: "task",
      title: msg("4-2.fix.title"),
      body: msg("4-2.fix.body"),
      tools: [
        { type: "orderBy", options: ["date", "customer_id"] },
        {
          type: "action",
          id: "q",
          label: msg("4-2.fix.run"),
          icon: "play",
          tone: "primary",
          run: async (ctx: LevelCtx) => {
            const r = await ctx.query({ columns: ["total"], where: { column: "customer_id", min: 4200, max: 4200, label: "4200" } });
            ctx.settings.read = r.granulesRead;
            ctx.settings.readKey = (ctx.table.spec.orderBy ?? []).join(", ");
          },
        },
      ],
      onEnter: (ctx) => {
        // Re-sorting by customer needs a distribution: the "recreated" table knows its customers
        for (const p of ctx.table.activeParts) p.dist = DIST;
      },
      progress: (ctx) => ({ done: ctx.settings.readKey === "customer_id" && Number(ctx.settings.read) <= 4 ? 1 : 0, total: 1 }),
      success: msg("4-2.fix.success"),
      panels: ["explain", "reading"],
      solution: { orderBy: ["customer_id"], actions: ["q"] },
    },
  ],
  check: q42,
};

// ---------------------------------------------------------------- 4-3 Too many halls

const q43: Question[] = [
  { concept: "over-partition", build: (r) => ({ prompt: msg("4-3.check.limit.q"), input: choices(r, "4-3.check.limit", ["l100", "l1000", "none"]), answer: "l100", explain: msg("4-3.check.limit.why") }) },
  { concept: "over-partition", build: (r) => ({ prompt: msg("4-3.check.key.q"), input: choices(r, "4-3.check.key", ["month", "day", "customer"]), answer: "month", explain: msg("4-3.check.key.why") }) },
  {
    concept: "over-partition",
    build: (r) => {
      const days = randInt(r, 2, 31);
      return { prompt: msg("4-3.check.days.q", { days }), input: { type: "number" }, answer: days, explain: msg("4-3.check.days.why", { days }) };
    },
  },
  { concept: "over-partition", build: (r) => ({ prompt: msg("4-3.check.total.q"), input: choices(r, "4-3.check.total", ["thousands", "millions", "unlimited"]), answer: "thousands", explain: msg("4-3.check.total.why") }) },
];

/** One week of orders in a single INSERT, split by the chosen partition key. */
const week = (key: "month" | "day" | "customer") => async (ctx: LevelCtx) => {
  ctx.settings.lastKey = key;
  if (key === "month") return ctx.insertBlock([{ partition: "202610", rows: GRANULE_ROWS * 2 - 800, dist: DIST }]);
  if (key === "day") return ctx.insertBlock(Array.from({ length: 7 }, (_, i) => ({ partition: `2026100${i + 1}`, rows: 2400, dist: DIST })));
  // One partition per customer: a week touches hundreds of them in one INSERT
  return ctx.insertBlock(Array.from({ length: 480 }, (_, i) => ({ partition: `c${1000 + i}`, rows: 30 })));
};

const level43: Level = {
  id: "4-3",
  world: 4,
  title: msg("4-3.title"),
  summary: msg("4-3.summary"),
  table: orders(),
  steps: [
    { kind: "brief", title: msg("4-3.brief.title"), body: msg("4-3.brief.body") },
    {
      kind: "task",
      title: msg("4-3.pick.title"),
      body: msg("4-3.pick.body"),
      tools: [
        { type: "action", id: "day", label: msg("4-3.pick.day"), icon: "truck", run: week("day") },
        { type: "action", id: "customer", label: msg("4-3.pick.customer"), icon: "truck", run: week("customer") },
        { type: "action", id: "month", label: msg("4-3.pick.month"), icon: "truck", tone: "accent", run: week("month") },
        {
          type: "action",
          id: "truncate",
          label: msg("4-3.pick.truncate"),
          icon: "trash",
          tone: "danger",
          run: async (ctx: LevelCtx) => {
            for (const p of ctx.table.partitions) await ctx.dropPartition(p);
          },
        },
      ],
      progress: (ctx, start) => ({
        done: (ctx.stats.rejected > start.rejected ? 1 : 0) + (ctx.settings.lastKey === "month" && ctx.table.activeParts.length <= 2 ? 1 : 0),
        total: 2,
      }),
      success: msg("4-3.pick.success"),
      panels: ["parts"],
      solution: { actions: ["customer", "truncate", "month"] },
    },
    {
      kind: "predict",
      build: (ctx) => ({ prompt: msg("4-3.error.q"), input: choices(ctx.rng, "4-3.error", ["partitions", "parts", "memory"]), answer: "partitions", explain: msg("4-3.error.why") }),
    },
  ],
  check: q43,
};

// ---------------------------------------------------------------- 4-4 Case: delete September

const q44: Question[] = [
  { concept: "drop-partition", build: (r) => ({ prompt: msg("4-4.check.cheapest.q"), input: choices(r, "4-4.check.cheapest", ["drop", "lightweight", "mutation"]), answer: "drop", explain: msg("4-4.check.cheapest.why") }) },
  { concept: "drop-partition", build: (r) => ({ prompt: msg("4-4.check.mutation.q"), input: choices(r, "4-4.check.mutation", ["rewrite", "mask", "metadata"]), answer: "rewrite", explain: msg("4-4.check.mutation.why") }) },
  { concept: "drop-partition", build: (r) => ({ prompt: msg("4-4.check.space.q"), input: choices(r, "4-4.check.space", ["merge", "instant", "never"]), answer: "merge", explain: msg("4-4.check.space.why") }) },
  { concept: "drop-partition", build: (r) => ({ prompt: msg("4-4.check.design.q"), input: choices(r, "4-4.check.design", ["month", "customer", "none"]), answer: "month", explain: msg("4-4.check.design.why") }) },
];

const level44: Level = {
  id: "4-4",
  world: 4,
  title: msg("4-4.title"),
  summary: msg("4-4.summary"),
  table: orders(),
  initial: [month("202608"), month("202608", 1), month("202609"), month("202609", 1), month("202610"), month("202610", 1)],
  steps: [
    { kind: "brief", title: msg("4-4.brief.title"), body: msg("4-4.brief.body") },
    {
      kind: "predict",
      build: (ctx) => ({ prompt: msg("4-4.guess.q"), input: choices(ctx.rng, "4-4.guess", ["drop", "lightweight", "mutation"]), answer: "drop", explain: msg("4-4.guess.why") }),
    },
    {
      kind: "task",
      title: msg("4-4.compare.title"),
      body: msg("4-4.compare.body"),
      tools: [
        { type: "action", id: "mutation", label: msg("4-4.compare.mutation"), icon: "pencil", run: (ctx: LevelCtx) => ctx.mutateDelete("202608") },
        { type: "action", id: "lightweight", label: msg("4-4.compare.lightweight"), icon: "eraser", run: (ctx: LevelCtx) => ctx.lightweightDelete("202610") },
        { type: "action", id: "drop", label: msg("4-4.compare.drop"), icon: "trash", tone: "accent", run: (ctx: LevelCtx) => ctx.dropPartition("202609") },
      ],
      progress: (ctx, start) => ({ done: [ctx.stats.mutations > start.mutations, ctx.stats.lwDeletes > start.lwDeletes, ctx.stats.drops > start.drops].filter(Boolean).length, total: 3 }),
      success: msg("4-4.compare.success"),
      panels: ["parts"],
      solution: { actions: ["drop", "lightweight", "mutation"] },
    },
    {
      kind: "brief",
      title: msg("4-4.real.title"),
      body: msg("4-4.real.body"),
      code: "-- Instant, metadata only\nALTER TABLE orders DROP PARTITION 202609;\n\n-- Lightweight: masks rows, space freed on merge\nDELETE FROM orders WHERE toYYYYMM(date) = 202610;\n\n-- Mutation: rewrites every affected part (async, heavy)\nALTER TABLE orders DELETE WHERE toYYYYMM(date) = 202608;",
    },
  ],
  check: q44,
};

export const WORLD4: Level[] = [level41, level42, level43, level44];
