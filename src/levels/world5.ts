// World 5 — Merge-time engines. Facts: docs/research/clickhouse-curriculum.md (World 5).
// These tables are tiny on purpose: one box = one row, with its value printed on it.
import { argMaxByKey, collapse, sumByKey, type Row } from "@/sim/engines";
import type { TableSpec } from "@/sim/table";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

const cols = (spec: [string, string][]) => spec.map(([name, type]) => ({ name, type, bytesPerRow: 1 }));

const users = (withDeleted = false): TableSpec => ({
  name: "users",
  orderBy: ["id"],
  engine: { type: "Replacing", ver: "ver", isDeleted: withDeleted ? "deleted" : undefined },
  columns: cols([["id", "UInt32"], ["ver", "UInt32"], ["city", "String"], ...(withDeleted ? ([["deleted", "UInt8"]] as [string, string][]) : [])]),
});
const U = (id: number, ver: number, city: string, deleted?: number): Row => (deleted === undefined ? { id, ver, city } : { id, ver, city, deleted });
const selectAll = (ctx: LevelCtx, final = false) => ctx.show({ columns: ctx.table.columns.map((c) => c.name), final }, `SELECT * FROM ${ctx.table.spec.name}${final ? " FINAL" : ""}`);
const allParts = (ctx: LevelCtx) => ctx.table.activeParts.map((p) => p.name);

// ---------------------------------------------------------------- 5-1 The latest version

const q51: Question[] = [
  { concept: "replacing", build: (r) => ({ prompt: msg("5-1.check.when.q"), input: choices(r, "5-1.check.when", ["merge", "insert", "select"]), answer: "merge", explain: msg("5-1.check.when.why") }) },
  { concept: "replacing", build: (r) => ({ prompt: msg("5-1.check.key.q"), input: choices(r, "5-1.check.key", ["orderBy", "primary", "all"]), answer: "orderBy", explain: msg("5-1.check.key.why") }) },
  {
    concept: "replacing",
    build: (r) => {
      const n = randInt(r, 2, 6);
      return { prompt: msg("5-1.check.count.q", { n }), input: { type: "number" }, answer: n, explain: msg("5-1.check.count.why", { n }) };
    },
  },
  { concept: "replacing", build: (r) => ({ prompt: msg("5-1.check.noVer.q"), input: choices(r, "5-1.check.noVer", ["last", "first", "random"]), answer: "last", explain: msg("5-1.check.noVer.why") }) },
];

const level51: Level = {
  id: "5-1",
  world: 5,
  title: msg("5-1.title"),
  summary: msg("5-1.summary"),
  table: users(),
  initialRows: [[U(1, 1, "Lima"), U(2, 1, "Madrid"), U(3, 1, "Quito")]],
  steps: [
    {
      kind: "brief",
      title: msg("5-1.brief.title"),
      body: msg("5-1.brief.body"),
      code: "CREATE TABLE users (id UInt32, ver UInt32, city String)\nENGINE = ReplacingMergeTree(ver)\nORDER BY id",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("5-1.update.q"),
        input: { type: "number" },
        answer: 4,
        explain: msg("5-1.update.why"),
        code: "INSERT INTO users VALUES (2, 2, 'Bogotá');\nSELECT * FROM users;",
        reveal: async (c) => {
          await c.insertRows([U(2, 2, "Bogotá")]);
          await selectAll(c);
        },
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("5-1.merge.q"),
        input: { type: "number" },
        answer: 3,
        explain: msg("5-1.merge.why"),
        reveal: async (c) => {
          await c.merge(allParts(c));
          await selectAll(c);
        },
      }),
    },
    {
      kind: "task",
      title: msg("5-1.moves.title"),
      body: msg("5-1.moves.body"),
      tools: [
        { type: "action", id: "move1", label: msg("5-1.moves.move1"), icon: "truck", tone: "accent", run: (ctx) => ctx.insertRows([U(1, 2, "Santiago")]) },
        { type: "action", id: "move3", label: msg("5-1.moves.move3"), icon: "truck", tone: "accent", run: (ctx) => ctx.insertRows([U(3, 2, "Valencia")]) },
        { type: "action", id: "select", label: msg("5-1.moves.select"), icon: "play", run: (ctx) => selectAll(ctx) },
        {
          type: "action",
          id: "final",
          label: msg("5-1.moves.final"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            const dups = ctx.table.activeParts.length > 1;
            await selectAll(ctx, true);
            if (dups && ctx.stats.inserts >= 3) ctx.settings.finalOk = true;
          },
        },
      ],
      progress: (ctx, start) => ({ done: Math.min(2, ctx.stats.inserts - start.inserts) + (ctx.settings.finalOk ? 1 : 0), total: 3 }),
      success: msg("5-1.moves.success"),
      panels: ["rows", "parts"],
      solution: { actions: ["move1", "move3", "final"] },
    },
  ],
  check: q51,
};

