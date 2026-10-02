import type { InsertOptions, KeyDistribution, Mutation, Part, QueryResult, QuerySpec, Table, TableSpec, Where } from "@/sim/table";
import type { Row } from "@/sim/engines";
import type { Layout } from "@/stage/depotStage";
import { shuffle } from "@/lib/rng";

export { seeded, randInt, shuffle } from "@/lib/rng";

/** A translatable message: a key under the `levels` namespace plus ICU values. */
export type Msg = { key: string; values?: Record<string, string | number> };
export const msg = (key: string, values?: Msg["values"]): Msg => ({ key, values });

export type Concept =
  | "columnar" | "column-read" | "compression" | "olap"
  | "parts" | "merges" | "too-many-parts" | "batching" | "async-insert" | "dedup"
  | "granules" | "sparse-index" | "key-order" | "pk-not-unique" | "explain"
  | "partitions" | "partition-pruning" | "over-partition" | "drop-partition"
  | "replacing" | "final" | "summing" | "aggregating" | "collapsing"
  | "mutations" | "lightweight-delete" | "lightweight-update" | "ttl" | "tiered-storage";

export type Choice = { id: string; label: Msg };
export type ChoiceInput = { type: "choice"; options: Choice[] };
export type Input = ChoiceInput | { type: "number" };

/** What the stage can do for a level script (all awaitable: they resolve when the animation ends). */
export type StageApi = {
  deliver: (part: Part, opts?: { quick?: boolean }) => Promise<void>;
  playQuery: (result: QueryResult) => Promise<void>;
  setLayout: (layout: Layout) => Promise<void>;
  setColumnSizes: (sizes: Record<string, number>) => Promise<void>;
  resetBoxes: () => Promise<void>;
  merge: (sources: string[], part: Part) => Promise<void>;
  turnAway: (kind: "rejected" | "duplicate" | "full") => Promise<void>;
  dropParts: (names: string[]) => Promise<void>;
  mutateParts: (names: string[]) => Promise<void>;
  maskParts: (names: string[]) => Promise<void>;
  setBuffer: (rows: number | null) => void;
  rewriteParts: (changes: { from: string; to: Part | null }[]) => Promise<void>;
  maskRows: (part: string, rows: number[]) => Promise<void>;
  moveParts: (names: string[]) => Promise<void>;
};

export type TaskStats = {
  inserts: number;
  queries: number;
  /** Queries whose result met the task's `goal` (see Tool "query"). */
  goodQueries: number;
  orderByChanges: number;
  merges: number;
  /** Inserts rejected (TOO_MANY_PARTS / too many partitions). */
  rejected: number;
  /** Inserts that arrived with the partition above the delay threshold. */
  delayed: number;
  /** Retried blocks dropped by insert deduplication. */
  dedupHits: number;
  /** Consecutive seconds a `bg.watch` condition held. */
  calm: number;
  /** Async-insert buffer flushes. */
  flushes: number;
  drops: number;
  mutations: number;
  lwDeletes: number;
  /** One-shot action buttons pressed. */
  actions: number;
  /** Rows rewritten by mutations (whole parts). */
  rewrittenRows: number;
  /** Lightweight UPDATE patch parts written. */
  patches: number;
  ttlMerges: number;
  moves: number;
};

export type Setting = string | number | boolean;

/** Live context a step can read and act on. */
export type LevelCtx = {
  table: Table;
  rng: () => number;
  stats: TaskStats;
  /** The last query the player (or a script) ran. */
  last: { spec: QuerySpec; result: QueryResult; sql?: string } | null;
  wait: (ms: number) => Promise<void>;
  /** Values the player sets in the dock (Tool "setting"). */
  settings: Record<string, Setting>;
  /**
   * Insert and wait until the part is on the shelf (truck, or `quick` drop). Resolves null when the
   * insert was rejected (too many parts) or deduplicated.
   */
  insert: (rows: number, options?: InsertOptions & { quick?: boolean }) => Promise<Part | null>;
  /** INSERT of logical rows (World 5 tables: one box per row). */
  insertRows: (rows: Row[], options?: InsertOptions) => Promise<Part | null>;
  /** Run a query and show `sql` + `rows` (e.g. an aggregate computed from the rows) in the rows panel. */
  show: (spec: QuerySpec, sql: string, transform?: (rows: Row[]) => Row[]) => Promise<QueryResult>;
  /** One INSERT spanning partitions: one part per partition (or null if rejected). */
  insertBlock: (blocks: { partition: string; rows: number; dist?: KeyDistribution; keyRange?: [number, number] }[]) => Promise<Part[] | null>;
  /** An application client inserting: goes through the async buffer when `settings.async` is true. */
  clientInsert: (rows: number, options?: InsertOptions) => Promise<Part | null>;
  /** Merge the given parts, or let the background selector pick (null when nothing to merge). */
  merge: (names?: string[]) => Promise<Part | null>;
  dropPartition: (partition: string) => Promise<void>;
  /** ALTER TABLE … DELETE: returns the bytes rewritten. */
  mutateDelete: (partition: string) => Promise<number>;
  lightweightDelete: (partition: string) => Promise<void>;
  /**
   * ALTER TABLE … UPDATE/DELETE on logical rows: parts with a match are rewritten one by one
   * (system.mutations shows parts_to_do going down). Null when refused (key column).
   */
  mutate: (command: string, transform: (r: Row) => Row | null, updates?: string[]) => Promise<Mutation | null>;
  /** DELETE FROM (lightweight): matching rows are masked in place. Returns how many. */
  deleteRows: (match: (r: Row) => boolean) => Promise<number>;
  /** UPDATE … SET (lightweight): writes a patch part. */
  patchUpdate: (match: (r: Row) => boolean, set: Row) => Promise<Part | null>;
  /** A TTL merge at day `settings.today`: expired rows go. Returns the parts touched. */
  ttlMerge: (column: string, days: number) => Promise<number>;
  /** Move whole parts to another disk. */
  moveParts: (names: string[], disk: string) => Promise<number>;
  /** Run a query and wait until Pico has walked it. */
  query: (spec: QuerySpec) => Promise<QueryResult>;
  stage: StageApi;
  /** Background loops: they stop when the step changes. Each iteration is awaited. */
  bg: {
    loop: (ms: number, fn: () => Promise<void>) => void;
    /** The background merger: every `ms`, merge up to `maxRun` neighbouring parts. */
    merger: (ms: number, maxRun?: number) => void;
    watch: (ok: () => boolean) => void;
    asyncFlusher: (flushMs: number, maxRows: number) => void;
  };
};

