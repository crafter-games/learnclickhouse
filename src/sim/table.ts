// A MergeTree table, simulated. Facts: docs/research/clickhouse-curriculum.md (Worlds 1–4).
// Rows are not stored one by one: a part is a list of granules (≤ 8192 rows each) and, for the
// sorting-key columns, each granule knows the key range it covers (data is sorted inside a part).
import { Emitter } from "./emitter";
import { collapse, type Engine, type Row } from "./engines";

/** Rows per granule (`index_granularity`, MergeTreeSettings.cpp). */
export const GRANULE_ROWS = 8192;
/** `parts_to_delay_insert` / `parts_to_throw_insert`: active parts per partition. */
export const PARTS_TO_DELAY = 1000;
export const PARTS_TO_THROW = 3000;
/** `max_parts_to_merge_at_once`. */
export const MAX_PARTS_PER_MERGE = 100;
/** `max_partitions_per_insert_block`. */
export const MAX_PARTITIONS_PER_INSERT = 100;

export type ColumnSpec = {
  name: string;
  type: string;
  /** Average compressed bytes per row on disk (drives "bytes read") when no ratios are given. */
  bytesPerRow: number;
  /** Distinct values 0…distinct-1 (projections sort by it). */
  distinct?: number;
  /** Hidden column of this projection (drawn as its own aisle, read only through the projection). */
  projection?: string;
  /** Only parts of these partitions have this column (several tables sharing one depot). */
  only?: string[];
  /** Uncompressed bytes per row and compression ratios (sorted = the table is ordered by this column). */
  raw?: number;
  ratio?: { sorted: number; unsorted: number };
};

/** What a granule holds in a non-key column: its range, and (when small) the exact values. */
export type ColumnStats = { min: number; max: number; values?: number[] };

/**
 * Key range of a granule per sorting-key column: [min, max] (inclusive). `cols`: stats of other
 * columns, for skip indexes and the query condition cache.
 */
export type Granule = { rows: number; min?: number; max?: number; keys?: Record<string, [number, number]>; cols?: Record<string, ColumnStats> };

/** A data-skipping index: one summary per `granularity` granules. */
export type SkipIndex = { name: string; column: string; type: "minmax" | "set" | "bloom_filter"; granularity: number; n?: number; fpr?: number };
/** A projection: a hidden copy of `columns` inside every part, sorted by `orderBy`. */
export type Projection = { name: string; orderBy: string; columns: string[] };
/** A projection's hidden column on the shelves is named `<projection>:<column>`. */
export const projColumn = (proj: string, col: string) => `${proj}:${col}`;

/** How an insert's values are distributed: `distinct` values 0…distinct-1 per column. */
export type KeyDistribution = Record<string, number>;

export type Part = {
  name: string;
  partition: string;
  minBlock: number;
  maxBlock: number;
  /** Merge depth: 0 for a fresh insert, max(sources) + 1 after a merge. */
  level: number;
  /** Mutation version (ALTER … UPDATE/DELETE rewrote the part), shown as a 5th name segment. */
  mutation?: number;
  rows: number;
  granules: Granule[];
  active: boolean;
  /** Rows hidden by lightweight DELETE (`_row_exists` = 0), physically removed on merge. */
  deletedRows?: number;
  /** Value distribution, kept so granule ranges can be rebuilt for another ORDER BY. */
  dist?: KeyDistribution;
  /** Logical rows, for the small "one row per box" tables (World 5's engines). */
  data?: Row[];
  /** Rows (indexes into data) hidden by lightweight DELETE (`_row_exists` = 0). */
  mask?: number[];
  /** A patch part (lightweight UPDATE): changed columns for rows of these parts, applied on read. */
  patch?: { targets: string[] };
  /** Disk / volume the part lives on (tiered storage). */
  disk?: string;
  /** Skip indexes built for this part (ADD INDEX only covers new parts until MATERIALIZE INDEX). */
  indexes?: string[];
  /** Projections built for this part: their granules, sorted by the projection's key. */
  projections?: Record<string, Granule[]>;
};

/** One entry of system.mutations. */
export type Mutation = { id: string; command: string; partsToDo: number; isDone: boolean; version: number; rowsRewritten: number };
/** A part replaced by a rewrite (mutation, TTL merge): `to` = null when nothing is left. */
export type Rewrite = { from: Part; to: Part | null };

export type TableSettings = {
  /** Scaled stand-ins for the real thresholds (the level says which real numbers they represent). */
  partsToDelay?: number;
  partsToThrow?: number;
  maxPartitionsPerInsert?: number;
  /** Insert deduplication window in blocks (`replicated_deduplication_window`; 0 = off). */
  dedupWindow?: number;
  /** Largest part (rows) the background merger will produce (stand-in for 150 GiB). */
  maxMergeRows?: number;
  /** use_query_condition_cache (on by default since 25.4). */
  conditionCache?: boolean;
  /** optimize_move_to_prewhere (default on): filter columns first, the rest only where rows match. */
  prewhere?: boolean;
  /** query_plan_optimize_lazy_materialization (on since 25.4): ORDER BY … LIMIT reads wide columns last. */
  lazyMaterialization?: boolean;
};

