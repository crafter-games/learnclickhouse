// A MergeTree table, simulated. Facts: docs/research/clickhouse-curriculum.md (Worlds 1–4).
// Rows are not stored one by one: a part is a list of granules (≤ 8192 rows each) and, for the
// sorting-key column, each granule knows the key range it covers (the data is sorted inside a part).
import { Emitter } from "./emitter";

/** Rows per granule (`index_granularity`, MergeTreeSettings.cpp). */
export const GRANULE_ROWS = 8192;
/** `parts_to_delay_insert` / `parts_to_throw_insert`: active parts per partition. */
export const PARTS_TO_DELAY = 1000;
export const PARTS_TO_THROW = 3000;
/** `max_parts_to_merge_at_once`. */
export const MAX_PARTS_PER_MERGE = 100;

export type ColumnSpec = {
  name: string;
  type: string;
  /** Average compressed bytes per row on disk (drives "bytes read") when no ratios are given. */
  bytesPerRow: number;
  /** Uncompressed bytes per row and compression ratios (sorted = the table is ordered by this column). */
  raw?: number;
  ratio?: { sorted: number; unsorted: number };
};

export type Granule = { rows: number; min?: number; max?: number };

export type Part = {
  name: string;
  partition: string;
  minBlock: number;
  maxBlock: number;
  /** Merge depth: 0 for a fresh insert, max(sources) + 1 after a merge. */
  level: number;
  rows: number;
  granules: Granule[];
  active: boolean;
};

export type TableSpec = {
  name: string;
  columns: ColumnSpec[];
  /** ORDER BY columns; the first one is used for granule pruning. */
  orderBy?: string[];
  /** "row": every value of a row is stored together (an OLTP-style row store, for contrast). */
  storage?: "row" | "column";
};

export type InsertOptions = {
  partition?: string;
  /** Range of the first sorting-key column in this insert (spread evenly over its sorted granules). */
  keyRange?: [number, number];
};

export type Where = { column: string; min: number; max: number };
export type QuerySpec = { columns: string[]; where?: Where };

/** One box on the shelf: a granule of one column of one part. */
export type BoxRead = { part: string; granule: number; column: string; read: boolean };

export type QueryResult = {
  boxes: BoxRead[];
  boxesRead: number;
  boxesTotal: number;
  granulesRead: number;
  granulesTotal: number;
  rowsRead: number;
  bytesRead: number;
  bytesTotal: number;
};

export type TableEvent =
  | { type: "partCreated"; part: Part }
  | { type: "merged"; part: Part; sources: string[] }
  | { type: "partOutdated"; part: Part }
  | { type: "insertDelayed"; partition: string; activeParts: number }
  | { type: "tooManyParts"; partition: string; activeParts: number }
  | { type: "queried"; spec: QuerySpec; result: QueryResult };

export class TooManyPartsError extends Error {
  constructor(public partition: string, public activeParts: number) {
    super(`Too many parts (${activeParts}) in partition ${partition}. Merges are processing significantly slower than inserts`);
  }
}

export const partName = (partition: string, minBlock: number, maxBlock: number, level: number) => `${partition}_${minBlock}_${maxBlock}_${level}`;

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

export class Table {
  readonly events = new Emitter<TableEvent>();
  readonly parts: Part[] = [];
  private nextBlock = 1;

  constructor(readonly spec: TableSpec) {}

  get columns() {
    return this.spec.columns;
  }

  get storage() {
    return this.spec.storage ?? "column";
  }

  /** Switch between row and column storage (World 1's "rotate the table"). */
  setStorage(storage: "row" | "column") {
    this.spec.storage = storage;
  }

