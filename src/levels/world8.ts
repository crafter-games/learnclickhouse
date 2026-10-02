// World 8 — Materialized views & ingestion. Facts: docs/research/clickhouse-curriculum.md (World 8).
// Several tables share one depot: each is a partition with its own hall (source, dimension, target),
// and one box is one row, as in World 5.
import { sumByKey, type Row } from "@/sim/engines";
import type { TableSpec } from "@/sim/table";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

const cols = (spec: [string, string][]) => spec.map(([name, type]) => ({ name, type, bytesPerRow: 1 }));
const rowsOf = (ctx: LevelCtx, partition: string) => ctx.table.dataParts.filter((p) => p.partition === partition).flatMap((p) => ctx.table.visibleRows(p));
const partsOf = (ctx: LevelCtx, partition: string) => ctx.table.dataParts.filter((p) => p.partition === partition);
const V = (page: number, user: number): Row => ({ page, user });

// ---------------------------------------------------------------- page_views → views_per_page

/** page_views (src) and views_per_page (mv, SummingMergeTree) in one depot. */
const viewsTables = (): TableSpec => ({
  name: "page_views",
  orderBy: ["page"],
  columns: cols([["page", "UInt32"], ["user", "UInt32"], ["views", "UInt64"]]),
  partitionEngines: { mv: { type: "Summing", columns: ["views"] } },
});
/** The MV's SELECT, run on one inserted block: page, count() AS views GROUP BY page. */
const countByPage = (block: Row[]): Row[] => {
  const counts = new Map<number, number>();
  for (const r of block) counts.set(Number(r.page), (counts.get(Number(r.page)) ?? 0) + 1);
  return [...counts.entries()].map(([page, views]) => ({ page, views }));
};
/** INSERT into page_views: the MV fires on that block and writes its result to the target. */
const insertViews = async (ctx: LevelCtx, block: Row[]) => {
  await ctx.insertRows(block, { partition: "src" });
  await ctx.insertRows(countByPage(block), { partition: "mv", quick: true });
};
const selectTarget = (ctx: LevelCtx) => ctx.show({ columns: ["page", "views"], partitions: ["mv"] }, "SELECT * FROM views_per_page");
const sumTarget = (ctx: LevelCtx) => ctx.show({ columns: ["page", "views"], partitions: ["mv"] }, "SELECT page, sum(views) AS views\nFROM views_per_page GROUP BY page", (rows) => sumByKey(rows, ["page"], ["views"]));
/** Does sum(views) per page in the target match count() per page in the source? */
const targetMatches = (ctx: LevelCtx) => JSON.stringify(sumByKey(rowsOf(ctx, "mv"), ["page"], ["views"])) === JSON.stringify(sumByKey(countByPage(rowsOf(ctx, "src")), ["page"], ["views"]));

const MV_SQL = "CREATE MATERIALIZED VIEW views_mv TO views_per_page AS\nSELECT page, count() AS views\nFROM page_views GROUP BY page;";

// ---------------------------------------------------------------- 8-1 A trigger on inserts

const q81: Question[] = [
  { concept: "mv-trigger", build: (r) => ({ prompt: msg("8-1.check.what.q"), input: choices(r, "8-1.check.what", ["trigger", "cache", "view"]), answer: "trigger", explain: msg("8-1.check.what.why") }) },
  { concept: "mv-backfill", build: (r) => ({ prompt: msg("8-1.check.history.q"), input: choices(r, "8-1.check.history", ["nothing", "all", "recent"]), answer: "nothing", explain: msg("8-1.check.history.why") }) },
  {
    concept: "mv-trigger",
    build: (r) => {
      const pages = randInt(r, 2, 4);
      const rows = pages + randInt(r, 2, 6);
      return { prompt: msg("8-1.check.block.q", { rows, pages }), input: { type: "number" }, answer: pages, explain: msg("8-1.check.block.why", { rows, pages }) };
    },
  },
  { concept: "mv-trigger", build: (r) => ({ prompt: msg("8-1.check.delete.q"), input: choices(r, "8-1.check.delete", ["unchanged", "updated", "error"]), answer: "unchanged", explain: msg("8-1.check.delete.why") }) },
];

