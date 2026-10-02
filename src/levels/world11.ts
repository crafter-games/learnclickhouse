// World 11 — Replication & sharding. Facts: docs/research/clickhouse-curriculum.md (World 11).
// Replicas and shards are halls of the depot: a replica's copy of a part has the same name (the
// sign shows which hall it's in), and a fetch drops the copy into the other hall.
import type { Row } from "@/sim/engines";
import type { Part, TableSpec } from "@/sim/table";
import { rowsFor } from "./session";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

const cols = (spec: [string, string][]) => spec.map(([name, type]) => ({ name, type, bytesPerRow: 1 }));
const rowsIn = (ctx: LevelCtx, partition: string) => ctx.table.dataParts.filter((p) => p.partition === partition).flatMap((p) => ctx.table.visibleRows(p));
const blocksIn = (ctx: LevelCtx, partition: string) => new Set(ctx.table.dataParts.filter((p) => p.partition === partition).map((p) => `${p.minBlock}_${p.maxBlock}_${p.level}`));
const shortName = (p: Part) => `all_${p.minBlock}_${p.maxBlock}_${p.level}`;

// ---------------------------------------------------------------- Keeper log

const log = (ctx: LevelCtx, line: string) => {
  const lines: string[] = JSON.parse(String(ctx.settings.keeperLog ?? "[]"));
  ctx.settings.keeperLog = JSON.stringify([...lines, line].slice(-6));
};
const keeperUp = (ctx: LevelCtx) => {
  const nodes = Number(ctx.settings.keeperNodes ?? 3);
  return nodes - Number(ctx.settings.keeperDown ?? 0) > nodes / 2;
};

// ---------------------------------------------------------------- replicas

const replicated = (): TableSpec => ({ name: "events", orderBy: ["id"], columns: cols([["id", "UInt64"], ["page", "UInt32"]]) });
const E = (id: number): Row => ({ id, page: (id % 3) + 1 });
const other = (r: string) => (r === "r1" ? "r2" : "r1");
const isDown = (ctx: LevelCtx, r: string) => ctx.settings[`${r}down`] === true;

/** The other replica sees the log entry and fetches every part it's missing. */
const catchUp = async (ctx: LevelCtx, replica: string) => {
  if (isDown(ctx, replica)) return;
  const have = blocksIn(ctx, replica);
  for (const p of ctx.table.dataParts.filter((x) => x.partition === other(replica) && !have.has(`${x.minBlock}_${x.maxBlock}_${x.level}`))) {
    await ctx.wait(500);
    await ctx.replicate(p.name, replica);
    log(ctx, `${replica}: fetched ${shortName(p)}`);
  }
};

/**
 * INSERT into a replica: it writes the part and logs it in Keeper; with insert_quorum = 2 the
 * insert only succeeds once the other replica has it too. Returns whether it was acknowledged.
 */
const insertOn = async (ctx: LevelCtx, replica: string, rows: Row[]) => {
  if (!keeperUp(ctx)) {
    await ctx.stage.turnAway("readonly");
    return false;
  }
  const quorum = Number(ctx.settings.quorum ?? 0);
  if (quorum >= 2 && isDown(ctx, other(replica))) {
    // Waits insert_quorum_timeout for the second replica, then fails
    await ctx.stage.turnAway("quorum");
    return false;
  }
  const part = await ctx.insertRows(rows, { partition: replica });
  if (!part) return false;
  log(ctx, `log: GET_PART ${shortName(part)} (from ${replica})`);
  await catchUp(ctx, other(replica));
  return true;
};
const countOn = (ctx: LevelCtx, replica: string) => ctx.show({ columns: ["id", "page"], partitions: [replica] }, `SELECT * FROM events -- on ${replica === "r1" ? "replica 1" : "replica 2"}`);

/** New rows with ids nobody used yet. */
const freshRows = (ctx: LevelCtx, n: number) =>
  Array.from({ length: n }, () => {
    ctx.settings.nextId = Number(ctx.settings.nextId ?? 100) + 1;
    return E(Number(ctx.settings.nextId));
  });

// ---------------------------------------------------------------- 11-1 Replicas fetch parts