export type TableSpec = {
  name: string;
  columns: ColumnSpec[];
  /** ORDER BY columns. */
  orderBy?: string[];
  /** "row": every value of a row is stored together (an OLTP-style row store, for contrast). */
  storage?: "row" | "column";
  /** PARTITION BY, as text for the UI (the sim takes the partition from each insert). */
  partitionBy?: string;
  /** Table engine (default plain MergeTree). */
  engine?: Engine;
  settings?: TableSettings;
  indexes?: SkipIndex[];
  projections?: Projection[];
  /**
   * A different engine per partition. Levels with two tables in one depot (source and MV target)
   * use one partition per table.
   */
  partitionEngines?: Record<string, Engine>;
};

export type InsertOptions = {
  partition?: string;
  /** Range of the first sorting-key column in this insert (spread evenly over its sorted granules). */
  keyRange?: [number, number];
  /** Value distribution for every sorting-key column (multi-column keys). */
  dist?: KeyDistribution;
  /** Deduplication token: the hash of the inserted block. */
  token?: string;
  /** Internal: don't emit partCreated yet (insertRows fills the rows first). */
  quiet?: boolean;
  /** Disk / volume the new part is written to. */
  disk?: string;
  /** Stats of non-key columns for granule `g` of `count` (skip indexes, condition cache). */
  cols?: (g: number, count: number) => Record<string, ColumnStats>;
};

/** A filter on one column; `label` is how the SQL shows the value (e.g. a city name for index 2). */
export type Where = { column: string; min: number; max: number; label?: string };
/** `partitions`: the partitions a filter on the partition key leaves (minmax pruning); unset = all. */
export type QuerySpec = { columns: string[]; where?: Where; partitions?: string[]; final?: boolean; orderLimit?: { column: string; n: number } };

/** One box on the shelf: a granule of one column of one part. */
export type BoxRead = { part: string; granule: number; column: string; read: boolean };

export type QueryResult = {
  boxes: BoxRead[];
  boxesRead: number;
  boxesTotal: number;
  granulesRead: number;
  granulesTotal: number;
  partsRead: number;
  partsTotal: number;
  rowsRead: number;
  bytesRead: number;
  bytesTotal: number;
  /** EXPLAIN indexes = 1 style funnel: [stage, parts selected, parts total, granules selected, granules total]. */
  explain: { stage: "Partition" | "PrimaryKey" | "Skip" | "Projection" | "Cache"; name?: string; parts: [number, number]; granules: [number, number] }[];
  /** Per part, the skip index verdict per index block: skip, read (may match) or fp (bloom false positive). */
  skip?: { index: string; parts: { part: string; built: boolean; blocks: ("skip" | "read" | "fp" | "full")[] }[] };
  /** The projection the optimizer picked (in at least one part). */
  projection?: string;
  /** Granules skipped thanks to the query condition cache. */
  cacheSkipped?: number;
  /** For tables with logical rows: what SELECT returns (FINAL applies the engine at read time). */
  rows?: Row[];
};

export type TableEvent =
  | { type: "partCreated"; part: Part }
  | { type: "merged"; part: Part; sources: string[] }
  | { type: "partOutdated"; part: Part }
  | { type: "insertDelayed"; partition: string; activeParts: number }
  | { type: "tooManyParts"; partition: string; activeParts: number }
  | { type: "deduplicated"; token: string }
  | { type: "partitionDropped"; partition: string; parts: Part[] }
  | { type: "mutated"; sources: Part[]; results: Part[] }
  | { type: "lightweightDeleted"; parts: Part[] }
  | { type: "queried"; spec: QuerySpec; result: QueryResult }
  | { type: "rewritten"; changes: Rewrite[] };

export class TooManyPartsError extends Error {
  constructor(public partition: string, public activeParts: number) {
    super(`Too many parts (${activeParts}) in partition ${partition}. Merges are processing significantly slower than inserts`);
  }
}

export class TooManyPartitionsError extends Error {
  constructor(public partitions: number, public limit: number) {
    super(`Too many partitions for single INSERT block (more than ${limit})`);
  }
}

export const partName = (partition: string, minBlock: number, maxBlock: number, level: number, mutation?: number) =>
  `${partition}_${minBlock}_${maxBlock}_${level}${mutation ? `_${mutation}` : ""}`;

/** Split `rows` into granules of at most GRANULE_ROWS, spreading a sorted key range across them. */
export function granulesFor(rows: number, keyRange?: [number, number]): Granule[] {
  const count = Math.max(1, Math.ceil(rows / GRANULE_ROWS));
  const out: Granule[] = [];
  for (let i = 0; i < count; i++) {
    const r = i === count - 1 ? rows - GRANULE_ROWS * (count - 1) : GRANULE_ROWS;
    const g: Granule = { rows: r };
    if (keyRange) {
      const [lo, hi] = keyRange;
      const span = hi - lo;
      g.min = lo + (span * (i * GRANULE_ROWS)) / rows;
      g.max = lo + (span * (i * GRANULE_ROWS + r - 1)) / Math.max(1, rows - 1);
    }
    out.push(g);
  }
  return out;
}

/**
 * Granules for rows sorted by `orderBy`, where each key column takes `dist[col]` distinct values,
 * spread evenly (mixed radix). A later key column's range is exact only while every earlier key
 * column is constant inside the granule; across a boundary it covers its whole domain.
 */
