// MergeTree family engines: what happens to rows with the same sorting key when parts merge
// (or at read time with FINAL). Facts: docs/research/clickhouse-curriculum.md (World 5).

/** A logical row. Aggregate states (AggregatingMergeTree) are arrays of the values seen. */
export type Value = number | string | null | number[];
export type Row = Record<string, Value>;

export type Engine =
  | { type: "MergeTree" }
  /** Keeps the row with the highest `ver` (or the last inserted); `isDeleted` = 1 marks a delete. */
  | { type: "Replacing"; ver?: string; isDeleted?: string }
  /** Sums the numeric non-key columns (or `columns`); a row whose sums are all 0 disappears. */
  | { type: "Summing"; columns?: string[] }
  /** Combines aggregate states (here: uniq states, unions of the values seen). */
  | { type: "Aggregating"; states: string[] }
  /** `sign` = 1 state row, −1 cancel row; pairs cancel. */
  | { type: "Collapsing"; sign: string }
  /** Per column, the latest non-NULL value. */
  | { type: "Coalescing" };

export const engineName = (e: Engine) => (e.type === "MergeTree" ? "MergeTree" : `${e.type}MergeTree`);

const keyOf = (row: Row, orderBy: string[]) => JSON.stringify(orderBy.map((c) => row[c]));

/** Sort rows by the sorting key (numbers numerically, strings lexically). */
export function sortRows(rows: Row[], orderBy: string[]): Row[] {
  return [...rows].sort((a, b) => {
    for (const c of orderBy) {
      const x = a[c], y = b[c];
      if (x === y) continue;
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Apply the engine to rows (in insertion order) that are being merged together. `final` is the
 * read-time view (SELECT … FINAL): it also hides rows ReplacingMergeTree marked as deleted.
 */
export function collapse(rows: Row[], engine: Engine, orderBy: string[], final = false): Row[] {
  if (engine.type === "MergeTree") return sortRows(rows, orderBy);
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(keyOf(r, orderBy), [...(groups.get(keyOf(r, orderBy)) ?? []), r]);
  const out: Row[] = [];
  for (const group of groups.values()) {
    if (engine.type === "Replacing") {
      let best = group[0];
      for (const r of group.slice(1)) if (!engine.ver || Number(r[engine.ver]) >= Number(best[engine.ver])) best = r;
      if (final && engine.isDeleted && Number(best[engine.isDeleted]) === 1) continue;
      out.push(best);
    } else if (engine.type === "Summing") {
      const sum: Row = { ...group[0] };
      const cols = engine.columns ?? Object.keys(sum).filter((c) => !orderBy.includes(c) && typeof sum[c] === "number");
      for (const c of cols) sum[c] = group.reduce((s, r) => s + Number(r[c] ?? 0), 0);
      if (cols.every((c) => sum[c] === 0)) continue;
      out.push(sum);
    } else if (engine.type === "Aggregating") {
      const agg: Row = { ...group[0] };
      for (const c of engine.states) agg[c] = [...new Set(group.flatMap((r) => (Array.isArray(r[c]) ? (r[c] as number[]) : [])))].sort((a, b) => a - b);
      out.push(agg);
    } else if (engine.type === "Collapsing") {
      // Cancel −1 rows against earlier +1 rows of the same key
      const kept: Row[] = [];
      for (const r of group) {
        if (Number(r[engine.sign]) === -1) {
          const i = kept.findIndex((k) => Number(k[engine.sign]) === 1);
          if (i >= 0) {
            kept.splice(i, 1);
            continue;
          }
        }
        kept.push(r);
      }
      out.push(...kept);
    } else {
      const merged: Row = { ...group[0] };
      for (const r of group.slice(1)) for (const [c, v] of Object.entries(r)) if (v !== null && v !== undefined) merged[c] = v;
      out.push(merged);
    }
  }
  return sortRows(out, orderBy);
}

/** argMax(col, ver) per key: the latest value without FINAL. */
export function argMaxByKey(rows: Row[], orderBy: string[], col: string, ver: string): Row[] {
  const best = new Map<string, Row>();
  for (const r of rows) {
    const k = keyOf(r, orderBy);
    const cur = best.get(k);
    if (!cur || Number(r[ver]) >= Number(cur[ver])) best.set(k, r);
  }
  return sortRows([...best.values()].map((r) => ({ ...Object.fromEntries(orderBy.map((c) => [c, r[c]])), [col]: r[col] })), orderBy);
}

/** sum(col) GROUP BY key. */
export function sumByKey(rows: Row[], orderBy: string[], cols: string[], sign?: string): Row[] {
  const acc = new Map<string, Row>();
  for (const r of rows) {
    const k = keyOf(r, orderBy);
    const cur = acc.get(k) ?? Object.fromEntries([...orderBy.map((c) => [c, r[c]]), ...cols.map((c) => [c, 0])]);
    for (const c of cols) cur[c] = Number(cur[c]) + Number(r[c] ?? 0) * (sign ? Number(r[sign]) : 1);
    acc.set(k, cur);
  }
  return sortRows([...acc.values()].filter((r) => cols.some((c) => r[c] !== 0)), orderBy);
}