const q111: Question[] = [
  { concept: "replication", build: (r) => ({ prompt: msg("11-1.check.how.q"), input: choices(r, "11-1.check.how", ["fetch", "sync", "leader"]), answer: "fetch", explain: msg("11-1.check.how.why") }) },
  { concept: "replication", build: (r) => ({ prompt: msg("11-1.check.master.q"), input: choices(r, "11-1.check.master", ["any", "leader", "first"]), answer: "any", explain: msg("11-1.check.master.why") }) },
  { concept: "replication", build: (r) => ({ prompt: msg("11-1.check.ack.q"), input: choices(r, "11-1.check.ack", ["one", "all", "majority"]), answer: "one", explain: msg("11-1.check.ack.why") }) },
  {
    concept: "replication",
    build: (r) => {
      const replicas = randInt(r, 2, 4);
      const inserts = randInt(r, 2, 5);
      return { prompt: msg("11-1.check.copies.q", { replicas, inserts }), input: { type: "number" }, answer: replicas * inserts, explain: msg("11-1.check.copies.why", { replicas, inserts, n: replicas * inserts }) };
    },
  },
];

const halls12 = ["r1", "r2"];

const level111: Level = {
  id: "11-1",
  world: 11,
  title: msg("11-1.title"),
  summary: msg("11-1.summary"),
  table: replicated(),
  halls: halls12,
  initialRows: [
    { rows: [E(1), E(2), E(3)], options: { partition: "r1" } },
  ],
  setup: (t) => void t.copyPart(t.dataParts[0].name, "r2"),
  settings: { keeperLog: JSON.stringify(["log: GET_PART all_1_1_0 (from r1)", "r2: fetched all_1_1_0"]) },
  steps: [
    { kind: "brief", title: msg("11-1.brief.title"), body: msg("11-1.brief.body"), code: "CREATE TABLE events ON CLUSTER main (id UInt64, page UInt32)\nENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/events', '{replica}')\nORDER BY id;" },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("11-1.lag.q"),
        input: choices(ctx.rng, "11-1.lag", ["soon", "already", "never"]),
        answer: "soon",
        explain: msg("11-1.lag.why"),
        code: "INSERT INTO events VALUES (4, 2), (5, 3);  -- on replica 1",
        reveal: async (c) => void (await insertOn(c, "r1", [E(4), E(5)])),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("11-1.master.q"),
        input: choices(ctx.rng, "11-1.master", ["works", "refused"]),
        answer: "works",
        explain: msg("11-1.master.why"),
        code: "INSERT INTO events VALUES (6, 1);  -- on replica 2",
        reveal: async (c) => void (await insertOn(c, "r2", [E(6)])),
      }),
    },
    {
      kind: "task",
      title: msg("11-1.both.title"),
      body: msg("11-1.both.body"),
      tools: [
        { type: "action", id: "insert1", label: msg("11-1.both.insert1"), icon: "truck", tone: "accent", run: (ctx) => insertOn(ctx, "r1", freshRows(ctx, 2)) },
        { type: "action", id: "insert2", label: msg("11-1.both.insert2"), icon: "truck", tone: "accent", run: (ctx) => insertOn(ctx, "r2", freshRows(ctx, 2)) },
        {
          type: "action",
          id: "count2",
          label: msg("11-1.both.count2"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            await countOn(ctx, "r2");
            if (rowsIn(ctx, "r2").length === rowsIn(ctx, "r1").length) ctx.settings.counted = true;
          },
        },
      ],
      progress: (ctx, start) => {
        const inserts = ctx.stats.inserts - start.inserts;
        return { done: Math.min(2, inserts) + (ctx.settings.counted && inserts >= 2 ? 1 : 0), total: 3 };
      },
      success: msg("11-1.both.success"),
      panels: ["keeper", "rows"],
      solution: { actions: ["insert1", "insert2", "count2"] },
    },
  ],
  check: q111,
};

// ---------------------------------------------------------------- 11-2 insert_quorum

