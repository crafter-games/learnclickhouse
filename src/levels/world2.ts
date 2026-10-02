// World 2 — Inserts, parts & merges. Facts: docs/research/clickhouse-curriculum.md (World 2).
// Thresholds are scaled to fit the depot (the briefs say which real numbers they stand for).
import { GRANULE_ROWS, type TableSpec } from "@/sim/table";
import { rowsFor } from "./session";
import { choices, msg, randInt, shuffle, type Level, type Question } from "./types";

const orders = (settings: TableSpec["settings"] = {}): TableSpec => ({
  name: "orders",
  orderBy: ["customer_id"],
  columns: [
    { name: "date", type: "Date", bytesPerRow: 0.2 },
    { name: "customer_id", type: "UInt32", bytesPerRow: 2.5 },
    { name: "total", type: "Decimal(10,2)", bytesPerRow: 3.6 },
  ],
  settings,
});
/** Scaled stand-ins for parts_to_delay_insert = 1000 / parts_to_throw_insert = 3000 (same 1:3 ratio). */
const SCALED = { partsToDelay: 5, partsToThrow: 15 };
const under = (n: number) => (ctx: { table: { activeCount: (p: string) => number } }) => ctx.table.activeCount("all") <= n;

// ---------------------------------------------------------------- 2-1 One truck, one section

const q21: Question[] = [
  {
    concept: "parts",
    build: (r) => {
      const k = randInt(r, 3, 12);
      const name = `all_${k}_${k}_0`;
      const options = shuffle(r, [name, `all_1_${k}_0`, `all_${k}_${k}_1`]).map((id) => ({ id, label: msg("2-1.check.name.opt", { name: id }) }));
      return { prompt: msg("2-1.check.name.q", { k }), input: { type: "choice", options }, answer: name, explain: msg("2-1.check.name.why", { name }) };
    },
  },
  { concept: "parts", build: (r) => ({ prompt: msg("2-1.check.immutable.q"), input: choices(r, "2-1.check.immutable", ["never", "append", "inplace"]), answer: "never", explain: msg("2-1.check.immutable.why") }) },
  { concept: "parts", build: (r) => ({ prompt: msg("2-1.check.oneRow.q"), input: choices(r, "2-1.check.oneRow", ["part", "row", "nothing"]), answer: "part", explain: msg("2-1.check.oneRow.why") }) },
  { concept: "parts", build: (r) => ({ prompt: msg("2-1.check.level.q"), input: choices(r, "2-1.check.level", ["merges", "rows", "version"]), answer: "merges", explain: msg("2-1.check.level.why") }) },
];

const level21: Level = {
  id: "2-1",
  world: 2,
  title: msg("2-1.title"),
  summary: msg("2-1.summary"),
  table: orders(),
  steps: [
    {
      kind: "brief",
      title: msg("2-1.brief.title"),
      body: msg("2-1.brief.body"),
      mapping: [
        { icon: "truck", thing: msg("2-1.map.truck"), real: msg("2-1.map.insert") },
        { icon: "stack", thing: msg("2-1.map.section"), real: msg("2-1.map.part") },
        { icon: "tag", thing: msg("2-1.map.tag"), real: msg("2-1.map.name") },
      ],
      breaks: msg("2-1.brief.breaks"),
    },
    {
      kind: "task",
      title: msg("2-1.two.title"),
      body: msg("2-1.two.body"),
      tools: [{ type: "insert", granules: 2 }],
      progress: (ctx, start) => ({ done: ctx.stats.inserts - start.inserts, total: 2 }),
      success: msg("2-1.two.success"),
      panels: ["parts"],
      solution: { actions: ["insert", "insert"] },
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("2-1.third.q"),
        input: choices(ctx.rng, "2-1.third", ["a330", "a130", "a331", "a230"]),
        answer: "a330",
        explain: msg("2-1.third.why"),
        reveal: async (c) => void (await c.insert(rowsFor(2))),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("2-1.fix.q"),
        input: choices(ctx.rng, "2-1.fix", ["newPart", "edit", "appendRow"]),
        answer: "newPart",
        explain: msg("2-1.fix.why"),
      }),
    },
    {
      kind: "brief",
      title: msg("2-1.real.title"),
      body: msg("2-1.real.body"),
      code: "INSERT INTO orders VALUES ('2026-10-02', 4200, 59.90), …\n\nSELECT name, rows, level\nFROM system.parts\nWHERE table = 'orders' AND active;",
    },
  ],
  check: q21,
};

