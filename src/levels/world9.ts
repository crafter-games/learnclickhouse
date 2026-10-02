// World 9 — Query execution & JOINs. Facts: docs/research/clickhouse-curriculum.md (World 9).
import type { Row } from "@/sim/engines";
import type { InsertOptions, QuerySpec, TableSpec } from "@/sim/table";
import { rowsFor } from "./session";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

const ROWS = rowsFor(8);
const col = (name: string, type: string, bytesPerRow: number, only?: string[]) => ({ name, type, bytesPerRow, only });

/** hits: errors (status 1) in granule 5 of each part; the biggest totals in granule 3 of the first part. */
const hitCols =
  (peak: boolean): InsertOptions["cols"] =>
  (g) => ({
    status: g === 5 ? { min: 0, max: 2, values: [0, 1, 2] } : { min: 0, max: 2, values: [0, 2] },
    total: { min: 0, max: peak && g === 3 ? 9999 : 500 },
  });
const hits = (settings: TableSpec["settings"] = {}): TableSpec => ({
  name: "hits",
  orderBy: ["ts"],
  columns: [col("ts", "DateTime", 4), col("status", "Enum8", 1), col("total", "UInt32", 4), col("payload", "String", 200)],
  settings,
});
const hitsInitial = [
  { rows: ROWS, options: { keyRange: [0, 29] as [number, number], cols: hitCols(true) } },
  { rows: ROWS, options: { keyRange: [30, 59] as [number, number], cols: hitCols(false) } },
];
const run = (ctx: LevelCtx, spec: QuerySpec) => ctx.query(spec);
const readOf = (ctx: LevelCtx, column: string) => ctx.last?.result.boxes.filter((b) => b.read && b.column === column).length ?? 0;
const durationMs = (ctx: LevelCtx) => (ctx.last ? Math.ceil(ctx.last.result.granulesRead / Number(ctx.settings.threads ?? 1)) * 40 : Infinity);

// ---------------------------------------------------------------- 9-1 Many hands

const qSum: QuerySpec = { columns: ["total"] };

const q91: Question[] = [
  { concept: "parallelism", build: (r) => ({ prompt: msg("9-1.check.vector.q"), input: choices(r, "9-1.check.vector", ["blocks", "rows", "pages"]), answer: "blocks", explain: msg("9-1.check.vector.why") }) },
  {
    concept: "parallelism",
    build: (r) => {
      const threads = [2, 4, 8][randInt(r, 0, 2)];
      const granules = threads * randInt(r, 2, 6);
      return { prompt: msg("9-1.check.split.q", { threads, granules }), input: { type: "number" }, answer: granules / threads, explain: msg("9-1.check.split.why", { threads, granules, n: granules / threads }) };
    },
  },
  { concept: "parallelism", build: (r) => ({ prompt: msg("9-1.check.default.q"), input: choices(r, "9-1.check.default", ["cores", "one", "unlimited"]), answer: "cores", explain: msg("9-1.check.default.why") }) },
  { concept: "parallelism", build: (r) => ({ prompt: msg("9-1.check.log.q"), input: choices(r, "9-1.check.log", ["queryLog", "parts", "settings"]), answer: "queryLog", explain: msg("9-1.check.log.why") }) },
];

