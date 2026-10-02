"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { GithubLogo, Play } from "@phosphor-icons/react";
import { useRouter } from "@/i18n/navigation";
import { audioBus } from "@/audio/audioBus";
import { backgroundMusic } from "@/audio/music";
import { GRANULE_ROWS, Table } from "@/sim/table";
import type { DepotStage } from "@/stage/depotStage";
import { AudioDirector } from "./AudioDirector";
import { DepotCanvas } from "./DepotCanvas";
import { Hud } from "./Hud";
import { gameButtonClass } from "./ui/GameButton";
import { Keycap } from "./ui/Keycap";
import { Backdrop } from "./ui/Backdrop";

const IRIS_MS = 650;
const REPO = "https://github.com/crafter-games/learnclickhouse";
const COLS = ["date", "customer_id", "city", "total"];
const DEMO_QUERIES = [["total"], ["city", "total"], ["date"], ["customer_id", "city"], ["total"]];

const demoTable = () => {
  const t = new Table({
    name: "orders",
    orderBy: ["date"],
    columns: COLS.map((name) => ({ name, type: "", bytesPerRow: 1 })),
  });
  t.insert(GRANULE_ROWS * 3 - 900);
  t.insert(GRANULE_ROWS * 2 - 400);
  return t;
};

export function Landing() {
  const t = useTranslations("landing");
  const ts = useTranslations("stage");
  const router = useRouter();
  const [table] = useState(demoTable);
  const stage = useRef<DepotStage | null>(null);
  // Where the iris transition grows from (the button), in px; null = idle
  const [iris, setIris] = useState<{ x: number; y: number } | null>(null);
  const [vh] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));

  // Attract mode: trucks deliver and Pico reads random aisles, silently, forever
  useEffect(() => {
    let alive = true;
    let i = 0;
    const run = async () => {
      while (alive) {
        await new Promise((r) => setTimeout(r, 1800));
        const s = stage.current;
        if (!alive || !s) continue;
        if (i % 3 === 1 && table.activeParts.length < 4) {
          const part = table.insert(GRANULE_ROWS * (2 + (i % 2)) - 700);
          await s.deliver(part);
        } else await s.playQuery(table.plan({ columns: DEMO_QUERIES[i % DEMO_QUERIES.length] }));
        i++;
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [table]);

  const start = useCallback(
    (from?: HTMLElement | null) => {
      if (iris) return;
      audioBus().play("unlock", { bus: "ui", rate: 1 });
      void backgroundMusic().start();
      const r = from?.getBoundingClientRect();
      setIris(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      router.prefetch("/world");
      setTimeout(() => router.push("/world"), IRIS_MS);
    },
    [iris, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        start(document.getElementById("start"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start]);

  return (
    <main className="relative isolate min-h-dvh overflow-hidden">
      <Backdrop />
      <AudioDirector intensity={1} />

      {/* The live warehouse is the backdrop; framed in the lower part so the title reads above it */}
      <div className="absolute inset-0">
        <DepotCanvas
          table={table}
          insets={{ top: vh * 0.5, bottom: 56, left: 24, right: 24 }}
          onReady={(s) => (stage.current = s)}
          labels={{ column: (name) => name, part: (name) => name, dock: ts("dock"), rows: ts("rows", { table: "orders" }) }}
        />
      </div>
      {/* Soft light behind the title + gentle edge vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 22%, color-mix(in oklab, #f6eefa 90%, transparent) 0%, color-mix(in oklab, #f6eefa 50%, transparent) 55%, transparent 100%), radial-gradient(ellipse 120% 90% at 50% 60%, transparent 60%, color-mix(in oklab, var(--ink) 16%, transparent) 100%)",
        }}
      />

      <header className="relative z-10 flex items-center justify-end gap-2 px-4 pt-4 sm:px-6">
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          aria-label={t("github")}
          title={t("github")}
          className="grid size-11 place-items-center rounded-xl bg-ink text-paper shadow-[0_2px_0_rgba(0,0,0,0.25)] transition hover:-translate-y-0.5 hover:bg-indigo-dark"
        >
          <GithubLogo size={22} weight="fill" aria-hidden />
        </a>
        <Hud />
      </header>

      <section className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-4 pt-[5vh] text-center sm:pt-[7vh]">
        <motion.p
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-full bg-ink px-3.5 py-1.5 font-display text-xs font-bold uppercase tracking-[0.16em] text-paper sm:text-sm"
        >
          {t("kicker")}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.15 }}
          className="mt-4 font-display text-[clamp(3rem,10vw,6.5rem)] font-extrabold leading-[0.9] tracking-tight text-ink [text-shadow:0_4px_0_var(--paper)]"
        >
          Column <span className="text-amber [text-shadow:0_4px_0_var(--amber-dark)]">Depot</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="mt-4 max-w-xl text-lg font-semibold leading-snug text-ink sm:text-2xl">
          {t("headline")}
        </motion.p>

        <motion.button
          id="start"
          type="button"
          onClick={(e) => start(e.currentTarget)}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, scale: [1, 1.04, 1] }}
          transition={{ delay: 0.5, scale: { repeat: Infinity, duration: 1.6, ease: "easeInOut", delay: 1.2 } }}
          className={`${gameButtonClass({ variant: "primary", size: "lg" })} mt-8 h-16 px-10 text-2xl`}
        >
          <Play weight="fill" />
          {t("start")}
          <Keycap className="ml-1 border-ink/20 bg-ink/10 text-ink shadow-none max-sm:hidden">Enter</Keycap>
        </motion.button>
      </section>

      <footer className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 px-4 pb-4 sm:flex-row sm:justify-between sm:px-6">
        <a
          href="https://github.com/Jibaru"
          target="_blank"
          rel="noreferrer"
          className="group inline-flex items-center gap-2 rounded-full bg-paper/85 py-1 pl-1 pr-3.5 font-display text-sm font-bold text-ink shadow-[0_2px_0_rgba(43,40,64,0.12)] backdrop-blur transition hover:bg-paper"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://github.com/Jibaru.png?size=64" alt="" width={28} height={28} className="size-7 rounded-full" />
          {t("madeBy")} <span className="text-amber-dark group-hover:underline">Jibaru</span>
        </a>
        <p className="rounded-full bg-paper/75 px-3 py-1 text-center text-xs text-ink-2 backdrop-blur sm:text-right">
          {t("credits")}{" "}
          <a href={`${REPO}/blob/main/CREDITS.md`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2 hover:text-ink">
            CREDITS.md
          </a>
        </p>
      </footer>

      {/* Iris wipe into the world map */}
      {iris && (
        <motion.div
          aria-hidden
          className="fixed inset-0 z-50 bg-ink"
          initial={{ clipPath: `circle(0px at ${iris.x}px ${iris.y}px)` }}
          animate={{ clipPath: `circle(150vmax at ${iris.x}px ${iris.y}px)` }}
          transition={{ duration: IRIS_MS / 1000, ease: [0.7, 0, 0.84, 0] }}
        />
      )}
    </main>
  );
}
