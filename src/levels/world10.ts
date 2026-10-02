// World 10 — Types & codecs. Facts: docs/research/clickhouse-curriculum.md (World 10).
// Every column's on-disk size comes from its type (uncompressed bytes per row) and how well it
// compresses with its codec; boxes shrink with the compression ratio and system.columns shows both.
import type { ColumnSpec, QuerySpec, TableSpec } from "@/sim/table";
import { rowsFor } from "./session";
import { choices, msg, randInt, type Level, type LevelCtx, type Question } from "./types";

const ROWS = rowsFor(8);
/** A column of `type`: `raw` uncompressed bytes per row, compressed `ratio`:1. */
type Variant = { type: string; raw: number; ratio: number };
const column = (name: string, v: Variant, only?: string[]): ColumnSpec => ({ name, type: v.type, bytesPerRow: v.raw / v.ratio, raw: v.raw, ratio: { sorted: v.ratio, unsorted: v.ratio }, only });
const totalBytes = (ctx: LevelCtx) => ctx.table.columnSizes().reduce((s, c) => s + c.compressed, 0);
/** Box size from the bytes a row takes on disk, against the biggest column at the start. */
const sizesOf = (ctx: LevelCtx) => {
  if (ctx.settings.refBytes === undefined) ctx.settings.refBytes = Math.max(...ctx.table.columns.map((c) => c.bytesPerRow));
  const ref = Number(ctx.settings.refBytes);
  return Object.fromEntries(ctx.table.columns.map((c) => [c.name, Math.max(0.3, Math.min(1, Math.sqrt(c.bytesPerRow / ref)))]));
};
/** ALTER TABLE … MODIFY COLUMN: the column gets a new type / codec (sizes, boxes and signs follow). */
const modify = async (ctx: LevelCtx, name: string, v: Variant) => {
  sizesOf(ctx);
  ctx.table.spec.columns = ctx.table.columns.map((c) => (c.name === name ? column(name, v, c.only) : c));
  ctx.stage.relabelColumns();
  await ctx.stage.setColumnSizes(sizesOf(ctx));
};
const start = (ctx: LevelCtx) => {
  if (ctx.settings.startBytes === undefined) ctx.settings.startBytes = totalBytes(ctx);
};

// ---------------------------------------------------------------- 10-1 The smallest type that fits

const T = {
  int64: { type: "Int64", raw: 8, ratio: 2 },
  uint32: { type: "UInt32", raw: 4, ratio: 2 },
  ageInt64: { type: "Int64", raw: 8, ratio: 6 },
  uint8: { type: "UInt8", raw: 1, ratio: 1.5 },
  dateString: { type: "String", raw: 20, ratio: 3 },
  dateTime: { type: "DateTime", raw: 4, ratio: 3 },
} satisfies Record<string, Variant>;
const PICK_101: Record<string, Record<string, Variant>> = {
  user_id: { Int64: T.int64, UInt32: T.uint32 },
  age: { Int64: T.ageInt64, UInt8: T.uint8 },
  created: { String: T.dateString, DateTime: T.dateTime },
};

const q101: Question[] = [
  { concept: "types", build: (r) => ({ prompt: msg("10-1.check.age.q"), input: choices(r, "10-1.check.age", ["uint8", "int64", "string"]), answer: "uint8", explain: msg("10-1.check.age.why") }) },
  {
    concept: "types",
    build: (r) => {
      const millions = randInt(r, 2, 9) * 100;
      return { prompt: msg("10-1.check.bytes.q", { millions }), input: { type: "number" }, answer: millions * 7, explain: msg("10-1.check.bytes.why", { millions, n: millions * 7 }) };
    },
  },
  { concept: "types", build: (r) => ({ prompt: msg("10-1.check.date.q"), input: choices(r, "10-1.check.date", ["datetime", "string", "float"]), answer: "datetime", explain: msg("10-1.check.date.why") }) },
  { concept: "types", build: (r) => ({ prompt: msg("10-1.check.enum.q"), input: choices(r, "10-1.check.enum", ["enum", "string", "uint64"]), answer: "enum", explain: msg("10-1.check.enum.why") }) },
];