// ---------------------------------------------------------------- 5-2 Case: the ghost version

const q52: Question[] = [
  { concept: "final", build: (r) => ({ prompt: msg("5-2.check.final.q"), input: choices(r, "5-2.check.final", ["readTime", "forces", "cache"]), answer: "readTime", explain: msg("5-2.check.final.why") }) },
  { concept: "final", build: (r) => ({ prompt: msg("5-2.check.argMax.q"), input: choices(r, "5-2.check.argMax", ["argMax", "max", "any"]), answer: "argMax", explain: msg("5-2.check.argMax.why") }) },
  { concept: "final", build: (r) => ({ prompt: msg("5-2.check.deleted.q"), input: choices(r, "5-2.check.deleted", ["final", "always", "never"]), answer: "final", explain: msg("5-2.check.deleted.why") }) },
  { concept: "replacing", build: (r) => ({ prompt: msg("5-2.check.partition.q"), input: choices(r, "5-2.check.partition", ["within", "across", "never"]), answer: "within", explain: msg("5-2.check.partition.why") }) },
];

const level52: Level = {
  id: "5-2",
  world: 5,
  title: msg("5-2.title"),
  summary: msg("5-2.summary"),
  table: users(true),
  initialRows: [[U(1, 1, "Lima", 0), U(2, 1, "Madrid", 0), U(3, 1, "Quito", 0)], [U(2, 2, "Bogotá", 0)]],
  steps: [
    {
      kind: "brief",
      title: msg("5-2.brief.title"),
      body: msg("5-2.brief.body"),
      code: "ENGINE = ReplacingMergeTree(ver, deleted)\n\nSELECT * FROM users FINAL;\nSELECT id, argMax(city, ver) FROM users GROUP BY id;",
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("5-2.ghost.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("5-2.ghost.why"),
        code: "SELECT city FROM users WHERE id = 2",
        reveal: async (c) => void (await selectAll(c)),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("5-2.delete.q"),
        input: choices(ctx.rng, "5-2.delete", ["hidden", "shown", "error"]),
        answer: "hidden",
        explain: msg("5-2.delete.why"),
        code: "INSERT INTO users VALUES (3, 2, 'Quito', 1);\nSELECT * FROM users FINAL;",
        reveal: async (c) => {
          await c.insertRows([U(3, 2, "Quito", 1)]);
          await selectAll(c, true);
        },
      }),
    },
    {
      kind: "task",
      title: msg("5-2.two.title"),
      body: msg("5-2.two.body"),
      tools: [
        { type: "action", id: "select", label: msg("5-2.two.select"), icon: "play", run: (ctx) => selectAll(ctx) },
        {
          type: "action",
          id: "final",
          label: msg("5-2.two.final"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await selectAll(ctx, true);
            ctx.settings.usedFinal = true;
          },
        },
        {
          type: "action",
          id: "argmax",
          label: msg("5-2.two.argmax"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await ctx.show({ columns: ["id", "city", "ver"] }, "SELECT id, argMax(city, ver) AS city\nFROM users GROUP BY id", (rows) => argMaxByKey(rows, ["id"], "city", "ver"));
            ctx.settings.usedArgMax = true;
          },
        },
      ],
      progress: (ctx) => ({ done: (ctx.settings.usedFinal ? 1 : 0) + (ctx.settings.usedArgMax ? 1 : 0), total: 2 }),
      success: msg("5-2.two.success"),
      panels: ["rows"],
      solution: { actions: ["final", "argmax"] },
    },
  ],
  check: q52,
};

// ---------------------------------------------------------------- 5-3 Counters that add up