const q112: Question[] = [
  { concept: "insert-quorum", build: (r) => ({ prompt: msg("11-2.check.default.q"), input: choices(r, "11-2.check.default", ["zero", "two", "all"]), answer: "zero", explain: msg("11-2.check.default.why") }) },
  { concept: "insert-quorum", build: (r) => ({ prompt: msg("11-2.check.auto.q"), input: choices(r, "11-2.check.auto", ["majority", "all", "one"]), answer: "majority", explain: msg("11-2.check.auto.why") }) },
  { concept: "insert-quorum", build: (r) => ({ prompt: msg("11-2.check.reads.q"), input: choices(r, "11-2.check.reads", ["sequential", "nothing", "final"]), answer: "sequential", explain: msg("11-2.check.reads.why") }) },
  { concept: "insert-quorum", build: (r) => ({ prompt: msg("11-2.check.down.q"), input: choices(r, "11-2.check.down", ["timeout", "succeeds", "queued"]), answer: "timeout", explain: msg("11-2.check.down.why") }) },
];

const level112: Level = {
  id: "11-2",
  world: 11,
  title: msg("11-2.title"),
  summary: msg("11-2.summary"),
  table: replicated(),
  halls: halls12,
  initialRows: [{ rows: [E(1), E(2), E(3)], options: { partition: "r1" } }],
  setup: (t) => void t.copyPart(t.dataParts[0].name, "r2"),
  settings: { r2down: true, quorum: 0, keeperLog: JSON.stringify(["r2: lost connection"]) },
  steps: [
    { kind: "brief", title: msg("11-2.brief.title"), body: msg("11-2.brief.body"), code: "INSERT INTO events VALUES (…)\nSETTINGS insert_quorum = 2;   -- or 'auto' (majority)\n\nSELECT … SETTINGS select_sequential_consistency = 1;" },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("11-2.zero.q"),
        input: choices(ctx.rng, "11-2.zero", ["ok", "fails", "waits"]),
        answer: "ok",
        explain: msg("11-2.zero.why"),
        code: "INSERT INTO events VALUES (4, 2);  -- insert_quorum = 0",
        reveal: async (c) => void (await insertOn(c, "r1", [E(4)])),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("11-2.two.q"),
        input: choices(ctx.rng, "11-2.two", ["timeout", "ok", "partial"]),
        answer: "timeout",
        explain: msg("11-2.two.why"),
        code: "INSERT INTO events VALUES (5, 3)\nSETTINGS insert_quorum = 2",
        reveal: async (c) => {
          c.settings.quorum = 2;
          await insertOn(c, "r1", [E(5)]);
          c.settings.quorum = 0;
        },
      }),
    },
    {
      kind: "task",
      title: msg("11-2.durable.title"),
      body: msg("11-2.durable.body"),
      tools: [
        {
          type: "action",
          id: "revive",
          label: msg("11-2.durable.revive"),
          icon: "repeat",
          tone: "accent",
          run: async (ctx) => {
            if (!isDown(ctx, "r2")) return;
            ctx.settings.r2down = false;
            log(ctx, "r2: back online, catching up");
            await catchUp(ctx, "r2");
          },
        },
        { type: "setting", field: "quorum", label: msg("11-2.durable.quorum"), options: [0, 2], labels: "11-2.durable.quorums" },
        {
          type: "action",
          id: "insert",
          label: msg("11-2.durable.insert"),
          icon: "truck",
          tone: "primary",
          run: async (ctx) => {
            const ok = await insertOn(ctx, "r1", freshRows(ctx, 2));
            if (ok && Number(ctx.settings.quorum) === 2) ctx.settings.durable = true;
          },
        },
      ],
      progress: (ctx) => ({ done: (isDown(ctx, "r2") ? 0 : 1) + (ctx.settings.durable ? 1 : 0), total: 2 }),
      success: msg("11-2.durable.success"),
      panels: ["keeper", "parts"],
      solution: { settings: { quorum: 2 }, actions: ["revive", "insert"] },
    },
  ],
  check: q112,
};

// ---------------------------------------------------------------- 11-3 ClickHouse Keeper

const q113: Question[] = [
  { concept: "keeper", build: (r) => ({ prompt: msg("11-3.check.stores.q"), input: choices(r, "11-3.check.stores", ["metadata", "data", "both"]), answer: "metadata", explain: msg("11-3.check.stores.why") }) },
  {
    concept: "keeper",
    build: (r) => {
      const f = randInt(r, 1, 3);
      return { prompt: msg("11-3.check.nodes.q", { f }), input: { type: "number" }, answer: 2 * f + 1, explain: msg("11-3.check.nodes.why", { f, n: 2 * f + 1 }) };
    },
  },
  { concept: "keeper", build: (r) => ({ prompt: msg("11-3.check.lost.q"), input: choices(r, "11-3.check.lost", ["readonly", "fine", "deleted"]), answer: "readonly", explain: msg("11-3.check.lost.why") }) },
  { concept: "keeper", build: (r) => ({ prompt: msg("11-3.check.onCluster.q"), input: choices(r, "11-3.check.onCluster", ["eventually", "atomic", "never"]), answer: "eventually", explain: msg("11-3.check.onCluster.why") }) },
];