const level91: Level = {
  id: "9-1",
  world: 9,
  title: msg("9-1.title"),
  summary: msg("9-1.summary"),
  table: hits(),
  initial: hitsInitial,
  settings: { threads: 1 },
  steps: [
    { kind: "brief", title: msg("9-1.brief.title"), body: msg("9-1.brief.body"), code: "SELECT sum(total) FROM hits\nSETTINGS max_threads = 4;\n\nSELECT read_rows, query_duration_ms\nFROM system.query_log ORDER BY event_time DESC LIMIT 1;" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("9-1.one.q"),
        input: { type: "number" },
        answer: 640,
        explain: msg("9-1.one.why"),
        code: "SELECT sum(total) FROM hits SETTINGS max_threads = 1",
        reveal: async (c) => void (await run(c, qSum)),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("9-1.four.q"),
        input: { type: "number" },
        answer: 160,
        explain: msg("9-1.four.why"),
        code: "SELECT sum(total) FROM hits SETTINGS max_threads = 4",
        reveal: async (c) => {
          c.settings.threads = 4;
          await run(c, qSum);
        },
      }),
    },
    {
      kind: "task",
      title: msg("9-1.sla.title"),
      body: msg("9-1.sla.body"),
      tools: [
        { type: "setting", field: "threads", label: msg("9-1.sla.threads"), options: [1, 2, 4, 8], labels: "9-1.sla.counts" },
        {
          type: "action",
          id: "run",
          label: msg("9-1.sla.run"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await run(ctx, qSum);
            if (durationMs(ctx) <= 100) ctx.settings.fast = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.fast ? 1 : 0, total: 1 }),
      success: msg("9-1.sla.success"),
      panels: ["queryLog", "reading"],
      solution: { settings: { threads: 8 }, actions: ["run"] },
    },
  ],
  check: q91,
};

// ---------------------------------------------------------------- 9-2 PREWHERE

const qErrors: QuerySpec = { columns: ["payload"], where: { column: "status", min: 1, max: 1, label: "'error'" } };
const qBig: QuerySpec = { columns: ["payload"], where: { column: "total", min: 9001, max: Infinity, label: "> 9000" } };
const setPrewhere = (ctx: LevelCtx, on: boolean) => (ctx.table.spec.settings = { ...ctx.table.spec.settings, prewhere: on });

const q92: Question[] = [
  { concept: "prewhere", build: (r) => ({ prompt: msg("9-2.check.what.q"), input: choices(r, "9-2.check.what", ["filterFirst", "index", "cache"]), answer: "filterFirst", explain: msg("9-2.check.what.why") }) },
  { concept: "prewhere", build: (r) => ({ prompt: msg("9-2.check.auto.q"), input: choices(r, "9-2.check.auto", ["auto", "manual", "never"]), answer: "auto", explain: msg("9-2.check.auto.why") }) },
  {
    concept: "prewhere",
    build: (r) => {
      const total = randInt(r, 8, 20);
      const hit = randInt(r, 1, 3);
      return { prompt: msg("9-2.check.count.q", { total, hit }), input: { type: "number" }, answer: hit, explain: msg("9-2.check.count.why", { total, hit }) };
    },
  },
  { concept: "prewhere", build: (r) => ({ prompt: msg("9-2.check.best.q"), input: choices(r, "9-2.check.best", ["wide", "narrow", "key"]), answer: "wide", explain: msg("9-2.check.best.why") }) },
];

const level92: Level = {
  id: "9-2",
  world: 9,
  title: msg("9-2.title"),
  summary: msg("9-2.summary"),
  table: hits({ prewhere: false }),
  initial: hitsInitial,
  settings: { prewhere: 0 },
  steps: [
    { kind: "brief", title: msg("9-2.brief.title"), body: msg("9-2.brief.body"), code: "SELECT payload FROM hits WHERE status = 'error';\n-- becomes, automatically (optimize_move_to_prewhere = 1):\nSELECT payload FROM hits PREWHERE status = 'error';" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("9-2.off.q"),
        input: { type: "number" },
        answer: 16,
        explain: msg("9-2.off.why"),
        code: "SELECT payload FROM hits WHERE status = 'error'\nSETTINGS optimize_move_to_prewhere = 0",
        reveal: async (c) => void (await run(c, qErrors)),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("9-2.on.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("9-2.on.why"),
        code: "SELECT payload FROM hits WHERE status = 'error'",
        reveal: async (c) => {
          setPrewhere(c, true);
          await run(c, qErrors);
          setPrewhere(c, false);
        },
      }),
    },
    {
      kind: "task",
      title: msg("9-2.budget.title"),
      body: msg("9-2.budget.body"),
      tools: [
        { type: "setting", field: "prewhere", label: msg("9-2.budget.setting"), options: [0, 1], labels: "9-2.budget.values" },
        {
          type: "action",
          id: "run",
          label: msg("9-2.budget.run"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            setPrewhere(ctx, ctx.settings.prewhere === 1);
            const r = await run(ctx, qBig);
            if (r.bytesRead <= r.bytesTotal * 0.15) ctx.settings.cheap = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.cheap ? 1 : 0, total: 1 }),
      success: msg("9-2.budget.success"),
      panels: ["reading", "queryLog"],
      solution: { settings: { prewhere: 1 }, actions: ["run"] },
    },
  ],
  check: q92,
};

