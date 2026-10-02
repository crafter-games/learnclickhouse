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
  /** Uncompressed bytes per row and compression ratios (sorted = the table is ordered by this column). */
  raw?: number;
  ratio?: { sorted: number; unsorted: number };
};

/** Key range of a granule per sorting-key column: [min, max] (inclusive). */
export type Granule = { rows: number; min?: number; max?: number; keys?: Record<string, [number, number]> };

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
};

export type TableSettings = {
  /** Scaled stand-ins for the real thresholds (the level says which real numbers they represent). */
  partsToDelay?: number;
  partsToThrow?: number;
  maxPartitionsPerInsert?: number;
  /** Insert deduplication window in blocks (`replicated_deduplication_window`; 0 = off). */
  dedupWindow?: number;
  /** Largest part (rows) the background merger will produce (stand-in for 150 GiB). */
  maxMergeRows?: number;
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
};

/** A filter on one column; `label` is how the SQL shows the value (e.g. a city name for index 2). */
export type Where = { column: string; min: number; max: number; label?: string };
/** `partitions`: the partitions a filter on the partition key leaves (minmax pruning); unset = all. */
export type QuerySpec = { columns: string[]; where?: Where; partitions?: string[]; final?: boolean };

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
  explain: { stage: "Partition" | "PrimaryKey"; parts: [number, number]; granules: [number, number] }[];
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
  | { type: "queried"; spec: QuerySpec; result: QueryResult };

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

export class Table {
  readonly events = new Emitter<TableEvent>();
  readonly parts: Part[] = [];
  private nextBlock = 1;
  private nextMutation = 1;
  private tokens: string[] = [];

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
    const rows = this.activeParts.reduce((s, p) => s + p.rows, 0);
    return this.columns.map((c) => ({ name: c.name, raw: rows * (c.raw ?? c.bytesPerRow), compressed: rows * this.bytesPerRow(c) }));
  }

  get activeParts() {
    return this.parts.filter((p) => p.active);
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
    const between = this.activeParts.filter(
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
      // Engines act here: rows with the same sorting key are replaced / summed / collapsed
      const data = collapse(sources.flatMap((p) => p.data ?? []), this.spec.engine ?? { type: "MergeTree" }, this.spec.orderBy ?? []);
      part.data = data;
      part.rows = data.length;
      part.granules = rowGranules(data, this.spec.orderBy ?? []);
    }
    for (const s of sources) {
      s.active = false;
      this.events.emit({ type: "partOutdated", part: s });
    }
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
      const ps = this.activeParts.filter((p) => p.partition === partition).sort((a, b) => a.minBlock - b.minBlock);
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

  /** The key range a granule covers for a column, if the index knows it. */
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
    for (const part of this.activeParts) {
      let partHit = false;
      const pruned = spec.partitions !== undefined && !spec.partitions.includes(part.partition);
      if (!pruned) afterPartition = { parts: afterPartition.parts + 1, granules: afterPartition.granules + part.granules.length };
      part.granules.forEach((g, i) => {
        granulesTotal++;
        const match = !pruned && (!w || !this.canSkip(g, w));
        if (match) {
          granulesRead++;
          rowsRead += g.rows;
          partHit = true;
        }
        // A filter column is read too (PREWHERE reads it first). A row store can't read one column
        // alone: every value of the row sits in the same box.
        for (const col of this.columns) {
          const read = match && (rowStore || wanted.has(col.name));
          const bytes = g.rows * this.bytesPerRow(col);
          bytesTotal += bytes;
          if (read) bytesRead += bytes;
          boxes.push({ part: part.name, granule: i, column: col.name, read });
        }
      });
      if (partHit) partsRead++;
    }
    const partsTotal = this.activeParts.length;
    let rows: Row[] | undefined;
    if (this.activeParts.some((p) => p.data)) {
      const engine = this.spec.engine ?? { type: "MergeTree" as const };
      if (spec.final)
        // FINAL merges at read time, partition by partition
        rows = this.partitions.flatMap((pt) => collapse(this.activeParts.filter((p) => p.partition === pt).flatMap((p) => p.data ?? []), engine, this.spec.orderBy ?? [], true));
      else rows = this.activeParts.flatMap((p) => p.data ?? []);
    }
    const explain: QueryResult["explain"] = [];
    if (spec.partitions) explain.push({ stage: "Partition", parts: [afterPartition.parts, partsTotal], granules: [afterPartition.granules, granulesTotal] });
    const base = spec.partitions ? afterPartition : { parts: partsTotal, granules: granulesTotal };
    explain.push({ stage: "PrimaryKey", parts: [partsRead, base.parts], granules: [granulesRead, base.granules] });
    return { boxes, boxesRead: boxes.filter((b) => b.read).length, boxesTotal: boxes.length, granulesRead, granulesTotal, partsRead, partsTotal, rowsRead, bytesRead, bytesTotal, explain, rows };
  }

  query(spec: QuerySpec): QueryResult {
    const result = this.plan(spec);
    this.events.emit({ type: "queried", spec, result });
    return result;
  }
}
