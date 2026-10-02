"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Play, Truck, Package, Eye } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { audioBus } from "@/audio/audioBus";
import { AudioDirector } from "@/components/AudioDirector";
import { DepotCanvas } from "@/components/DepotCanvas";
import { Hud } from "@/components/Hud";
import { useInsets } from "@/components/useInsets";
import { Backdrop } from "@/components/ui/Backdrop";
import { GameButton, gameButtonClass } from "@/components/ui/GameButton";
import { Logo } from "@/components/ui/Logo";
import { GRANULE_ROWS, Table, type QueryResult } from "@/sim/table";
import type { DepotStage } from "@/stage/depotStage";
import type { Intensity } from "@/audio/music";
import { COLUMN_COLORS } from "@/stage/theme";

// M1 (GDD → Milestones): the core verb. Insert → a truck delivers a sealed part; query → Pico reads
// only the aisles (columns) it needs, with a live counter of boxes and bytes read.
const ORDERS = {
  name: "orders",
  orderBy: ["customer_id"],
  columns: [
    { name: "date", type: "Date", bytesPerRow: 0.6 },
    { name: "customer_id", type: "UInt32", bytesPerRow: 2.4 },
    { name: "city", type: "LowCardinality(String)", bytesPerRow: 0.5 },
    { name: "total", type: "Decimal(10,2)", bytesPerRow: 3.1 },
  ],
};
const MAX_PARTS = 5;
const INSERT_GRANULES = [3, 2, 4, 3, 2];