// ---------------------------------------------------------------- 9-3 Lazy materialization

const topN = (n: number): QuerySpec => ({ columns: ["ts", "status", "total", "payload"], orderLimit: { column: "total", n } });
const setLazy = (ctx: LevelCtx, on: boolean) => (ctx.table.spec.settings = { ...ctx.table.spec.settings, lazyMaterialization: on });

const q93: Question[] = [
  { concept: "lazy-materialization", build: (r) => ({ prompt: msg("9-3.check.what.q"), input: choices(r, "9-3.check.what", ["topRows", "allRows", "cache"]), answer: "topRows", explain: msg("9-3.check.what.why") }) },
  { concept: "lazy-materialization", build: (r) => ({ prompt: msg("9-3.check.when.q"), input: choices(r, "9-3.check.when", ["limit", "groupBy", "insert"]), answer: "limit", explain: msg("9-3.check.when.why") }) },
  { concept: "lazy-materialization", build: (r) => ({ prompt: msg("9-3.check.default.q"), input: choices(r, "9-3.check.default", ["on", "off", "cloud"]), answer: "on", explain: msg("9-3.check.default.why") }) },
  { concept: "lazy-materialization", build: (r) => ({ prompt: msg("9-3.check.big.q"), input: choices(r, "9-3.check.big", ["less", "same", "more"]), answer: "less", explain: msg("9-3.check.big.why") }) },
];

const level93: Level = {
  id: "9-3",
  world: 9,
  title: msg("9-3.title"),
  summary: msg("9-3.summary"),
  table: hits({ lazyMaterialization: false }),
  initial: hitsInitial,
  settings: { lazy: 0, limit: 100000 },
  steps: [
    { kind: "brief", title: msg("9-3.brief.title"), body: msg("9-3.brief.body"), code: "SELECT * FROM hits ORDER BY total DESC LIMIT 3;" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("9-3.off.q"),
        input: { type: "number" },
        answer: 16,
        explain: msg("9-3.off.why"),
        code: "SELECT * FROM hits ORDER BY total DESC LIMIT 3\nSETTINGS query_plan_optimize_lazy_materialization = 0",
        reveal: async (c) => void (await run(c, topN(3))),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("9-3.on.q"),
        input: { type: "number" },
        answer: 1,
        explain: msg("9-3.on.why"),
        code: "SELECT * FROM hits ORDER BY total DESC LIMIT 3",
        reveal: async (c) => {
          setLazy(c, true);
          await run(c, topN(3));
          setLazy(c, false);
        },
      }),
    },
    {
      kind: "task",
      title: msg("9-3.top.title"),
      body: msg("9-3.top.body"),
      tools: [
        { type: "setting", field: "lazy", label: msg("9-3.top.lazy"), options: [0, 1], labels: "9-3.top.values" },
        { type: "setting", field: "limit", label: msg("9-3.top.limit"), options: [100000, 3], labels: "9-3.top.limits" },
        {
          type: "action",
          id: "run",
          label: msg("9-3.top.run"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            setLazy(ctx, ctx.settings.lazy === 1);
            await run(ctx, topN(Number(ctx.settings.limit)));
            if (readOf(ctx, "payload") <= 1) ctx.settings.lean = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.lean ? 1 : 0, total: 1 }),
      success: msg("9-3.top.success"),
      panels: ["reading", "queryLog"],
      solution: { settings: { lazy: 1, limit: 3 }, actions: ["run"] },
    },
  ],
  check: q93,
};