export type Prediction = {
  prompt: Msg;
  input: Input;
  answer: string | number;
  explain: Msg;
  code?: string;
  /** Plays the outcome on the stage after the player commits (predict → watch). */
  reveal?: (ctx: LevelCtx) => Promise<void>;
};

/** Buttons in the dock during a task. */
export type Tool =
  /** Send a truck: `granules` per insert (the last one partly filled). */
  | { type: "insert"; granules: number; max?: number }
  /**
   * Pick columns and run a query. `columns` limits the chips; `where` is a fixed filter shown in the
   * SQL; `goal` marks a query as good (counted in stats.goodQueries).
   */
  | { type: "query"; columns?: string[]; where?: Where; partitions?: string[]; goal?: (spec: QuerySpec, result: QueryResult) => boolean; select?: string }
  /** Choose the table's ORDER BY (one column, or a comma-separated key like "city, customer_id"). */
  | { type: "orderBy"; options: string[] }
  /** A segmented control bound to ctx.settings[field]; labels: `levels.<labels>.<option>`. */
  | { type: "setting"; field: string; label: Msg; options: Setting[]; labels: string }
  /** A one-shot button. */
  | { type: "action"; id: string; label: Msg; icon?: "truck" | "repeat" | "trash" | "eraser" | "pencil" | "press" | "play"; tone?: "primary" | "accent" | "secondary" | "danger"; run: (ctx: LevelCtx) => Promise<unknown> };

/** Live panels a step can show next to the stage. */
export type Panel = "reading" | "parts" | "compression" | "partsMeter" | "index" | "explain" | "rows" | "mutations" | "ttl" | "disks";

export type Step =
  | { kind: "brief"; title: Msg; body: Msg; mapping?: { icon: string; thing: Msg; real: Msg }[]; breaks?: Msg; code?: string }
  | { kind: "watch"; title: Msg; body: Msg; script: (ctx: LevelCtx) => Promise<void>; panels?: Panel[] }
  | { kind: "predict"; build: (ctx: LevelCtx) => Prediction }
  | {
      kind: "task";
      title: Msg;
      body: Msg;
      tools: Tool[];
      /** Progress toward the goal, re-evaluated after every action. Done when done >= total. */
      progress: (ctx: LevelCtx, start: TaskStats) => { done: number; total: number };
      success: Msg;
      onEnter?: (ctx: LevelCtx) => void | Promise<void>;
      panels?: Panel[];
      /** A known solution: drives the autoplay test (and could power a hint). */
      solution?: { columns?: string[]; orderBy?: string[]; settings?: Record<string, Setting>; actions?: string[] };
    };

/** A recall-check question; `build` gets a seeded rng so a retry gets new numbers. */
export type Question = {
  concept: Concept;
  build: (rng: () => number) => { prompt: Msg; input: Input; answer: string | number; explain: Msg; code?: string };
};

export type Level = {
  id: string;
  world: number;
  title: Msg;
  summary: Msg;
  /** The warehouse's table. Copied for every run. */
  table: TableSpec;
  /** Parts already on the shelves when the level starts. */
  initial?: { rows: number; options?: InsertOptions }[];
  /** Parts of logical rows already on the shelves (World 5 tables). */
  initialRows?: (Row[] | { rows: Row[]; options: InsertOptions })[];
  /** Initial dock settings (ctx.settings). */
  settings?: Record<string, Setting>;
  /** How key values print in panels (e.g. city index → name). */
  format?: Record<string, (v: number) => string>;
  steps: Step[];
  check: Question[];
};

/** Multiple choice where option ids are message suffixes: `${base}.${id}`. */
export function choices(rng: () => number, base: string, ids: string[]): ChoiceInput {
  return { type: "choice", options: shuffle(rng, ids).map((id) => ({ id, label: msg(`${base}.${id}`) })) };
}