export function sortedGranules(rows: number, orderBy: string[], dist: KeyDistribution): Granule[] {
  const keyCols = orderBy.filter((c) => dist[c] !== undefined);
  const tupleAt = (r: number) => {
    // Position of row r inside the nested blocks of each key column
    const out: number[] = [];
    let start = 0;
    let len = rows;
    for (const c of keyCols) {
      const d = dist[c];
      const idx = Math.min(d - 1, Math.floor(((r - start) * d) / len));
      out.push(idx);
      const blockStart = start + Math.floor((idx * len) / d);
      const blockEnd = start + Math.floor(((idx + 1) * len) / d);
      start = blockStart;
      len = Math.max(1, blockEnd - blockStart);
    }
    return out;
  };
  return granulesFor(rows).map((g, i) => {
    const first = tupleAt(i * GRANULE_ROWS);
    const last = tupleAt(i * GRANULE_ROWS + g.rows - 1);
    const keys: Record<string, [number, number]> = {};
    let prefixConstant = true;
    keyCols.forEach((c, k) => {
      keys[c] = prefixConstant ? [first[k], last[k]] : [0, dist[c] - 1];
      if (first[k] !== last[k]) prefixConstant = false;
    });
    return { ...g, keys, min: keys[keyCols[0]]?.[0], max: keys[keyCols[0]]?.[1] };
  });
}

/** One granule per logical row, with the row's key values as its range. */
export function rowGranules(data: Row[], orderBy: string[]): Granule[] {
  return data.map((r) => {
    const keys: Record<string, [number, number]> = {};
    for (const c of orderBy) if (typeof r[c] === "number") keys[c] = [r[c] as number, r[c] as number];
    const first = orderBy[0] && typeof r[orderBy[0]] === "number" ? (r[orderBy[0]] as number) : undefined;
    return { rows: 1, keys, min: first, max: first };
  });
}

const cacheKey = (part: string, w: Where) => `${part}|${w.column}|${w.min}|${w.max}`;

/** A stable pseudo-random number in [0, 1) for a string (FNV-1a). */
function hash01(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 2 ** 32;
}

export class Table {
  readonly events = new Emitter<TableEvent>();
  readonly parts: Part[] = [];
  private nextBlock = 1;
  private nextMutation = 1;
  private tokens: string[] = [];
  readonly mutations: Mutation[] = [];
  /** Query condition cache: per (part, condition) one bit per granule (0 = no row can match). */
  readonly conditionCache = new Map<string, boolean[]>();

  constructor(readonly spec: TableSpec) {}

  get columns() {
    return this.spec.columns;
  }

  get storage() {
    return this.spec.storage ?? "column";
  }

  get settings() {
    return {
      partsToDelay: this.spec.settings?.partsToDelay ?? PARTS_TO_DELAY,
      partsToThrow: this.spec.settings?.partsToThrow ?? PARTS_TO_THROW,
      maxPartitionsPerInsert: this.spec.settings?.maxPartitionsPerInsert ?? MAX_PARTITIONS_PER_INSERT,
      dedupWindow: this.spec.settings?.dedupWindow ?? 0,
      maxMergeRows: this.spec.settings?.maxMergeRows ?? Infinity,
    };
  }

  /** Switch between row and column storage (World 1's "rotate the table"). */
  setStorage(storage: "row" | "column") {
    this.spec.storage = storage;
  }

  /** Change the sorting key. Parts inserted with a value distribution are re-sorted (recreate + reinsert). */
  setOrderBy(orderBy: string[]) {
    this.spec.orderBy = orderBy;
    for (const p of this.activeParts) if (p.dist) p.granules = sortedGranules(p.rows, orderBy, p.dist);
  }

  /** Compressed bytes per row of a column: sorted data compresses better (equal values side by side). */
  bytesPerRow(col: ColumnSpec) {
    if (!col.raw || !col.ratio) return col.bytesPerRow;
    const sorted = this.spec.orderBy?.[0] === col.name;
    return col.raw / (sorted ? col.ratio.sorted : col.ratio.unsorted);
  }

  /** Compressed and uncompressed size of every column over the active parts. */
  columnSizes() {
    return this.columns.map((c) => {
      // Only the parts that have this column (one table per hall, projections once built)
      const rows = this.activeParts.filter((p) => (!c.only || c.only.includes(p.partition)) && (!c.projection || p.projections?.[c.projection])).reduce((s, p) => s + p.rows, 0);
      return { name: c.name, raw: rows * (c.raw ?? c.bytesPerRow), compressed: rows * this.bytesPerRow(c) };
    });
  }

  /** The engine that applies in a partition. */
  engineOf(partition: string): Engine {
    return this.spec.partitionEngines?.[partition] ?? this.spec.engine ?? { type: "MergeTree" };
  }

  get activeParts() {
    return this.parts.filter((p) => p.active);
  }

  /** Data parts (not patches). */
  get dataParts() {
    return this.activeParts.filter((p) => !p.patch);
  }

  /** What a part's rows look like to a query: masked rows hidden, patches applied on read. */
  visibleRows(p: Part): Row[] {
    const key = this.spec.orderBy ?? [];
    const keyOf = (r: Row) => JSON.stringify(key.map((c) => r[c]));
    const patches = this.activeParts.filter((x) => x.patch?.targets.includes(p.name));
    return (p.data ?? [])
      .filter((_, i) => !p.mask?.includes(i))
      .map((r) => {
        let out = r;
        for (const patch of patches)
          for (const pr of patch.data ?? [])
            if (keyOf(pr) === keyOf(r)) out = { ...out, ...Object.fromEntries(Object.entries(pr).filter(([c]) => !key.includes(c))) };
        return out;
      });
  }

  get partitions() {
    return [...new Set(this.activeParts.map((p) => p.partition))];
  }