const level113: Level = {
  id: "11-3",
  world: 11,
  title: msg("11-3.title"),
  summary: msg("11-3.summary"),
  table: replicated(),
  halls: halls12,
  initialRows: [{ rows: [E(1), E(2), E(3)], options: { partition: "r1" } }],
  setup: (t) => void t.copyPart(t.dataParts[0].name, "r2"),
  settings: { keeperNodes: 3, keeperDown: 0, keeperLog: JSON.stringify(["log: GET_PART all_1_1_0 (from r1)", "r2: fetched all_1_1_0"]) },
  steps: [
    { kind: "brief", title: msg("11-3.brief.title"), body: msg("11-3.brief.body"), code: "SELECT name, value FROM system.zookeeper\nWHERE path = '/clickhouse/tables/01/events/log';" },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("11-3.what.q"),
        input: choices(ctx.rng, "11-3.what", ["metadata", "rows", "both"]),
        answer: "metadata",
        explain: msg("11-3.what.why"),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("11-3.one.q"),
        input: choices(ctx.rng, "11-3.one", ["yes", "no"]),
        answer: "yes",
        explain: msg("11-3.one.why"),
        code: "-- keeper-2 is down\nINSERT INTO events VALUES (4, 2);",
        reveal: async (c) => {
          c.settings.keeperDown = 1;
          await insertOn(c, "r1", [E(4)]);
        },
      }),
    },
    {
      kind: "task",
      title: msg("11-3.survive.title"),
      body: msg("11-3.survive.body"),
      onEnter: (ctx) => {
        ctx.settings.keeperDown = 0;
      },
      tools: [
        { type: "setting", field: "keeperNodes", label: msg("11-3.survive.nodes"), options: [3, 5], labels: "11-3.survive.counts" },
        {
          type: "action",
          id: "fail",
          label: msg("11-3.survive.fail"),
          icon: "trash",
          tone: "danger",
          run: async (ctx) => {
            ctx.settings.keeperDown = 2;
            log(ctx, "keeper: 2 nodes lost");
          },
        },
        {
          type: "action",
          id: "insert",
          label: msg("11-3.survive.insert"),
          icon: "truck",
          tone: "primary",
          run: async (ctx) => {
            const ok = await insertOn(ctx, "r1", freshRows(ctx, 1));
            if (ok && Number(ctx.settings.keeperDown) >= 2) ctx.settings.survived = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.survived ? 1 : 0, total: 1 }),
      success: msg("11-3.survive.success"),
      panels: ["keeper", "parts"],
      solution: { settings: { keeperNodes: 5 }, actions: ["fail", "insert"] },
    },
  ],
  check: q113,
};

// ---------------------------------------------------------------- 11-4 Shards and the Distributed table

const sharded = (): TableSpec => ({ name: "events", orderBy: ["user_id"], columns: cols([["user_id", "UInt32"], ["page", "UInt32"]]) });
const U = (user_id: number, page: number): Row => ({ user_id, page });
/** INSERT INTO events_all: each row goes to shard (key % 2); one part per shard it touches. */
const insertDistributed = async (ctx: LevelCtx, rows: Row[]) => {
  const byShard = new Map<string, Row[]>();
  for (const r of rows) {
    // rand() in the game: round-robin, so a user's rows scatter over the shards
    const spread = Number(ctx.settings.spread ?? 0);
    ctx.settings.spread = spread + 1;
    const key = ctx.settings.key === "rand()" ? spread : Number(r.user_id);
    const shard = key % 2 === 0 ? "s1" : "s2";
    byShard.set(shard, [...(byShard.get(shard) ?? []), r]);
  }
  for (const [shard, part] of [...byShard.entries()].sort()) await ctx.insertRows(part, { partition: shard, quick: true });
};
const selectAllShards = async (ctx: LevelCtx, sql: string, filter?: number) => {
  ctx.settings.threads = 2;
  const r = await ctx.show({ columns: ["user_id", "page"] }, sql, (rows) => (filter === undefined ? rows : rows.filter((x) => x.user_id === filter)));
  ctx.settings.threads = 1;
  return r;
};