const views = (): TableSpec => ({ name: "page_views", orderBy: ["page"], engine: { type: "Summing" }, columns: cols([["page", "UInt32"], ["views", "UInt64"]]) });

const q53: Question[] = [
  { concept: "summing", build: (r) => ({ prompt: msg("5-3.check.when.q"), input: choices(r, "5-3.check.when", ["merge", "insert", "never"]), answer: "merge", explain: msg("5-3.check.when.why") }) },
  { concept: "summing", build: (r) => ({ prompt: msg("5-3.check.query.q"), input: choices(r, "5-3.check.query", ["sum", "star", "final"]), answer: "sum", explain: msg("5-3.check.query.why") }) },
  {
    concept: "summing",
    build: (r) => {
      const x = randInt(r, 2, 9), y = randInt(r, 2, 9);
      return { prompt: msg("5-3.check.total.q", { x, y }), input: { type: "number" }, answer: x + y, explain: msg("5-3.check.total.why", { x, y, s: x + y }) };
    },
  },
  { concept: "summing", build: (r) => ({ prompt: msg("5-3.check.zero.q"), input: choices(r, "5-3.check.zero", ["gone", "zero", "error"]), answer: "gone", explain: msg("5-3.check.zero.why") }) },
];

const level53: Level = {
  id: "5-3",
  world: 5,
  title: msg("5-3.title"),
  summary: msg("5-3.summary"),
  table: views(),
  initialRows: [[{ page: 1, views: 5 }, { page: 2, views: 3 }, { page: 3, views: 1 }], [{ page: 1, views: 2 }, { page: 2, views: 4 }]],
  steps: [
    { kind: "brief", title: msg("5-3.brief.title"), body: msg("5-3.brief.body"), code: "CREATE TABLE page_views (page UInt32, views UInt64)\nENGINE = SummingMergeTree\nORDER BY page" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("5-3.rows.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("5-3.rows.why"),
        code: "SELECT * FROM page_views WHERE page = 1",
        reveal: async (c) => void (await c.show({ columns: ["page", "views"] }, "SELECT * FROM page_views WHERE page = 1", (rows) => rows.filter((r) => r.page === 1))),
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("5-3.sum.q"),
        input: { type: "number" },
        answer: 7,
        explain: msg("5-3.sum.why"),
        code: "SELECT page, sum(views) FROM page_views\nGROUP BY page",
        reveal: async (c) => void (await c.show({ columns: ["page", "views"] }, "SELECT page, sum(views) AS views\nFROM page_views GROUP BY page", (rows) => sumByKey(rows, ["page"], ["views"]))),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("5-3.zero.q"),
        input: choices(ctx.rng, "5-3.zero", ["gone", "zero", "negative"]),
        answer: "gone",
        explain: msg("5-3.zero.why"),
        code: "INSERT INTO page_views VALUES (3, -1);\nOPTIMIZE TABLE page_views FINAL;  -- here: the press",
        reveal: async (c) => {
          await c.insertRows([{ page: 3, views: -1 }]);
          await c.merge(allParts(c));
          await selectAll(c);
        },
      }),
    },
    {
      kind: "task",
      title: msg("5-3.report.title"),
      body: msg("5-3.report.body"),
      tools: [
        { type: "action", id: "more", label: msg("5-3.report.more"), icon: "truck", tone: "accent", run: (ctx) => ctx.insertRows([{ page: 1, views: 3 }, { page: 2, views: 1 }]) },
        { type: "action", id: "star", label: msg("5-3.report.star"), icon: "play", run: (ctx) => selectAll(ctx) },
        {
          type: "action",
          id: "sum",
          label: msg("5-3.report.sum"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            const partial = ctx.table.activeParts.length > 1;
            await ctx.show({ columns: ["page", "views"] }, "SELECT page, sum(views) AS views\nFROM page_views GROUP BY page", (rows) => sumByKey(rows, ["page"], ["views"]));
            if (partial) ctx.settings.sumOk = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.sumOk ? 1 : 0, total: 1 }),
      success: msg("5-3.report.success"),
      panels: ["rows", "parts"],
      solution: { actions: ["more", "sum"] },
    },
  ],
  check: q53,
};

