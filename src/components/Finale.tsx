"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowLeft, DownloadSimple, GraduationCap, MapTrifold, Star, Trophy } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { audioBus } from "@/audio/audioBus";
import { ALL_LEVELS, WORLDS } from "@/levels";
import { allComplete, useProgress } from "@/learning/progress";
import { AudioDirector } from "./AudioDirector";
import { Hud } from "./Hud";
import { Backdrop } from "./ui/Backdrop";
import { gameButtonClass } from "./ui/GameButton";

const noop = () => () => {};
const CONFETTI = ["#faff69", "#3ddbb8", "#8a8cff", "#ff8a65", "#f3f2ec"];
const Y = "#faff69";
const INK = "#f3f2ec";
const DIM = "#a9a9b4";

/** The bar-chart mark from the logo, drawn on the certificate canvas. */
function drawMark(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.fillStyle = Y;
  g.beginPath();
  g.roundRect(x, y, s, s, s * 0.22);
  g.fill();
  g.fillStyle = "#121214";
  const bars: [number, number, number][] = [[0.13, 0.5, 0.38], [0.35, 0.15, 0.73], [0.57, 0.35, 0.53], [0.79, 0.25, 0.63]];
  for (const [bx, by, bh] of bars) {
    g.beginPath();
    g.roundRect(x + bx * s, y + by * s, s * 0.14, bh * s, s * 0.04);
    g.fill();
  }
}