const q114: Question[] = [
  { concept: "sharding", build: (r) => ({ prompt: msg("11-4.check.stores.q"), input: choices(r, "11-4.check.stores", ["router", "data", "cache"]), answer: "router", explain: msg("11-4.check.stores.why") }) },
  {
    concept: "sharding",
    build: (r) => {
      const key = randInt(r, 10, 99);
      const shards = [2, 3, 4][randInt(r, 0, 2)];
      return { prompt: msg("11-4.check.route.q", { key, shards }), input: { type: "number" }, answer: key % shards, explain: msg("11-4.check.route.why", { key, shards, n: key % shards }) };
    },
  },
  { concept: "sharding", build: (r) => ({ prompt: msg("11-4.check.internal.q"), input: choices(r, "11-4.check.internal", ["one", "all", "none"]), answer: "one", explain: msg("11-4.check.internal.why") }) },
  { concept: "sharding", build: (r) => ({ prompt: msg("11-4.check.async.q"), input: choices(r, "11-4.check.async", ["background", "always", "never"]), answer: "background", explain: msg("11-4.check.async.why") }) },
];

const level114: Level = {
  id: "11-4",
  world: 11,
  title: msg("11-4.title"),
  summary: msg("11-4.summary"),
  table: sharded(),
  halls: ["s1", "s2"],
  initialRows: [
    { rows: [U(2, 1), U(4, 3)], options: { partition: "s1" } },
    { rows: [U(1, 2), U(3, 1)], options: { partition: "s2" } },
  ],
  settings: { key: "user_id" },
  steps: [
    { kind: "brief", title: msg("11-4.brief.title"), body: msg("11-4.brief.body"), code: "CREATE TABLE events_all AS events\nENGINE = Distributed(main, default, events, user_id);" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("11-4.route.q"),
        input: { type: "number" },
        answer: 2,
        explain: msg("11-4.route.why"),
        code: "INSERT INTO events_all VALUES (5, 1), (6, 2), (7, 3), (8, 1);",
        reveal: async (c) => void (await insertDistributed(c, [U(5, 1), U(6, 2), U(7, 3), U(8, 1)])),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("11-4.read.q"),
        input: choices(ctx.rng, "11-4.read", ["both", "one", "none"]),
        answer: "both",
        explain: msg("11-4.read.why"),
        code: "SELECT count() FROM events_all",
        reveal: async (c) => void (await selectAllShards(c, "SELECT * FROM events_all")),
      }),
    },
    {
      kind: "task",
      title: msg("11-4.colocate.title"),
      body: msg("11-4.colocate.body"),
      onEnter: (ctx) => {
        ctx.settings.key = "rand()";
      },
      tools: [
        { type: "setting", field: "key", label: msg("11-4.colocate.key"), options: ["rand()", "user_id"], labels: "11-4.colocate.keys" },
        {
          type: "action",
          id: "insert",
          label: msg("11-4.colocate.insert"),
          icon: "truck",
          tone: "accent",
          run: async (ctx) => {
            await insertDistributed(ctx, [U(9, 1), U(9, 2), U(9, 3), U(9, 1)]);
            const shards = new Set(ctx.table.dataParts.filter((p) => ctx.table.visibleRows(p).some((r) => r.user_id === 9)).map((p) => p.partition));
            ctx.settings.together = shards.size === 1;
          },
        },
        { type: "action", id: "select", label: msg("11-4.colocate.select"), icon: "play", run: (ctx) => selectAllShards(ctx, "SELECT * FROM events_all WHERE user_id = 9", 9) },
      ],
      progress: (ctx) => ({ done: ctx.settings.together ? 1 : 0, total: 1 }),
      success: msg("11-4.colocate.success"),
      panels: ["rows", "parts"],
      solution: { settings: { key: "user_id" }, actions: ["insert"] },
    },
  ],
  check: q114,
};

// ---------------------------------------------------------------- 11-5 SharedMergeTree & parallel replicas