  /** Change the sorting key (affects compression and pruning). */
  setOrderBy(orderBy: string[]) {
    this.spec.orderBy = orderBy;
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

  activeCount(partition: string) {
    return this.parts.filter((p) => p.active && p.partition === partition).length;
  }

  /** Each INSERT block creates one new, immutable part (per partition it touches). */
  insert(rows: number, options: InsertOptions = {}): Part {
    const partition = options.partition ?? "all";
    const active = this.activeCount(partition);
    if (active >= PARTS_TO_THROW) {
      this.events.emit({ type: "tooManyParts", partition, activeParts: active });
      throw new TooManyPartsError(partition, active);
    }
    if (active >= PARTS_TO_DELAY) this.events.emit({ type: "insertDelayed", partition, activeParts: active });
    const block = this.nextBlock++;
    const part: Part = {
      name: partName(partition, block, block, 0),
      partition,
      minBlock: block,
      maxBlock: block,
      level: 0,
      rows,
      granules: granulesFor(rows, options.keyRange),
      active: true,
    };
    this.parts.push(part);
    this.events.emit({ type: "partCreated", part });
    return part;
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

    const rows = sources.reduce((s, p) => s + p.rows, 0);
    const mins = sources.flatMap((p) => p.granules.map((g) => g.min)).filter((v): v is number => v !== undefined);
    const maxs = sources.flatMap((p) => p.granules.map((g) => g.max)).filter((v): v is number => v !== undefined);
    const keyRange: [number, number] | undefined = mins.length ? [Math.min(...mins), Math.max(...maxs)] : undefined;
    const minBlock = sources[0].minBlock;
    const maxBlock = sources[sources.length - 1].maxBlock;
    const level = Math.max(...sources.map((p) => p.level)) + 1;
    const part: Part = { name: partName(partition, minBlock, maxBlock, level), partition, minBlock, maxBlock, level, rows, granules: granulesFor(rows, keyRange), active: true };
    for (const s of sources) {
      s.active = false;
      this.events.emit({ type: "partOutdated", part: s });
    }
    // Keep parts ordered by block number (the shelf order)
    const at = this.parts.indexOf(sources[0]);
    this.parts.splice(at, 0, part);
    this.events.emit({ type: "merged", part, sources: sources.map((s) => s.name) });
    return part;
  }

  /** Remove outdated parts (after `old_parts_lifetime` in real ClickHouse). */
  cleanup() {
    for (let i = this.parts.length - 1; i >= 0; i--) if (!this.parts[i].active) this.parts.splice(i, 1);
  }

  /**
   * Which boxes a query opens: only the columns it names, and — when it filters on the first
   * sorting-key column — only the granules whose key range can match (the sparse index).
   */
  plan(spec: QuerySpec): QueryResult {
    const names = new Set(spec.columns);
    for (const c of names) if (!this.columns.some((col) => col.name === c)) throw new Error(`Unknown column ${c}`);
    const keyColumn = this.spec.orderBy?.[0];
    const boxes: BoxRead[] = [];
    let granulesRead = 0;
    let granulesTotal = 0;
    let rowsRead = 0;
    let bytesRead = 0;
    let bytesTotal = 0;
    for (const part of this.activeParts) {
      part.granules.forEach((g, i) => {
        granulesTotal++;
        const w = spec.where;
        const prunable = w && w.column === keyColumn && g.min !== undefined && g.max !== undefined;
        const match = !prunable || (g.max! >= w!.min && g.min! <= w!.max);
        if (match) {
          granulesRead++;
          rowsRead += g.rows;
        }
        // A filter column is read too (PREWHERE reads it first). A row store can't read one
        // column alone: every value of the row sits in the same box.
        const wanted = new Set(names);
        if (w) wanted.add(w.column);
        const rowStore = this.storage === "row";
        for (const col of this.columns) {
          const read = match && (rowStore || wanted.has(col.name));
          const bytes = g.rows * this.bytesPerRow(col);
          bytesTotal += bytes;
          if (read) bytesRead += bytes;
          boxes.push({ part: part.name, granule: i, column: col.name, read });
        }
      });
    }
    return { boxes, boxesRead: boxes.filter((b) => b.read).length, boxesTotal: boxes.length, granulesRead, granulesTotal, rowsRead, bytesRead, bytesTotal };
  }

  query(spec: QuerySpec): QueryResult {
    const result = this.plan(spec);
    this.events.emit({ type: "queried", spec, result });
    return result;
  }
}
