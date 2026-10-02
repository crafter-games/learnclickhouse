"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Check, Eye, Package, Robot, Stack, Tag, Warehouse, X, ArrowsDownUp, Database, Rows, Truck, type Icon } from "@phosphor-icons/react";
import type { Input, Msg, Panel } from "@/levels/types";
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
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-ink px-4 py-3 font-mono text-sm leading-relaxed text-paper sm:text-base">
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
    if (String(value) === String(answer)) return "!border-read-dark !bg-read !text-white !shadow-[0_3px_0_var(--read-dark)] disabled:opacity-100 [&_span]:!text-white/85";
    if (String(value) === String(picked)) return "!border-danger !bg-danger !text-white !shadow-[0_3px_0_#a8292d] disabled:opacity-100 animate-shake [&_span]:!text-white/85";
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
        className={`h-14 w-32 rounded-xl border-2 border-line bg-paper-2 px-3 text-center font-mono text-2xl font-bold text-ink outline-none focus:border-indigo focus:bg-white ${state(Number(num))}`}
      />
      <button type="submit" disabled={disabled || num === ""} className={gameButtonClass({ variant: "accent", size: "lg" })}>
        {t("check")}
      </button>
      {picked !== undefined && String(picked) !== String(answer) && <span className="rounded-lg bg-read px-3 py-1.5 font-mono text-xl font-bold text-white">= {answer}</span>}
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
      <p className={`flex items-center gap-2 px-4 py-2 font-display text-lg font-extrabold text-white ${correct ? "bg-read" : "bg-danger"}`}>
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
        <span className={`grid size-28 place-items-center rounded-full text-white shadow-[0_6px_0_rgba(0,0,0,0.18)] ${correct ? "bg-read" : "bg-danger"}`}>
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
type Last = { spec: QuerySpec; result: QueryResult } | null;

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
          <li key={p.name} className="flex justify-between font-mono text-sm">
            <span className="rounded bg-amber/80 px-1.5 font-bold">{p.name}</span>
            <span className="text-ink-2">{t("rows", { rows: new Intl.NumberFormat(locale).format(p.rows) })}</span>
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
              <div className="absolute inset-y-0 left-0 rounded-full bg-ink/10" style={{ width: `${(s.raw / max) * 100}%` }} />
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
                <li key={i} className={`truncate rounded-md px-1.5 py-1 font-mono text-[11px] leading-tight ${on ? "bg-read text-white" : last ? "bg-paper-2 text-ink-2/60" : "bg-paper-2 text-ink"}`} title={`${t("mark")} ${i}`}>
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
        <pre className="overflow-x-auto rounded-xl bg-ink px-3 py-2 font-mono text-[13px] leading-relaxed text-paper">
          {ex.map((e) => `${e.stage}\n  Parts: ${e.parts[0]}/${e.parts[1]}\n  Granules: ${e.granules[0]}/${e.granules[1]}`).join("\n")}
        </pre>
      ) : (
        <p className="text-base leading-snug text-ink-2">{t("noQuery")}</p>
      )}
    </div>
  );
}

export function Panels({ panels, table, last, format }: { panels: Panel[]; table: Table; last: Last; format?: Record<string, (v: number) => string> }) {
  return (
    <div className="space-y-4">
      {panels.map((p) =>
        p === "reading" ? <ReadingPanel key={p} last={last} />
        : p === "parts" ? <PartsPanel key={p} table={table} />
        : p === "partsMeter" ? <PartsMeterPanel key={p} table={table} />
        : p === "index" ? <IndexPanel key={p} table={table} last={last} format={format} />
        : p === "explain" ? <ExplainPanel key={p} last={last} />
        : <CompressionPanel key={p} table={table} />,
      )}
    </div>
  );
}
