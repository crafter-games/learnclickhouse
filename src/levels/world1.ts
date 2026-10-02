// World 1 — Columns. Facts: docs/research/clickhouse-curriculum.md (World 1).
// Each level: brief (mapping card) → predict/watch/task steps → recall check (stage hidden).
import { GRANULE_ROWS, Table, type QuerySpec, type TableSpec } from "@/sim/table";
import { boxSizes } from "./helpers";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

/**
 * The orders table. Compression ratios are illustrative (the brief says so): low-cardinality and
 * sorted columns compress far better than high-cardinality, mixed ones.
 */
const orders = (orderBy: string, storage: "row" | "column" = "column"): TableSpec => ({
  name: "orders",
  orderBy: [orderBy],
  storage,
  columns: [
    { name: "date", type: "Date", bytesPerRow: 0.2, raw: 2, ratio: { sorted: 40, unsorted: 12 } },
    { name: "customer_id", type: "UInt32", bytesPerRow: 2.5, raw: 4, ratio: { sorted: 5, unsorted: 1.6 } },
    { name: "city", type: "LowCardinality(String)", bytesPerRow: 0.25, raw: 1, ratio: { sorted: 60, unsorted: 4 } },
    { name: "total", type: "Decimal(10,2)", bytesPerRow: 3.6, raw: 8, ratio: { sorted: 2.6, unsorted: 2.2 } },
  ],
});
const COLS = ["date", "customer_id", "city", "total"];
const rows = (granules: number) => GRANULE_ROWS * granules - 1200;

const sameColumns = (spec: QuerySpec, want: string[]) => spec.columns.length === want.length && want.every((c) => spec.columns.includes(c));

const totalBytes = (t: Table) => t.columnSizes().reduce((s, c) => s + c.compressed, 0);

/** The ORDER BY that leaves the table smallest (tried on a copy). */
function smallestOrderBy(t: Table) {
  let best = { col: "", bytes: Infinity };
  for (const col of COLS) {
    const copy = new Table(structuredClone(t.spec));
    for (const p of t.activeParts) copy.insert(p.rows);
    copy.setOrderBy([col]);
    const b = totalBytes(copy);
    if (b < best.bytes) best = { col, bytes: b };
  }
  return best.col;
}

// ---------------------------------------------------------------- 1-1 Rows vs columns

const q11: Question[] = [
  { concept: "columnar", build: (r) => ({ prompt: msg("1-1.check.together.q"), input: choices(r, "1-1.check.together", ["column", "row", "random"]), answer: "column", explain: msg("1-1.check.together.why") }) },
  {
    concept: "column-read",
    build: (r) => {
      const n = randInt(r, 2, 6);
      return { prompt: msg("1-1.check.files.q", { n }), input: { type: "number" }, answer: n, explain: msg("1-1.check.files.why", { n }) };
    },
  },
  {
    concept: "columnar",
    build: (r) => {
      const n = randInt(r, 3, 9) * 4;
      return { prompt: msg("1-1.check.rowStore.q", { n }), input: { type: "number" }, answer: n, explain: msg("1-1.check.rowStore.why", { n }) };
    },
  },
  { concept: "olap", build: (r) => ({ prompt: msg("1-1.check.shines.q"), input: choices(r, "1-1.check.shines", ["aggregate", "lookup", "update"]), answer: "aggregate", explain: msg("1-1.check.shines.why") }) },
];

