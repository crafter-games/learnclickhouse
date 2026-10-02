// World 3 — ORDER BY & the sparse index. Facts: docs/research/clickhouse-curriculum.md (World 3).
import { GRANULE_ROWS, type TableSpec } from "@/sim/table";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

export const CITIES = ["Bogotá", "Lima", "Madrid", "Quito", "Santiago", "Valencia"];
const LIMA = 1;
const DIST = { city: CITIES.length, customer_id: 10000 };
const GRANULES = 24;
const ROWS = GRANULE_ROWS * GRANULES;

const orders = (orderBy: string[]): TableSpec => ({
  name: "orders",
  orderBy,
  columns: [
    { name: "city", type: "LowCardinality(String)", bytesPerRow: 0.3 },
    { name: "customer_id", type: "UInt32", bytesPerRow: 2.5 },
    { name: "total", type: "Decimal(10,2)", bytesPerRow: 3.6 },
  ],
});
const format = { city: (v: number) => CITIES[Math.round(v)] ?? String(v), customer_id: (v: number) => String(Math.round(v)) };
const byCustomer = (id: number) => ({ column: "customer_id", min: id, max: id, label: String(id) });
const byCity = (i: number) => ({ column: "city", min: i, max: i, label: `'${CITIES[i]}'` });

// ---------------------------------------------------------------- 3-1 Boxes of 8192

const q31: Question[] = [
  {
    concept: "granules",
    build: (r) => {
      const rows = randInt(r, 3, 40) * 10000;
      const n = Math.ceil(rows / GRANULE_ROWS);
      return { prompt: msg("3-1.check.count.q", { rows }), input: { type: "number" }, answer: n, explain: msg("3-1.check.count.why", { rows, n }) };
    },
  },
  { concept: "granules", build: (r) => ({ prompt: msg("3-1.check.unit.q"), input: choices(r, "3-1.check.unit", ["granule", "row", "part"]), answer: "granule", explain: msg("3-1.check.unit.why") }) },
  { concept: "granules", build: (r) => ({ prompt: msg("3-1.check.size.q"), input: choices(r, "3-1.check.size", ["g8192", "g1024", "g65536"]), answer: "g8192", explain: msg("3-1.check.size.why") }) },
  { concept: "granules", build: (r) => ({ prompt: msg("3-1.check.sorted.q"), input: choices(r, "3-1.check.sorted", ["part", "table", "never"]), answer: "part", explain: msg("3-1.check.sorted.why") }) },
];

const level31: Level = {
  id: "3-1",
  world: 3,
  title: msg("3-1.title"),
  summary: msg("3-1.summary"),
  table: orders(["customer_id"]),
  initial: [{ rows: GRANULE_ROWS * 12, options: { dist: DIST } }],
  format,
  steps: [
    {
      kind: "brief",
      title: msg("3-1.brief.title"),
      body: msg("3-1.brief.body"),
      mapping: [
        { icon: "package", thing: msg("3-1.map.box"), real: msg("3-1.map.granule") },
        { icon: "sort", thing: msg("3-1.map.order"), real: msg("3-1.map.orderBy") },
      ],
      breaks: msg("3-1.brief.breaks"),
    },
    { kind: "predict", build: () => ({ prompt: msg("3-1.count.q"), input: { type: "number" }, answer: 13, explain: msg("3-1.count.why") }) },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("3-1.oneRow.q"),
        input: choices(ctx.rng, "3-1.oneRow", ["one", "granule", "all"]),
        answer: "granule",
        explain: msg("3-1.oneRow.why"),
        code: "SELECT total FROM orders\nWHERE customer_id = 4200",
        reveal: async (c) => void (await c.query({ columns: ["total"], where: byCustomer(4200) })),
      }),
    },
    {
      kind: "task",
      title: msg("3-1.find.title"),
      body: msg("3-1.find.body"),
      tools: [{ type: "query", where: byCustomer(777), goal: (_, r) => r.granulesRead === 1 }],
      progress: (ctx, start) => ({ done: ctx.stats.goodQueries - start.goodQueries, total: 1 }),
      success: msg("3-1.find.success"),
      panels: ["reading", "index"],
      solution: { columns: ["total"] },
    },
  ],
  check: q31,
};

// ---------------------------------------------------------------- 3-2 The board at the entrance