const level101: Level = {
  id: "10-1",
  world: 10,
  title: msg("10-1.title"),
  summary: msg("10-1.summary"),
  table: { name: "events", orderBy: ["user_id"], columns: [column("user_id", T.int64), column("age", T.ageInt64), column("created", T.dateString)] },
  initial: [{ rows: ROWS, options: { keyRange: [0, 99999] } }],
  settings: { user_id: "Int64", age: "Int64", created: "String" },
  steps: [
    { kind: "brief", title: msg("10-1.brief.title"), body: msg("10-1.brief.body"), code: "CREATE TABLE events (\n  user_id Int64,   -- ids fit in UInt32\n  age     Int64,   -- 0–120 fits in UInt8\n  created String   -- '2026-10-02 12:00:00'\n) ORDER BY user_id;" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("10-1.age.q"),
        input: { type: "number" },
        answer: 1,
        explain: msg("10-1.age.why"),
        code: "ALTER TABLE events MODIFY COLUMN age UInt8",
        reveal: async (c) => {
          start(c);
          await modify(c, "age", T.uint8);
          c.settings.age = "UInt8";
        },
      }),
    },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("10-1.created.q"),
        input: { type: "number" },
        answer: 4,
        explain: msg("10-1.created.why"),
        code: "ALTER TABLE events MODIFY COLUMN created DateTime",
      }),
    },
    {
      kind: "task",
      title: msg("10-1.shrink.title"),
      body: msg("10-1.shrink.body"),
      onEnter: (ctx) => start(ctx),
      tools: [
        { type: "setting", field: "user_id", label: msg("10-1.shrink.user_id"), options: ["Int64", "UInt32"], labels: "10-1.shrink.types" },
        { type: "setting", field: "created", label: msg("10-1.shrink.created"), options: ["String", "DateTime"], labels: "10-1.shrink.types" },
        {
          type: "action",
          id: "apply",
          label: msg("10-1.shrink.apply"),
          icon: "press",
          tone: "primary",
          run: async (ctx) => {
            for (const name of ["user_id", "created"]) await modify(ctx, name, PICK_101[name][String(ctx.settings[name])]);
          },
        },
      ],
      progress: (ctx) => ({ done: totalBytes(ctx) <= Number(ctx.settings.startBytes) * 0.45 ? 1 : 0, total: 1 }),
      success: msg("10-1.shrink.success"),
      panels: ["compression"],
      solution: { settings: { user_id: "UInt32", created: "DateTime" }, actions: ["apply"] },
    },
  ],
  check: q101,
};

// ---------------------------------------------------------------- 10-2 LowCardinality

const LC = {
  city: { type: "String", raw: 9, ratio: 4 },
  cityLc: { type: "LowCardinality(String)", raw: 9, ratio: 18 },
  url: { type: "String", raw: 60, ratio: 3 },
  urlLc: { type: "LowCardinality(String)", raw: 60, ratio: 2.4 },
} satisfies Record<string, Variant>;
const PICK_102: Record<string, Record<string, Variant>> = {
  city: { String: LC.city, LowCardinality: LC.cityLc },
  url: { String: LC.url, LowCardinality: LC.urlLc },
};

const q102: Question[] = [
  { concept: "low-cardinality", build: (r) => ({ prompt: msg("10-2.check.how.q"), input: choices(r, "10-2.check.how", ["dictionary", "compress", "index"]), answer: "dictionary", explain: msg("10-2.check.how.why") }) },
  {
    concept: "low-cardinality",
    build: (r) => {
      const distinct = [50, 800, 5000, 500000, 2000000][randInt(r, 0, 4)];
      const good = distinct < 10000;
      return { prompt: msg("10-2.check.fit.q", { distinct }), input: choices(r, "10-2.check.fit", ["yes", "no"]), answer: good ? "yes" : "no", explain: msg(good ? "10-2.check.fit.whyYes" : "10-2.check.fit.whyNo", { distinct }) };
    },
  },
  { concept: "low-cardinality", build: (r) => ({ prompt: msg("10-2.check.every.q"), input: choices(r, "10-2.check.every", ["no", "yes"]), answer: "no", explain: msg("10-2.check.every.why") }) },
  { concept: "low-cardinality", build: (r) => ({ prompt: msg("10-2.check.vsEnum.q"), input: choices(r, "10-2.check.vsEnum", ["newValues", "faster", "smaller"]), answer: "newValues", explain: msg("10-2.check.vsEnum.why") }) },
];