const level81: Level = {
  id: "8-1",
  world: 8,
  title: msg("8-1.title"),
  summary: msg("8-1.summary"),
  table: viewsTables(),
  halls: ["src", "mv"],
  initialRows: [{ rows: [V(1, 7), V(2, 3), V(1, 9)], options: { partition: "src" } }],
  // The MV was created after block 1: only blocks from 2 on went through it
  settings: { mvFrom: 2 },
  steps: [
    { kind: "brief", title: msg("8-1.brief.title"), body: msg("8-1.brief.body"), code: MV_SQL },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("8-1.empty.q"),
        input: { type: "number" },
        answer: 0,
        explain: msg("8-1.empty.why"),
        code: "SELECT * FROM views_per_page",
        reveal: async (c) => void (await selectTarget(c)),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("8-1.fires.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("8-1.fires.why"),
        code: "INSERT INTO page_views VALUES (1, 4), (3, 8);\nSELECT * FROM views_per_page;",
        reveal: async (c) => {
          await insertViews(c, [V(1, 4), V(3, 8)]);
          await selectTarget(c);
        },
      }),
    },
    {
      kind: "task",
      title: msg("8-1.backfill.title"),
      body: msg("8-1.backfill.body"),
      tools: [
        {
          type: "action",
          id: "backfillAll",
          label: msg("8-1.backfill.all"),
          icon: "truck",
          tone: "accent",
          run: (ctx) => ctx.insertRows(countByPage(rowsOf(ctx, "src")), { partition: "mv", quick: true }),
        },
        {
          type: "action",
          id: "backfillOld",
          label: msg("8-1.backfill.old"),
          icon: "truck",
          tone: "accent",
          run: async (ctx) => {
            const old = partsOf(ctx, "src").filter((p) => p.minBlock < Number(ctx.settings.mvFrom)).flatMap((p) => ctx.table.visibleRows(p));
            if (old.length) await ctx.insertRows(countByPage(old), { partition: "mv", quick: true });
          },
        },
        { type: "action", id: "truncate", label: msg("8-1.backfill.truncate"), icon: "trash", tone: "danger", run: (ctx) => ctx.dropPartition("mv") },
        {
          type: "action",
          id: "check",
          label: msg("8-1.backfill.check"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await sumTarget(ctx);
            ctx.settings.checked = targetMatches(ctx);
          },
        },
      ],
      progress: (ctx) => {
        const ok = targetMatches(ctx);
        return { done: (ok ? 1 : 0) + (ok && ctx.settings.checked ? 1 : 0), total: 2 };
      },
      success: msg("8-1.backfill.success"),
      panels: ["rows", "parts"],
      solution: { actions: ["backfillOld", "check"] },
    },
  ],
  check: q81,
};

// ---------------------------------------------------------------- 8-2 Partial rows in the target

const q82: Question[] = [
  { concept: "mv-partial", build: (r) => ({ prompt: msg("8-2.check.rows.q"), input: choices(r, "8-2.check.rows", ["several", "one", "zero"]), answer: "several", explain: msg("8-2.check.rows.why") }) },
  { concept: "mv-partial", build: (r) => ({ prompt: msg("8-2.check.query.q"), input: choices(r, "8-2.check.query", ["sum", "star", "count"]), answer: "sum", explain: msg("8-2.check.query.why") }) },
  {
    concept: "mv-partial",
    build: (r) => {
      const n = randInt(r, 2, 5);
      return { prompt: msg("8-2.check.inserts.q", { n }), input: { type: "number" }, answer: n, explain: msg("8-2.check.inserts.why", { n }) };
    },
  },
  { concept: "mv-partial", build: (r) => ({ prompt: msg("8-2.check.engine.q"), input: choices(r, "8-2.check.engine", ["summing", "plain", "replacing"]), answer: "summing", explain: msg("8-2.check.engine.why") }) },
];

