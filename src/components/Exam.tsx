"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowLeft, ArrowCounterClockwise, Certificate, GraduationCap, MapTrifold } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { audioBus } from "@/audio/audioBus";
import { buildExam, EXAM_SIZE, PASS_RATIO, WORLDS, type BuiltQuestion } from "@/levels";
import { newSeed } from "@/levels/session";
import { allComplete, useProgress } from "@/learning/progress";
import { AudioDirector } from "./AudioDirector";
import { Hud } from "./Hud";
import { RecallQuiz } from "./level/RecallQuiz";
import { Backdrop } from "./ui/Backdrop";
import { gameButtonClass } from "./ui/GameButton";

const noop = () => () => {};

/** The final exam: 20 interleaved questions from every completed world; 80% to pass. */
export function Exam() {
  const t = useTranslations("exam");
  const tm = useTranslations("map");
  const { levels, exam, recordExam } = useProgress();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [run, setRun] = useState<{ questions: BuiltQuestion[]; worlds: number[] } | null>(null);
  const [result, setResult] = useState<{ answers: boolean[]; worlds: number[] } | null>(null);

  const done = mounted ? Object.keys(levels).filter((id) => (levels[id]?.stars ?? 0) > 0) : [];
  const worldsDone = WORLDS.filter((w) => w.levels.some((l) => done.includes(l.id))).length;
  const complete = mounted && allComplete(levels);

  const start = () => {
    audioBus().play("click", { bus: "ui", rate: 1 });
    setResult(null);
    setRun(buildExam(done, newSeed()));
  };

  const finish = (answers: boolean[]) => {
    recordExam(run!.questions.map((q, i) => ({ concept: q.concept, correct: answers[i] })));
    const passed = answers.filter(Boolean).length / answers.length >= PASS_RATIO;
    audioBus().play(passed ? "unlock" : "wrong", { bus: "ui", rate: 1 });
    setResult({ answers, worlds: run!.worlds });
    setRun(null);
  };

  const correct = result ? result.answers.filter(Boolean).length : 0;
  const passed = result ? correct / result.answers.length >= PASS_RATIO : false;
  const perWorld = result
    ? [...new Set(result.worlds)].sort((a, b) => a - b).map((w) => {
        const idx = result.worlds.map((x, i) => (x === w ? i : -1)).filter((i) => i >= 0);
        return { w, total: idx.length, ok: idx.filter((i) => result.answers[i]).length };
      })
    : [];

  return (
    <main className="relative isolate flex min-h-dvh flex-col">
      <Backdrop />
      <AudioDirector intensity={run ? 2 : 1} />
      <header className="flex items-center justify-between gap-3 px-3 pt-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <Link href="/world" aria-label={t("back")} className={gameButtonClass({ size: "icon" })}>
            <ArrowLeft weight="bold" />
          </Link>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        </div>
        <Hud />
      </header>

      {run ? (
        <RecallQuiz questions={run.questions} title={t("title")} onFinish={finish} />
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card card--accent w-full max-w-xl p-7 text-center sm:p-9">
            <span className={`mx-auto grid size-16 place-items-center rounded-2xl ${result ? (passed ? "bg-read text-on-amber" : "bg-danger text-white") : "bg-amber text-on-amber"} shadow-[0_3px_0_rgba(0,0,0,0.35)]`}>
              <GraduationCap size={34} weight="fill" />
            </span>
            {mounted && result ? (
              <>
                <p className="mt-4 font-display text-6xl font-extrabold">
                  {correct}
                  <span className="text-3xl text-ink-2">/{result.answers.length}</span>
                </p>
                <h2 className={`mt-1 font-display text-2xl font-extrabold ${passed ? "text-read" : "text-danger"}`}>{passed ? t("passed") : t("failed")}</h2>
                <p className="mt-1 text-ink-2">{passed ? t("passedBody") : t("failedBody")}</p>
                <ul className="mt-5 space-y-1.5 text-left">
                  {perWorld.map(({ w, total, ok }) => (
                    <li key={w} className="flex items-center gap-2 text-sm">
                      <span className="w-48 truncate font-semibold">
                        {w}. {tm(`w${w}.title`)}
                      </span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-paper-2">
                        <motion.span className={`block h-full rounded-full ${ok === total ? "bg-read" : ok === 0 ? "bg-danger" : "bg-amber"}`} initial={{ width: 0 }} animate={{ width: `${(ok / total) * 100}%` }} />
                      </span>
                      <span className="w-9 text-right font-mono text-xs font-bold">
                        {ok}/{total}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : mounted ? (
              <>
                <h2 className="mt-4 font-display text-3xl font-extrabold">{done.length ? t("introTitle", { n: EXAM_SIZE }) : t("emptyTitle")}</h2>
                <p className="mt-2 text-lg leading-snug text-ink-2">{done.length ? t("introBody", { worlds: worldsDone, pass: Math.round(EXAM_SIZE * PASS_RATIO) }) : t("emptyBody")}</p>
                {exam && <p className="mt-3 font-display font-bold text-amber">{t("best", { best: exam.best, total: exam.total })}</p>}
              </>
            ) : null}
            {mounted && (
              <div className="mt-7 grid gap-2.5">
                {done.length > 0 && (
                  <button type="button" onClick={start} className={gameButtonClass({ variant: "primary", size: "lg" })}>
                    {result ? <ArrowCounterClockwise weight="bold" /> : <GraduationCap weight="fill" />}
                    {result ? t("retry") : t("start")}
                  </button>
                )}
                {complete && (
                  <Link href="/finale" className={gameButtonClass({ variant: "accent", size: "md" })}>
                    <Certificate weight="fill" />
                    {t("certificate")}
                  </Link>
                )}
                <Link href="/world" className={gameButtonClass({ size: "md" })}>
                  <MapTrifold weight="bold" />
                  {t("map")}
                </Link>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </main>
  );
}