const level102: Level = {
  id: "10-2",
  world: 10,
  title: msg("10-2.title"),
  summary: msg("10-2.summary"),
  table: { name: "visits", orderBy: ["ts"], columns: [column("ts", { type: "DateTime", raw: 4, ratio: 8 }), column("city", LC.city), column("url", LC.url)] },
  initial: [{ rows: ROWS, options: { keyRange: [0, 29] } }],
  settings: { city: "String", url: "String" },
  steps: [
    { kind: "brief", title: msg("10-2.brief.title"), body: msg("10-2.brief.body"), code: "city LowCardinality(String),  -- ~200 distinct values\nurl  String                   -- ~1,000,000 distinct values" },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("10-2.city.q"),
        input: choices(ctx.rng, "10-2.city", ["smaller", "same", "bigger"]),
        answer: "smaller",
        explain: msg("10-2.city.why"),
        code: "ALTER TABLE visits MODIFY COLUMN city LowCardinality(String)",
        reveal: async (c) => {
          start(c);
          await modify(c, "city", LC.cityLc);
          c.settings.city = "LowCardinality";
        },
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("10-2.url.q"),
        input: choices(ctx.rng, "10-2.url", ["smaller", "same", "bigger"]),
        answer: "bigger",
        explain: msg("10-2.url.why"),
        code: "ALTER TABLE visits MODIFY COLUMN url LowCardinality(String)",
        reveal: async (c) => {
          await modify(c, "url", LC.urlLc);
          c.settings.url = "LowCardinality";
        },
      }),
    },
    {
      kind: "task",
      title: msg("10-2.pick.title"),
      body: msg("10-2.pick.body"),
      tools: [
        { type: "setting", field: "city", label: msg("10-2.pick.city"), options: ["String", "LowCardinality"], labels: "10-2.pick.types" },
        { type: "setting", field: "url", label: msg("10-2.pick.url"), options: ["String", "LowCardinality"], labels: "10-2.pick.types" },
        {
          type: "action",
          id: "apply",
          label: msg("10-2.pick.apply"),
          icon: "press",
          tone: "primary",
          run: async (ctx) => {
            for (const name of ["city", "url"]) await modify(ctx, name, PICK_102[name][String(ctx.settings[name])]);
          },
        },
      ],
      progress: (ctx) => {
        const best = ctx.table.columns.find((c) => c.name === "city")!.type.startsWith("LowCardinality") && ctx.table.columns.find((c) => c.name === "url")!.type === "String";
        return { done: best ? 1 : 0, total: 1 };
      },
      success: msg("10-2.pick.success"),
      panels: ["compression"],
      solution: { settings: { city: "LowCardinality", url: "String" }, actions: ["apply"] },
    },
  ],
  check: q102,
};

// ---------------------------------------------------------------- 10-3 Nullable

const N = {
  phone: { type: "Nullable(String)", raw: 13, ratio: 3 },
  phonePlain: { type: "String DEFAULT ''", raw: 12, ratio: 3.2 },
  score: { type: "Nullable(UInt32)", raw: 5, ratio: 2 },
  scorePlain: { type: "UInt32 DEFAULT 0", raw: 4, ratio: 2.4 },
} satisfies Record<string, Variant>;