const ROWS = rowsFor(8);
const q115: Question[] = [
  { concept: "shared-merge-tree", build: (r) => ({ prompt: msg("11-5.check.where.q"), input: choices(r, "11-5.check.where", ["objectStorage", "local", "keeper"]), answer: "objectStorage", explain: msg("11-5.check.where.why") }) },
  { concept: "shared-merge-tree", build: (r) => ({ prompt: msg("11-5.check.shard.q"), input: choices(r, "11-5.check.shard", ["notNeeded", "required", "automatic"]), answer: "notNeeded", explain: msg("11-5.check.shard.why") }) },
  { concept: "shared-merge-tree", build: (r) => ({ prompt: msg("11-5.check.parallel.q"), input: choices(r, "11-5.check.parallel", ["optIn", "always", "removed"]), answer: "optIn", explain: msg("11-5.check.parallel.why") }) },
  {
    concept: "shared-merge-tree",
    build: (r) => {
      const replicas = randInt(r, 2, 4);
      const granules = replicas * randInt(r, 3, 8);
      return { prompt: msg("11-5.check.split.q", { replicas, granules }), input: { type: "number" }, answer: granules / replicas, explain: msg("11-5.check.split.why", { replicas, granules, n: granules / replicas }) };
    },
  },
];

const runBig = async (ctx: LevelCtx) => {
  // Parallel replicas: one Pico per replica, each reading a share of the granules
  ctx.settings.threads = ctx.settings.parallel === 1 ? Number(ctx.settings.replicas) : 1;
  const r = await ctx.query({ columns: ["total"] });
  return r;
};

const level115: Level = {
  id: "11-5",
  world: 11,
  title: msg("11-5.title"),
  summary: msg("11-5.summary"),
  table: { name: "orders", orderBy: ["date"], columns: [{ name: "date", type: "Date", bytesPerRow: 2 }, { name: "total", type: "UInt32", bytesPerRow: 4 }] },
  halls: ["s3"],
  initial: [
    { rows: ROWS, options: { partition: "s3", keyRange: [0, 9] } },
    { rows: ROWS, options: { partition: "s3", keyRange: [10, 19] } },
    { rows: ROWS, options: { partition: "s3", keyRange: [20, 29] } },
  ],
  settings: { replicas: 1, parallel: 0, threads: 1 },
  steps: [
    { kind: "brief", title: msg("11-5.brief.title"), body: msg("11-5.brief.body"), code: "-- ClickHouse Cloud\nENGINE = SharedMergeTree ORDER BY date;\n\nSELECT sum(total) FROM orders\nSETTINGS enable_parallel_replicas = 1;" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("11-5.add.q"),
        input: { type: "number" },
        answer: 0,
        explain: msg("11-5.add.why"),
        reveal: async (c) => {
          c.settings.replicas = 3;
        },
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("11-5.split.q"),
        input: { type: "number" },
        answer: 8,
        explain: msg("11-5.split.why"),
        code: "SELECT sum(total) FROM orders SETTINGS enable_parallel_replicas = 1",
        reveal: async (c) => {
          c.settings.parallel = 1;
          await runBig(c);
          c.settings.parallel = 0;
          c.settings.replicas = 1;
          c.settings.threads = 1;
        },
      }),
    },
    {
      kind: "task",
      title: msg("11-5.scale.title"),
      body: msg("11-5.scale.body"),
      tools: [
        { type: "setting", field: "replicas", label: msg("11-5.scale.replicas"), options: [1, 2, 4], labels: "11-5.scale.counts" },
        { type: "setting", field: "parallel", label: msg("11-5.scale.parallel"), options: [0, 1], labels: "11-5.scale.values" },
        {
          type: "action",
          id: "run",
          label: msg("11-5.scale.run"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            const r = await runBig(ctx);
            if (Math.ceil(r.granulesRead / Number(ctx.settings.threads)) * 40 <= 250) ctx.settings.fast = true;
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.settings.fast ? 1 : 0, total: 1 }),
      success: msg("11-5.scale.success"),
      panels: ["queryLog", "reading"],
      solution: { settings: { replicas: 4, parallel: 1 }, actions: ["run"] },
    },
  ],
  check: q115,
};

export const WORLD11: Level[] = [level111, level112, level113, level114, level115];