// ---------------------------------------------------------------- 9-4 Hash joins

const CUSTOMER_ROWS = 5000;
const MEMORY_LIMIT = 1024 * 1024;
const ENTRY_BYTES = 48;
const joinTable = (): TableSpec => ({
  name: "orders",
  orderBy: ["customer_id"],
  columns: [col("customer_id", "UInt32", 4), col("total", "UInt32", 4, ["orders"]), col("city", "LowCardinality(String)", 2, ["customers"])],
});
/** Which side becomes the hash table: the right-hand one, unless the planner swaps to the smaller. */
const buildSide = (ctx: LevelCtx) => {
  if (ctx.settings.swap === "auto") return "customers";
  return ctx.settings.order === "co" ? "orders" : "customers";
};
const runJoin = async (ctx: LevelCtx) => {
  const build = buildSide(ctx);
  const probe = build === "orders" ? "customers" : "orders";
  const buildRows = build === "orders" ? ROWS : CUSTOMER_ROWS;
  ctx.stage.setBuffer(null);
  await ctx.query({ columns: build === "orders" ? ["customer_id", "total"] : ["customer_id", "city"], partitions: [build] });
  ctx.stage.setBuffer(buildRows);
  const memory = buildRows * ENTRY_BYTES;
  ctx.settings.memory = memory;
  // Over the limit the hash join spills to disk (since 26.5, at 50% of memory): slower, not fatal
  ctx.settings.extraMs = memory > MEMORY_LIMIT ? 400 : 0;
  await ctx.query({ columns: probe === "orders" ? ["customer_id", "total"] : ["customer_id", "city"], partitions: [probe] });
  return memory <= MEMORY_LIMIT;
};

const q94: Question[] = [
  { concept: "hash-join", build: (r) => ({ prompt: msg("9-4.check.build.q"), input: choices(r, "9-4.check.build", ["right", "left", "both"]), answer: "right", explain: msg("9-4.check.build.why") }) },
  { concept: "hash-join", build: (r) => ({ prompt: msg("9-4.check.swap.q"), input: choices(r, "9-4.check.swap", ["swaps", "never", "random"]), answer: "swaps", explain: msg("9-4.check.swap.why") }) },
  { concept: "hash-join", build: (r) => ({ prompt: msg("9-4.check.spill.q"), input: choices(r, "9-4.check.spill", ["spill", "crash", "skip"]), answer: "spill", explain: msg("9-4.check.spill.why") }) },
  {
    concept: "hash-join",
    build: (r) => {
      const k = randInt(r, 2, 9) * 1000;
      return { prompt: msg("9-4.check.memory.q", { k }), input: { type: "number" }, answer: k * 48, explain: msg("9-4.check.memory.why", { k, n: k * 48 }) };
    },
  },
];