const q103: Question[] = [
  { concept: "nullable", build: (r) => ({ prompt: msg("10-3.check.cost.q"), input: choices(r, "10-3.check.cost", ["nullMap", "free", "index"]), answer: "nullMap", explain: msg("10-3.check.cost.why") }) },
  { concept: "nullable", build: (r) => ({ prompt: msg("10-3.check.key.q"), input: choices(r, "10-3.check.key", ["refused", "fine", "faster"]), answer: "refused", explain: msg("10-3.check.key.why") }) },
  {
    concept: "nullable",
    build: (r) => {
      const millions = randInt(r, 1, 9) * 100;
      return { prompt: msg("10-3.check.bytes.q", { millions }), input: { type: "number" }, answer: millions, explain: msg("10-3.check.bytes.why", { millions }) };
    },
  },
  { concept: "nullable", build: (r) => ({ prompt: msg("10-3.check.instead.q"), input: choices(r, "10-3.check.instead", ["default", "nullable", "string"]), answer: "default", explain: msg("10-3.check.instead.why") }) },
];

const level103: Level = {
  id: "10-3",
  world: 10,
  title: msg("10-3.title"),
  summary: msg("10-3.summary"),
  table: { name: "customers", orderBy: ["id"], columns: [column("id", { type: "UInt32", raw: 4, ratio: 2 }), column("phone", N.phone), column("score", N.score)] },
  initial: [{ rows: ROWS, options: { keyRange: [0, 99999] } }],
  settings: { nullable: "yes" },
  steps: [
    { kind: "brief", title: msg("10-3.brief.title"), body: msg("10-3.brief.body"), code: "phone Nullable(String),   -- + a null-map file\nscore Nullable(UInt32)\n-- usually better:\nphone String DEFAULT '',\nscore UInt32 DEFAULT 0" },
    {
      kind: "predict",
      build: () => ({
        prompt: msg("10-3.extra.q"),
        input: { type: "number" },
        answer: 1,
        explain: msg("10-3.extra.why"),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("10-3.key.q"),
        input: choices(ctx.rng, "10-3.key", ["error", "works", "slower"]),
        answer: "error",
        explain: msg("10-3.key.why"),
        code: "CREATE TABLE t (score Nullable(UInt32)) ORDER BY score;",
      }),
    },
    {
      kind: "task",
      title: msg("10-3.defaults.title"),
      body: msg("10-3.defaults.body"),
      onEnter: (ctx) => start(ctx),
      tools: [
        { type: "setting", field: "nullable", label: msg("10-3.defaults.setting"), options: ["yes", "no"], labels: "10-3.defaults.values" },
        {
          type: "action",
          id: "apply",
          label: msg("10-3.defaults.apply"),
          icon: "press",
          tone: "primary",
          run: async (ctx) => {
            const yes = ctx.settings.nullable === "yes";
            await modify(ctx, "phone", yes ? N.phone : N.phonePlain);
            await modify(ctx, "score", yes ? N.score : N.scorePlain);
          },
        },
      ],
      progress: (ctx) => ({ done: ctx.table.columns.every((c) => !c.type.startsWith("Nullable")) ? 1 : 0, total: 1 }),
      success: msg("10-3.defaults.success"),
      panels: ["compression"],
      solution: { settings: { nullable: "no" }, actions: ["apply"] },
    },
  ],
  check: q103,
};

// ---------------------------------------------------------------- 10-4 Codecs

const CODEC: Record<string, Record<string, Variant>> = {
  ts: {
    LZ4: { type: "DateTime CODEC(LZ4)", raw: 4, ratio: 2 },
    "DoubleDelta, ZSTD": { type: "DateTime CODEC(DoubleDelta, ZSTD)", raw: 4, ratio: 40 },
    Gorilla: { type: "DateTime CODEC(Gorilla)", raw: 4, ratio: 1.6 },
  },
  temp: {
    LZ4: { type: "Float64 CODEC(LZ4)", raw: 8, ratio: 1.3 },
    Gorilla: { type: "Float64 CODEC(Gorilla)", raw: 8, ratio: 2.6 },
    ZSTD: { type: "Float64 CODEC(ZSTD)", raw: 8, ratio: 3.1 },
  },
};
const codecTable = (): TableSpec => ({ name: "sensors", orderBy: ["ts"], columns: [column("ts", CODEC.ts.LZ4), column("sensor", { type: "UInt16", raw: 2, ratio: 6 }), column("temp", CODEC.temp.LZ4)] });