const q32: Question[] = [
  { concept: "sparse-index", build: (r) => ({ prompt: msg("3-2.check.entries.q"), input: choices(r, "3-2.check.entries", ["granule", "row", "part"]), answer: "granule", explain: msg("3-2.check.entries.why") }) },
  { concept: "sparse-index", build: (r) => ({ prompt: msg("3-2.check.marks.q"), input: choices(r, "3-2.check.marks", ["offsets", "keys", "rows"]), answer: "offsets", explain: msg("3-2.check.marks.why") }) },
  {
    concept: "sparse-index",
    build: (r) => {
      const g = randInt(r, 200, 5000);
      return { prompt: msg("3-2.check.size.q", { g }), input: { type: "number" }, answer: g, explain: msg("3-2.check.size.why", { g }) };
    },
  },
  { concept: "sparse-index", build: (r) => ({ prompt: msg("3-2.check.memory.q"), input: choices(r, "3-2.check.memory", ["memory", "disk", "never"]), answer: "memory", explain: msg("3-2.check.memory.why") }) },
];

const level32: Level = {
  id: "3-2",
  world: 3,
  title: msg("3-2.title"),
  summary: msg("3-2.summary"),
  table: orders(["customer_id"]),
  initial: [{ rows: ROWS, options: { dist: DIST } }],
  format,
  steps: [
    { kind: "brief", title: msg("3-2.brief.title"), body: msg("3-2.brief.body") },
    {
      kind: "watch",
      title: msg("3-2.search.title"),
      body: msg("3-2.search.body"),
      panels: ["index", "reading"],
      script: async (ctx) => {
        await ctx.wait(1000);
        await ctx.query({ columns: ["total"], where: byCustomer(5100) });
      },
    },
    { kind: "predict", build: () => ({ prompt: msg("3-2.entries.q"), input: { type: "number" }, answer: 1083, explain: msg("3-2.entries.why") }) },
    {
      kind: "predict",
      build: (ctx) => ({ prompt: msg("3-2.holds.q"), input: choices(ctx.rng, "3-2.holds", ["first", "every", "offsets"]), answer: "first", explain: msg("3-2.holds.why") }),
    },
    {
      kind: "task",
      title: msg("3-2.lean.title"),
      body: msg("3-2.lean.body"),
      tools: [{ type: "query", where: byCustomer(3100), goal: (spec, r) => r.boxesRead === 2 && spec.columns.length === 1 && spec.columns[0] === "total" }],
      progress: (ctx, start) => ({ done: ctx.stats.goodQueries - start.goodQueries, total: 1 }),
      success: msg("3-2.lean.success"),
      panels: ["reading", "index"],
      solution: { columns: ["total"] },
    },
  ],
  check: q32,
};

// ---------------------------------------------------------------- 3-3 Second in line

const q33: Question[] = [
  { concept: "key-order", build: (r) => ({ prompt: msg("3-3.check.rule.q"), input: choices(r, "3-3.check.rule", ["low", "high", "alpha"]), answer: "low", explain: msg("3-3.check.rule.why") }) },
  { concept: "key-order", build: (r) => ({ prompt: msg("3-3.check.docs.q"), input: choices(r, "3-3.check.docs", ["second", "first", "both"]), answer: "second", explain: msg("3-3.check.docs.why") }) },
  { concept: "key-order", build: (r) => ({ prompt: msg("3-3.check.when.q"), input: choices(r, "3-3.check.when", ["constant", "always", "never"]), answer: "constant", explain: msg("3-3.check.when.why") }) },
  { concept: "sparse-index", build: (r) => ({ prompt: msg("3-3.check.notInKey.q"), input: choices(r, "3-3.check.notInKey", ["all", "half", "none"]), answer: "all", explain: msg("3-3.check.notInKey.why") }) },
];

/** 3-3 / 3-5 workload: run each report under the current key; record its granules. */
const report = (id: string, where: ReturnType<typeof byCity>) => async (ctx: LevelCtx) => {
  const r = await ctx.query({ columns: ["total"], where });
  ctx.settings[`${id}`] = r.granulesRead;
  ctx.settings[`${id}Key`] = (ctx.table.spec.orderBy ?? []).join(", ");
};
const workloadDone = (ctx: LevelCtx, ids: string[], max: number) => {
  const key = (ctx.table.spec.orderBy ?? []).join(", ");
  const ran = ids.every((id) => ctx.settings[`${id}Key`] === key);
  return ran && ids.reduce((s, id) => s + Number(ctx.settings[id] ?? 999), 0) <= max;
};

