"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Check, Eye, Package, Robot, Stack, Tag, Warehouse, X, ArrowsDownUp, Database, Rows, Truck, Gear, Clock, HardDrives, Funnel, Lightning, type Icon } from "@phosphor-icons/react";
import type { Input, Msg, Panel, Setting } from "@/levels/types";
import type { QueryResult, QuerySpec, Table } from "@/sim/table";
import { COLUMN_COLORS } from "@/stage/theme";
import { gameButtonClass } from "../ui/GameButton";

const ICONS: Record<string, Icon> = { package: Package, tag: Tag, robot: Robot, eye: Eye, warehouse: Warehouse, stack: Stack, sort: ArrowsDownUp, database: Database, rows: Rows, truck: Truck };

/** Renders a level message with <b> and <code> rich tags. */
export function Text({ m, className }: { m: Msg; className?: string }) {
  const t = useTranslations("levels");
  return (
    <span className={className}>
      {t.rich(m.key, {
        ...m.values,
        b: (c) => <strong className="font-bold text-ink">{c}</strong>,
        code: (c) => <code className="rounded bg-paper-2 px-1 py-0.5 font-mono text-[0.9em] text-indigo-dark">{c}</code>,
      })}
    </span>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/55 text-ink px-4 py-3 font-mono text-sm leading-relaxed sm:text-base">
      <code>{code}</code>
    </pre>
  );
}

export function MappingCard({ items, big }: { items: { icon: string; thing: Msg; real: Msg }[]; big?: boolean }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper-2/60">
      {items.map((it, i) => {
        const I = ICONS[it.icon] ?? Package;
        return (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 * i }}
            className={`grid items-center gap-2 px-3 leading-snug ${big ? "grid-cols-[28px_1fr_auto_1fr] py-2 text-[1.0625rem] sm:text-[1.2rem]" : "grid-cols-[20px_1fr_auto_1fr] py-1.5 text-[0.9375rem]"}`}
          >
            <I size={big ? 26 : 18} weight="duotone" className="text-amber-dark" />
            <Text m={it.thing} className="text-ink-2" />
            <span className="text-ink/30">→</span>
            <Text m={it.real} className="font-semibold text-indigo-dark" />
          </motion.li>
        );
      })}
    </ul>
  );
}

export function Breaks({ m, big }: { m: Msg; big?: boolean }) {
  const t = useTranslations("level");
  return (
    <p className={`rounded-xl border border-dashed border-amber-dark/50 bg-amber/10 leading-snug text-ink-2 ${big ? "px-4 py-3 text-[1.125rem] sm:text-[1.3rem]" : "px-3 py-2 text-sm"}`}>
      <span className="font-display font-bold text-amber-dark">{t("breaks")} </span>
      <Text m={m} />
    </p>
  );
}