const q104: Question[] = [
  { concept: "codecs", build: (r) => ({ prompt: msg("10-4.check.ts.q"), input: choices(r, "10-4.check.ts", ["doubleDelta", "gorilla", "none"]), answer: "doubleDelta", explain: msg("10-4.check.ts.why") }) },
  { concept: "codecs", build: (r) => ({ prompt: msg("10-4.check.chain.q"), input: choices(r, "10-4.check.chain", ["chain", "only", "either"]), answer: "chain", explain: msg("10-4.check.chain.why") }) },
  { concept: "codecs", build: (r) => ({ prompt: msg("10-4.check.float.q"), input: choices(r, "10-4.check.float", ["measure", "gorilla", "never"]), answer: "measure", explain: msg("10-4.check.float.why") }) },
  { concept: "codecs", build: (r) => ({ prompt: msg("10-4.check.where.q"), input: choices(r, "10-4.check.where", ["columns", "parts", "queryLog"]), answer: "columns", explain: msg("10-4.check.where.why") }) },
];

const level104: Level = {
  id: "10-4",
  world: 10,
  title: msg("10-4.title"),
  summary: msg("10-4.summary"),
  table: codecTable(),
  initial: [{ rows: ROWS, options: { keyRange: [0, 29] } }],
  settings: { ts: "LZ4", temp: "LZ4" },
  steps: [
    { kind: "brief", title: msg("10-4.brief.title"), body: msg("10-4.brief.body"), code: "ts   DateTime CODEC(DoubleDelta, ZSTD),\ntemp Float64  CODEC(ZSTD)" },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("10-4.delta.q"),
        input: choices(ctx.rng, "10-4.delta", ["huge", "small", "worse"]),
        answer: "huge",
        explain: msg("10-4.delta.why"),
        code: "ALTER TABLE sensors MODIFY COLUMN ts DateTime CODEC(DoubleDelta, ZSTD)",
        reveal: async (c) => {
          start(c);
          await modify(c, "ts", CODEC.ts["DoubleDelta, ZSTD"]);
          c.settings.ts = "DoubleDelta, ZSTD";
        },
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("10-4.gorilla.q"),
        input: choices(ctx.rng, "10-4.gorilla", ["notAlways", "always", "never"]),
        answer: "notAlways",
        explain: msg("10-4.gorilla.why"),
      }),
    },
    {
      kind: "task",
      title: msg("10-4.tune.title"),
      body: msg("10-4.tune.body"),
      onEnter: (ctx) => start(ctx),
      tools: [
        { type: "setting", field: "ts", label: msg("10-4.tune.ts"), options: ["LZ4", "DoubleDelta, ZSTD", "Gorilla"], labels: "10-4.tune.codecs" },
        { type: "setting", field: "temp", label: msg("10-4.tune.temp"), options: ["LZ4", "Gorilla", "ZSTD"], labels: "10-4.tune.codecs" },
        {
          type: "action",
          id: "apply",
          label: msg("10-4.tune.apply"),
          icon: "press",
          tone: "primary",
          run: async (ctx) => {
            for (const name of ["ts", "temp"]) await modify(ctx, name, CODEC[name][String(ctx.settings[name])]);
          },
        },
      ],
      progress: (ctx) => {
        const ts = ctx.table.columns.find((c) => c.name === "ts")!.type.includes("DoubleDelta");
        const temp = ctx.table.columns.find((c) => c.name === "temp")!.type.includes("(ZSTD)");
        return { done: (ts ? 1 : 0) + (temp ? 1 : 0), total: 2 };
      },
      success: msg("10-4.tune.success"),
      panels: ["compression"],
      solution: { settings: { ts: "DoubleDelta, ZSTD", temp: "ZSTD" }, actions: ["apply"] },
    },
  ],
  check: q104,
};

// ---------------------------------------------------------------- 10-5 The JSON type