const level33: Level = {
  id: "3-3",
  world: 3,
  title: msg("3-3.title"),
  summary: msg("3-3.summary"),
  table: orders(["customer_id", "city"]),
  initial: [{ rows: ROWS, options: { dist: DIST } }],
  format,
  steps: [
    { kind: "brief", title: msg("3-3.brief.title"), body: msg("3-3.brief.body") },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("3-3.cityFirst.q"),
        input: { type: "number" },
        answer: GRANULES,
        explain: msg("3-3.cityFirst.why"),
        code: "-- ORDER BY (customer_id, city)\nSELECT sum(total) FROM orders\nWHERE city = 'Lima'",
        reveal: async (c) => void (await c.query({ columns: ["total"], where: byCity(LIMA) })),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("3-3.swap.q"),
        input: { type: "number" },
        answer: 4,
        explain: msg("3-3.swap.why"),
        code: "-- ORDER BY (city, customer_id)\nSELECT sum(total) FROM orders\nWHERE city = 'Lima'",
        reveal: async (c) => {
          c.table.setOrderBy(["city", "customer_id"]);
          await c.query({ columns: ["total"], where: byCity(LIMA) });
        },
      }),
    },
    {
      kind: "task",
      title: msg("3-3.daily.title"),
      body: msg("3-3.daily.body"),
      tools: [
        { type: "orderBy", options: ["customer_id, city", "city, customer_id"] },
        { type: "action", id: "qa", label: msg("3-3.daily.qa"), icon: "play", tone: "primary", run: report("qa", byCity(LIMA)) },
        { type: "action", id: "qb", label: msg("3-3.daily.qb"), icon: "play", tone: "primary", run: report("qb", byCustomer(4200) as ReturnType<typeof byCity>) },
      ],
      onEnter: (ctx) => {
        ctx.table.setOrderBy(["customer_id", "city"]);
      },
      progress: (ctx) => ({ done: workloadDone(ctx, ["qa", "qb"], 10) ? 1 : 0, total: 1 }),
      success: msg("3-3.daily.success"),
      panels: ["reading", "index"],
      solution: { orderBy: ["city, customer_id"], actions: ["qa", "qb"] },
    },
  ],
  check: q33,
};

// ---------------------------------------------------------------- 3-4 The key isn't unique

const q34: Question[] = [
  { concept: "pk-not-unique", build: (r) => ({ prompt: msg("3-4.check.unique.q"), input: choices(r, "3-4.check.unique", ["no", "yes", "replicated"]), answer: "no", explain: msg("3-4.check.unique.why") }) },
  { concept: "pk-not-unique", build: (r) => ({ prompt: msg("3-4.check.prefix.q"), input: choices(r, "3-4.check.prefix", ["prefix", "any", "same"]), answer: "prefix", explain: msg("3-4.check.prefix.why") }) },
  {
    concept: "pk-not-unique",
    build: (r) => {
      const n = randInt(r, 2, 6);
      return { prompt: msg("3-4.check.count.q", { n }), input: { type: "number" }, answer: n, explain: msg("3-4.check.count.why", { n }) };
    },
  },
  { concept: "pk-not-unique", build: (r) => ({ prompt: msg("3-4.check.dedupe.q"), input: choices(r, "3-4.check.dedupe", ["replacing", "pk", "index"]), answer: "replacing", explain: msg("3-4.check.dedupe.why") }) },
];

