import type { InsertOptions, Part, QueryResult, QuerySpec, Table, TableSpec, Where } from "@/sim/table";
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
  | "partitions" | "partition-pruning" | "over-partition" | "drop-partition";

export type Choice = { id: string; label: Msg };
export type ChoiceInput = { type: "choice"; options: Choice[] };
export type Input = ChoiceInput | { type: "number" };

/** What the stage can do for a level script (all awaitable: they resolve when the animation ends). */
export type StageApi = {
  deliver: (part: Part) => Promise<void>;
  playQuery: (result: QueryResult) => Promise<void>;
  setLayout: (layout: Layout) => Promise<void>;
  setColumnSizes: (sizes: Record<string, number>) => Promise<void>;
  resetBoxes: () => Promise<void>;
};

export type TaskStats = {
  inserts: number;
  queries: number;
  /** Queries whose result met the task's `goal` (see Tool "query"). */
  goodQueries: number;
  orderByChanges: number;
};

/** Live context a step can read and act on. */
export type LevelCtx = {
  table: Table;
  rng: () => number;
  stats: TaskStats;
  /** The last query the player (or a script) ran. */
  last: { spec: QuerySpec; result: QueryResult } | null;
  wait: (ms: number) => Promise<void>;
  /** Insert and wait until the truck has delivered the part. */
  insert: (rows: number, options?: InsertOptions) => Promise<Part>;
  /** Run a query and wait until Pico has walked it. */
  query: (spec: QuerySpec) => Promise<QueryResult>;
  stage: StageApi;
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
  | { type: "query"; columns?: string[]; where?: Where; goal?: (spec: QuerySpec, result: QueryResult) => boolean; select?: string }
  /** Choose the table's ORDER BY column (World 1-3 compression, World 3 key order). */
  | { type: "orderBy"; options: string[] };

/** Live panels a step can show next to the stage. */
export type Panel = "reading" | "parts" | "compression";

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
      solution?: { columns?: string[]; orderBy?: string[] };
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
  steps: Step[];
  check: Question[];
};

/** Multiple choice where option ids are message suffixes: `${base}.${id}`. */
export function choices(rng: () => number, base: string, ids: string[]): ChoiceInput {
  return { type: "choice", options: shuffle(rng, ids).map((id) => ({ id, label: msg(`${base}.${id}`) })) };
}
