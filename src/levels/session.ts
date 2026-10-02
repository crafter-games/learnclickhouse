import { GRANULE_ROWS, Table, TooManyPartitionsError, TooManyPartsError, type InsertOptions, type KeyDistribution, type Part, type QuerySpec } from "@/sim/table";
import { seeded } from "@/lib/rng";
import type { Level, LevelCtx, StageApi, TaskStats } from "./types";

const ZERO: TaskStats = { inserts: 0, queries: 0, goodQueries: 0, orderByChanges: 0, merges: 0, rejected: 0, delayed: 0, dedupHits: 0, calm: 0, flushes: 0, drops: 0, mutations: 0, lwDeletes: 0, actions: 0, rewrittenRows: 0, patches: 0, ttlMerges: 0, moves: 0 };

export const newSeed = () => Math.floor(Math.random() * 0xffffff);

/** Until the 3D stage is ready, scripted steps wait for it. */
function deferredStage() {
  let resolve!: (api: StageApi) => void;
  const ready = new Promise<StageApi>((r) => (resolve = r));
  const call =
    <K extends keyof StageApi>(k: K) =>
    (...args: Parameters<StageApi[K]>) =>
      ready.then((s) => (s[k] as (...a: Parameters<StageApi[K]>) => ReturnType<StageApi[K]>)(...args));
  const api = {
    deliver: call("deliver"),
    playQuery: call("playQuery"),
    setLayout: call("setLayout"),
    setColumnSizes: call("setColumnSizes"),
    resetBoxes: call("resetBoxes"),
    merge: call("merge"),
    turnAway: call("turnAway"),
    dropParts: call("dropParts"),
    mutateParts: call("mutateParts"),
    maskParts: call("maskParts"),
    setBuffer: (rows: number | null) => void ready.then((s) => s.setBuffer(rows)),
    rewriteParts: call("rewriteParts"),
    maskRows: call("maskRows"),
    moveParts: call("moveParts"),
    fillParts: call("fillParts"),
  } as StageApi;
  return { api, attach: resolve };
}

/** Mutable state of one level run: the table, task counters, background loops, the stage bridge. */
export class LevelSession {
  readonly table: Table;
  readonly stats: TaskStats = { ...ZERO };
  stepStart: TaskStats = { ...ZERO };
  readonly ctx: LevelCtx;
  private stage = deferredStage();
  private listeners = new Set<() => void>();
  /** Background loops belong to the current step: bumping the epoch stops them. */
  private epoch = 0;
  private buffer = { rows: 0, since: 0 };