const level11: Level = {
  id: "1-1",
  world: 1,
  title: msg("1-1.title"),
  summary: msg("1-1.summary"),
  table: orders("date", "row"),
  initial: [{ rows: rows(2) }, { rows: rows(2) }],
  steps: [
    {
      kind: "brief",
      title: msg("1-1.brief.title"),
      body: msg("1-1.brief.body"),
      mapping: [
        { icon: "warehouse", thing: msg("1-1.map.depot"), real: msg("1-1.map.table") },
        { icon: "package", thing: msg("1-1.map.box"), real: msg("1-1.map.block") },
        { icon: "tag", thing: msg("1-1.map.sticker"), real: msg("1-1.map.column") },
        { icon: "robot", thing: msg("1-1.map.pico"), real: msg("1-1.map.query") },
        { icon: "eye", thing: msg("1-1.map.opened"), real: msg("1-1.map.read") },
      ],
      breaks: msg("1-1.brief.breaks"),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("1-1.rowSum.q", { n: ctx.table.plan({ columns: ["total"] }).boxesTotal }),
        input: choices(ctx.rng, "1-1.rowSum", ["quarter", "half", "all"]),
        answer: "all",
        explain: msg("1-1.rowSum.why"),
        code: "SELECT sum(total) FROM orders",
        reveal: async (c) => void (await c.query({ columns: ["total"] })),
      }),
    },
    {
      kind: "watch",
      title: msg("1-1.rotate.title"),
      body: msg("1-1.rotate.body"),
      script: async (ctx: LevelCtx) => {
        // Give the player a moment to read before the boxes take off
        await ctx.wait(1400);
        ctx.table.setStorage("column");
        await ctx.stage.setLayout("columns");
      },
    },
    {
      kind: "predict",
      build: (ctx) => {
        const n = ctx.table.plan({ columns: ["total"] }).boxesRead;
        return {
          prompt: msg("1-1.colSum.q", { total: ctx.table.plan({ columns: ["total"] }).boxesTotal }),
          input: { type: "number" },
          answer: n,
          explain: msg("1-1.colSum.why", { n }),
          code: "SELECT sum(total) FROM orders",
          reveal: async (c) => void (await c.query({ columns: ["total"] })),
        };
      },
    },
    {
      kind: "task",
      title: msg("1-1.byCity.title"),
      body: msg("1-1.byCity.body"),
      tools: [{ type: "query", select: "city, sum(total)", goal: (spec) => sameColumns(spec, ["city", "total"]) }],
      progress: (ctx, start) => ({ done: ctx.stats.goodQueries - start.goodQueries, total: 1 }),
      success: msg("1-1.byCity.success"),
      solution: { columns: ["city", "total"] },
      panels: ["reading"],
    },
  ],
  check: q11,
};

// ---------------------------------------------------------------- 1-2 Only what you ask for

const q12: Question[] = [
  {
    concept: "column-read",
    build: (r) => {
      const n = randInt(r, 5, 40);
      return { prompt: msg("1-2.check.star.q", { n }), input: { type: "number" }, answer: n, explain: msg("1-2.check.star.why", { n }) };
    },
  },
  { concept: "column-read", build: (r) => ({ prompt: msg("1-2.check.unnamed.q"), input: choices(r, "1-2.check.unnamed", ["never", "skimmed", "always"]), answer: "never", explain: msg("1-2.check.unnamed.why") }) },
  {
    concept: "column-read",
    build: (r) => {
      const of = [4, 5, 8, 10][randInt(r, 0, 3)];
      const read = randInt(r, 1, of / 2);
      const pct = Math.round((read / of) * 100);
      return { prompt: msg("1-2.check.pct.q", { read, of }), input: { type: "number" }, answer: pct, explain: msg("1-2.check.pct.why", { read, of, pct }) };
    },
  },
  { concept: "compression", build: (r) => ({ prompt: msg("1-2.check.sizes.q"), input: choices(r, "1-2.check.sizes", ["differ", "same", "rows"]), answer: "differ", explain: msg("1-2.check.sizes.why") }) },
];