// ---------------------------------------------------------------- 5-4 Aggregate states

const daily = (): TableSpec => ({ name: "daily_users", orderBy: ["day"], engine: { type: "Aggregating", states: ["users"] }, columns: cols([["day", "UInt8"], ["users", "AggregateFunction(uniq, UInt32)"]]) });
const uniqMerge = (rows: Row[]) => collapse(rows, { type: "Aggregating", states: ["users"] }, ["day"]).map((r) => ({ day: r.day, users: (r.users as number[]).length }));

const q54: Question[] = [
  { concept: "aggregating", build: (r) => ({ prompt: msg("5-4.check.combinators.q"), input: choices(r, "5-4.check.combinators", ["stateMerge", "mergeState", "plain"]), answer: "stateMerge", explain: msg("5-4.check.combinators.why") }) },
  {
    concept: "aggregating",
    build: (r) => {
      const x = randInt(r, 3, 8), shared = randInt(r, 1, x - 1), y = randInt(r, shared + 1, 9);
      const n = x + y - shared;
      return { prompt: msg("5-4.check.uniq.q", { x, y, shared }), input: { type: "number" }, answer: n, explain: msg("5-4.check.uniq.why", { x, y, shared, n }) };
    },
  },
  { concept: "aggregating", build: (r) => ({ prompt: msg("5-4.check.direct.q"), input: choices(r, "5-4.check.direct", ["binary", "number", "error"]), answer: "binary", explain: msg("5-4.check.direct.why") }) },
  { concept: "aggregating", build: (r) => ({ prompt: msg("5-4.check.simple.q"), input: choices(r, "5-4.check.simple", ["simple", "aggregate", "nullable"]), answer: "simple", explain: msg("5-4.check.simple.why") }) },
];

const level54: Level = {
  id: "5-4",
  world: 5,
  title: msg("5-4.title"),
  summary: msg("5-4.summary"),
  table: daily(),
  initialRows: [[{ day: 1, users: [1, 2, 3] }, { day: 2, users: [5] }], [{ day: 1, users: [2, 3, 4] }]],
  steps: [
    { kind: "brief", title: msg("5-4.brief.title"), body: msg("5-4.brief.body"), code: "CREATE TABLE daily_users (\n  day   UInt8,\n  users AggregateFunction(uniq, UInt32)\n) ENGINE = AggregatingMergeTree ORDER BY day;\n\nINSERT … SELECT day, uniqState(user_id) …;\nSELECT day, uniqMerge(users) FROM daily_users GROUP BY day;" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("5-4.day1.q"),
        input: { type: "number" },
        answer: 4,
        explain: msg("5-4.day1.why"),
        reveal: async (c) => void (await c.show({ columns: ["day", "users"] }, "SELECT day, uniqMerge(users) AS users\nFROM daily_users GROUP BY day", uniqMerge)),
      }),
    },
    {
      kind: "watch",
      title: msg("5-4.press.title"),
      body: msg("5-4.press.body"),
      panels: ["rows"],
      script: async (ctx) => {
        await ctx.wait(1200);
        await ctx.merge(allParts(ctx));
        await selectAll(ctx);
      },
    },
    {
      kind: "task",
      title: msg("5-4.count.title"),
      body: msg("5-4.count.body"),
      tools: [
        { type: "action", id: "visit", label: msg("5-4.count.visit"), icon: "truck", tone: "accent", run: (ctx) => ctx.insertRows([{ day: 2, users: [5, 6] }]) },
        {
          type: "action",
          id: "wrong",
          label: msg("5-4.count.wrong"),
          icon: "play",
          run: (ctx) =>
            ctx.show({ columns: ["day", "users"] }, "SELECT day, sum(uniq) AS users  -- uniq per part, then add", (rows) => sumByKey(rows.map((r) => ({ day: r.day, users: (r.users as number[]).length })), ["day"], ["users"])),
        },
        {
          type: "action",
          id: "merge",
          label: msg("5-4.count.merge"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await ctx.show({ columns: ["day", "users"] }, "SELECT day, uniqMerge(users) AS users\nFROM daily_users GROUP BY day", uniqMerge);
            if (ctx.table.activeParts.length > 1) ctx.settings.mergeOk = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.mergeOk ? 1 : 0, total: 1 }),
      success: msg("5-4.count.success"),
      panels: ["rows"],
      solution: { actions: ["visit", "merge"] },
    },
  ],
  check: q54,
};