const level82: Level = {
  id: "8-2",
  world: 8,
  title: msg("8-2.title"),
  summary: msg("8-2.summary"),
  table: viewsTables(),
  halls: ["src", "mv"],
  initialRows: [
    { rows: [V(1, 7), V(2, 3)], options: { partition: "src" } },
    { rows: countByPage([V(1, 7), V(2, 3)]), options: { partition: "mv" } },
  ],
  steps: [
    { kind: "brief", title: msg("8-2.brief.title"), body: msg("8-2.brief.body"), code: "CREATE TABLE views_per_page (page UInt32, views UInt64)\nENGINE = SummingMergeTree ORDER BY page;\n\n" + MV_SQL },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("8-2.partials.q"),
        input: { type: "number" },
        answer: 4,
        explain: msg("8-2.partials.why"),
        code: "INSERT INTO page_views VALUES (1, 11);\nINSERT INTO page_views VALUES (1, 12);\nINSERT INTO page_views VALUES (1, 13);",
        reveal: async (c) => {
          for (const user of [11, 12, 13]) await insertViews(c, [V(1, user)]);
          await selectTarget(c);
        },
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("8-2.sum.q"),
        input: { type: "number" },
        answer: 4,
        explain: msg("8-2.sum.why"),
        code: "SELECT page, sum(views) FROM views_per_page GROUP BY page",
        reveal: async (c) => void (await sumTarget(c)),
      }),
    },
    {
      kind: "task",
      title: msg("8-2.read.title"),
      body: msg("8-2.read.body"),
      tools: [
        {
          type: "action",
          id: "insert",
          label: msg("8-2.read.insert"),
          icon: "truck",
          tone: "accent",
          run: async (ctx) => {
            await insertViews(ctx, [V(2, 21), V(2, 22), V(3, 23)]);
            ctx.settings.inserted = true;
          },
        },
        { type: "action", id: "star", label: msg("8-2.read.star"), icon: "play", run: (ctx) => selectTarget(ctx) },
        {
          type: "action",
          id: "sum",
          label: msg("8-2.read.sum"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await sumTarget(ctx);
            if (ctx.settings.inserted && partsOf(ctx, "mv").length > 1) ctx.settings.summed = true;
          },
        },
      ],
      progress: (ctx) => ({ done: (ctx.settings.inserted ? 1 : 0) + (ctx.settings.summed ? 1 : 0), total: 2 }),
      success: msg("8-2.read.success"),
      panels: ["rows", "parts"],
      solution: { actions: ["insert", "sum"] },
    },
  ],
  check: q82,
};

// ---------------------------------------------------------------- page_views ⨝ pages → views_by_section