  activeCount(partition: string) {
    return this.parts.filter((p) => p.active && p.partition === partition).length;
  }

  private makePart(rows: number, partition: string, options: InsertOptions): Part {
    const block = this.nextBlock++;
    const dist = options.dist;
    return {
      name: partName(partition, block, block, 0),
      partition,
      minBlock: block,
      maxBlock: block,
      level: 0,
      rows,
      granules: dist ? sortedGranules(rows, this.spec.orderBy ?? [], dist) : granulesFor(rows, options.keyRange),
      active: true,
      dist,
      disk: options.disk,
      indexes: (this.spec.indexes ?? []).map((i) => i.name),
    };
  }

  /**
   * Each INSERT block creates one new, immutable part (per partition it touches). Returns null when
   * the block was dropped as a duplicate (same token inside the dedup window).
   */
  insert(rows: number, options: InsertOptions = {}): Part | null {
    const partition = options.partition ?? "all";
    if (options.token && this.settings.dedupWindow > 0) {
      if (this.tokens.includes(options.token)) {
        this.events.emit({ type: "deduplicated", token: options.token });
        return null;
      }
      this.tokens = [...this.tokens, options.token].slice(-this.settings.dedupWindow);
    }
    const active = this.activeCount(partition);
    if (active >= this.settings.partsToThrow) {
      this.events.emit({ type: "tooManyParts", partition, activeParts: active });
      throw new TooManyPartsError(partition, active);
    }
    if (active >= this.settings.partsToDelay) this.events.emit({ type: "insertDelayed", partition, activeParts: active });
    const part = this.makePart(rows, partition, options);
    if (options.cols) part.granules.forEach((g, i) => (g.cols = options.cols!(i, part.granules.length)));
    for (const p of this.spec.projections ?? []) this.buildProjection(part, p);
    this.parts.push(part);
    if (!options.quiet) this.events.emit({ type: "partCreated", part });
    return part;
  }

  /** INSERT of logical rows (one granule per row, so every box is a row). */
  insertRows(rows: Row[], options: InsertOptions = {}): Part | null {
    const part = this.insert(rows.length, { ...options, quiet: true });
    if (!part) return null;
    part.data = collapse(rows, { type: "MergeTree" }, this.spec.orderBy ?? []);
    part.granules = rowGranules(part.data, this.spec.orderBy ?? []);
    this.events.emit({ type: "partCreated", part });
    return part;
  }

  /** One INSERT whose rows fall into several partitions: one part per partition it touches. */
  insertBlock(blocks: { partition: string; rows: number; dist?: KeyDistribution; keyRange?: [number, number] }[]): Part[] {
    const limit = this.settings.maxPartitionsPerInsert;
    const touched = new Set(blocks.map((b) => b.partition));
    if (touched.size > limit) throw new TooManyPartitionsError(touched.size, limit);
    return blocks.map((b) => this.insert(b.rows, { partition: b.partition, dist: b.dist, keyRange: b.keyRange })!);
  }

  /**
   * Merge a contiguous run of active parts of one partition into a new part. The sources become
   * outdated (they linger for `old_parts_lifetime` before deletion; the sim just marks them).
   */
  merge(names: string[]): Part {
    const sources = names.map((n) => {
      const p = this.parts.find((x) => x.name === n && x.active);
      if (!p) throw new Error(`No active part ${n}`);
      return p;
    });
    if (sources.length < 2) throw new Error("A merge needs at least two parts");
    if (sources.length > MAX_PARTS_PER_MERGE) throw new Error(`At most ${MAX_PARTS_PER_MERGE} parts per merge`);
    const partition = sources[0].partition;
    if (sources.some((p) => p.partition !== partition)) throw new Error("Parts never merge across partitions");
    sources.sort((a, b) => a.minBlock - b.minBlock);
    // Contiguous: no other active part of this partition sits between the chosen block ranges
    const between = this.dataParts.filter(
      (p) => p.partition === partition && !sources.includes(p) && p.minBlock > sources[0].minBlock && p.maxBlock < sources[sources.length - 1].maxBlock,
    );
    if (between.length) throw new Error("Only a contiguous range of parts can be merged");

    // Lightweight-deleted rows are physically dropped by the merge
    const rows = sources.reduce((s, p) => s + p.rows - (p.deletedRows ?? 0), 0);
    const mins = sources.flatMap((p) => p.granules.map((g) => g.min)).filter((v): v is number => v !== undefined);
    const maxs = sources.flatMap((p) => p.granules.map((g) => g.max)).filter((v): v is number => v !== undefined);
    const keyRange: [number, number] | undefined = mins.length ? [Math.min(...mins), Math.max(...maxs)] : undefined;
    const dist = sources[0].dist;
    const minBlock = sources[0].minBlock;
    const maxBlock = sources[sources.length - 1].maxBlock;
    const level = Math.max(...sources.map((p) => p.level)) + 1;
    const part: Part = {
      name: partName(partition, minBlock, maxBlock, level),
      partition,
      minBlock,
      maxBlock,
      level,
      rows,
      granules: dist ? sortedGranules(rows, this.spec.orderBy ?? [], dist) : granulesFor(rows, keyRange),
      active: true,
      dist,
    };
    if (sources.some((p) => p.data)) {
      // Engines act here: rows with the same sorting key are replaced / summed / collapsed.
      // Lightweight-deleted rows are dropped and patches are materialized.
      const data = collapse(sources.flatMap((p) => this.visibleRows(p)), this.engineOf(partition), this.spec.orderBy ?? []);
      part.data = data;
      part.rows = data.length;
      part.granules = rowGranules(data, this.spec.orderBy ?? []);
    }
    part.disk = sources[0].disk;
    for (const s of sources) {
      s.active = false;
      this.events.emit({ type: "partOutdated", part: s });
    }
    // Patches whose targets were all merged are now part of the data
    for (const patch of this.activeParts.filter((x) => x.patch && x.patch.targets.every((t) => sources.some((src) => src.name === t)))) patch.active = false;
    const at = this.parts.indexOf(sources[0]);
    this.parts.splice(at, 0, part);
    this.events.emit({ type: "merged", part, sources: sources.map((s) => s.name) });
    return part;
  }