// ---------------------------------------------------------------- 2-2 The press

const q22: Question[] = [
  {
    concept: "merges",
    build: (r) => {
      const a = randInt(r, 1, 4);
      const b = a + randInt(r, 1, 4);
      const c = b + randInt(r, 1, 4);
      const l1 = randInt(r, 0, 2);
      const l2 = randInt(r, 0, 2);
      const name = `all_${a}_${c}_${Math.max(l1, l2) + 1}`;
      return {
        prompt: msg("2-2.check.name.q", { left: `all_${a}_${b}_${l1}`, right: `all_${b + 1}_${c}_${l2}` }),
        input: { type: "choice", options: shuffle(r, [...new Set([name, `all_${a}_${c}_${l1 + l2 + 2}`, `all_${b + 1}_${c}_${Math.max(l1, l2) + 1}`])]).map((id) => ({ id, label: msg("2-2.check.name.opt", { name: id }) })) },
        answer: name,
        explain: msg("2-2.check.name.why", { name }),
      };
    },
  },
  { concept: "merges", build: (r) => ({ prompt: msg("2-2.check.lifetime.q"), input: choices(r, "2-2.check.lifetime", ["eight", "instant", "day"]), answer: "eight", explain: msg("2-2.check.lifetime.why") }) },
  { concept: "merges", build: (r) => ({ prompt: msg("2-2.check.contiguous.q"), input: choices(r, "2-2.check.contiguous", ["no", "yes", "night"]), answer: "no", explain: msg("2-2.check.contiguous.why") }) },
  { concept: "merges", build: (r) => ({ prompt: msg("2-2.check.optimize.q"), input: choices(r, "2-2.check.optimize", ["auto", "optimize", "restart"]), answer: "auto", explain: msg("2-2.check.optimize.why") }) },
];

const level22: Level = {
  id: "2-2",
  world: 2,
  title: msg("2-2.title"),
  summary: msg("2-2.summary"),
  table: orders(),
  initial: [{ rows: 3000 }, { rows: 2500 }, { rows: 4000 }, { rows: 3500 }],
  steps: [
    { kind: "brief", title: msg("2-2.brief.title"), body: msg("2-2.brief.body") },
    {
      kind: "watch",
      title: msg("2-2.first.title"),
      body: msg("2-2.first.body"),
      panels: ["parts"],
      script: async (ctx) => {
        await ctx.wait(1200);
        await ctx.merge(["all_1_1_0", "all_2_2_0"]);
      },
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("2-2.next.q"),
        input: choices(ctx.rng, "2-2.next", ["a132", "a131", "a331", "a122"]),
        answer: "a132",
        explain: msg("2-2.next.why"),
        reveal: async (c) => void (await c.merge(["all_1_2_1", "all_3_3_0"])),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("2-2.gap.q"),
        input: choices(ctx.rng, "2-2.gap", ["no", "yes", "fill"]),
        answer: "no",
        explain: msg("2-2.gap.why"),
      }),
    },
    {
      kind: "task",
      title: msg("2-2.work.title"),
      body: msg("2-2.work.body"),
      tools: [{ type: "insert", granules: 1 }],
      onEnter: (ctx) => ctx.bg.merger(2600),
      progress: (ctx, start) => ({ done: ctx.stats.merges - start.merges, total: 2 }),
      success: msg("2-2.work.success"),
      panels: ["parts"],
      solution: { actions: ["insert", "insert", "insert"] },
    },
  ],
  check: q22,
};

// ---------------------------------------------------------------- 2-3 Too many parts

const q23: Question[] = [
  { concept: "too-many-parts", build: (r) => ({ prompt: msg("2-3.check.limits.q"), input: choices(r, "2-3.check.limits", ["l1000", "l100", "l10k"]), answer: "l1000", explain: msg("2-3.check.limits.why") }) },
  { concept: "too-many-parts", build: (r) => ({ prompt: msg("2-3.check.scope.q"), input: choices(r, "2-3.check.scope", ["partition", "table", "server"]), answer: "partition", explain: msg("2-3.check.scope.why") }) },
  { concept: "batching", build: (r) => ({ prompt: msg("2-3.check.fix.q"), input: choices(r, "2-3.check.fix", ["batch", "raise", "partitions"]), answer: "batch", explain: msg("2-3.check.fix.why") }) },
  {
    concept: "too-many-parts",
    build: (r) => {
      const ins = randInt(r, 4, 9) * 10;
      const mer = ins - randInt(r, 1, 3) * 10;
      const s = Math.round(3000 / (ins - mer));
      return { prompt: msg("2-3.check.time.q", { ins, mer }), input: { type: "number" }, answer: s, explain: msg("2-3.check.time.why", { ins, mer, net: ins - mer, s }) };
    },
  },
];

