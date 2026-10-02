"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRight } from "@phosphor-icons/react";
import { audioBus } from "@/audio/audioBus";
import type { BuiltQuestion } from "@/levels";
import { gameButtonClass } from "../ui/GameButton";
import { AnswerInput, CodeBlock, Feedback, Text, Verdict } from "./parts";

/** One question at a time, immediate explained feedback, no stage in sight (testing effect). */
export function RecallQuiz({ questions, title, onFinish }: { questions: BuiltQuestion[]; title: string; onFinish: (answers: boolean[]) => void }) {
  const t = useTranslations("level");
  const [qIndex, setQIndex] = useState(0);
  const [picked, setPicked] = useState<string | number | undefined>(undefined);
  const [answers, setAnswers] = useState<boolean[]>([]);
  const question = questions[qIndex];

  const answer = (value: string | number) => {
    if (picked !== undefined) return;
    const ok = String(value) === String(question.answer);
    setPicked(value);
    setAnswers((a) => [...a, ok]);
    audioBus().play(ok ? "correct" : "wrong", { bus: "ui", rate: 1 });
  };

  const next = () => {
    if (picked === undefined) return;
    if (qIndex < questions.length - 1) {
      setQIndex((i) => i + 1);
      setPicked(undefined);
    } else onFinish(answers);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.target as HTMLElement)?.tagName !== "INPUT") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const prev = window.__TEST__ ?? {};
    window.__TEST__ = { ...prev, question: () => ({ answer: question.answer, input: question.input.type }) };
  });

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 py-6 sm:items-center">
      <motion.div key={qIndex} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-2xl p-6 sm:p-9">
        <div className="flex items-center justify-between">
          <p className="font-display text-xs font-bold uppercase tracking-[0.14em] text-amber-dark">
            {title} · {qIndex + 1}/{questions.length}
          </p>
          {question.review && <span className="rounded-full bg-indigo/10 px-2.5 py-1 font-display text-xs font-bold text-indigo">{t("review")}</span>}
        </div>
        <p className="mt-1 text-base text-ink-2">{t("noPeeking")}</p>
        <h2 className="mt-4 font-display text-2xl font-extrabold leading-snug">
          <Text m={question.prompt} />
        </h2>
        {question.code && (
          <div className="mt-3">
            <CodeBlock code={question.code} />
          </div>
        )}
        <div className="mt-4">
          <AnswerInput key={qIndex} input={question.input} disabled={picked !== undefined} picked={picked} answer={question.answer} onAnswer={answer} />
        </div>
        {picked !== undefined && <Verdict key={qIndex} correct={String(picked) === String(question.answer)} />}
        {picked !== undefined && <Feedback correct={String(picked) === String(question.answer)} explain={question.explain} />}
        <button type="button" onClick={next} disabled={picked === undefined} className={`${gameButtonClass({ variant: "primary", size: "md" })} mt-6 w-full`}>
          {qIndex < questions.length - 1 ? t("next") : t("finish")}
          <ArrowRight weight="bold" />
        </button>
      </motion.div>
    </div>
  );
}