/** Celebration on finishing every level: confetti, a trophy and a personal certificate. */
export function Finale() {
  const t = useTranslations("finale");
  const locale = useLocale();
  const { levels, exam, name, setName } = useProgress();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const complete = mounted && allComplete(levels);
  const stars = ALL_LEVELS.reduce((n, l) => n + (levels[l.id]?.stars ?? 0), 0);
  const missing = ALL_LEVELS.filter((l) => !(levels[l.id]?.stars ?? 0)).length;
  const date = new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (complete) audioBus().play("unlock", { bus: "ui", rate: 0.9 });
  }, [complete]);

  /** The certificate as a 1600×1000 PNG, in the depot's console style. */
  const download = () => {
    audioBus().play("click", { bus: "ui", rate: 1 });
    const display = getComputedStyle(cardRef.current!.querySelector("h2")!).fontFamily;
    const ui = getComputedStyle(cardRef.current!).fontFamily;
    const mono = getComputedStyle(cardRef.current!.querySelector("[data-mono]")!).fontFamily;
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1000;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0e0f13";
    g.fillRect(0, 0, 1600, 1000);
    // Subtle grid like the depot floor
    g.strokeStyle = "rgba(255,255,255,0.04)";
    g.lineWidth = 1;
    for (let x = 0; x <= 1600; x += 40) g.strokeRect(x, 0, 0, 1000);
    for (let y = 0; y <= 1000; y += 40) g.strokeRect(0, y, 1600, 0);
    // Console window
    g.fillStyle = "#18191f";
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(80, 80, 1440, 840, 28);
    g.fill();
    g.stroke();
    // Yellow bottom edge, clipped to the window's rounded corners
    g.save();
    g.clip();
    g.fillStyle = Y;
    g.fillRect(80, 912, 1440, 8);
    g.restore();
    drawMark(g, 130, 130, 72);
    g.textAlign = "left";
    g.fillStyle = INK;
    g.font = `700 40px ${display}`;
    g.fillText("Column", 222, 180);
    g.fillStyle = Y;
    g.fillText("Depot", 222 + g.measureText("Column ").width, 180);
    g.fillStyle = DIM;
    g.font = `600 22px ${mono}`;
    g.fillText(t("kicker").toUpperCase(), 222, 214);
    g.textAlign = "center";
    g.fillStyle = INK;
    g.font = `700 76px ${display}`;
    g.fillText(t("certTitle"), 800, 360);
    g.fillStyle = DIM;
    g.font = `500 32px ${ui}`;
    g.fillText(t("awardedTo"), 800, 440);
    g.fillStyle = Y;
    g.font = `700 96px ${display}`;
    g.fillText(name || t("anonymous"), 800, 550);
    g.fillStyle = DIM;
    g.font = `500 32px ${ui}`;
    g.fillText(t("certBody", { worlds: WORLDS.length, levels: ALL_LEVELS.length }), 800, 630);
    g.fillStyle = INK;
    g.font = `600 34px ${mono}`;
    g.fillText(`★ ${stars} / ${ALL_LEVELS.length * 3}`, 800, 710);
    if (exam?.passed) {
      g.fillStyle = "#3ddbb8";
      g.font = `600 28px ${mono}`;
      g.fillText(t("examPassed", { best: exam.best, total: exam.total }), 800, 765);
    }
    g.fillStyle = DIM;
    g.font = `500 26px ${mono}`;
    g.textAlign = "left";
    g.fillText(date, 140, 860);
    g.textAlign = "right";
    g.fillText(t("madeBy"), 1460, 860);
    // Seal
    g.beginPath();
    g.arc(1390, 190, 78, 0, Math.PI * 2);
    g.fillStyle = exam?.passed ? "#3ddbb8" : Y;
    g.fill();
    g.fillStyle = "#121214";
    g.textAlign = "center";
    g.font = `700 22px ${mono}`;
    g.fillText(exam?.passed ? "EXAM" : `${ALL_LEVELS.length}/${ALL_LEVELS.length}`, 1390, 184);
    g.fillText(exam?.passed ? "PASSED" : "LEVELS", 1390, 212);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `column-depot-${(name || "certificate").replace(/\W+/g, "-").toLowerCase()}.png`;
    a.click();
  };

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <Backdrop />
      <AudioDirector intensity={1} />
      <header className="flex items-center justify-between gap-3 px-3 pt-3 sm:px-5">
        <Link href="/world" aria-label={t("back")} className={gameButtonClass({ size: "icon" })}>
          <ArrowLeft weight="bold" />
        </Link>
        <Hud />
      </header>

      {complete && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-30 overflow-hidden motion-reduce:hidden">
          {Array.from({ length: 70 }, (_, i) => (
            <motion.span
              key={i}
              className="absolute top-0 block h-3 w-2 rounded-[2px]"
              style={{ left: `${(i * 37) % 100}%`, background: CONFETTI[i % CONFETTI.length] }}
              initial={{ y: -40, rotate: 0, opacity: 1 }}
              animate={{ y: "105vh", rotate: 360 * (i % 2 ? 1 : -1) * 2, x: [0, (i % 5) * 12 - 24, 0], opacity: [1, 1, 0.6] }}
              transition={{ duration: 3.5 + (i % 7) * 0.4, delay: (i % 10) * 0.18, ease: "easeIn" }}
            />
          ))}
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-4 py-6">
        {!mounted ? null : complete ? (
          <div className="flex w-full max-w-3xl flex-col items-center text-center">
            <motion.span
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 12 }}
              className="grid size-24 place-items-center rounded-3xl bg-amber text-on-amber shadow-[0_5px_0_var(--amber-dark),0_0_40px_-6px_rgba(250,255,105,0.6)]"
            >
              <Trophy size={56} weight="fill" />
            </motion.span>
            <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">{t("title")}</h1>
            <p className="mt-2 max-w-xl text-lg text-ink-2">{t("body")}</p>

            <label className="mt-5 flex w-full max-w-md flex-col gap-1 text-left">
              <span className="font-mono text-sm font-semibold text-ink-2">{t("nameLabel")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className="h-12 rounded-[10px] border border-white/15 bg-black/40 px-4 font-display text-lg font-bold text-ink outline-none focus:border-amber"
              />
            </label>

            {/* The certificate */}
            <motion.div
              ref={cardRef}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="card card--accent relative mt-6 w-full px-6 py-8 sm:px-12"
            >
              <span className={`absolute right-4 top-4 grid size-20 place-items-center rounded-full text-on-amber ${exam?.passed ? "bg-read" : "bg-amber"}`}>
                <span className="font-mono text-[11px] font-bold leading-tight">
                  {exam?.passed ? "EXAM" : `${ALL_LEVELS.length}/${ALL_LEVELS.length}`}
                  <br />
                  {exam?.passed ? "PASSED" : "LEVELS"}
                </span>
              </span>
              <p data-mono className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-amber">
                {t("kicker")}
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{t("certTitle")}</h2>
              <p className="mt-4 text-ink-2">{t("awardedTo")}</p>
              <p className="mt-1 break-words font-display text-4xl font-bold text-amber sm:text-5xl">{name || t("anonymous")}</p>
              <p className="mt-3 text-ink-2">{t("certBody", { worlds: WORLDS.length, levels: ALL_LEVELS.length })}</p>
              <p className="mt-3 flex items-center justify-center gap-1.5 font-mono text-2xl font-bold text-ink">
                <Star weight="fill" className="text-amber" /> {stars} / {ALL_LEVELS.length * 3}
              </p>
              {exam?.passed ? (
                <p className="mt-1 font-mono font-semibold text-read">{t("examPassed", { best: exam.best, total: exam.total })}</p>
              ) : (
                <Link href="/exam" className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-amber underline underline-offset-2">
                  <GraduationCap weight="fill" /> {t("examTip")}
                </Link>
              )}
              <div className="mt-6 flex justify-between font-mono text-sm text-ink-2">
                <span>{date}</span>
                <span>{t("madeBy")}</span>
              </div>
            </motion.div>

            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              <button type="button" onClick={download} className={gameButtonClass({ variant: "primary", size: "md" })}>
                <DownloadSimple weight="bold" />
                {t("download")}
              </button>
              <Link href="/exam" className={gameButtonClass({ variant: "accent", size: "md" })}>
                <GraduationCap weight="fill" />
                {t("exam")}
              </Link>
              <Link href="/world" className={gameButtonClass({ size: "md" })}>
                <MapTrifold weight="bold" />
                {t("map")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="card w-full max-w-md p-8 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white/10 text-ink-2">
              <Trophy size={34} weight="fill" />
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold">{t("lockedTitle")}</h1>
            <p className="mt-2 text-lg text-ink-2">{t("lockedBody", { n: missing })}</p>
            <Link href="/world" className={`${gameButtonClass({ variant: "primary", size: "md" })} mt-6`}>
              <MapTrifold weight="bold" />
              {t("map")}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