const level23: Level = {
  id: "2-3",
  world: 2,
  title: msg("2-3.title"),
  summary: msg("2-3.summary"),
  table: orders(SCALED),
  initial: [{ rows: rowsFor(2) }],
  settings: { batch: "single" },
  steps: [
    { kind: "brief", title: msg("2-3.brief.title"), body: msg("2-3.brief.body") },
    {
      kind: "task",
      title: msg("2-3.rush.title"),
      body: msg("2-3.rush.body"),
      tools: [{ type: "setting", field: "batch", label: msg("2-3.rush.setting"), options: ["single", "batch"], labels: "2-3.batch" }],
      onEnter: (ctx) => {
        ctx.bg.loop(120, async () => {
          if (ctx.settings.batch === "single") await ctx.insert(60, { quick: true });
        });
        ctx.bg.loop(2600, async () => {
          if (ctx.settings.batch === "batch") await ctx.insert(GRANULE_ROWS, { quick: true });
        });
        // The press can't keep up with row-by-row inserts: it fuses two parts at a time, slowly
        ctx.bg.merger(1500, 2);
        ctx.bg.watch(() => ctx.settings.batch === "batch" && under(SCALED.partsToDelay)(ctx));
      },
      progress: (ctx) => ({ done: ctx.stats.calm, total: 8 }),
      success: msg("2-3.rush.success"),
      panels: ["partsMeter", "parts"],
      solution: { settings: { batch: "batch" } },
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("2-3.math.q"),
        input: { type: "number" },
        answer: 300,
        explain: msg("2-3.math.why"),
      }),
    },
    {
      kind: "brief",
      title: msg("2-3.real.title"),
      body: msg("2-3.real.body"),
      code: "-- 10,000–100,000 rows per INSERT, about one INSERT per second\nINSERT INTO orders FORMAT Native …\n\n-- MergeTree settings (per partition)\nparts_to_delay_insert = 1000\nparts_to_throw_insert = 3000",
    },
  ],
  check: q23,
};

// ---------------------------------------------------------------- 2-4 Batches & async inserts

const q24: Question[] = [
  { concept: "async-insert", build: (r) => ({ prompt: msg("2-4.check.default.q"), input: choices(r, "2-4.check.default", ["on", "off", "cloud"]), answer: "on", explain: msg("2-4.check.default.why") }) },
  { concept: "async-insert", build: (r) => ({ prompt: msg("2-4.check.first.q"), input: choices(r, "2-4.check.first", ["time", "size", "count"]), answer: "time", explain: msg("2-4.check.first.why") }) },
  { concept: "async-insert", build: (r) => ({ prompt: msg("2-4.check.wait.q"), input: choices(r, "2-4.check.wait", ["lost", "slow", "nothing"]), answer: "lost", explain: msg("2-4.check.wait.why") }) },
  { concept: "batching", build: (r) => ({ prompt: msg("2-4.check.batch.q"), input: choices(r, "2-4.check.batch", ["b10k", "b1", "b10m"]), answer: "b10k", explain: msg("2-4.check.batch.why") }) },
];