  /**
   * The background merge selector (a simplified SimpleMergeSelector): in each partition, pick the
   * contiguous run of 2–`maxRun` parts that is cheapest per part saved, preferring small young
   * parts, and never producing a part above `maxMergeRows`. Returns the names, or null.
   */
  selectMerge(maxRun = 3): string[] | null {
    let best: { names: string[]; score: number } | null = null;
    for (const partition of this.partitions) {
      const ps = this.dataParts.filter((p) => p.partition === partition).sort((a, b) => a.minBlock - b.minBlock);
      for (let i = 0; i < ps.length; i++)
        for (let len = 2; len <= Math.min(maxRun, ps.length - i); len++) {
          const run = ps.slice(i, i + len);
          const total = run.reduce((s, p) => s + p.rows, 0);
          if (total > this.settings.maxMergeRows) continue;
          const score = total / (len - 1);
          if (!best || score < best.score) best = { names: run.map((p) => p.name), score };
        }
    }
    return best?.names ?? null;
  }

  /** Remove outdated parts (after `old_parts_lifetime` in real ClickHouse). */
  cleanup() {
    for (let i = this.parts.length - 1; i >= 0; i--) if (!this.parts[i].active) this.parts.splice(i, 1);
  }

  /** DROP PARTITION: a metadata operation, the whole partition's parts go at once. */
  dropPartition(partition: string): Part[] {
    const gone = this.activeParts.filter((p) => p.partition === partition);
    for (const p of gone) p.active = false;
    this.cleanup();
    this.events.emit({ type: "partitionDropped", partition, parts: gone });
    return gone;
  }

  /** Lightweight DELETE: rows are masked (`_row_exists`), the parts stay until a merge. */
  lightweightDelete(partition: string): Part[] {
    const hit = this.activeParts.filter((p) => p.partition === partition);
    for (const p of hit) p.deletedRows = p.rows;
    this.events.emit({ type: "lightweightDeleted", parts: hit });
    return hit;
  }

  /**
   * ALTER TABLE … DELETE (a mutation): every part that holds matching rows is rewritten whole.
   * Returns the bytes rewritten. Here the whole partition matches, so the rewritten parts are empty
   * and disappear.
   */
  mutateDelete(partition: string): { rewritten: Part[]; bytes: number } {
    const hit = this.activeParts.filter((p) => p.partition === partition);
    const bytes = hit.reduce((s, p) => s + p.rows * this.columns.reduce((b, c) => b + this.bytesPerRow(c), 0), 0);
    const version = this.nextMutation++;
    const results = hit.map((p) => ({ ...p, name: partName(p.partition, p.minBlock, p.maxBlock, p.level, version), rows: 0, granules: [], mutation: version }));
    for (const p of hit) p.active = false;
    this.cleanup();
    this.events.emit({ type: "mutated", sources: hit, results });
    return { rewritten: hit, bytes };
  }

  /** Replace parts by their rewritten versions (keeping shelf order). */
  private applyRewrites(changes: Rewrite[]) {
    for (const { from, to } of changes) {
      from.active = false;
      if (to) this.parts.splice(this.parts.indexOf(from), 0, to);
    }
    this.cleanup();
    if (changes.length) this.events.emit({ type: "rewritten", changes });
  }

  /**
   * ALTER TABLE … UPDATE / DELETE (a mutation): every part with at least one matching row is
   * rewritten whole, and its name gets the mutation version. `transform` returns the new row, or
   * null to delete it. Key columns can't be updated.
   */
  mutate(command: string, transform: (r: Row) => Row | null, updates: string[] = []): { mutation: Mutation; changes: Rewrite[] } {
    const key = this.spec.orderBy ?? [];
    const bad = updates.find((c) => key.includes(c));
    if (bad) throw new Error(`Cannot UPDATE key column \`${bad}\``);
    const version = this.nextBlock++;
    const changes: Rewrite[] = [];
    for (const p of this.dataParts) {
      const before = this.visibleRows(p);
      const after = before.map(transform);
      if (after.every((r, i) => r !== null && JSON.stringify(r) === JSON.stringify(before[i]))) continue;
      const data = after.filter((r): r is Row => r !== null);
      const to: Part | null = data.length
        ? { ...p, name: partName(p.partition, p.minBlock, p.maxBlock, p.level, version), mutation: version, data, rows: data.length, granules: rowGranules(data, key), mask: undefined, active: true }
        : null;
      changes.push({ from: p, to });
    }
    const mutation: Mutation = { id: `mutation_${version}.txt`, command, partsToDo: changes.length, isDone: changes.length === 0, version, rowsRewritten: changes.reduce((n, c) => n + c.from.rows, 0) };
    this.mutations.push(mutation);
    this.applyRewrites(changes);
    return { mutation, changes };
  }

