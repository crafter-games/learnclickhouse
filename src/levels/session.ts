import { Table, type QuerySpec } from "@/sim/table";
import { seeded } from "@/lib/rng";
import type { Level, LevelCtx, StageApi, TaskStats } from "./types";

const ZERO: TaskStats = { inserts: 0, queries: 0, goodQueries: 0, orderByChanges: 0 };

export const newSeed = () => Math.floor(Math.random() * 0xffffff);

/** Until the 3D stage is ready, scripted steps wait for it. */
function deferredStage() {
  let resolve!: (api: StageApi) => void;
  const ready = new Promise<StageApi>((r) => (resolve = r));
  const api: StageApi = {
    deliver: (p) => ready.then((s) => s.deliver(p)),
    playQuery: (r) => ready.then((s) => s.playQuery(r)),
    setLayout: (l) => ready.then((s) => s.setLayout(l)),
    setColumnSizes: (sz) => ready.then((s) => s.setColumnSizes(sz)),
    resetBoxes: () => ready.then((s) => s.resetBoxes()),
  };
  return { api, attach: resolve };
}

/** Mutable state of one level run: the table, task counters, the stage bridge. */
export class LevelSession {
  readonly table: Table;
  readonly stats: TaskStats = { ...ZERO };
  stepStart: TaskStats = { ...ZERO };
  readonly ctx: LevelCtx;
  private stage = deferredStage();
  private listeners = new Set<() => void>();

  constructor(level: Level) {
    // A deep copy: levels mutate their table (storage, ORDER BY)
    this.table = new Table(structuredClone(level.table));
    for (const i of level.initial ?? []) this.table.insert(i.rows, i.options);
    const rng = seeded(newSeed());
    this.ctx = {
      table: this.table,
      rng,
      stats: this.stats,
      last: null,
      stage: this.stage.api,
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      insert: async (rows, options) => {
        const part = this.table.insert(rows, options);
        this.stats.inserts++;
        this.changed();
        await this.stage.api.deliver(part);
        return part;
      },
      query: async (spec: QuerySpec) => {
        const result = this.table.query(spec);
        this.ctx.last = { spec, result };
        this.stats.queries++;
        await this.stage.api.playQuery(result);
        this.changed();
        return result;
      },
    };
  }

  attachStage(api: StageApi) {
    this.stage.attach(api);
  }

  /** React re-renders on any change (task progress, panels). */
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  changed() {
    for (const l of this.listeners) l();
  }

  setOrderBy(column: string) {
    if (this.table.spec.orderBy?.[0] === column) return;
    this.table.setOrderBy([column]);
    this.stats.orderByChanges++;
    this.changed();
  }

  /** New step: snapshot counters. */
  markStepStart() {
    this.stepStart = { ...this.stats };
  }
}