/** page_views (src), pages (dim) and views_by_section (mv) in one depot, keyed by (page, section). */
const joinTables = (refreshable = false): TableSpec => ({
  name: "page_views",
  orderBy: ["page", "section"],
  columns: cols([["page", "UInt32"], ["user", "UInt32"], ["section", "String"], ["views", "UInt64"]]),
  partitionEngines: refreshable ? {} : { mv: { type: "Summing", columns: ["views"] } },
});
const P = (page: number, section: string): Row => ({ page, section });
/** The latest section of each page in the dimension table. */
const sectionOf = (ctx: LevelCtx) => {
  const map = new Map<number, string>();
  for (const p of partsOf(ctx, "dim").sort((a, b) => a.minBlock - b.minBlock)) for (const r of ctx.table.visibleRows(p)) map.set(Number(r.page), String(r.section));
  return map;
};
/** The MV's SELECT: page_views JOIN pages USING page, count() GROUP BY page, section. */
const joined = (ctx: LevelCtx, block: Row[]): Row[] => {
  const sections = sectionOf(ctx);
  const counts = new Map<string, Row>();
  for (const r of block) {
    const section = sections.get(Number(r.page)) ?? "?";
    const k = `${r.page}|${section}`;
    const cur = counts.get(k) ?? { page: Number(r.page), section, views: 0 };
    cur.views = Number(cur.views) + 1;
    counts.set(k, cur);
  }
  return [...counts.values()];
};
const insertJoined = async (ctx: LevelCtx, block: Row[]) => {
  await ctx.insertRows(block, { partition: "src" });
  await ctx.insertRows(joined(ctx, block), { partition: "mv", quick: true });
};
const selectSections = (ctx: LevelCtx) =>
  ctx.show({ columns: ["page", "section", "views"], partitions: ["mv"] }, "SELECT page, section, sum(views) AS views\nFROM views_by_section GROUP BY page, section", (rows) => sumByKey(rows, ["page", "section"], ["views"]));
/** Does the target hold exactly what the JOIN gives today over all of page_views? */
const sectionsFresh = (ctx: LevelCtx) => JSON.stringify(sumByKey(rowsOf(ctx, "mv"), ["page", "section"], ["views"])) === JSON.stringify(sumByKey(joined(ctx, rowsOf(ctx, "src")), ["page", "section"], ["views"]));
/** Recompute the whole target from the JOIN (TRUNCATE + INSERT … SELECT, or a refresh). */
const recompute = async (ctx: LevelCtx) => {
  if (partsOf(ctx, "mv").length) await ctx.dropPartition("mv");
  await ctx.insertRows(joined(ctx, rowsOf(ctx, "src")), { partition: "mv", quick: true });
};
const JOIN_SRC = [V(1, 7), V(2, 3), V(1, 9)];
const JOIN_DIM = [P(1, "news"), P(2, "sports")];

// ---------------------------------------------------------------- 8-3 A JOIN fires on the left table only

const q83: Question[] = [
  { concept: "mv-join", build: (r) => ({ prompt: msg("8-3.check.fires.q"), input: choices(r, "8-3.check.fires", ["left", "both", "right"]), answer: "left", explain: msg("8-3.check.fires.why") }) },
  { concept: "mv-join", build: (r) => ({ prompt: msg("8-3.check.dim.q"), input: choices(r, "8-3.check.dim", ["nothing", "rewrite", "error"]), answer: "nothing", explain: msg("8-3.check.dim.why") }) },
  { concept: "mv-backfill", build: (r) => ({ prompt: msg("8-3.check.populate.q"), input: choices(r, "8-3.check.populate", ["insertSelect", "populate", "recreate"]), answer: "insertSelect", explain: msg("8-3.check.populate.why") }) },
  { concept: "mv-join", build: (r) => ({ prompt: msg("8-3.check.alt.q"), input: choices(r, "8-3.check.alt", ["refreshable", "bigger", "final"]), answer: "refreshable", explain: msg("8-3.check.alt.why") }) },
];