const level94: Level = {
  id: "9-4",
  world: 9,
  title: msg("9-4.title"),
  summary: msg("9-4.summary"),
  table: joinTable(),
  halls: ["orders", "customers"],
  bufferLabel: "9-4.hash",
  initial: [
    { rows: ROWS, options: { partition: "orders", keyRange: [0, 4999] } },
    { rows: CUSTOMER_ROWS, options: { partition: "customers", keyRange: [0, 4999] } },
  ],
  settings: { order: "co", swap: "auto", memoryLimit: MEMORY_LIMIT },
  steps: [
    { kind: "brief", title: msg("9-4.brief.title"), body: msg("9-4.brief.body"), code: "SELECT city, sum(total)\nFROM customers JOIN orders USING customer_id\nGROUP BY city;" },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("9-4.auto.q"),
        input: choices(ctx.rng, "9-4.auto", ["customers", "orders"]),
        answer: "customers",
        explain: msg("9-4.auto.why"),
        code: "SELECT … FROM customers JOIN orders USING customer_id\n-- query_plan_join_swap_table = 'auto'",
        reveal: async (c) => void (await runJoin(c)),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("9-4.legacy.q"),
        input: choices(ctx.rng, "9-4.legacy", ["customers", "orders"]),
        answer: "orders",
        explain: msg("9-4.legacy.why"),
        code: "SELECT … FROM customers JOIN orders USING customer_id\nSETTINGS query_plan_join_swap_table = false",
        reveal: async (c) => {
          c.settings.swap = "false";
          await runJoin(c);
          c.settings.swap = "auto";
        },
      }),
    },
    {
      kind: "task",
      title: msg("9-4.fit.title"),
      body: msg("9-4.fit.body"),
      tools: [
        { type: "setting", field: "order", label: msg("9-4.fit.order"), options: ["co", "oc"], labels: "9-4.fit.orders" },
        { type: "setting", field: "swap", label: msg("9-4.fit.swap"), options: ["auto", "false"], labels: "9-4.fit.swaps" },
        {
          type: "action",
          id: "run",
          label: msg("9-4.fit.run"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            const fits = await runJoin(ctx);
            if (fits && ctx.settings.swap === "false") ctx.settings.legacyOk = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.legacyOk ? 1 : 0, total: 1 }),
      success: msg("9-4.fit.success"),
      panels: ["queryLog", "reading"],
      solution: { settings: { order: "oc", swap: "false" }, actions: ["run"] },
    },
  ],
  check: q94,
};

// ---------------------------------------------------------------- 9-5 Dictionaries

const dictTables = (): TableSpec => ({
  name: "orders",
  orderBy: ["customer"],
  columns: [
    { name: "order", type: "UInt32", bytesPerRow: 1 },
    { name: "customer", type: "UInt32", bytesPerRow: 1 },
    { name: "city", type: "String", bytesPerRow: 1 },
  ],
});
const latestCities = (ctx: LevelCtx) => {
  const map: Record<string, string> = {};
  for (const p of ctx.table.dataParts.filter((x) => x.partition === "customers").sort((a, b) => a.minBlock - b.minBlock)) for (const r of ctx.table.visibleRows(p)) map[String(r.customer)] = String(r.city);
  return map;
};
/** SYSTEM RELOAD DICTIONARY (or a LIFETIME tick): the in-memory copy is rebuilt from the table. */
const reload = (ctx: LevelCtx) => {
  const map = latestCities(ctx);
  ctx.settings.dict = JSON.stringify(map);
  ctx.stage.setBuffer(Object.keys(map).length);
};
const dict = (ctx: LevelCtx): Record<string, string> => JSON.parse(String(ctx.settings.dict ?? "{}"));
const viaDict = (ctx: LevelCtx) =>
  ctx.show({ columns: ["order", "customer"], partitions: ["orders"] }, "SELECT order, customer,\n  dictGet('customers_dict', 'city', customer) AS city\nFROM orders", (rows) => rows.map((r) => ({ order: r.order, customer: r.customer, city: dict(ctx)[String(r.customer)] ?? "" })));
const viaJoin = (ctx: LevelCtx) =>
  ctx.show({ columns: ["order", "customer"], partitions: ["orders"] }, "SELECT order, customer, city\nFROM orders JOIN customers USING customer", (rows) => rows.map((r) => ({ order: r.order, customer: r.customer, city: latestCities(ctx)[String(r.customer)] ?? "" })));
const O = (order: number, customer: number): Row => ({ order, customer });
const C = (customer: number, city: string): Row => ({ customer, city });