  /** Lightweight DELETE on logical rows: matching rows are masked in place, nothing is rewritten. */
  deleteRows(match: (r: Row) => boolean): { part: Part; rows: number[] }[] {
    const out: { part: Part; rows: number[] }[] = [];
    for (const p of this.dataParts) {
      const idx = (p.data ?? []).map((r, i) => (match(r) && !p.mask?.includes(i) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      p.mask = [...(p.mask ?? []), ...idx];
      out.push({ part: p, rows: idx });
    }
    if (out.length) this.events.emit({ type: "lightweightDeleted", parts: out.map((o) => o.part) });
    return out;
  }

  /** Lightweight UPDATE: a small patch part with the key and the changed columns of matching rows. */
  patchUpdate(match: (r: Row) => boolean, set: Row): Part | null {
    const key = this.spec.orderBy ?? [];
    const targets: string[] = [];
    const rows: Row[] = [];
    for (const p of this.dataParts)
      for (const r of this.visibleRows(p))
        if (match(r)) {
          if (!targets.includes(p.name)) targets.push(p.name);
          rows.push({ ...Object.fromEntries(key.map((c) => [c, r[c]])), ...set });
        }
    if (!rows.length) return null;
    const block = this.nextBlock++;
    const part: Part = { name: `patch-${partName(targets.length === 1 ? this.parts.find((x) => x.name === targets[0])!.partition : "all", block, block, 0)}`, partition: this.parts.find((x) => x.name === targets[0])!.partition, minBlock: block, maxBlock: block, level: 0, rows: rows.length, granules: rowGranules(rows, key), active: true, data: rows, patch: { targets } };
    this.parts.push(part);
    this.events.emit({ type: "partCreated", part });
    return part;
  }

  /**
   * A TTL merge at day `now`: rows whose `column` + `days` has passed are removed by rewriting their
   * part (level + 1); a part where every row expired is dropped whole.
   */
  ttlMerge(now: number, column: string, days: number): Rewrite[] {
    const changes: Rewrite[] = [];
    for (const p of this.dataParts) {
      const rows = this.visibleRows(p);
      const keep = rows.filter((r) => Number(r[column]) + days > now);
      if (keep.length === rows.length) continue;
      const to: Part | null = keep.length
        ? { ...p, name: partName(p.partition, p.minBlock, p.maxBlock, p.level + 1), level: p.level + 1, data: keep, rows: keep.length, granules: rowGranules(keep, this.spec.orderBy ?? []), mask: undefined, active: true }
        : null;
      changes.push({ from: p, to });
    }
    this.applyRewrites(changes);
    return changes;
  }

  /**
   * A replica fetches a part: an identical copy (same blocks, level and rows) in another partition,
   * which stands for the other replica's disk.
   */
  copyPart(name: string, partition: string): Part {
    const src = this.activeParts.find((p) => p.name === name);
    if (!src) throw new Error(`No active part ${name}`);
    const part: Part = { ...structuredClone(src), partition, name: partName(partition, src.minBlock, src.maxBlock, src.level, src.mutation) };
    this.parts.push(part);
    this.events.emit({ type: "partCreated", part });
    return part;
  }

  /** Move whole parts to another disk / volume (tiered storage). */
  moveParts(names: string[], disk: string): Part[] {
    const moved = this.activeParts.filter((p) => names.includes(p.name) && p.disk !== disk);
    for (const p of moved) p.disk = disk;
    return moved;
  }

  /** The key range a granule covers for a column, if the index knows it. */
  /** ALTER TABLE … ADD INDEX: only parts written from now on get it. */
  addIndex(index: SkipIndex) {
    this.spec.indexes = [...(this.spec.indexes ?? []).filter((i) => i.name !== index.name), index];
    // A redefined index is stale in the old parts
    for (const p of this.activeParts) p.indexes = p.indexes?.filter((n) => n !== index.name);
  }

  /** ALTER TABLE … DROP INDEX. */
  dropIndex(name: string) {
    this.spec.indexes = (this.spec.indexes ?? []).filter((i) => i.name !== name);
    for (const p of this.parts) p.indexes = p.indexes?.filter((n) => n !== name);
  }

  /** ALTER TABLE … MATERIALIZE INDEX (a mutation): build it for the parts that lack it. Returns them. */
  materializeIndex(name: string): Part[] {
    const todo = this.dataParts.filter((p) => !p.indexes?.includes(name));
    for (const p of todo) p.indexes = [...(p.indexes ?? []), name];
    return todo;
  }

  /** ALTER TABLE … ADD PROJECTION: hidden columns appear; only new parts get them until MATERIALIZE. */
  addProjection(proj: Projection) {
    if (this.spec.projections?.some((p) => p.name === proj.name)) return;
    this.spec.projections = [...(this.spec.projections ?? []), proj];
    for (const c of proj.columns) {
      const base = this.columns.find((x) => x.name === c)!;
      this.spec.columns = [...this.spec.columns, { ...base, name: projColumn(proj.name, c), projection: proj.name }];
    }
  }

  /** ALTER TABLE … MATERIALIZE PROJECTION (a mutation): build it inside the parts that lack it. */
  materializeProjection(name: string): Part[] {
    const proj = this.spec.projections?.find((p) => p.name === name);
    if (!proj) return [];
    const todo = this.dataParts.filter((p) => !p.projections?.[name]);
    for (const p of todo) this.buildProjection(p, proj);
    return todo;
  }

  private buildProjection(part: Part, proj: Projection) {
    const distinct = this.columns.find((c) => c.name === proj.orderBy)?.distinct ?? 1000;
    part.projections = { ...(part.projections ?? {}), [proj.name]: sortedGranules(part.rows, [proj.orderBy], { [proj.orderBy]: distinct }) };
  }

  /** Does a column's stats leave room for a value in [min, max]? */
  private mayMatch(st: ColumnStats | undefined, w: Where) {
    if (!st) return true;
    if (st.values) return st.values.some((v) => v >= w.min && v <= w.max);
    return !(st.max < w.min || st.min > w.max);
  }

  /** A skip index's verdict for one index block (`granularity` granules) of a part. */
  private blockVerdict(part: Part, block: number, idx: SkipIndex, w: Where): "skip" | "read" | "fp" | "full" {
    const stats = part.granules.slice(block * idx.granularity, (block + 1) * idx.granularity).map((g) => g.cols?.[idx.column]);
    if (stats.some((st) => !st)) return "read";
    const all = stats as ColumnStats[];
    if (idx.type === "minmax") {
      const lo = Math.min(...all.map((st) => st.min));
      const hi = Math.max(...all.map((st) => st.max));
      return hi < w.min || lo > w.max ? "skip" : "read";
    }
    if (idx.type === "set") {
      if (all.some((st) => !st.values)) return "full";
      const vals = new Set(all.flatMap((st) => st.values!));
      if (vals.size > (idx.n ?? 100)) return "full";
      return [...vals].some((v) => v >= w.min && v <= w.max) ? "read" : "skip";
    }
    // bloom_filter: membership of one value; a hash collision is a false positive
    if (w.min !== w.max) return "read";
    if (all.some((st) => this.mayMatch(st, w))) return "read";
    return hash01(`${part.name}|${block}|${w.min}`) < (idx.fpr ?? 0.025) ? "fp" : "skip";
  }

  private rangeOf(g: Granule, col: string): [number, number] | undefined {
    if (g.keys?.[col]) return g.keys[col];
    if (col === this.spec.orderBy?.[0] && g.min !== undefined && g.max !== undefined) return [g.min, g.max];
    return undefined;
  }

  /**
   * Can the sparse index rule this granule out for the filter? On the first key column, by its
   * range (binary search). On a later key column only when every earlier key column is constant in
   * the granule (generic exclusion search); otherwise the granule must be read.
   */
  private canSkip(g: Granule, w: Where) {
    const orderBy = this.spec.orderBy ?? [];
    const pos = orderBy.indexOf(w.column);
    if (pos < 0) return false;
    for (let k = 0; k < pos; k++) {
      const r = this.rangeOf(g, orderBy[k]);
      if (!r || r[0] !== r[1]) return false;
    }
    const r = this.rangeOf(g, w.column);
    return !!r && (r[1] < w.min || r[0] > w.max);
  }

  /** Which boxes a query opens: only the named columns, and only granules the index can't rule out. */
  plan(spec: QuerySpec): QueryResult {
    const names = new Set(spec.columns);
    for (const c of names) if (!this.columns.some((col) => col.name === c)) throw new Error(`Unknown column ${c}`);
    const boxes: BoxRead[] = [];
    let granulesRead = 0;
    let granulesTotal = 0;
    let partsRead = 0;
    let rowsRead = 0;
    let bytesRead = 0;
    let bytesTotal = 0;
    const w = spec.where;
    const rowStore = this.storage === "row";
    const wanted = new Set(names);
    if (w) wanted.add(w.column);
    let afterPartition = { parts: 0, granules: 0 };
    let pk = { parts: 0, granules: 0 };
    let afterSkip = { parts: 0, granules: 0 };
    let cacheSkipped = 0;
    const idx = w ? (this.spec.indexes ?? []).find((i) => i.column === w.column) : undefined;
    const proj = w ? (this.spec.projections ?? []).find((p) => p.orderBy === w.column && [...wanted].every((c) => p.columns.includes(c))) : undefined;
    const useCache = !!w && this.spec.settings?.conditionCache === true;
    const skip: NonNullable<QueryResult["skip"]> | undefined = idx ? { index: idx.name, parts: [] } : undefined;
    let usedProjection = false;
    const count = (xs: boolean[]) => xs.filter(Boolean).length;
    const prewhere = !!w && this.spec.settings?.prewhere !== false;
    // Lazy materialization: for ORDER BY x LIMIT n, only the granules that can hold the top n rows
    // need the other columns (the sort column is read first)
    const ol = spec.orderLimit;
    let top: Set<string> | undefined;
    if (ol && this.spec.settings?.lazyMaterialization !== false) {
      const cands = this.activeParts.flatMap((p) => p.granules.map((g, i) => ({ key: `${p.name}/${i}`, max: g.cols?.[ol.column]?.max ?? Infinity, rows: g.rows })));
      cands.sort((a, b) => b.max - a.max);
      top = new Set();
      let rowsSoFar = 0;
      for (const c of cands) {
        if (rowsSoFar >= ol.n) break;
        top.add(c.key);
        rowsSoFar += c.rows;
      }
    }
    if (ol) wanted.add(ol.column);
    for (const part of this.activeParts) {
      const pruned = spec.partitions !== undefined && !spec.partitions.includes(part.partition);
      if (!pruned) afterPartition = { parts: afterPartition.parts + 1, granules: afterPartition.granules + part.granules.length };
      const match = part.granules.map((g) => !pruned && (!w || !this.canSkip(g, w)));
      if (count(match)) pk = { parts: pk.parts + 1, granules: pk.granules + count(match) };
      if (idx && w) {
        const built = !!part.indexes?.includes(idx.name);
        const blocks: ("skip" | "read" | "fp" | "full")[] = [];
        if (built)
          for (let b = 0; b * idx.granularity < part.granules.length; b++) {
            const v = this.blockVerdict(part, b, idx, w);
            blocks.push(v);
            if (v === "skip") for (let i = b * idx.granularity; i < Math.min(part.granules.length, (b + 1) * idx.granularity); i++) match[i] = false;
          }
        skip!.parts.push({ part: part.name, built, blocks });
      }
      if (count(match)) afterSkip = { parts: afterSkip.parts + 1, granules: afterSkip.granules + count(match) };
      if (useCache) {
        const bits = this.conditionCache.get(cacheKey(part.name, w!));
        if (bits)
          match.forEach((m, i) => {
            if (m && !bits[i]) {
              match[i] = false;
              cacheSkipped++;
            }
          });
      }
      // The optimizer reads the projection instead when it needs fewer granules
      const pgs = proj ? part.projections?.[proj.name] : undefined;
      const pmatch = pgs ? pgs.map((g) => !pruned && !(g.keys![proj!.orderBy][1] < w!.min || g.keys![proj!.orderBy][0] > w!.max)) : undefined;
      const viaProj = !!pmatch && count(pmatch) < count(match);
      if (viaProj) usedProjection = true;
      const reads = viaProj ? pmatch! : match;
      if (count(reads)) {
        granulesRead += count(reads);
        partsRead++;
      }
      part.granules.forEach((g, i) => {
        granulesTotal++;
        if (reads[i]) rowsRead += g.rows;
        // A filter column is read too (PREWHERE reads it first). A row store can't read one column
        // alone: every value of the row sits in the same box.
        for (const col of this.columns) {
          if (col.projection && !part.projections?.[col.projection]) continue;
          if (col.only && !col.only.includes(part.partition)) continue;
          const name = col.projection ? col.name.slice(col.projection.length + 1) : col.name;
          // PREWHERE: a non-filter column is only read where the filter can match; lazy
          // materialization: only in the granules that can hold the top rows
          const early = col.name === w?.column || col.name === ol?.column;
          const late = (!prewhere || this.mayMatch(g.cols?.[w!.column], w!)) && (!top || top.has(`${part.name}/${i}`));
          const read = col.projection ? viaProj && col.projection === proj!.name && reads[i] && wanted.has(name) : !viaProj && reads[i] && (rowStore || wanted.has(col.name)) && (rowStore || early || late);
          const bytes = g.rows * this.bytesPerRow(col);
          bytesTotal += bytes;
          if (read) bytesRead += bytes;
          boxes.push({ part: part.name, granule: i, column: col.name, read });
        }
      });
    }
    const partsTotal = this.activeParts.length;
    let rows: Row[] | undefined;
    if (this.activeParts.some((p) => p.data)) {
      const scope = this.dataParts.filter((p) => !spec.partitions || spec.partitions.includes(p.partition));
      if (spec.final)
        // FINAL merges at read time, partition by partition
        rows = this.partitions.flatMap((pt) => collapse(scope.filter((p) => p.partition === pt).flatMap((p) => this.visibleRows(p)), this.engineOf(pt), this.spec.orderBy ?? [], true));
      else rows = scope.flatMap((p) => this.visibleRows(p));
    }
    const explain: QueryResult["explain"] = [];
    if (spec.partitions) explain.push({ stage: "Partition", parts: [afterPartition.parts, partsTotal], granules: [afterPartition.granules, granulesTotal] });
    const base = spec.partitions ? afterPartition : { parts: partsTotal, granules: granulesTotal };
    explain.push({ stage: "PrimaryKey", parts: [pk.parts, base.parts], granules: [pk.granules, base.granules] });
    if (idx) explain.push({ stage: "Skip", name: idx.name, parts: [afterSkip.parts, pk.parts], granules: [afterSkip.granules, pk.granules] });
    if (useCache && cacheSkipped) explain.push({ stage: "Cache", parts: [partsRead, afterSkip.parts], granules: [afterSkip.granules - cacheSkipped, afterSkip.granules] });
    if (usedProjection) explain.push({ stage: "Projection", name: proj!.name, parts: [partsRead, partsTotal], granules: [granulesRead, granulesTotal] });
    return { boxes, boxesRead: boxes.filter((b) => b.read).length, boxesTotal: boxes.length, granulesRead, granulesTotal, partsRead, partsTotal, rowsRead, bytesRead, bytesTotal, explain, rows, skip, projection: usedProjection ? proj!.name : undefined, cacheSkipped };
  }

  query(spec: QuerySpec): QueryResult {
    const result = this.plan(spec);
    // The condition cache remembers, per part, which granules can match this filter
    const w = spec.where;
    if (w && this.spec.settings?.conditionCache)
      for (const p of this.activeParts) {
        const key = cacheKey(p.name, w);
        if (!this.conditionCache.has(key)) this.conditionCache.set(key, p.granules.map((g) => this.mayMatch(g.cols?.[w.column], w) && !this.canSkip(g, w)));
      }
    this.events.emit({ type: "queried", spec, result });
    return result;
  }
}