// ---------------------------------------------------------------- 5-5 Ins and outs

const userViews = (): TableSpec => ({ name: "user_views", orderBy: ["user"], engine: { type: "Collapsing", sign: "sign" }, columns: cols([["user", "UInt32"], ["views", "UInt32"], ["sign", "Int8"]]) });
const signedSum = (rows: Row[]) => sumByKey(rows, ["user"], ["views"], "sign");

const q55: Question[] = [
  { concept: "collapsing", build: (r) => ({ prompt: msg("5-5.check.sign.q"), input: choices(r, "5-5.check.sign", ["cancel", "delete", "negative"]), answer: "cancel", explain: msg("5-5.check.sign.why") }) },
  {
    concept: "collapsing",
    build: (r) => {
      const x = randInt(r, 2, 9), y = randInt(r, 2, 9);
      return { prompt: msg("5-5.check.sum.q", { x, y }), input: { type: "number" }, answer: y, explain: msg("5-5.check.sum.why", { x, y }) };
    },
  },
  { concept: "collapsing", build: (r) => ({ prompt: msg("5-5.check.versioned.q"), input: choices(r, "5-5.check.versioned", ["anyOrder", "faster", "noSign"]), answer: "anyOrder", explain: msg("5-5.check.versioned.why") }) },
  { concept: "collapsing", build: (r) => ({ prompt: msg("5-5.check.coalescing.q"), input: choices(r, "5-5.check.coalescing", ["perColumn", "wholeRow", "sum"]), answer: "perColumn", explain: msg("5-5.check.coalescing.why") }) },
];

const level55: Level = {
  id: "5-5",
  world: 5,
  title: msg("5-5.title"),
  summary: msg("5-5.summary"),
  table: userViews(),
  initialRows: [[{ user: 1, views: 5, sign: 1 }, { user: 2, views: 4, sign: 1 }], [{ user: 1, views: 5, sign: -1 }, { user: 1, views: 6, sign: 1 }]],
  steps: [
    { kind: "brief", title: msg("5-5.brief.title"), body: msg("5-5.brief.body"), code: "ENGINE = CollapsingMergeTree(sign)\n\nSELECT user, sum(sign * views) AS views\nFROM user_views GROUP BY user\nHAVING sum(sign) > 0" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("5-5.sum.q"),
        input: { type: "number" },
        answer: 6,
        explain: msg("5-5.sum.why"),
        reveal: async (c) => void (await c.show({ columns: ["user", "views", "sign"] }, "SELECT user, sum(sign * views) AS views\nFROM user_views GROUP BY user", signedSum)),
      }),
    },
    {
      kind: "watch",
      title: msg("5-5.press.title"),
      body: msg("5-5.press.body"),
      panels: ["rows"],
      script: async (ctx) => {
        await ctx.wait(1200);
        await ctx.merge(allParts(ctx));
        await selectAll(ctx);
      },
    },
    {
      kind: "task",
      title: msg("5-5.update.title"),
      body: msg("5-5.update.body"),
      tools: [
        { type: "action", id: "cancel", label: msg("5-5.update.cancel"), icon: "eraser", run: (ctx) => ctx.insertRows([{ user: 2, views: 4, sign: -1 }]) },
        { type: "action", id: "add", label: msg("5-5.update.add"), icon: "truck", tone: "accent", run: (ctx) => ctx.insertRows([{ user: 2, views: 9, sign: 1 }]) },
        {
          type: "action",
          id: "read",
          label: msg("5-5.update.read"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            const r = await ctx.show({ columns: ["user", "views", "sign"] }, "SELECT user, sum(sign * views) AS views\nFROM user_views GROUP BY user", signedSum);
            if (r.rows?.find((x) => x.user === 2)?.views === 9) ctx.settings.updated = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.updated ? 1 : 0, total: 1 }),
      success: msg("5-5.update.success"),
      panels: ["rows", "parts"],
      solution: { actions: ["cancel", "add", "read"] },
    },
  ],
  check: q55,
};

export const WORLD5: Level[] = [level51, level52, level53, level54, level55];
