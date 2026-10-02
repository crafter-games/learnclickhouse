"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowLeft, Coffee, Fire, MapTrifold } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { audioBus } from "@/audio/audioBus";
import { buildReview, type BuiltQuestion } from "@/levels";
import type { Concept } from "@/levels/types";
import { newSeed } from "@/levels/session";
import { dueConcepts, shiftStreak, useProgress } from "@/learning/progress";
import { AudioDirector } from "./AudioDirector";
import { Hud } from "./Hud";
import { RecallQuiz } from "./level/RecallQuiz";
import { gameButtonClass } from "./ui/GameButton";
import { Backdrop } from "./ui/Backdrop";

const noop = () => () => {};

/** Spaced retrieval: a few questions on the concepts due today (Leitner boxes), interleaved. */
export function MorningShift() {
  const t = useTranslations("review");
  const { concepts, shifts, recordReview } = useProgress();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [questions, setQuestions] = useState<BuiltQuestion[] | null>(null);
  const [result, setResult] = useState<{ correct: number; total: number } | null>(null);

  const studied = Object.keys(concepts) as Concept[];
  const due = mounted ? dueConcepts(concepts) : [];
  const weakest = [...studied].sort((a, b) => (concepts[a]?.box ?? 0) - (concepts[b]?.box ?? 0)).slice(0, 3);
  const nextDue = studied.length ? Math.min(...studied.map((c) => concepts[c]!.due)) : 0;

  const start = (list: Concept[]) => {
    audioBus().play("click", { bus: "ui", rate: 1 });
    setResult(null);
    setQuestions(buildReview(list, newSeed()));
  };

  const finish = (answers: boolean[]) => {
    recordReview(questions!.map((q, i) => ({ concept: q.concept, correct: answers[i] })));
    audioBus().play("unlock", { bus: "ui", rate: 1 });
    setResult({ correct: answers.filter(Boolean).length, total: answers.length });
    setQuestions(null);
  };

  return (
    <main className="relative isolate flex min-h-dvh flex-col">
      <Backdrop />
      <AudioDirector intensity={questions ? 0 : 1} />
      <header className="flex items-center justify-between gap-3 px-3 pt-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <Link href="/world" aria-label={t("back")} className={gameButtonClass({ size: "icon" })}>
            <ArrowLeft weight="bold" />
          </Link>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{t("title")}</h1>
        </div>
        <Hud />
      </header>

      {questions ? (
        <RecallQuiz questions={questions} title={t("title")} onFinish={finish} />
      ) : (
        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-lg p-8 text-center">
            <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-amber text-on-amber shadow-[0_3px_0_var(--amber-dark)]">
              <Coffee size={34} weight="fill" />
            </span>
            {mounted && (
              <>
                <p className="mt-4 flex items-center justify-center gap-1.5 font-display text-lg font-bold text-amber-dark">
                  <Fire weight="fill" /> {t("streak", { n: shiftStreak(shifts) })}
                </p>
                {result ? (
                  <>
                    <h2 className="mt-2 font-display text-3xl font-extrabold">{t("done")}</h2>
                    <p className="mt-2 text-lg text-ink-2">{t("score", result)}</p>
                  </>
                ) : studied.length === 0 ? (
                  <>
                    <h2 className="mt-2 font-display text-3xl font-extrabold">{t("emptyTitle")}</h2>
                    <p className="mt-2 text-lg text-ink-2">{t("emptyBody")}</p>
                  </>
                ) : due.length ? (
                  <>
                    <h2 className="mt-2 font-display text-3xl font-extrabold">{t("dueTitle", { n: Math.min(5, due.length) })}</h2>
                    <p className="mt-2 text-lg text-ink-2">{t("dueBody")}</p>
                  </>
                ) : (
                  <>
                    <h2 className="mt-2 font-display text-3xl font-extrabold">{t("caughtUp")}</h2>
                    <p className="mt-2 text-lg text-ink-2">{t("nextOn", { date: new Date(nextDue).toLocaleDateString() })}</p>
                  </>
                )}
                <div className="mt-7 grid gap-2.5">
                  {studied.length > 0 && (
                    <button type="button" onClick={() => start(due.length ? due : weakest)} className={gameButtonClass({ variant: "primary", size: "lg" })}>
                      {due.length && !result ? t("start") : t("practice")}
                    </button>
                  )}
                  <Link href="/world" className={gameButtonClass({ size: "md" })}>
                    <MapTrifold weight="bold" />
                    {t("map")}
                  </Link>
                </div>
                <p className="mt-6 text-sm leading-relaxed text-ink-2">{t("why")}</p>
              </>
            )}
          </motion.div>
        </div>
      )}
    </main>
  );
}