const level83: Level = {
  id: "8-3",
  world: 8,
  title: msg("8-3.title"),
  summary: msg("8-3.summary"),
  table: joinTables(),
  halls: ["src", "dim", "mv"],
  initialRows: [
    { rows: JOIN_DIM, options: { partition: "dim" } },
    { rows: JOIN_SRC, options: { partition: "src" } },
    { rows: [{ page: 1, section: "news", views: 2 }, { page: 2, section: "sports", views: 1 }], options: { partition: "mv" } },
  ],
  steps: [
    {
      kind: "brief",
      title: msg("8-3.brief.title"),
      body: msg("8-3.brief.body"),
      code: "CREATE MATERIALIZED VIEW sections_mv TO views_by_section AS\nSELECT page, section, count() AS views\nFROM page_views JOIN pages USING page\nGROUP BY page, section;",
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("8-3.dim.q"),
        input: choices(ctx.rng, "8-3.dim", ["no", "yes", "later"]),
        answer: "no",
        explain: msg("8-3.dim.why"),
        code: "INSERT INTO pages VALUES (1, 'tech');",
        reveal: async (c) => {
          await c.insertRows([P(1, "tech")], { partition: "dim" });
          await selectSections(c);
        },
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("8-3.next.q"),
        input: choices(ctx.rng, "8-3.next", ["tech", "news", "both"]),
        answer: "tech",
        explain: msg("8-3.next.why"),
        code: "INSERT INTO page_views VALUES (1, 4);",
        reveal: async (c) => {
          await insertJoined(c, [V(1, 4)]);
          await selectSections(c);
        },
      }),
    },
    {
      kind: "task",
      title: msg("8-3.restate.title"),
      body: msg("8-3.restate.body"),
      tools: [
        { type: "action", id: "view", label: msg("8-3.restate.view"), icon: "truck", tone: "accent", run: (ctx) => insertJoined(ctx, [V(2, 5)]) },
        { type: "action", id: "rebuild", label: msg("8-3.restate.rebuild"), icon: "repeat", tone: "danger", run: (ctx) => recompute(ctx) },
        {
          type: "action",
          id: "check",
          label: msg("8-3.restate.check"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await selectSections(ctx);
            ctx.settings.checked = sectionsFresh(ctx);
          },
        },
      ],
      progress: (ctx) => {
        const ok = sectionsFresh(ctx);
        return { done: (ok ? 1 : 0) + (ok && ctx.settings.checked ? 1 : 0), total: 2 };
      },
      success: msg("8-3.restate.success"),
      panels: ["rows", "parts"],
      solution: { actions: ["rebuild", "check"] },
    },
  ],
  check: q83,
};

// ---------------------------------------------------------------- 8-4 Refreshable materialized views

const q84: Question[] = [
  { concept: "refreshable-mv", build: (r) => ({ prompt: msg("8-4.check.how.q"), input: choices(r, "8-4.check.how", ["rerun", "incremental", "trigger"]), answer: "rerun", explain: msg("8-4.check.how.why") }) },
  { concept: "refreshable-mv", build: (r) => ({ prompt: msg("8-4.check.between.q"), input: choices(r, "8-4.check.between", ["stale", "live", "empty"]), answer: "stale", explain: msg("8-4.check.between.why") }) },
  { concept: "refreshable-mv", build: (r) => ({ prompt: msg("8-4.check.swap.q"), input: choices(r, "8-4.check.swap", ["atomic", "partial", "append"]), answer: "atomic", explain: msg("8-4.check.swap.why") }) },
  { concept: "refreshable-mv", build: (r) => ({ prompt: msg("8-4.check.when.q"), input: choices(r, "8-4.check.when", ["joins", "every", "never"]), answer: "joins", explain: msg("8-4.check.when.why") }) },
];