const q95: Question[] = [
  { concept: "dictionaries", build: (r) => ({ prompt: msg("9-5.check.what.q"), input: choices(r, "9-5.check.what", ["memory", "table", "index"]), answer: "memory", explain: msg("9-5.check.what.why") }) },
  { concept: "dictionaries", build: (r) => ({ prompt: msg("9-5.check.fresh.q"), input: choices(r, "9-5.check.fresh", ["lifetime", "always", "never"]), answer: "lifetime", explain: msg("9-5.check.fresh.why") }) },
  { concept: "dictionaries", build: (r) => ({ prompt: msg("9-5.check.in.q"), input: choices(r, "9-5.check.in", ["in", "join", "same"]), answer: "in", explain: msg("9-5.check.in.why") }) },
  { concept: "hash-join", build: (r) => ({ prompt: msg("9-5.check.default.q"), input: choices(r, "9-5.check.default", ["list", "hash", "merge"]), answer: "list", explain: msg("9-5.check.default.why") }) },
];

const level95: Level = {
  id: "9-5",
  world: 9,
  title: msg("9-5.title"),
  summary: msg("9-5.summary"),
  table: dictTables(),
  halls: ["orders", "customers"],
  bufferLabel: "9-5.dict",
  initialRows: [
    { rows: [C(1, "Lima"), C(2, "Madrid"), C(3, "Quito")], options: { partition: "customers" } },
    { rows: [O(101, 1), O(102, 2), O(103, 2), O(104, 3)], options: { partition: "orders" } },
  ],
  steps: [
    {
      kind: "brief",
      title: msg("9-5.brief.title"),
      body: msg("9-5.brief.body"),
      code: "CREATE DICTIONARY customers_dict (customer UInt32, city String)\nPRIMARY KEY customer\nSOURCE(CLICKHOUSE(TABLE 'customers'))\nLAYOUT(HASHED()) LIFETIME(MIN 300 MAX 360);",
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("9-5.stale.q"),
        input: choices(ctx.rng, "9-5.stale", ["madrid", "lima", "error"]),
        answer: "madrid",
        explain: msg("9-5.stale.why"),
        code: "INSERT INTO customers VALUES (2, 'Lima');\nSELECT dictGet('customers_dict', 'city', 2);",
        reveal: async (c) => {
          reload(c);
          await c.insertRows([C(2, "Lima")], { partition: "customers" });
          await viaDict(c);
        },
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("9-5.join.q"),
        input: choices(ctx.rng, "9-5.join", ["lima", "madrid"]),
        answer: "lima",
        explain: msg("9-5.join.why"),
        code: "SELECT city FROM orders JOIN customers USING customer WHERE customer = 2",
        reveal: async (c) => void (await viaJoin(c)),
      }),
    },
    {
      kind: "task",
      title: msg("9-5.reload.title"),
      body: msg("9-5.reload.body"),
      onEnter: (ctx) => {
        if (!ctx.settings.dict) reload(ctx);
      },
      tools: [
        { type: "action", id: "move", label: msg("9-5.reload.move"), icon: "pencil", tone: "accent", run: (ctx) => ctx.insertRows([C(3, "Bogotá")], { partition: "customers" }) },
        { type: "action", id: "reload", label: msg("9-5.reload.reload"), icon: "repeat", tone: "primary", run: async (ctx) => reload(ctx) },
        {
          type: "action",
          id: "query",
          label: msg("9-5.reload.query"),
          icon: "play",
          run: async (ctx) => {
            await viaDict(ctx);
            if (JSON.stringify(dict(ctx)) === JSON.stringify(latestCities(ctx))) ctx.settings.fresh = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.fresh ? 1 : 0, total: 1 }),
      success: msg("9-5.reload.success"),
      panels: ["rows", "parts"],
      solution: { actions: ["reload", "query"] },
    },
  ],
  check: q95,
};

export const WORLD9: Level[] = [level91, level92, level93, level94, level95];