  constructor(level: Level) {
    // A deep copy: levels mutate their table (storage, ORDER BY)
    this.table = new Table(structuredClone(level.table));
    for (const i of level.initial ?? []) this.table.insert(i.rows, i.options);
    for (const i of level.initialRows ?? []) {
      if (Array.isArray(i)) this.table.insertRows(i);
      else this.table.insertRows(i.rows, i.options);
    }
    level.setup?.(this.table);
    const rng = seeded(newSeed());
    const stage = this.stage.api;
    const ctx: LevelCtx = {
      table: this.table,
      rng,
      stats: this.stats,
      last: null,
      stage,
      settings: { ...(level.settings ?? {}) },
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      insert: async (rows, options = {}) => {
        let part: Part | null;
        try {
          part = this.table.insert(rows, options);
        } catch (e) {
          if (!(e instanceof TooManyPartsError)) throw e;
          this.stats.rejected++;
          this.changed();
          await stage.turnAway("rejected");
          return null;
        }
        if (!part) {
          this.stats.dedupHits++;
          this.changed();
          await stage.turnAway("duplicate");
          return null;
        }
        this.stats.inserts++;
        if (this.table.activeCount(part.partition) > this.table.settings.partsToDelay) this.stats.delayed++;
        this.changed();
        await stage.deliver(part, { quick: options.quick });
        return part;
      },
      insertRows: async (rows, options = {}) => {
        const part = this.table.insertRows(rows, options);
        if (!part) {
          this.stats.dedupHits++;
          this.changed();
          await stage.turnAway("duplicate");
          return null;
        }
        this.stats.inserts++;
        this.changed();
        await stage.deliver(part);
        return part;
      },
      show: async (spec, sql, transform) => {
        const result = this.table.query(spec);
        if (transform && result.rows) result.rows = transform(result.rows);
        ctx.last = { spec, result, sql };
        this.stats.queries++;
        await stage.playQuery(result);
        this.changed();
        return result;
      },
      insertBlock: async (blocks) => {
        try {
          const parts = this.table.insertBlock(blocks);
          this.stats.inserts++;
          this.changed();
          for (const p of parts) await stage.deliver(p, { quick: true });
          return parts;
        } catch (e) {
          if (!(e instanceof TooManyPartitionsError) && !(e instanceof TooManyPartsError)) throw e;
          this.stats.rejected++;
          this.changed();
          await stage.turnAway("rejected");
          return null;
        }
      },
      merge: async (names) => {
        const pick = names ?? this.table.selectMerge();
        if (!pick) return null;
        const patches = this.table.activeParts.filter((p) => p.patch);
        const part = this.table.merge(pick);
        this.stats.merges++;
        this.changed();
        await stage.merge(pick, part);
        // Patch parts fully absorbed by this merge leave the shelf
        const absorbed = patches.filter((p) => !p.active).map((p) => p.name);
        if (absorbed.length) await stage.dropParts(absorbed);
        // Everything cancelled out (SummingMergeTree zeros, Collapsing pairs): the part is empty
        if (part.rows === 0) {
          part.active = false;
          this.table.cleanup();
          await stage.dropParts([part.name]);
          this.changed();
        }
        return part;
      },
      dropPartition: async (partition) => {
        const gone = this.table.dropPartition(partition);
        this.stats.drops++;
        this.changed();
        await stage.dropParts(gone.map((p) => p.name));
      },
      mutateDelete: async (partition) => {
        const names = this.table.activeParts.filter((p) => p.partition === partition).map((p) => p.name);
        const r = this.table.mutateDelete(partition);
        this.stats.mutations++;
        this.changed();
        await stage.mutateParts(names);
        return r.bytes;
      },
      lightweightDelete: async (partition) => {
        const hit = this.table.lightweightDelete(partition);
        this.stats.lwDeletes++;
        this.changed();
        await stage.maskParts(hit.map((p) => p.name));
      },
      mutate: async (command, transform, updates = []) => {
        let out;
        try {
          out = this.table.mutate(command, transform, updates);
        } catch {
          this.stats.rejected++;
          this.changed();
          return null;
        }
        const { mutation, changes } = out;
        this.stats.mutations++;
        // Asynchronous, part by part: parts_to_do counts down as each part is rewritten
        for (const c of changes) {
          await stage.rewriteParts([{ from: c.from.name, to: c.to }]);
          this.stats.rewrittenRows += c.from.rows;
          mutation.partsToDo--;
          this.changed();
        }
        mutation.isDone = true;
        this.changed();
        return mutation;
      },
      deleteRows: async (match) => {
        const hit = this.table.deleteRows(match);
        this.stats.lwDeletes++;
        this.changed();
        for (const h of hit) await stage.maskRows(h.part.name, h.rows);
        return hit.reduce((n, h) => n + h.rows.length, 0);
      },
      patchUpdate: async (match, set) => {
        const part = this.table.patchUpdate(match, set);
        if (!part) return null;
        this.stats.patches++;
        this.changed();
        await stage.deliver(part, { quick: true });
        return part;
      },
      ttlMerge: async (column, days) => {
        const changes = this.table.ttlMerge(Number(ctx.settings.today ?? 0), column, days);
        this.stats.ttlMerges++;
        this.changed();
        if (changes.length) await stage.rewriteParts(changes.map((c) => ({ from: c.from.name, to: c.to })));
        return changes.length;
      },
      moveParts: async (names, disk) => {
        const moved = this.table.moveParts(names, disk);
        this.stats.moves += moved.length;
        this.changed();
        await stage.moveParts(moved.map((p) => p.name));
        return moved.length;
      },
      materialize: async (kind, name) => {
        const parts = kind === "index" ? this.table.materializeIndex(name) : this.table.materializeProjection(name);
        this.stats.mutations++;
        this.changed();
        if (kind === "projection") await stage.fillParts(parts.map((p) => p.name));
        return parts.length;
      },
      query: async (spec: QuerySpec) => {
        const result = this.table.query(spec);
        ctx.last = { spec, result };
        this.stats.queries++;
        await stage.playQuery(result);
        this.changed();
        return result;
      },
      clientInsert: async (rows, options) => {
        // async_insert on: small inserts wait in the server's buffer and leave as one part
        if (ctx.settings.async === true) {
          if (!this.buffer.rows) this.buffer.since = Date.now();
          this.buffer.rows += rows;
          stage.setBuffer(this.buffer.rows);
          this.changed();
          return null;
        }
        return ctx.insert(rows, { quick: true, ...options });
      },
      bg: {
        loop: (ms, fn) => {
          const epoch = this.epoch;
          void (async () => {
            while (epoch === this.epoch) {
              await new Promise((r) => setTimeout(r, ms));
              if (epoch !== this.epoch) break;
              await fn();
            }
          })();
        },
        merger: (ms, maxRun = 3) =>
          ctx.bg.loop(ms, async () => {
            const pick = this.table.selectMerge(maxRun);
            if (pick) await ctx.merge(pick);
          }),
        watch: (ok) =>
          ctx.bg.loop(1000, async () => {
            this.stats.calm = ok() ? this.stats.calm + 1 : 0;
            this.changed();
          }),
        asyncFlusher: (flushMs, maxRows) =>
          ctx.bg.loop(100, async () => {
            if (!this.buffer.rows) return;
            if (Date.now() - this.buffer.since < flushMs && this.buffer.rows < maxRows) return;
            const rows = this.buffer.rows;
            this.buffer.rows = 0;
            stage.setBuffer(0);
            this.stats.flushes++;
            await ctx.insert(rows, { quick: true });
          }),
      },
    };
    this.ctx = ctx;
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

  setOrderBy(orderBy: string) {
    const cols = orderBy.split(",").map((c) => c.trim());
    if ((this.table.spec.orderBy ?? []).join(", ") === cols.join(", ")) return;
    this.table.setOrderBy(cols);
    this.stats.orderByChanges++;
    this.changed();
  }

  setSetting(field: string, value: string | number | boolean) {
    this.ctx.settings[field] = value;
    if (field === "async") this.ctx.stage.setBuffer(value === true ? this.bufferRows : null);
    this.changed();
  }

  recordAction() {
    this.stats.actions++;
    this.changed();
  }

  recordGoodQuery() {
    this.stats.goodQueries++;
    this.changed();
  }

  get bufferRows() {
    return this.buffer.rows;
  }

  /** New step: stop the previous step's background loops and snapshot counters. */
  markStepStart() {
    this.epoch++;
    this.stats.calm = 0;
    this.stepStart = { ...this.stats };
  }

  /** Level unmounted: stop every loop. */
  dispose() {
    this.epoch++;
  }
}

/** Rows for `granules` granules (the last one partly filled). */
export const rowsFor = (granules: number) => Math.max(1, GRANULE_ROWS * granules - 1200);

export type { InsertOptions, KeyDistribution };