const level34: Level = {
  id: "3-4",
  world: 3,
  title: msg("3-4.title"),
  summary: msg("3-4.summary"),
  table: orders(["customer_id"]),
  initial: [{ rows: GRANULE_ROWS * 6, options: { dist: DIST } }],
  format,
  steps: [
    { kind: "brief", title: msg("3-4.brief.title"), body: msg("3-4.brief.body") },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("3-4.twice.q"),
        input: choices(ctx.rng, "3-4.twice", ["two", "one", "error"]),
        answer: "two",
        explain: msg("3-4.twice.why"),
        reveal: async (c) => void (await c.insert(GRANULE_ROWS * 2, { dist: DIST })),
      }),
    },
    {
      kind: "task",
      title: msg("3-4.both.title"),
      body: msg("3-4.both.body"),
      tools: [{ type: "query", where: byCustomer(4200), goal: (_, r) => r.partsRead === 2 }],
      progress: (ctx, start) => ({ done: ctx.stats.goodQueries - start.goodQueries, total: 1 }),
      success: msg("3-4.both.success"),
      panels: ["reading", "index"],
      solution: { columns: ["total"] },
    },
    {
      kind: "predict",
      build: (ctx) => ({ prompt: msg("3-4.prefix.q"), input: choices(ctx.rng, "3-4.prefix", ["valid", "invalid"]), answer: "invalid", explain: msg("3-4.prefix.why"), code: "CREATE TABLE orders (…)\nENGINE = MergeTree\nORDER BY (city, customer_id)\nPRIMARY KEY customer_id" }),
    },
    {
      kind: "brief",
      title: msg("3-4.real.title"),
      body: msg("3-4.real.body"),
      code: "CREATE TABLE orders (\n  city        LowCardinality(String),\n  customer_id UInt32,\n  total       Decimal(10, 2)\n)\nENGINE = MergeTree\nORDER BY (city, customer_id)\nPRIMARY KEY city;   -- must be a prefix of ORDER BY",
    },
  ],
  check: q34,
};

// ---------------------------------------------------------------- 3-5 Case: EXPLAIN

const q35: Question[] = [
  {
    concept: "explain",
    build: (r) => {
      const sel = randInt(r, 2, 40);
      const total = sel * randInt(r, 5, 30);
      const pct = Math.round((sel / total) * 100);
      return { prompt: msg("3-5.check.read.q", { sel, total }), input: { type: "number" }, answer: pct, explain: msg("3-5.check.read.why", { sel, total, pct }) };
    },
  },
  { concept: "explain", build: (r) => ({ prompt: msg("3-5.check.limit.q"), input: choices(r, "3-5.check.limit", ["all", "one", "half"]), answer: "all", explain: msg("3-5.check.limit.why") }) },
  { concept: "key-order", build: (r) => ({ prompt: msg("3-5.check.pick.q"), input: choices(r, "3-5.check.pick", ["cityFirst", "custFirst", "total"]), answer: "cityFirst", explain: msg("3-5.check.pick.why") }) },
  { concept: "explain", build: (r) => ({ prompt: msg("3-5.check.stage.q"), input: choices(r, "3-5.check.stage", ["pk", "partition", "skip"]), answer: "pk", explain: msg("3-5.check.stage.why") }) },
];

const level35: Level = {
  id: "3-5",
  world: 3,
  title: msg("3-5.title"),
  summary: msg("3-5.summary"),
  table: orders(["customer_id", "city"]),
  initial: [{ rows: ROWS, options: { dist: DIST } }],
  format,
  steps: [
    { kind: "brief", title: msg("3-5.brief.title"), body: msg("3-5.brief.body") },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("3-5.limit.q"),
        input: { type: "number" },
        answer: GRANULES,
        explain: msg("3-5.limit.why"),
        code: "SELECT * FROM orders\nORDER BY total DESC\nLIMIT 1",
        reveal: async (c) => void (await c.query({ columns: ["total"] })),
      }),
    },
    {
      kind: "task",
      title: msg("3-5.fix.title"),
      body: msg("3-5.fix.body"),
      tools: [
        { type: "orderBy", options: ["customer_id, city", "city, customer_id"] },
        { type: "action", id: "q1", label: msg("3-5.fix.q1"), icon: "play", tone: "primary", run: report("q1", byCity(3)) },
        { type: "action", id: "q2", label: msg("3-5.fix.q2"), icon: "play", tone: "primary", run: report("q2", byCity(LIMA)) },
        { type: "action", id: "q3", label: msg("3-5.fix.q3"), icon: "play", tone: "primary", run: report("q3", byCustomer(9100) as ReturnType<typeof byCity>) },
      ],
      progress: (ctx) => ({ done: workloadDone(ctx, ["q1", "q2", "q3"], 14) ? 1 : 0, total: 1 }),
      success: msg("3-5.fix.success"),
      panels: ["explain", "index"],
      solution: { orderBy: ["city, customer_id"], actions: ["q1", "q2", "q3"] },
    },
  ],
  check: q35,
};

export const WORLD3: Level[] = [level31, level32, level33, level34, level35];