const jsonTable = (): TableSpec => ({
  name: "events",
  orderBy: ["ts"],
  columns: [
    column("ts", { type: "DateTime", raw: 4, ratio: 8 }),
    column("payload", { type: "String", raw: 120, ratio: 4 }, ["text"]),
    column("payload.user", { type: "UInt32", raw: 4, ratio: 2 }, ["json"]),
    column("payload.page", { type: "LowCardinality(String)", raw: 2, ratio: 4 }, ["json"]),
    column("payload.ms", { type: "UInt32", raw: 4, ratio: 3 }, ["json"]),
  ],
});
const qText: QuerySpec = { columns: ["payload"], partitions: ["text"] };
const qJson: QuerySpec = { columns: ["payload.ms"], partitions: ["json"] };

const q105: Question[] = [
  { concept: "json-type", build: (r) => ({ prompt: msg("10-5.check.stored.q"), input: choices(r, "10-5.check.stored", ["subcolumns", "blob", "rows"]), answer: "subcolumns", explain: msg("10-5.check.stored.why") }) },
  { concept: "json-type", build: (r) => ({ prompt: msg("10-5.check.paths.q"), input: choices(r, "10-5.check.paths", ["shared", "error", "dropped"]), answer: "shared", explain: msg("10-5.check.paths.why") }) },
  { concept: "json-type", build: (r) => ({ prompt: msg("10-5.check.ga.q"), input: choices(r, "10-5.check.ga", ["v253", "v226", "never"]), answer: "v253", explain: msg("10-5.check.ga.why") }) },
  {
    concept: "json-type",
    build: (r) => {
      const n = randInt(r, 3, 9);
      return { prompt: msg("10-5.check.read.q", { n }), input: { type: "number" }, answer: 1, explain: msg("10-5.check.read.why", { n }) };
    },
  },
];

const level105: Level = {
  id: "10-5",
  world: 10,
  title: msg("10-5.title"),
  summary: msg("10-5.summary"),
  table: jsonTable(),
  halls: ["text", "json"],
  initial: [
    { rows: ROWS, options: { partition: "text", keyRange: [0, 29] } },
    { rows: ROWS, options: { partition: "json", keyRange: [0, 29] } },
  ],
  steps: [
    { kind: "brief", title: msg("10-5.brief.title"), body: msg("10-5.brief.body"), code: "-- events_text: payload String\nSELECT avg(JSONExtractUInt(payload, 'ms')) FROM events_text;\n\n-- events_json: payload JSON\nSELECT avg(payload.ms) FROM events_json;" },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("10-5.json.q"),
        input: choices(ctx.rng, "10-5.json", ["ms", "all", "blob"]),
        answer: "ms",
        explain: msg("10-5.json.why"),
        code: "SELECT avg(payload.ms) FROM events_json",
        reveal: async (c) => void (await c.query(qJson)),
      }),
    },
    {
      kind: "predict",
      build: (ctx) => ({
        prompt: msg("10-5.text.q"),
        input: choices(ctx.rng, "10-5.text", ["whole", "ms"]),
        answer: "whole",
        explain: msg("10-5.text.why"),
        code: "SELECT avg(JSONExtractUInt(payload, 'ms')) FROM events_text",
        reveal: async (c) => void (await c.query(qText)),
      }),
    },
    {
      kind: "task",
      title: msg("10-5.compare.title"),
      body: msg("10-5.compare.body"),
      tools: [
        {
          type: "action",
          id: "text",
          label: msg("10-5.compare.text"),
          icon: "play",
          run: async (ctx) => {
            const r = await ctx.query(qText);
            ctx.settings.textBytes = r.bytesRead;
          },
        },
        {
          type: "action",
          id: "json",
          label: msg("10-5.compare.json"),
          icon: "play",
          tone: "primary",
          run: async (ctx) => {
            const r = await ctx.query(qJson);
            ctx.settings.jsonBytes = r.bytesRead;
          },
        },
      ],
      progress: (ctx) => {
        const t = Number(ctx.settings.textBytes ?? 0);
        const j = Number(ctx.settings.jsonBytes ?? 0);
        return { done: (t ? 1 : 0) + (t && j && j <= t * 0.1 ? 1 : 0), total: 2 };
      },
      success: msg("10-5.compare.success"),
      panels: ["reading", "compression"],
      solution: { actions: ["text", "json"] },
    },
  ],
  check: q105,
};

export const WORLD10: Level[] = [level101, level102, level103, level104, level105];