const level24: Level = {
  id: "2-4",
  world: 2,
  title: msg("2-4.title"),
  summary: msg("2-4.summary"),
  table: orders(SCALED),
  initial: [{ rows: rowsFor(2) }],
  settings: { async: false },
  steps: [
    { kind: "brief", title: msg("2-4.brief.title"), body: msg("2-4.brief.body") },
    {
      kind: "task",
      title: msg("2-4.clients.title"),
      body: msg("2-4.clients.body"),
      tools: [{ type: "setting", field: "async", label: msg("2-4.clients.setting"), options: [false, true], labels: "2-4.async" }],
      onEnter: (ctx) => {
        ctx.bg.loop(120, async () => void (await ctx.clientInsert(40)));
        ctx.bg.asyncFlusher(2500, GRANULE_ROWS * 3);
        ctx.bg.merger(1500, 2);
        ctx.bg.watch(() => ctx.settings.async === true && under(SCALED.partsToDelay)(ctx));
      },
      progress: (ctx) => ({ done: ctx.stats.calm, total: 8 }),
      success: msg("2-4.clients.success"),
      panels: ["partsMeter", "parts"],
      solution: { settings: { async: true } },
    },
    {
      kind: "predict",
      build: () => ({ prompt: msg("2-4.rate.q"), input: { type: "number" }, answer: 5, explain: msg("2-4.rate.why") }),
    },
    {
      kind: "predict",
      build: (ctx) => ({ prompt: msg("2-4.fire.q"), input: choices(ctx.rng, "2-4.fire", ["lost", "faster", "nothing"]), answer: "lost", explain: msg("2-4.fire.why") }),
    },
    {
      kind: "brief",
      title: msg("2-4.real.title"),
      body: msg("2-4.real.body"),
      code: "-- Defaults since 26.2\nSET async_insert = 1;\nSET wait_for_async_insert = 1;\n-- Flush at the first limit reached:\n--   async_insert_busy_timeout_max_ms = 200 (adaptive, from 50)\n--   async_insert_max_data_size = 10 MiB (Cloud: 100 MiB)\n--   async_insert_max_query_number = 450",
    },
  ],
  check: q24,
};

// ---------------------------------------------------------------- 2-5 Case: the truck that came twice

const q25: Question[] = [
  { concept: "dedup", build: (r) => ({ prompt: msg("2-5.check.what.q"), input: choices(r, "2-5.check.what", ["block", "row", "key"]), answer: "block", explain: msg("2-5.check.what.why") }) },
  { concept: "dedup", build: (r) => ({ prompt: msg("2-5.check.window.q"), input: choices(r, "2-5.check.window", ["w10k", "w100", "forever"]), answer: "w10k", explain: msg("2-5.check.window.why") }) },
  { concept: "dedup", build: (r) => ({ prompt: msg("2-5.check.plain.q"), input: choices(r, "2-5.check.plain", ["off", "on", "async"]), answer: "off", explain: msg("2-5.check.plain.why") }) },
  { concept: "dedup", build: (r) => ({ prompt: msg("2-5.check.notUnique.q"), input: choices(r, "2-5.check.notUnique", ["both", "one", "error"]), answer: "both", explain: msg("2-5.check.notUnique.why") }) },
];

const level25: Level = {
  id: "2-5",
  world: 2,
  title: msg("2-5.title"),
  summary: msg("2-5.summary"),
  table: orders({ dedupWindow: 100 }),
  initial: [{ rows: rowsFor(2), options: { token: "b16" } }],
  steps: [
    { kind: "brief", title: msg("2-5.brief.title"), body: msg("2-5.brief.body") },
    {
      kind: "task",
      title: msg("2-5.retry.title"),
      body: msg("2-5.retry.body"),
      tools: [
        { type: "action", id: "send17", label: msg("2-5.retry.send17"), icon: "truck", tone: "accent", run: (ctx) => ctx.insert(rowsFor(1), { token: "b17" }) },
        { type: "action", id: "retry17", label: msg("2-5.retry.retry17"), icon: "repeat", run: (ctx) => ctx.insert(rowsFor(1), { token: "b17" }) },
        { type: "action", id: "send18", label: msg("2-5.retry.send18"), icon: "truck", run: (ctx) => ctx.insert(rowsFor(1), { token: "b18" }) },
      ],
      progress: (ctx, start) => ({ done: Math.min(1, ctx.stats.dedupHits - start.dedupHits) + Math.min(1, ctx.stats.inserts - start.inserts), total: 2 }),
      success: msg("2-5.retry.success"),
      panels: ["parts"],
      solution: { actions: ["send17", "retry17"] },
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("2-5.changed.q"),
        input: choices(ctx.rng, "2-5.changed", ["inserted", "dropped", "merged"]),
        answer: "inserted",
        explain: msg("2-5.changed.why"),
        reveal: async (c) => void (await c.insert(rowsFor(1), { token: "b17-edited" })),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({ prompt: msg("2-5.diagnose.q"), input: choices(ctx.rng, "2-5.diagnose", ["async", "raise", "partition"]), answer: "async", explain: msg("2-5.diagnose.why") }),
    },
    {
      kind: "predict",
      build: (ctx) => ({ prompt: msg("2-5.verdict.q"), input: choices(ctx.rng, "2-5.verdict", ["both", "one", "error"]), answer: "both", explain: msg("2-5.verdict.why") }),
    },
  ],
  check: q25,
};

export const WORLD2: Level[] = [level21, level22, level23, level24, level25];