/** The answer UI shared by predictions and the recall check. */
export function AnswerInput({
  input,
  disabled,
  picked,
  answer,
  onAnswer,
  big,
}: {
  big?: boolean;
  input: Input;
  disabled: boolean;
  picked?: string | number;
  answer?: string | number;
  onAnswer: (value: string | number) => void;
}) {
  const t = useTranslations("level");
  const [num, setNum] = useState("");

  const state = (value: string | number) => {
    if (picked === undefined) return "";
    if (String(value) === String(answer)) return "!border-read-dark !bg-read !text-on-amber !shadow-[0_3px_0_var(--read-dark)] disabled:opacity-100 [&_span]:!text-on-amber/70";
    if (String(value) === String(picked)) return "!border-danger !bg-danger !text-white !shadow-[0_3px_0_#a8292d] disabled:opacity-100 animate-shake [&_span]:!text-on-amber/70";
    return "opacity-50";
  };
  const mark = (value: string | number) =>
    picked === undefined ? null : String(value) === String(answer) ? <Check weight="bold" className="ml-auto shrink-0" /> : String(value) === String(picked) ? <X weight="bold" className="ml-auto shrink-0" /> : null;

  if (input.type === "choice") {
    return (
      <div className={`grid gap-2 ${big ? "sm:grid-cols-2 sm:gap-3" : ""}`}>
        {input.options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            data-value={o.id}
            disabled={disabled}
            onClick={() => onAnswer(o.id)}
            className={`${gameButtonClass({ size: "md" })} h-auto min-h-12 justify-start px-4 text-left font-sans font-semibold ${big ? "min-h-14 py-3 text-[1.1875rem] sm:text-[1.3rem]" : "py-2.5 text-[1.0625rem]"} ${state(o.id)}`}
          >
            <span className="font-mono text-sm text-ink-2">{String.fromCharCode(65 + i)}</span>
            <Text m={o.label} />
            {mark(o.id)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <form
      className={`flex flex-wrap items-center gap-2 ${big ? "justify-center" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (num.trim() !== "") onAnswer(Number(num));
      }}
    >
      <label className="sr-only" htmlFor="answer-number">
        {t("yourAnswer")}
      </label>
      <input
        id="answer-number"
        type="number"
        inputMode="numeric"
        min={0}
        autoFocus
        disabled={disabled}
        value={num}
        onChange={(e) => setNum(e.target.value)}
        className={`h-14 w-32 rounded-xl border-2 border-line bg-paper-2 px-3 text-center font-mono text-2xl font-bold text-ink outline-none focus:border-indigo focus:bg-black/40 ${state(Number(num))}`}
      />
      <button type="submit" disabled={disabled || num === ""} className={gameButtonClass({ variant: "accent", size: "lg" })}>
        {t("check")}
      </button>
      {picked !== undefined && String(picked) !== String(answer) && <span className="rounded-lg bg-read px-3 py-1.5 font-mono text-xl font-bold text-on-amber">= {answer}</span>}
    </form>
  );
}

/** Explained feedback after a recall answer. */
export function Feedback({ correct, explain }: { correct: boolean; explain: Msg }) {
  const t = useTranslations("level");
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={correct ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, x: [0, -8, 8, -5, 5, 0] }}
      transition={{ duration: 0.4 }}
      className={`mt-4 overflow-hidden rounded-2xl border-2 text-base leading-snug sm:text-lg ${correct ? "border-read bg-read/10" : "border-danger bg-danger/10"}`}
      role="status"
    >
      <p className={`flex items-center gap-2 px-4 py-2 font-display text-lg font-extrabold ${correct ? "bg-read text-on-amber" : "bg-danger text-white"}`}>
        {correct ? <Check weight="bold" /> : <X weight="bold" />}
        {correct ? t("right") : t("notQuite")}
      </p>
      <Text m={explain} className="block px-4 py-3 text-ink" />
    </motion.div>
  );
}

/** Full-screen verdict: a coloured edge flash and a big ✓ / ✗ stamp that pops, then fades. */
export function Verdict({ correct }: { correct: boolean }) {
  const t = useTranslations("level");
  const color = correct ? "var(--read)" : "var(--danger)";
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 grid place-items-center">
      <motion.div
        className="absolute inset-0"
        style={{ boxShadow: `inset 0 0 0 6px ${color}, inset 0 0 120px 10px color-mix(in oklab, ${color} 45%, transparent)` }}
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 1.1, ease: "easeOut" }}
      />
      <motion.div
        className="flex flex-col items-center gap-2"
        initial={{ scale: 0.3, opacity: 0, rotate: correct ? 0 : -12 }}
        animate={{ scale: [0.3, 1.15, 1, 1], opacity: [0, 1, 1, 0], rotate: 0 }}
        transition={{ duration: 1.2, times: [0, 0.25, 0.4, 1] }}
      >
        <span className={`grid size-28 place-items-center rounded-full shadow-[0_6px_0_rgba(0,0,0,0.3)] ${correct ? "bg-read text-on-amber" : "bg-danger text-white"}`}>
          {correct ? <Check size={64} weight="bold" /> : <X size={64} weight="bold" />}
        </span>
        <span className={`rounded-xl bg-paper px-4 py-1.5 font-display text-2xl font-extrabold shadow ${correct ? "text-read-dark" : "text-danger"}`}>{correct ? t("right") : t("notQuite")}</span>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------- live panels

export function useBytes() {
  const locale = useLocale();
  return (b: number) => {
    const units = ["B", "KiB", "MiB", "GiB"];
    let i = 0;
    while (b >= 1024 && i < units.length - 1) {
      b /= 1024;
      i++;
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: b < 10 ? 1 : 0 }).format(b)} ${units[i]}`;
  };
}

const panelTitle = "mb-1.5 flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-[0.14em] text-ink-2";

/** What the last query read: boxes and bytes, with a bar. */
type Last = { spec: QuerySpec; result: QueryResult; sql?: string } | null;

export function ReadingPanel({ last }: { last: Last }) {
  const t = useTranslations("panels");
  const locale = useLocale();
  const bytes = useBytes();
  if (!last)
    return (
      <div>
        <p className={panelTitle}>
          <Eye weight="bold" /> {t("reading")}
        </p>
        <p className="text-base leading-snug text-ink-2">{t("noQuery")}</p>
      </div>
    );
  const r = last.result;
  const pct = Math.round((r.bytesRead / r.bytesTotal) * 100);
  return (
    <div>
      <p className={panelTitle}>
        <Eye weight="bold" /> {t("reading")}
      </p>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base text-ink-2">{t("boxes")}</span>
        <span key={r.boxesRead} className="animate-bump font-display text-2xl font-extrabold">
          {new Intl.NumberFormat(locale).format(r.boxesRead)} <span className="text-ink-2/70">/ {r.boxesTotal}</span>
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-3">
        <span className="text-base text-ink-2">{t("bytes")}</span>
        <span className="font-mono text-base font-bold">
          {bytes(r.bytesRead)} <span className="text-ink-2/70">/ {bytes(r.bytesTotal)}</span>
        </span>
      </div>
      <div className="mt-2 h-3.5 overflow-hidden rounded-full bg-paper-2 outline-1 outline-line">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} className="h-full rounded-full bg-read" />
      </div>
      <p className="mt-1 text-right font-mono text-sm font-bold text-read-dark">{pct}%</p>
    </div>
  );
}

/** system.parts: the active parts on the shelves. */
export function PartsPanel({ table }: { table: Table }) {
  const t = useTranslations("panels");
  const locale = useLocale();
  return (
    <div>
      <p className={panelTitle}>
        <Database weight="bold" /> system.parts
      </p>
      <ul className="space-y-1">
        {table.activeParts.map((p) => (
          <li key={p.name} className="flex items-center justify-between gap-2 font-mono text-sm">
            <span className={p.patch ? "rounded border border-dashed border-amber px-1.5 font-bold text-amber" : "rounded bg-amber px-1.5 font-bold text-on-amber"}>{p.name}</span>
            <span className="text-right text-ink-2">
              {t("rows", { rows: new Intl.NumberFormat(locale).format(p.rows) })}
              {p.mask?.length ? <span className="ml-1.5 font-bold text-danger">{t("masked", { n: p.mask.length })}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** system.columns: compressed vs uncompressed size per column, plus the current ORDER BY. */
export function CompressionPanel({ table }: { table: Table }) {
  const t = useTranslations("panels");
  const bytes = useBytes();
  const sizes = table.columnSizes();
  const max = Math.max(...sizes.map((s) => s.raw));
  const total = sizes.reduce((s, c) => s + c.compressed, 0);
  return (
    <div>
      <p className={panelTitle}>
        <Database weight="bold" /> system.columns
      </p>
      <p className="mb-2 font-mono text-sm text-ink-2">
        ORDER BY <b className="text-ink">{table.spec.orderBy?.[0]}</b>
      </p>
      <ul className="space-y-2">
        {sizes.map((s, i) => (
          <li key={s.name}>
            <div className="flex items-baseline justify-between font-mono text-sm">
              <span className="flex items-center gap-1.5 font-bold">
                <span className="size-2.5 rounded-[3px]" style={{ background: COLUMN_COLORS[i] }} />
                {s.name}
              </span>
              <span className="text-ink-2">
                {bytes(s.compressed)} <span className="text-ink-2/60">/ {bytes(s.raw)}</span>
              </span>
            </div>
            <div className="relative mt-0.5 h-2.5 overflow-hidden rounded-full bg-paper-2">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/10" style={{ width: `${(s.raw / max) * 100}%` }} />
              <motion.div className="absolute inset-y-0 left-0 rounded-full bg-indigo" animate={{ width: `${(s.compressed / max) * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 24 }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t border-line pt-2 font-display text-base font-bold">
        <span>{t("tableSize")}</span>
        <span key={Math.round(total)} className="animate-bump font-mono">
          {bytes(total)}
        </span>
      </p>
    </div>
  );
}

/** Active parts per partition against the (scaled) delay / throw thresholds. */
export function PartsMeterPanel({ table }: { table: Table }) {
  const t = useTranslations("panels");
  const { partsToDelay, partsToThrow } = table.settings;
  const partitions = table.partitions.length ? table.partitions : ["all"];
  return (
    <div>
      <p className={panelTitle}>
        <Stack weight="bold" /> {t("partsMeter")}
      </p>
      <ul className="space-y-2.5">
        {partitions.map((p) => {
          const n = table.activeCount(p);
          const hot = n >= partsToDelay;
          return (
            <li key={p}>
              <div className="flex items-baseline justify-between font-mono text-sm">
                <span className="font-bold">{p}</span>
                <span key={n} className={`animate-bump font-display text-xl font-extrabold ${n >= partsToThrow ? "text-danger" : hot ? "text-amber-dark" : "text-ink"}`}>
                  {n} <span className="text-sm text-ink-2">/ {partsToThrow}</span>
                </span>
              </div>
              <div className="relative mt-1 h-3.5 overflow-hidden rounded-full bg-paper-2">
                <motion.div className={`h-full rounded-full ${n >= partsToThrow ? "bg-danger" : hot ? "bg-amber" : "bg-read"}`} animate={{ width: `${Math.min(100, (n / partsToThrow) * 100)}%` }} transition={{ type: "spring", stiffness: 220, damping: 26 }} />
                <span className="absolute inset-y-0 w-0.5 bg-amber-dark" style={{ left: `${(partsToDelay / partsToThrow) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-sm leading-snug text-ink-2">{t("partsMeterNote", { delay: partsToDelay, throw: partsToThrow })}</p>
    </div>
  );
}

/** primary.idx: one entry per granule (its first key values); the last query's picks in teal. */
export function IndexPanel({ table, last, format }: { table: Table; last: Last; format?: Record<string, (v: number) => string> }) {
  const t = useTranslations("panels");
  const key = table.spec.orderBy ?? [];
  const read = new Set(last ? last.result.boxes.filter((b) => b.read).map((b) => `${b.part}/${b.granule}`) : []);
  const fmt = (col: string, v: number) => format?.[col]?.(v) ?? String(Math.round(v));
  return (
    <div>
      <p className={panelTitle}>
        <Database weight="bold" /> primary.idx
      </p>
      <p className="mb-2 font-mono text-sm text-ink-2">
        ORDER BY <b className="text-ink">({key.join(", ")})</b>
      </p>
      {table.activeParts.map((p) => (
        <div key={p.name} className="mb-2">
          <p className="mb-1 font-mono text-xs font-bold text-ink-2">{p.name}</p>
          <ol className="grid grid-cols-3 gap-1">
            {p.granules.map((g, i) => {
              const on = last && read.has(`${p.name}/${i}`);
              return (
                <li key={i} className={`truncate rounded-md px-1.5 py-1 font-mono text-[11px] leading-tight ${on ? "bg-read text-on-amber" : last ? "bg-paper-2 text-ink-2/60" : "bg-paper-2 text-ink"}`} title={`${t("mark")} ${i}`}>
                  {key.map((c) => (g.keys?.[c] ? fmt(c, g.keys[c][0]) : g.min !== undefined && c === key[0] ? fmt(c, g.min) : "·")).join(" · ")}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/** EXPLAIN indexes = 1, as the funnel ClickHouse prints. */
export function ExplainPanel({ last }: { last: Last }) {
  const t = useTranslations("panels");
  const ex = last?.result.explain;
  return (
    <div>
      <p className={panelTitle}>
        <Database weight="bold" /> EXPLAIN indexes = 1
      </p>
      {ex ? (
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/55 text-ink px-3 py-2 font-mono text-[13px] leading-relaxed">
          {ex.map((e) => `${e.stage}${e.name ? ` (${e.name})` : ""}\n  Parts: ${e.parts[0]}/${e.parts[1]}\n  Granules: ${e.granules[0]}/${e.granules[1]}`).join("\n")}
        </pre>
      ) : (
        <p className="text-base leading-snug text-ink-2">{t("noQuery")}</p>
      )}
    </div>
  );
}

/** SELECT result for tables with logical rows; rows sharing a sorting key are flagged. */
export function RowsPanel({ table, last }: { table: Table; last: Last }) {
  const t = useTranslations("panels");
  const rows = last?.result.rows;
  const cols = table.columns.map((c) => c.name);
  const key = table.spec.orderBy ?? [];
  const keyOf = (r: Record<string, unknown>) => JSON.stringify(key.map((k) => r[k]));
  const counts = new Map<string, number>();
  for (const r of rows ?? []) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
  const fmt = (v: unknown) => (v === null || v === undefined ? "NULL" : Array.isArray(v) ? `[${v.join(",")}]` : String(v));
  const shown = rows?.length ? Object.keys(rows[0]) : cols;
  return (
    <div>
      <p className={panelTitle}>
        <Rows weight="bold" /> {t("result")}
      </p>
      {last && <pre className="mb-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/55 px-2.5 py-1.5 font-mono text-[12px] leading-snug text-amber">{last.sql ?? `SELECT * FROM ${table.spec.name}${last.spec.final ? " FINAL" : ""}`}</pre>}
      {!rows ? (
        <p className="text-base leading-snug text-ink-2">{t("noQuery")}</p>
      ) : (
        <>
          <table className="w-full font-mono text-[13px]">
            <thead>
              <tr className="text-left text-ink-2">
                {shown.map((c) => (
                  <th key={c} className="px-1 py-0.5 font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const dup = (counts.get(keyOf(r)) ?? 0) > 1;
                return (
                  <tr key={i} className={dup ? "bg-amber/15 text-amber" : "odd:bg-white/5"}>
                    {shown.map((c) => (
                      <td key={c} className="px-1 py-0.5">{fmt(r[c])}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1.5 font-mono text-xs text-ink-2">{t("rowCount", { n: rows.length })}</p>
        </>
      )}
    </div>
  );
}

/** system.query_log for the last query: rows, bytes, duration (granules per thread) and memory. */
export function QueryLogPanel({ last, settings }: { last: Last; settings: Record<string, Setting> }) {
  const t = useTranslations("panels");
  const locale = useLocale();
  const bytes = useBytes();
  const r = last?.result;
  const threads = Number(settings.threads ?? 1);
  const nf = new Intl.NumberFormat(locale);
  const ms = r ? Math.ceil(r.granulesRead / threads) * 40 + Number(settings.extraMs ?? 0) : 0;
  const memory = Number(settings.memory ?? 0);
  const limit = Number(settings.memoryLimit ?? 0);
  const rows: [string, string, boolean?][] = r
    ? [
        ["read_rows", nf.format(r.rowsRead)],
        ["read_bytes", bytes(r.bytesRead)],
        ["query_duration_ms", nf.format(ms)],
        ...(memory ? ([["memory_usage", bytes(memory), limit > 0 && memory > limit]] as [string, string, boolean][]) : []),
      ]
    : [];
  return (
    <div>
      <p className={panelTitle}>
        <Database weight="bold" /> system.query_log
      </p>
      {!r ? (
        <p className="text-base leading-snug text-ink-2">{t("noQuery")}</p>
      ) : (
        <ul className="space-y-1 font-mono text-sm">
          {rows.map(([k, v, bad]) => (
            <li key={k} className="flex justify-between">
              <span className="text-ink-2">{k}</span>
              <span key={v} className={`animate-bump font-bold ${bad ? "text-danger" : "text-ink"}`}>{v}</span>
            </li>
          ))}
          <li className="flex justify-between">
            <span className="text-ink-2">max_threads</span>
            <span className="font-bold text-amber">{threads}</span>
          </li>
        </ul>
      )}
      {limit > 0 && memory > limit && <p className="mt-2 text-sm font-bold text-danger">{t("spilled")}</p>}
    </div>
  );
}

/** The skip index of the last query: one cell per index block and part (skipped, read, false positive). */
export function SkipIndexPanel({ table, last }: { table: Table; last: Last }) {
  const t = useTranslations("panels");
  const skip = last?.result.skip;
  const idx = (table.spec.indexes ?? []).find((i) => i.name === skip?.index) ?? table.spec.indexes?.[0];
  const cell: Record<string, string> = { skip: "bg-paper-2 text-ink-2", read: "bg-read text-on-amber", fp: "bg-danger text-white", full: "bg-amber text-on-amber" };
  return (
    <div>
      <p className={panelTitle}>
        <Funnel weight="bold" /> {t("skipIndex")}
      </p>
      {idx ? (
        <p className="mb-2 rounded-lg bg-black/40 px-2.5 py-1 font-mono text-[12px] text-amber">
          INDEX {idx.name} {idx.column} TYPE {idx.type}
          {idx.type === "set" ? `(${idx.n ?? 100})` : idx.type === "bloom_filter" && idx.fpr !== undefined ? `(${idx.fpr})` : ""} GRANULARITY {idx.granularity}
        </p>
      ) : (
        <p className="mb-2 text-base leading-snug text-ink-2">{t("noIndex")}</p>
      )}
      {skip && (
        <ul className="space-y-1.5">
          {skip.parts.map((p) => (
            <li key={p.part}>
              <p className="font-mono text-xs text-ink-2">{p.part}</p>
              {p.built ? (
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {p.blocks.map((b, i) => (
                    <span key={i} className={`grid h-6 min-w-6 place-items-center rounded px-1 font-mono text-[11px] font-bold ${cell[b]}`}>
                      {b === "fp" ? "FP" : b === "full" ? "∞" : b === "skip" ? "–" : "✓"}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-bold text-amber">{t("notBuilt")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {skip && <p className="mt-2 text-xs leading-snug text-ink-2">{t("skipLegend")}</p>}
    </div>
  );
}

/** Query condition cache: per part, the bits stored for the last query's filter (0 = no match). */
export function CachePanel({ table, last }: { table: Table; last: Last }) {
  const t = useTranslations("panels");
  const w = last?.spec.where;
  return (
    <div>
      <p className={panelTitle}>
        <Lightning weight="bold" /> {t("cache")}
      </p>
      {!w ? (
        <p className="text-base leading-snug text-ink-2">{t("noQuery")}</p>
      ) : (
        <ul className="space-y-1.5">
          {table.activeParts.map((p) => {
            const bits = table.conditionCache.get(`${p.name}|${w.column}|${w.min}|${w.max}`);
            return (
              <li key={p.name}>
                <p className="font-mono text-xs text-ink-2">{p.name}</p>
                {bits ? (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {bits.map((b, i) => (
                      <span key={i} className={`grid h-6 w-6 place-items-center rounded font-mono text-[12px] font-bold ${b ? "bg-read text-on-amber" : "bg-paper-2 text-ink-2"}`}>
                        {b ? 1 : 0}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm font-bold text-amber">{t("cacheMiss")}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!!last?.result.cacheSkipped && <p className="mt-2 text-sm font-bold text-read">{t("cacheSkipped", { n: last.result.cacheSkipped })}</p>}
    </div>
  );
}

/** system.mutations: each ALTER … UPDATE/DELETE, its parts_to_do counting down. */
export function MutationsPanel({ table }: { table: Table }) {
  const rewritten = table.mutations.reduce((n, m) => n + m.rowsRewritten, 0);
  const t = useTranslations("panels");
  return (
    <div>
      <p className={panelTitle}>
        <Gear weight="bold" /> system.mutations
      </p>
      {!table.mutations.length ? (
        <p className="text-base leading-snug text-ink-2">{t("noMutations")}</p>
      ) : (
        <ul className="space-y-2">
          {table.mutations.slice(-3).map((m) => (
            <li key={m.id} className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5">
              <p className="font-mono text-[12px] leading-snug text-amber">{m.command}</p>
              <p className="mt-1 flex justify-between font-mono text-xs">
                <span className="text-ink-2">parts_to_do = <b className="text-ink">{m.partsToDo}</b></span>
                <span className="text-ink-2">{t("rowsShort", { n: m.rowsRewritten })}</span>
                <span className={m.isDone ? "font-bold text-read" : "font-bold text-amber"}>is_done = {m.isDone ? 1 : 0}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 flex items-baseline justify-between text-sm text-ink-2">
        {t("rewritten")} <span key={rewritten} className="animate-bump font-display text-xl font-extrabold text-ink">{rewritten}</span>
      </p>
    </div>
  );
}

/** The depot's calendar for TTL: today, the rule, and rows already expired but still stored. */
export function TtlPanel({ table, settings }: { table: Table; settings: Record<string, Setting> }) {
  const t = useTranslations("panels");
  const today = Number(settings.today ?? 0);
  const column = String(settings.ttlColumn ?? "day");
  const days = Number(settings.ttlDays ?? 30);
  const expired = table.dataParts.reduce((n, p) => n + table.visibleRows(p).filter((r) => Number(r[column]) + days <= today).length, 0);
  return (
    <div>
      <p className={panelTitle}>
        <Clock weight="bold" /> TTL
      </p>
      <p className="flex items-baseline justify-between">
        <span className="text-ink-2">{t("today")}</span>
        <span key={today} className="animate-bump font-display text-3xl font-extrabold text-amber">{t("day", { n: today })}</span>
      </p>
      <p className="mt-1 rounded-lg bg-black/40 px-2.5 py-1 font-mono text-[12px] text-amber">TTL {column} + INTERVAL {days} DAY</p>
      <p className="mt-2 flex items-baseline justify-between text-sm">
        <span className="text-ink-2">{t("expired")}</span>
        <span key={expired} className={`animate-bump font-display text-xl font-extrabold ${expired ? "text-danger" : "text-read"}`}>{expired}</span>
      </p>
    </div>
  );
}

/** Disks of the storage policy: parts on each, with a capacity bar for the hot SSD. */
export function DisksPanel({ table, settings }: { table: Table; settings: Record<string, Setting> }) {
  const t = useTranslations("panels");
  const cap = Number(settings.hotCapacity ?? 4);
  const disks = ["hot", "s3"];
  return (
    <div>
      <p className={panelTitle}>
        <HardDrives weight="bold" /> system.disks
      </p>
      <ul className="space-y-2.5">
        {disks.map((d) => {
          const parts = table.dataParts.filter((p) => (p.disk ?? "hot") === d);
          const full = d === "hot" && parts.length >= cap;
          return (
            <li key={d}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-bold">{t(`disk.${d}`)}</span>
                <span key={parts.length} className={`animate-bump font-display text-xl font-extrabold ${full ? "text-danger" : "text-ink"}`}>
                  {parts.length}
                  {d === "hot" && <span className="text-sm text-ink-2"> / {cap}</span>}
                </span>
              </div>
              {d === "hot" && (
                <div className="mt-1 h-3 overflow-hidden rounded-full bg-paper-2">
                  <motion.div className={`h-full rounded-full ${full ? "bg-danger" : "bg-amber"}`} animate={{ width: `${Math.min(100, (parts.length / cap) * 100)}%` }} />
                </div>
              )}
              <p className="mt-0.5 font-mono text-xs text-ink-2">{parts.map((p) => p.partition).join(" · ") || "—"}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Panels({ panels, table, last, format, settings = {} }: { panels: Panel[]; table: Table; last: Last; format?: Record<string, (v: number) => string>; settings?: Record<string, Setting> }) {
  return (
    <div className="space-y-4">
      {panels.map((p) =>
        p === "reading" ? <ReadingPanel key={p} last={last} />
        : p === "parts" ? <PartsPanel key={p} table={table} />
        : p === "partsMeter" ? <PartsMeterPanel key={p} table={table} />
        : p === "index" ? <IndexPanel key={p} table={table} last={last} format={format} />
        : p === "explain" ? <ExplainPanel key={p} last={last} />
        : p === "rows" ? <RowsPanel key={p} table={table} last={last} />
        : p === "mutations" ? <MutationsPanel key={p} table={table} />
        : p === "ttl" ? <TtlPanel key={p} table={table} settings={settings} />
        : p === "disks" ? <DisksPanel key={p} table={table} settings={settings} />
        : p === "skipIndex" ? <SkipIndexPanel key={p} table={table} last={last} />
        : p === "cache" ? <CachePanel key={p} table={table} last={last} />
        : p === "queryLog" ? <QueryLogPanel key={p} last={last} settings={settings} />
        : <CompressionPanel key={p} table={table} />,
      )}
    </div>
  );
}
