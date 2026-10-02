"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { CaretLeft, CaretRight, Check, Coffee, Fire, LockSimple, Package, Play, Star } from "@phosphor-icons/react";
import { Link, useRouter } from "@/i18n/navigation";
import { audioBus } from "@/audio/audioBus";
import { WORLDS } from "@/levels";
import type { Level } from "@/levels/types";
import { dueConcepts, isUnlocked, shiftStreak, useProgress } from "@/learning/progress";
import type { PlotSpec, WorldMapStage } from "@/stage/worldMapStage";
import { AudioDirector } from "./AudioDirector";
import { Hud } from "./Hud";
import { Text } from "./level/parts";
import { gameButtonClass } from "./ui/GameButton";
import { Logo } from "./ui/Logo";
import { UnlockCode } from "./UnlockCode";
import { Backdrop } from "./ui/Backdrop";

const UPCOMING = [] as const;
const noop = () => () => {};

type WorldEntry = { id: number; levels: Level[] };

/** Level-select as a game map: a logistics park with one warehouse per world. */
export function WorldMap() {
  const t = useTranslations("map");
  const router = useRouter();
  const { levels, concepts, shifts } = useProgress();
  // Progress lives in localStorage: build the islands only after mount (avoids a hydration mismatch)
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const host = useRef<HTMLDivElement>(null);
  const stageRef = useRef<WorldMapStage | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const worlds: WorldEntry[] = [...WORLDS.map((w) => ({ id: w.id, levels: [...w.levels] })), ...UPCOMING.map((id) => ({ id, levels: [] }))];
  const all = WORLDS.flatMap((w) => w.levels);
  const nextLevel = mounted ? all.find((l) => isUnlocked(levels, l.id) && !(levels[l.id]?.stars > 0)) : undefined;
  const worldUnlocked = (w: WorldEntry) => mounted && w.levels.length > 0 && isUnlocked(levels, w.levels[0].id);
  const [selected, setSelected] = useState<number | null>(null);
  const current = selected ?? Math.max(0, worlds.findIndex((w) => w.id === (nextLevel?.world ?? 1)));
  const world = worlds[current];
  const due = mounted ? dueConcepts(concepts).length : 0;
  const streak = mounted ? shiftStreak(shifts) : 0;
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  });

  const go = (i: number) => {
    const next = Math.max(0, Math.min(worlds.length - 1, i));
    if (next === current) return;
    audioBus().play("click", { bus: "ui", rate: 0.9 + next * 0.05 });
    setSelected(next);
  };

  // Build the 3D park once progress is known
  useEffect(() => {
    if (!mounted || !host.current) return;
    const el = host.current;
    let stage: WorldMapStage | null = null;
    let cancelled = false;
    const specs: PlotSpec[] = worlds.map((w) => ({
      id: w.id,
      title: t(`w${w.id}.title`),
      locked: !worldUnlocked(w),
      progress: w.levels.length ? w.levels.filter((l) => (levels[l.id]?.stars ?? 0) > 0).length / w.levels.length : 0,
    }));
    void import("@/stage/worldMapStage").then(({ WorldMapStage }) => {
      if (cancelled) return;
      stage = new WorldMapStage(el, specs, (i) => setSelected(i));
      stageRef.current = stage;
      void stage.ready.then(() => {
        if (cancelled) return;
        stage?.select(currentRef.current);
        el.setAttribute("data-ready", "true");
      });
    });
    return () => {
      cancelled = true;
      stage?.dispose();
      stageRef.current = null;
    };
    // Rebuild only when progress changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, JSON.stringify(levels)]);

  useEffect(() => {
    void stageRef.current?.ready.then(() => stageRef.current?.select(current));
  }, [current, mounted]);

  // Frame the plots above the bottom card
  useEffect(() => {
    const measure = () => {
      const top = headerRef.current?.getBoundingClientRect().bottom ?? 0;
      const card = cardRef.current?.getBoundingClientRect();
      stageRef.current?.setInsets({ top, bottom: card ? window.innerHeight - card.top : 0 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (cardRef.current) ro.observe(cardRef.current);
    window.addEventListener("resize", measure);
    const id = setInterval(measure, 500);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      clearInterval(id);
    };
  }, [current, mounted]);

  const playable = world.levels.find((l) => mounted && isUnlocked(levels, l.id) && !(levels[l.id]?.stars > 0)) ?? world.levels.find((l) => mounted && isUnlocked(levels, l.id));
  const unlocked = worldUnlocked(world);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(current + 1);
      if (e.key === "ArrowLeft") go(current - 1);
      if (e.key === "Enter" && unlocked && playable) router.push(`/level/${playable.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Swipe between plots on touch screens
  const touchX = useRef<number | null>(null);

  return (
    <main
      className="relative isolate h-dvh overflow-hidden"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(current + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
    >
      <Backdrop />
      <AudioDirector intensity={1} />
      {/* The map opens from a closed iris (pairs with the landing's wipe) */}
      <div aria-hidden className="iris-open pointer-events-none fixed inset-0 z-50 bg-black" />
      <div ref={host} className="absolute inset-0" data-testid="world-map" />

      <header ref={headerRef} className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-3 pt-3 sm:px-5">
        <Link href="/" aria-label={t("home")} className="pointer-events-auto">
          <Logo />
        </Link>
        <div className="pointer-events-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <Link href="/review" className={`${gameButtonClass({ size: "sm" })} relative`} aria-label={t("shift.title")}>
            <Coffee size={18} weight="fill" className="text-amber-dark" />
            <span className="hidden sm:inline">{t("shift.title")}</span>
            {streak > 0 && (
              <span className="flex items-center gap-0.5 font-display text-amber-dark">
                <Fire size={14} weight="fill" />
                {streak}
              </span>
            )}
            {due > 0 && <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-danger text-[11px] font-extrabold text-white">{due}</span>}
          </Link>
          <UnlockCode />
          <Link href="/play" className={gameButtonClass({ size: "sm" })} aria-label={t("sandbox.title")}>
            <Package size={18} weight="fill" className="text-indigo" />
            <span className="hidden sm:inline">{t("sandbox.title")}</span>
          </Link>
          <Hud />
        </div>
      </header>

      {/* Carousel arrows */}
      {(["prev", "next"] as const).map((dir) => {
        const target = current + (dir === "next" ? 1 : -1);
        const hidden = target < 0 || target >= worlds.length;
        return (
          <div key={dir} className={`absolute top-[38%] z-20 ${dir === "prev" ? "left-3 sm:left-6" : "right-3 sm:right-6"} ${hidden ? "invisible" : ""}`}>
            <button type="button" onClick={() => go(target)} disabled={hidden} aria-label={t(dir)} className={`${gameButtonClass({ size: "icon" })} size-14 rounded-full text-2xl`}>
              {dir === "prev" ? <CaretLeft weight="bold" /> : <CaretRight weight="bold" />}
            </button>
          </div>
        );
      })}

      {/* World card: the selected warehouse's levels as stops on a route */}
      <div ref={cardRef} className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-3xl sm:bottom-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={world.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="card p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-display text-xs font-bold uppercase tracking-[0.14em] text-amber-dark">
                  {t("world", { n: world.id })} · {current + 1}/{worlds.length}
                </p>
                <h1 className="mt-0.5 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{t(`w${world.id}.title`)}</h1>
                <p className="mt-1 line-clamp-3 text-base leading-snug text-ink-2 sm:text-lg">{world.levels.length ? t(`w${world.id}.body`) : t("soonBody")}</p>
              </div>
              {unlocked && playable ? (
                <Link href={`/level/${playable.id}`} className={gameButtonClass({ variant: "primary", size: "md" })}>
                  <Play weight="fill" />
                  {levels[playable.id]?.stars ? t("replay") : t("playLevel", { id: playable.id })}
                </Link>
              ) : (
                <span className="flex items-center gap-1.5 rounded-xl bg-paper-2 px-3 py-2 text-sm font-semibold text-ink-2">
                  <LockSimple weight="bold" />
                  {world.levels.length ? t("worldLocked", { n: world.id - 1 }) : t("soon")}
                </span>
              )}
            </div>

            {world.levels.length > 0 && (
              <ol className="relative mt-5 flex items-start justify-between gap-1">
                <span aria-hidden className="absolute inset-x-6 top-5 h-1 rounded-full bg-paper-2" />
                {world.levels.map((l) => {
                  const open = mounted && isUnlocked(levels, l.id);
                  const stars = levels[l.id]?.stars ?? 0;
                  const isNext = nextLevel?.id === l.id;
                  const node = (
                    <span className="flex flex-col items-center gap-1.5 text-center">
                      <span
                        className={`relative grid size-10 place-items-center rounded-full font-display text-sm font-extrabold transition ${
                          stars ? "bg-read text-on-amber" : isNext ? "bg-amber text-on-amber ring-4 ring-amber/30" : open ? "bg-indigo text-on-amber" : "bg-paper-2 text-ink-2"
                        }`}
                      >
                        {stars ? <Check weight="bold" /> : open ? l.id : <LockSimple weight="bold" />}
                      </span>
                      <span className="flex gap-0.5">
                        {[1, 2, 3].map((n) => (
                          <Star key={n} size={11} weight="fill" className={n <= stars ? "text-amber" : "text-ink/15"} />
                        ))}
                      </span>
                      <span className={`line-clamp-2 max-w-[7.5rem] text-xs font-semibold leading-tight ${open ? "text-ink" : "text-ink-2"}`}>
                        <Text m={l.title} />
                      </span>
                    </span>
                  );
                  return (
                    <li key={l.id} className="relative z-10 flex-1">
                      {open ? (
                        <Link href={`/level/${l.id}`} className="block rounded-xl py-1 transition hover:-translate-y-0.5" aria-label={`${l.id}`}>
                          {node}
                        </Link>
                      ) : (
                        <div className="py-1 opacity-70">{node}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-4 flex justify-center gap-1.5" aria-hidden>
              {worlds.map((w, i) => (
                <button key={w.id} type="button" tabIndex={-1} onClick={() => go(i)} className={`h-2 rounded-full transition-all ${i === current ? "w-6 bg-indigo" : "w-2 bg-ink/20"}`} />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}