const level84: Level = {
  id: "8-4",
  world: 8,
  title: msg("8-4.title"),
  summary: msg("8-4.summary"),
  table: joinTables(true),
  halls: ["src", "dim", "mv"],
  initialRows: [
    { rows: JOIN_DIM, options: { partition: "dim" } },
    { rows: JOIN_SRC, options: { partition: "src" } },
    { rows: [{ page: 1, section: "news", views: 2 }, { page: 2, section: "sports", views: 1 }], options: { partition: "mv" } },
  ],
  steps: [
    {
      kind: "brief",
      title: msg("8-4.brief.title"),
      body: msg("8-4.brief.body"),
      code: "CREATE MATERIALIZED VIEW sections_mv\nREFRESH EVERY 1 HOUR TO views_by_section AS\nSELECT page, section, count() AS views\nFROM page_views JOIN pages USING page\nGROUP BY page, section;",
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("8-4.between.q"),
        input: choices(ctx.rng, "8-4.between", ["no", "yes"]),
        answer: "no",
        explain: msg("8-4.between.why"),
        code: "INSERT INTO page_views VALUES (2, 6);",
        reveal: async (c) => {
          await c.insertRows([V(2, 6)], { partition: "src" });
          await selectSections(c);
        },
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("8-4.refresh.q"),
        input: { type: "number" },
        answer: 1,
        explain: msg("8-4.refresh.why"),
        code: "SYSTEM REFRESH VIEW sections_mv;",
        reveal: async (c) => {
          await recompute(c);
          await selectSections(c);
        },
      }),
    },
    {
      kind: "task",
      title: msg("8-4.fresh.title"),
      body: msg("8-4.fresh.body"),
      tools: [
        {
          type: "action",
          id: "dim",
          label: msg("8-4.fresh.dim"),
          icon: "pencil",
          tone: "accent",
          run: async (ctx) => {
            await ctx.insertRows([P(2, "tech")], { partition: "dim" });
            ctx.settings.dimChanged = true;
          },
        },
        {
          type: "action",
          id: "views",
          label: msg("8-4.fresh.views"),
          icon: "truck",
          tone: "accent",
          run: async (ctx) => {
            await ctx.insertRows([V(1, 31), V(2, 32)], { partition: "src" });
            ctx.settings.viewsAdded = true;
          },
        },
        { type: "action", id: "refresh", label: msg("8-4.fresh.refresh"), icon: "repeat", tone: "primary", run: (ctx) => recompute(ctx) },
        { type: "action", id: "select", label: msg("8-4.fresh.select"), icon: "play", run: (ctx) => selectSections(ctx) },
      ],
      progress: (ctx) => {
        const changed = [ctx.settings.dimChanged, ctx.settings.viewsAdded].filter(Boolean).length;
        return { done: changed + (changed === 2 && sectionsFresh(ctx) ? 1 : 0), total: 3 };
      },
      success: msg("8-4.fresh.success"),
      panels: ["rows", "parts"],
      solution: { actions: ["dim", "views", "refresh"] },
    },
  ],
  check: q84,
};

// ---------------------------------------------------------------- 8-5 Kafka engine

const q85: Question[] = [
  { concept: "kafka-engine", build: (r) => ({ prompt: msg("8-5.check.stores.q"), input: choices(r, "8-5.check.stores", ["consumer", "storage", "cache"]), answer: "consumer", explain: msg("8-5.check.stores.why") }) },
  { concept: "kafka-engine", build: (r) => ({ prompt: msg("8-5.check.pipeline.q"), input: choices(r, "8-5.check.pipeline", ["kafkaMvTable", "kafkaTable", "tableKafka"]), answer: "kafkaMvTable", explain: msg("8-5.check.pipeline.why") }) },
  { concept: "kafka-engine", build: (r) => ({ prompt: msg("8-5.check.delivery.q"), input: choices(r, "8-5.check.delivery", ["atLeast", "exactly", "atMost"]), answer: "atLeast", explain: msg("8-5.check.delivery.why") }) },
  {
    concept: "kafka-engine",
    build: (r) => {
      const n = randInt(r, 2, 6);
      return { prompt: msg("8-5.check.dups.q", { n }), input: { type: "number" }, answer: n * 2, explain: msg("8-5.check.dups.why", { n, total: n * 2 }) };
    },
  },
];

