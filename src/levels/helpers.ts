import type { Table } from "@/sim/table";

/** Box size on the shelf for a column's compression ratio (1 = uncompressed look). */
export function boxSizes(table: Table) {
  const out: Record<string, number> = {};
  for (const c of table.columns) {
    const ratio = (c.raw ?? c.bytesPerRow) / table.bytesPerRow(c);
    out[c.name] = Math.min(1, 0.5 + 0.5 * Math.sqrt(2 / ratio));
  }
  return out;
}