const level12: Level = {
  id: "1-2",
  world: 1,
  title: msg("1-2.title"),
  summary: msg("1-2.summary"),
  table: orders("date"),
  initial: [{ rows: rows(3) }, { rows: rows(2) }, { rows: rows(2) }],
  steps: [
    { kind: "brief", title: msg("1-2.brief.title"), body: msg("1-2.brief.body") },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("1-2.star.q"),
        input: choices(ctx.rng, "1-2.star", ["p25", "p50", "p100"]),
        answer: "p100",
        explain: msg("1-2.star.why"),
        code: "SELECT * FROM orders",
        reveal: async (c) => void (await c.query({ columns: COLS })),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("1-2.lightest.q"),
        input: choices(ctx.rng, "1-2.lightest", ["total", "customer_id", "city"]),
        answer: "city",
        explain: msg("1-2.lightest.why"),
        reveal: async (c) => void (await c.query({ columns: ["city"] })),
      }),
    },
    {
      kind: "task",
      title: msg("1-2.daily.title"),
      body: msg("1-2.daily.body"),
      tools: [{ type: "query", select: "date, sum(total)", goal: (spec) => sameColumns(spec, ["date", "total"]) }],
      progress: (ctx, start) => ({ done: ctx.stats.goodQueries - start.goodQueries, total: 1 }),
      success: msg("1-2.daily.success"),
      solution: { columns: ["date", "total"] },
      panels: ["reading"],
    },
    {
      kind: "task",
      title: msg("1-2.unique.title"),
      body: msg("1-2.unique.body"),
      tools: [{ type: "query", select: "city, uniq(customer_id)", goal: (spec) => sameColumns(spec, ["city", "customer_id"]) }],
      progress: (ctx, start) => ({ done: ctx.stats.goodQueries - start.goodQueries, total: 1 }),
      success: msg("1-2.unique.success"),
      solution: { columns: ["city", "customer_id"] },
      panels: ["reading"],
    },
  ],
  check: q12,
};

// ---------------------------------------------------------------- 1-3 Shrinking aisles

const q13: Question[] = [
  { concept: "compression", build: (r) => ({ prompt: msg("1-3.check.why.q"), input: choices(r, "1-3.check.why", ["alike", "smaller", "magic"]), answer: "alike", explain: msg("1-3.check.why.why") }) },
  { concept: "compression", build: (r) => ({ prompt: msg("1-3.check.sorted.q"), input: choices(r, "1-3.check.sorted", ["more", "less", "same"]), answer: "more", explain: msg("1-3.check.sorted.why") }) },
  {
    concept: "compression",
    build: (r) => {
      const small = randInt(r, 2, 60);
      return { prompt: msg("1-3.check.codecSmall.q", { mb: small }), input: choices(r, "1-3.check.codec", ["lz4", "zstd", "none"]), answer: "lz4", explain: msg("1-3.check.codecSmall.why", { mb: small }) };
    },
  },
  {
    concept: "compression",
    build: (r) => {
      const big = randInt(r, 120, 900);
      return { prompt: msg("1-3.check.codecBig.q", { mb: big }), input: choices(r, "1-3.check.codec", ["lz4", "zstd", "none"]), answer: "zstd", explain: msg("1-3.check.codecBig.why", { mb: big }) };
    },
  },
];

const level13: Level = {
  id: "1-3",
  world: 1,
  title: msg("1-3.title"),
  summary: msg("1-3.summary"),
  table: orders("date"),
  initial: [{ rows: rows(3) }, { rows: rows(3) }],
  steps: [
    {
      kind: "brief",
      title: msg("1-3.brief.title"),
      body: msg("1-3.brief.body"),
      code: "CREATE TABLE orders (...)\nENGINE = MergeTree\nORDER BY date\n-- 26.9+: LZ4 for parts < 100 MB, ZSTD(3) from 100 MB\n-- ClickHouse Cloud: ZSTD",
    },
    {
      kind: "watch",
      title: msg("1-3.squeeze.title"),
      body: msg("1-3.squeeze.body"),
      panels: ["compression"],
      script: async (ctx) => {
        await ctx.wait(400);
        await ctx.stage.setColumnSizes(boxSizes(ctx.table));
      },
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("1-3.sortCity.q"),
        input: choices(ctx.rng, "1-3.sortCity", COLS),
        answer: "city",
        explain: msg("1-3.sortCity.why"),
        code: "ORDER BY city",
        reveal: async (c) => {
          c.table.setOrderBy(["city"]);
          await c.stage.setColumnSizes(boxSizes(c.table));
        },
      }),
    },
    {
      kind: "task",
      title: msg("1-3.smallest.title"),
      body: msg("1-3.smallest.body"),
      tools: [{ type: "orderBy", options: COLS }],
      onEnter: async (ctx) => {
        ctx.table.setOrderBy(["date"]);
        await ctx.stage.setColumnSizes(boxSizes(ctx.table));
      },
      progress: (ctx, start) => ({ done: ctx.stats.orderByChanges - start.orderByChanges >= 2 && ctx.table.spec.orderBy?.[0] === smallestOrderBy(ctx.table) ? 1 : 0, total: 1 }),
      success: msg("1-3.smallest.success"),
      solution: { orderBy: ["city", "total", "customer_id"] },
      panels: ["compression"],
    },
  ],
  check: q13,
};