function useBytes() {
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

export function DepotDesk() {
  const t = useTranslations("desk");
  const locale = useLocale();
  const fmt = (n: number) => new Intl.NumberFormat(locale).format(n);
  const bytes = useBytes();
  const [table] = useState(() => new Table(ORDERS));
  const stage = useRef<DepotStage | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [parts, setParts] = useState<{ name: string; rows: number }[]>([]);
  const [selected, setSelected] = useState<string[]>(["total"]);
  const [result, setResult] = useState<{ cols: string[]; r: QueryResult } | null>(null);
  const [intensity, setIntensity] = useState<Intensity>(1);

  const header = useRef<HTMLElement>(null);
  const side = useRef<HTMLElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const objective = useRef<HTMLDivElement>(null);
  const insets = useInsets({ header, side, dock, objective }, [ready]);

  useEffect(() => {
    audioBus().preload();
  }, []);

  // QA hook for the playtest driver
  useEffect(() => {
    (window as unknown as { __TEST__?: unknown }).__TEST__ = { ready, busy, parts: parts.length, result: result?.r ?? null };
  }, [ready, busy, parts, result]);

  const insert = async () => {
    if (busy || parts.length >= MAX_PARTS) return;
    setBusy(true);
    setResult(null);
    void stage.current?.resetBoxes();
    audioBus().play("click", { bus: "ui" });
    const granules = INSERT_GRANULES[parts.length % INSERT_GRANULES.length];
    const rows = GRANULE_ROWS * granules - Math.floor(GRANULE_ROWS * 0.4);
    const part = table.insert(rows)!;
    // The stage animates the delivery (it listens to partCreated); wait for it to finish
    await stage.current?.deliver(part).catch(() => {});
    setParts(table.activeParts.map((p) => ({ name: p.name, rows: p.rows })));
    setBusy(false);
  };

  const query = async () => {
    if (busy || !parts.length || !selected.length) return;
    setBusy(true);
    setResult(null);
    audioBus().play("click", { bus: "ui" });
    const cols = [...selected];
    const r = table.query({ columns: cols });
    setIntensity(2);
    await stage.current?.playQuery(r);
    setIntensity(1);
    // The less Pico read, the higher the chime
    audioBus().play("done", { rate: 1 + (1 - r.boxesRead / r.boxesTotal) * 0.5 });
    setResult({ cols, r });
    setBusy(false);
  };

  const toggle = (c: string) => {
    if (busy) return;
    audioBus().play("click", { bus: "ui", minGapMs: 30 });
    setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : ORDERS.columns.map((x) => x.name).filter((x) => x === c || s.includes(x))));
  };

  const onSound = (sound: string, i = 0) => {
    const a = audioBus();
    if (sound === "read") a.play("read", { rate: 1 + Math.min(12, i) * 0.03, minGapMs: 40 });
    else if (sound === "skip") a.play("skip", { minGapMs: 35, volume: 0.8 });
    else if (sound === "land") a.play("land", { minGapMs: 45, volume: 0.6 });
    else if (sound === "seal") a.play("seal");
    else if (sound === "truck") a.play("truck", { volume: 0.8 });
  };

  // Keyboard: I inserts, R runs the query, 1–4 toggle columns
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (k === "i") void insert();
      else if (k === "r") void query();
      else if (/^[1-4]$/.test(k)) toggle(ORDERS.columns[Number(k) - 1].name);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sql = `SELECT ${selected.length ? selected.join(", ") : "…"}\nFROM orders`;
  const full = parts.length >= MAX_PARTS;
  const pct = result ? Math.round((result.r.bytesRead / result.r.bytesTotal) * 100) : 0;

  return (
    <main className="relative isolate h-dvh overflow-hidden">
      <Backdrop />
      <AudioDirector intensity={intensity} />
      <DepotCanvas
        table={table}
        insets={insets}
        onSound={onSound}
        onReady={(s) => {
          stage.current = s;
          setReady(true);
        }}
        labels={{
          column: (name, type) => `${name}<small>${type}</small>`,
          part: (name) => name,
          dock: t("dock"),
          rows: "orders",
        }}
      />

      {/* Header */}
      <header ref={header} className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link href="/world" aria-label={t("map")} className={gameButtonClass({ size: "icon" })}>
            <ArrowLeft weight="bold" />
          </Link>
          <div className="card flex items-center gap-3 px-3 py-2">
            <Logo />
          </div>
        </div>
        <div className="pointer-events-auto">
          <Hud />
        </div>
      </header>

      {/* Objective bar */}
      <div ref={objective} className="pointer-events-none absolute inset-x-0 top-[72px] z-10 flex justify-center px-3 max-lg:hidden">
        <div className="card px-5 py-3 text-center font-display text-lg font-bold text-ink lg:text-xl">
          {parts.length === 0 ? t("objective.insert") : result ? t("objective.again") : t("objective.query")}
        </div>
      </div>

      {/* Reading panel */}
      <aside ref={side} className="absolute right-3 top-[76px] z-10 w-[min(360px,calc(100vw-24px))] lg:right-4 lg:top-[150px] max-lg:left-3 max-lg:w-auto">
        <div className="card p-4 max-lg:p-3">
          <div className="flex items-center gap-2 font-display text-sm font-extrabold uppercase tracking-wide text-ink-2">
            <Eye weight="bold" /> {t("panel.title")}
          </div>
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div key="r" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-base text-ink-2 lg:text-lg">{t("panel.boxes")}</span>
                  <span className="animate-bump font-display text-2xl font-extrabold lg:text-3xl">
                    {fmt(result.r.boxesRead)} <span className="text-ink-2/70">/ {fmt(result.r.boxesTotal)}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-base text-ink-2 lg:text-lg">{t("panel.bytes")}</span>
                  <span className="font-mono text-lg font-bold lg:text-xl">
                    {bytes(result.r.bytesRead)} <span className="text-ink-2/70">/ {bytes(result.r.bytesTotal)}</span>
                  </span>
                </div>
                <div className="mt-2 h-4 overflow-hidden rounded-full bg-paper-2 outline-1 outline-line">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: "easeOut" }} className="h-full rounded-full bg-read" />
                </div>
                <p className="mt-2 text-base leading-snug text-ink lg:text-lg">{t.rich("panel.verdict", { pct, cols: result.cols.length, all: ORDERS.columns.length, b: (c) => <b>{c}</b> })}</p>
              </motion.div>
            ) : (
              <motion.p key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2 text-base leading-snug text-ink-2 lg:text-lg">
                {parts.length ? t("panel.hintQuery") : t("panel.hintInsert")}
              </motion.p>
            )}
          </AnimatePresence>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-white/10 bg-black/55 text-ink px-3 py-2 font-mono text-sm leading-relaxed lg:text-base max-lg:hidden">{sql}</pre>
          {parts.length > 0 && (
            <div className="mt-3 max-lg:hidden">
              <div className="font-mono text-xs font-bold uppercase text-ink-2">system.parts</div>
              <ul className="mt-1 space-y-1">
                {parts.map((p) => (
                  <li key={p.name} className="flex justify-between font-mono text-sm">
                    <span className="rounded bg-amber px-1.5 font-bold text-on-amber">{p.name}</span>
                    <span className="text-ink-2">{t("panel.rows", { rows: fmt(p.rows) })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>

      {/* Dock */}
      <div ref={dock} className="absolute inset-x-0 bottom-0 z-10 flex justify-center p-3 sm:p-4">
        <div className="card flex flex-wrap items-center justify-center gap-2 p-2.5 sm:gap-3 sm:p-3">
          <GameButton variant="accent" size="lg" onClick={insert} disabled={!ready || busy || full} title={`${t("insert")} (I)`}>
            <Truck weight="fill" size={22} />
            {full ? t("full") : t("insert")}
          </GameButton>
          <div className="flex items-center gap-1.5" role="group" aria-label={t("columns")}>
            {ORDERS.columns.map((c, i) => {
              const on = selected.includes(c.name);
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => toggle(c.name)}
                  aria-pressed={on}
                  title={`${c.name} (${i + 1})`}
                  className={`flex h-14 items-center gap-1.5 rounded-xl border-2 px-3 font-mono text-base font-bold transition-colors max-sm:h-12 max-sm:px-2 max-sm:text-sm ${on ? "border-read-dark !bg-read text-on-amber" : "border-line bg-paper text-ink-2 hover:border-amber/40 hover:bg-paper-2"}`}
                >
                  <span className="size-3 rounded-[3px]" style={{ background: COLUMN_COLORS[i] }} />
                  {c.name}
                </button>
              );
            })}
          </div>
          <GameButton variant="primary" size="lg" onClick={query} disabled={!ready || busy || !parts.length || !selected.length} title={`${t("query")} (R)`}>
            <Play weight="fill" size={22} />
            {t("query")}
          </GameButton>
        </div>
      </div>

      {!ready && (
        <div className="absolute inset-0 z-20 grid place-items-center">
          <div className="card flex items-center gap-3 px-5 py-3 font-display text-lg font-bold">
            <Package className="animate-bounce" weight="fill" /> {t("loading")}
          </div>
        </div>
      )}
    </main>
  );
}