/** The topic lives in ctx.settings: messages 1…produced, the consumer group committed up to `committed`. */
const produce = (ctx: LevelCtx, n: number) => {
  ctx.settings.produced = Number(ctx.settings.produced) + n;
  ctx.stage.setBuffer(Number(ctx.settings.produced) - Number(ctx.settings.committed));
};
/** The Kafka table reads a batch from the committed offset; the MV writes it to `events`. */
const consume = async (ctx: LevelCtx, commit: boolean) => {
  const from = Number(ctx.settings.committed) + 1;
  const to = Number(ctx.settings.produced);
  if (to < from) return;
  const batch: Row[] = [];
  for (let id = from; id <= to; id++) batch.push({ id, page: (id % 3) + 1 });
  await ctx.insertRows(batch, { quick: true });
  if (commit) ctx.settings.committed = to;
  ctx.stage.setBuffer(to - Number(ctx.settings.committed));
};
const selectEvents = (ctx: LevelCtx, final = false) => ctx.show({ columns: ["id", "page"], final }, `SELECT * FROM events${final ? " FINAL" : ""}`);
const hasDuplicates = (rows: Row[]) => new Set(rows.map((r) => r.id)).size !== rows.length;

const level85: Level = {
  id: "8-5",
  world: 8,
  title: msg("8-5.title"),
  summary: msg("8-5.summary"),
  table: { name: "events", orderBy: ["id"], columns: cols([["id", "UInt64"], ["page", "UInt32"]]) },
  bufferLabel: "8-5.topic",
  settings: { produced: 0, committed: 0, engine: "MergeTree" },
  steps: [
    {
      kind: "brief",
      title: msg("8-5.brief.title"),
      body: msg("8-5.brief.body"),
      code: "CREATE TABLE kafka_events (id UInt64, page UInt32)\nENGINE = Kafka('broker:9092', 'events', 'clickhouse', 'JSONEachRow');\n\nCREATE MATERIALIZED VIEW events_mv TO events AS\nSELECT * FROM kafka_events;",
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("8-5.where.q"),
        input: choices(ctx.rng, "8-5.where", ["target", "kafka", "both"]),
        answer: "target",
        explain: msg("8-5.where.why"),
        reveal: async (c) => {
          produce(c, 4);
          await c.wait(700);
          await consume(c, true);
          await selectEvents(c);
        },
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("8-5.crash.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("8-5.crash.why"),
        reveal: async (c) => {
          produce(c, 3);
          await c.wait(700);
          await consume(c, false);
          await c.wait(500);
          await consume(c, true);
          await selectEvents(c);
        },
      }),
    },
    {
      kind: "task",
      title: msg("8-5.dedup.title"),
      body: msg("8-5.dedup.body"),
      tools: [
        { type: "setting", field: "engine", label: msg("8-5.dedup.engine"), options: ["MergeTree", "ReplacingMergeTree"], labels: "8-5.dedup.engines" },
        {
          type: "action",
          id: "crash",
          label: msg("8-5.dedup.crash"),
          icon: "truck",
          tone: "accent",
          run: async (ctx) => {
            produce(ctx, 2);
            await ctx.wait(500);
            await consume(ctx, false);
            await consume(ctx, true);
            ctx.settings.crashed = true;
          },
        },
        {
          type: "action",
          id: "final",
          label: msg("8-5.dedup.final"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            // The target's engine, as chosen in the dock (re-created with the same rows). FINAL only
            // means something for ReplacingMergeTree; on a plain MergeTree we just read.
            const replacing = ctx.settings.engine === "ReplacingMergeTree";
            ctx.table.spec.engine = replacing ? { type: "Replacing" } : { type: "MergeTree" };
            const r = await selectEvents(ctx, replacing);
            if (ctx.settings.crashed && r.rows && !hasDuplicates(r.rows)) ctx.settings.clean = true;
          },
        },
      ],
      progress: (ctx) => ({ done: (ctx.settings.crashed ? 1 : 0) + (ctx.settings.clean ? 1 : 0), total: 2 }),
      success: msg("8-5.dedup.success"),
      panels: ["rows", "parts"],
      solution: { settings: { engine: "ReplacingMergeTree" }, actions: ["crash", "final"] },
    },
  ],
  check: q85,
};

export const WORLD8: Level[] = [level81, level82, level83, level84, level85];