// ---------------------------------------------------------------- 1-4 Analytics, not a ticket window

const q14: Question[] = [
  { concept: "olap", build: (r) => ({ prompt: msg("1-4.check.fits.q"), input: choices(r, "1-4.check.fits", ["dashboard", "cart", "login"]), answer: "dashboard", explain: msg("1-4.check.fits.why") }) },
  {
    concept: "olap",
    build: (r) => {
      const n = randInt(r, 4, 30);
      return { prompt: msg("1-4.check.oneRow.q", { n }), input: { type: "number" }, answer: n, explain: msg("1-4.check.oneRow.why", { n }) };
    },
  },
  { concept: "olap", build: (r) => ({ prompt: msg("1-4.check.minimum.q"), input: choices(r, "1-4.check.minimum", ["granule", "row", "file"]), answer: "granule", explain: msg("1-4.check.minimum.why") }) },
  { concept: "olap", build: (r) => ({ prompt: msg("1-4.check.updates.q"), input: choices(r, "1-4.check.updates", ["oltp", "clickhouse", "either"]), answer: "oltp", explain: msg("1-4.check.updates.why") }) },
];

const level14: Level = {
  id: "1-4",
  world: 1,
  title: msg("1-4.title"),
  summary: msg("1-4.summary"),
  table: orders("customer_id"),
  initial: [
    { rows: rows(3), options: { keyRange: [0, 999] } },
    { rows: rows(3), options: { keyRange: [0, 999] } },
  ],
  steps: [
    { kind: "brief", title: msg("1-4.brief.title"), body: msg("1-4.brief.body") },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("1-4.lookup.q"),
        input: { type: "number" },
        answer: 4,
        explain: msg("1-4.lookup.why"),
        code: "SELECT * FROM orders\nWHERE customer_id = 420",
        reveal: async (c) => void (await c.query({ columns: COLS, where: { column: "customer_id", min: 420, max: 420 } })),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("1-4.yearly.q"),
        input: choices(ctx.rng, "1-4.yearly", ["p25", "p50", "p100"]),
        answer: "p25",
        explain: msg("1-4.yearly.why"),
        code: "SELECT sum(total) FROM orders",
        reveal: async (c) => void (await c.query({ columns: ["total"] })),
      }),
    },
    {
      kind: "task",
      title: msg("1-4.light.title"),
      body: msg("1-4.light.body"),
      tools: [{ type: "query", select: "…, count()", goal: (spec, r) => spec.columns.length >= 2 && r.bytesRead / r.bytesTotal < 0.1 }],
      progress: (ctx, start) => ({ done: ctx.stats.goodQueries - start.goodQueries, total: 1 }),
      success: msg("1-4.light.success"),
      solution: { columns: ["date", "city"] },
      panels: ["reading"],
    },
    {
      kind: "brief",
      title: msg("1-4.real.title"),
      body: msg("1-4.real.body"),
      code: "CREATE TABLE orders (\n  date        Date,\n  customer_id UInt32,\n  city        LowCardinality(String),\n  total       Decimal(10, 2)\n)\nENGINE = MergeTree\nORDER BY customer_id;\n\nSELECT name, formatReadableSize(data_compressed_bytes)\nFROM system.columns WHERE table = 'orders';",
    },
  ],
  check: q14,
};

export const WORLD1: Level[] = [level11, level12, level13, level14];
