"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowCounterClockwise, ArrowLeft, ArrowRight, Brain, MapTrifold, Star } from "@phosphor-icons/react";
import { audioBus } from "@/audio/audioBus";
import { backgroundMusic } from "@/audio/music";
import { Link } from "@/i18n/navigation";
import { buildCheck, nextLevel, starsFor, type BuiltQuestion } from "@/levels";
import { boxSizes } from "@/levels/helpers";
import type { Level, Prediction } from "@/levels/types";
import { LevelSession, newSeed } from "@/levels/session";
import { useProgress } from "@/learning/progress";
import { GRANULE_ROWS } from "@/sim/table";
import { AudioDirector } from "../AudioDirector";
import { DepotCanvas } from "../DepotCanvas";
import { Hud } from "../Hud";
import { gameButtonClass } from "../ui/GameButton";
import { PicoPortrait } from "../ui/PicoPortrait";
import { AnswerInput, Breaks, CodeBlock, MappingCard, Panels, Text, Verdict } from "./parts";
import { DialogueBox, Rich, usePages, type Page } from "./dialogue";
import { RecallQuiz } from "./RecallQuiz";
import { useInsets } from "../useInsets";
import { ToolDock, type ToolHandlers } from "./ToolDock";
import { Backdrop } from "../ui/Backdrop";

type Phase = "steps" | "check" | "result";

/** Human label of the right answer (choice text or the number). */
function answerLabel(p: Prediction, tl: ReturnType<typeof useTranslations>) {
  if (p.input.type === "choice") {
    const o = p.input.options.find((x) => x.id === String(p.answer));
    return o ? tl(o.label.key, o.label.values) : String(p.answer);
  }
  return String(p.answer);
}

declare global {
  interface Window {
    __TEST__?: Record<string, unknown>;
  }
}

/** Stage sounds → SFX (each one a ClickHouse event). */
function onStageSound(sound: string, i = 0) {
  const a = audioBus();
  if (sound === "read") a.play("read", { rate: 1 + Math.min(12, i) * 0.03, minGapMs: 40 });
  else if (sound === "skip") a.play("skip", { minGapMs: 35, volume: 0.8 });
  else if (sound === "land") a.play("land", { minGapMs: 45, volume: 0.6 });
  else if (sound === "seal") a.play("seal");
  else if (sound === "truck") a.play("truck", { volume: 0.8, minGapMs: 300 });
  else if (sound === "merge") a.play("merge");
  else if (sound === "reject") a.play("reject");
  else if (sound === "drop") a.play("drop");
}

/** `onRestart` remounts the player: a fresh table, new numbers, back to step 1. */
export function LevelPlayer({ level, onRestart }: { level: Level; onRestart: () => void }) {
  const t = useTranslations("level");
  const tl = useTranslations("levels");
  const ts = useTranslations("stage");
  const recordCheck = useProgress((s) => s.recordCheck);

  const [session] = useState(() => new LevelSession(level));
  const { table, ctx } = session;
  const [phase, setPhase] = useState<Phase>("steps");
  const [stepIndex, setStepIndex] = useState(0);
  const [, setTick] = useState(0); // re-render on sim changes (task progress, panels)
  const [busy, setBusy] = useState(0);
  const [stageReady, setStageReady] = useState(false);

  // Prediction / watch state
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [picked, setPicked] = useState<string | number | undefined>(undefined);
  const [revealing, setRevealing] = useState(false);
  const [watchDone, setWatchDone] = useState(false);
  const [taskStarted, setTaskStarted] = useState(false);
  const [questionRead, setQuestionRead] = useState(false);
  const objectiveRef = useRef<HTMLDivElement>(null);
  const pages = usePages();

  // Check state
  const [seed, setSeed] = useState(newSeed);
  const [questions, setQuestions] = useState<BuiltQuestion[]>([]);
  const [answers, setAnswers] = useState<boolean[]>([]);

  const step = level.steps[stepIndex];
  const isLastStep = stepIndex === level.steps.length - 1;
  const headerRef = useRef<HTMLElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const restart = () => {
    audioBus().play("click", { bus: "ui", rate: 0.9 });
    onRestart();
  };

  useEffect(() => session.subscribe(() => setTick((n) => n + 1)), [session]);
  // Stop background loops when the level unmounts
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => audioBus().preload(), []);

  /** Run an animation-bearing action; the dock is disabled meanwhile. */
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy((n) => n + 1);
    try {
      await fn();
    } finally {
      setBusy((n) => n - 1);
      setTick((n) => n + 1);
    }
  }, []);

  /** Enter a step: snapshot counters, build its prediction, start its watch script. */
  const enterStep = (i: number) => {
    const next = level.steps[i];
    session.markStepStart();
    setStepIndex(i);
    setPicked(undefined);
    setRevealing(false);
    setWatchDone(false);
    setTaskStarted(false);
    setQuestionRead(false);
    setPrediction(next.kind === "predict" ? next.build(ctx) : null);
    if (next.kind === "watch") void act(() => next.script(ctx)).then(() => setWatchDone(true));
    if (next.kind === "task" && next.onEnter) void act(async () => next.onEnter!(ctx));
  };

  // Explanations duck the music; hands-on steps let it breathe
  useEffect(() => {
    const reading = phase !== "steps" || step.kind === "brief" || step.kind === "predict";
    backgroundMusic().duck(reading);
    return () => backgroundMusic().duck(false);
  }, [phase, step]);

  const taskProgress = step.kind === "task" ? step.progress(ctx, session.stepStart) : null;
  const taskDone = !!taskProgress && taskProgress.done >= taskProgress.total;

  const insets = useInsets({ header: headerRef, side: sideRef, dock: dockRef, objective: objectiveRef }, [phase, stepIndex, taskStarted, taskDone, picked, revealing, questionRead]);

  const [celebrated, setCelebrated] = useState(-1);
  if (taskDone && celebrated !== stepIndex) {
    setCelebrated(stepIndex);
    audioBus().play("unlock", { bus: "ui", rate: 1 });
  }

  const canAdvance = step.kind === "brief" || (step.kind === "watch" && watchDone) || (step.kind === "predict" && picked !== undefined && !revealing) || (taskDone && !busy);

  // ---- Dialogue content for the current step (short pages, big type) ----
  const showDock = step.kind === "task" && taskStarted && !taskDone;
  const dialogueKey = `${stepIndex}-${step.kind === "task" ? (taskDone ? "done" : "intro") : step.kind === "predict" ? (picked === undefined ? "q" : revealing ? "reveal" : "fb") : "x"}`;
  const dialoguePages: Page[] = (() => {
    if (step.kind === "brief") {
      const out: Page[] = pages.text(step.body, tl(step.title.key, step.title.values));
      if (step.mapping) out.push({ kind: "node", heading: t("mapping"), node: <MappingCard items={step.mapping} big /> });
      if (step.breaks) out.push({ kind: "node", node: <Breaks m={step.breaks} big /> });
      if (step.code) out.push({ kind: "node", node: <CodeBlock code={step.code} /> });
      return out;
    }
    if (step.kind === "watch") return pages.text(step.body, tl(step.title.key, step.title.values));
    if (step.kind === "task") return taskDone ? pages.text(step.success, t("taskDone")) : pages.text(step.body, tl(step.title.key, step.title.values));
    if (!prediction) return [];
    if (picked === undefined)
      return [
        {
          kind: "node",
          node: (
            <>
              <Rich markup={pages.markup(prediction.prompt)} />
              {prediction.code && (
                <div className="mt-3 text-base">
                  <CodeBlock code={prediction.code} />
                </div>
              )}
            </>
          ),
        },
      ];
    if (revealing) return [{ kind: "text", markup: t("watch") }];
    const ok = String(picked) === String(prediction.answer);
    return pages.text(prediction.explain, ok ? t("right") : `${t("notQuite")} ${t("answerWas", { answer: answerLabel(prediction, tl) })}`);
  })();
  const dialogueAdvance = () => {
    if (step.kind === "task" && !taskDone) {
      audioBus().play("click", { bus: "ui", rate: 1 });
      setTaskStarted(true);
      return;
    }
    advance();
  };
  const dialogueLabel = step.kind === "task" && !taskDone ? t("letsGo") : step.kind === "watch" && !watchDone ? t("watching") : isLastStep ? t("toCheck") : t("next");

  const panels = step.kind === "task" && taskStarted ? step.panels : step.kind === "watch" ? step.panels : undefined;

  const startCheck = useCallback(
    (s: number) => {
      setQuestions(buildCheck(level, s));
      setAnswers([]);
      setPhase("check");
    },
    [level],
  );

  const advance = () => {
    if (!canAdvance) return;
    audioBus().play("click", { bus: "ui", rate: 1 });
    if (isLastStep) startCheck(seed);
    else enterStep(stepIndex + 1);
  };

  const answerPrediction = async (value: string | number) => {
    if (!prediction || picked !== undefined) return;
    setPicked(value);
    audioBus().play(String(value) === String(prediction.answer) ? "correct" : "wrong", { bus: "ui", rate: 1 });
    if (prediction.reveal) {
      setRevealing(true);
      await act(() => prediction.reveal!(ctx));
      setRevealing(false);
    }
  };

  const finishCheck = (results: boolean[]) => {
    const stars = starsFor(results.filter(Boolean).length, questions.length);
    recordCheck(
      level.id,
      stars,
      questions.map((q, i) => ({ concept: q.concept, correct: results[i] })),
    );
    audioBus().play(stars > 0 ? "unlock" : "wrong", { bus: "ui", rate: 1 });
    setAnswers(results);
    setPhase("result");
  };

  const handlers: ToolHandlers = {
    busy: busy > 0,
    insert: (granules) => {
      audioBus().play("click", { bus: "ui" });
      void act(() => ctx.insert(GRANULE_ROWS * granules - 1200));
    },
    query: (columns, where) => {
      audioBus().play("click", { bus: "ui" });
      const tool = step.kind === "task" ? step.tools.find((x) => x.type === "query") : undefined;
      void act(async () => {
        const spec = { columns, where, partitions: tool?.type === "query" ? tool.partitions : undefined };
        const result = await ctx.query(spec);
        audioBus().play("done", { rate: 1 + (1 - result.boxesRead / result.boxesTotal) * 0.5 });
        if (tool?.type === "query" && tool.goal?.(spec, result)) session.recordGoodQuery();
        else if (tool?.type === "query" && tool.goal) audioBus().play("wrong", { bus: "ui", rate: 1.1 });
        session.changed();
      });
    },
    orderBy: (column) => {
      audioBus().play("click", { bus: "ui", rate: 1.2 });
      session.setOrderBy(column);
      void act(() => ctx.stage.setColumnSizes(boxSizes(table)));
    },
    currentOrderBy: () => (table.spec.orderBy ?? []).join(", "),
    setting: (field, value) => {
      audioBus().play("click", { bus: "ui", rate: 1.2 });
      session.setSetting(field, value);
    },
    currentSetting: (field) => ctx.settings[field],
    action: (tool) => {
      audioBus().play("click", { bus: "ui" });
      session.recordAction();
      void act(() => tool.run(ctx));
    },
  };

  useEffect(() => {
    window.__TEST__ = {
      ...window.__TEST__,
      phase: () => phase,
      step: () => ({ index: stepIndex, kind: step.kind, busy: busy > 0, taskDone, taskStarted, watchDone, ready: stageReady }),
      prediction: () => prediction && { answer: prediction.answer, input: prediction.input.type },
      solution: () => (step.kind === "task" ? (step.solution ?? null) : null),
      musicStarted: () => backgroundMusic().started,
    };
  });

  const correctCount = answers.filter(Boolean).length;
  const stars = phase === "result" ? starsFor(correctCount, questions.length) : 0;
  const upNext = nextLevel(level.id);

  return (
    <main className="relative isolate h-dvh overflow-hidden">
      <Backdrop />
      <AudioDirector intensity={phase === "steps" && step.kind === "task" ? 2 : phase === "result" ? 1 : 0} />

      {/* The warehouse fills the screen; UI floats on top and the camera frames the free area */}
      {phase === "steps" && (
        <section className="absolute inset-0" data-testid="stage">
          <DepotCanvas
            table={table}
            autoDeliver={false}
            insets={insets}
            onSound={onStageSound}
            onReady={(s) => {
              session.attachStage({
                deliver: (p, o) => s.deliver(p, o),
                playQuery: (r) => s.playQuery(r),
                setLayout: (l) => s.setLayout(l),
                setColumnSizes: (sz) => s.setColumnSizes(sz),
                resetBoxes: () => s.resetBoxes(),
                merge: (src, part) => s.merge(src, part),
                turnAway: (k) => s.turnAway(k),
                dropParts: (n) => s.dropParts(n),
                mutateParts: (n) => s.mutateParts(n),
                maskParts: (n) => s.maskParts(n),
                setBuffer: (r) => s.setBuffer(r),
              });
              setStageReady(true);
            }}
            labels={{
              column: (name, type) => `${name}<small>${type}</small>`,
              part: (name) => name,
              dock: ts("dock"),
              rows: ts("rows", { table: table.spec.name }),
              hall: (p) => ts("hall", { p }),
              rejected: ts("rejected"),
              duplicate: ts("duplicate"),
              buffer: (rows) => ts("buffer", { rows }),
            }}
          />
        </section>
      )}

      <header ref={headerRef} className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-3 pt-3 sm:px-5">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2.5">
          <Link href="/world" aria-label={t("map")} className={gameButtonClass({ size: "icon" })}>
            <ArrowLeft weight="bold" />
          </Link>
          <div className="card min-w-0 px-3 py-1.5 leading-tight">
            <p className="font-display text-xs font-bold uppercase tracking-[0.14em] text-ink-2">{t("levelLabel", { world: level.world, id: level.id })}</p>
            <h1 className="truncate font-display text-lg font-extrabold tracking-tight sm:text-xl">
              <Text m={level.title} />
            </h1>
          </div>
        </div>
        <ol className="card pointer-events-auto hidden items-center gap-1.5 px-3 py-2 md:flex" aria-label={t("progress")}>
          {level.steps.map((_, i) => (
            <li key={i} className={`h-2 rounded-full transition-all ${phase !== "steps" || i < stepIndex ? "w-2 bg-read" : i === stepIndex ? "w-6 bg-indigo" : "w-2 bg-ink/20"}`} />
          ))}
          <li className={`ml-1 grid size-5 place-items-center rounded-full ${phase === "steps" ? "bg-ink/10 text-ink-2" : "bg-amber text-ink"}`}>
            <Brain size={12} weight="bold" />
          </li>
        </ol>
        <div className="pointer-events-auto flex items-center gap-2">
          <button type="button" onClick={restart} aria-label={t("restart")} title={t("restart")} className={gameButtonClass({ size: "icon" })}>
            <ArrowCounterClockwise weight="bold" />
          </button>
          <Hud />
        </div>
      </header>

      {phase === "steps" && (
        <>
          {/* Phones: objective + live data stack under the header; wide screens: their own spots */}
          <div className="absolute inset-x-3 top-[72px] z-10 flex flex-col items-center gap-2 lg:contents">
            {step.kind === "task" && taskStarted && !taskDone && taskProgress && (
              <div ref={objectiveRef} data-objective className="card flex w-full max-w-[600px] items-center gap-3 px-4 py-2.5 lg:absolute lg:left-1/2 lg:top-[72px] lg:z-10 lg:w-[600px] lg:-translate-x-1/2">
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-xs font-bold uppercase tracking-[0.14em] text-amber-dark">{t("objective")}</span>
                  <span className="block truncate font-display text-lg font-extrabold leading-tight sm:text-xl">
                    <Text m={step.title} />
                  </span>
                </span>
                <span className="w-24 shrink-0">
                  <span className="block h-2.5 overflow-hidden rounded-full bg-paper-2">
                    <motion.span className="block h-full rounded-full bg-read" animate={{ width: `${(Math.min(taskProgress.done, taskProgress.total) / taskProgress.total) * 100}%` }} />
                  </span>
                  <span className="mt-1 block text-right font-mono text-xs font-bold text-ink-2">
                    {Math.min(taskProgress.done, taskProgress.total)}/{taskProgress.total}
                  </span>
                </span>
                <button type="button" onClick={() => setTaskStarted(false)} className={gameButtonClass({ variant: "ghost", size: "sm" })} aria-label={t("reread")}>
                  ?
                </button>
              </div>
            )}

            {panels && panels.length > 0 && (
              <aside ref={sideRef} className="card max-h-[26dvh] w-full overflow-y-auto px-4 py-3 lg:absolute lg:right-4 lg:top-[84px] lg:z-10 lg:max-h-[calc(100dvh-220px)] lg:w-[330px]">
                <Panels panels={panels} table={table} last={ctx.last} format={level.format} />
              </aside>
            )}
          </div>

          <div ref={dockRef} className="absolute inset-x-3 bottom-3 z-10 flex flex-col items-center gap-3 sm:bottom-4">
            {step.kind === "predict" && prediction && picked !== undefined && <Verdict key={stepIndex} correct={String(picked) === String(prediction.answer)} />}
            {step.kind === "predict" && prediction && questionRead && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`card max-w-[720px] p-4 sm:p-5 ${prediction.input.type === "choice" ? "w-full" : "w-fit"}`}>
                <AnswerInput key={stepIndex} big input={prediction.input} disabled={picked !== undefined} picked={picked} answer={prediction.answer} onAnswer={(v) => void answerPrediction(v)} />
              </motion.div>
            )}

            {showDock ? (
              <ToolDock key={stepIndex} tools={(step as Extract<typeof step, { kind: "task" }>).tools} columns={table.columns} on={handlers} />
            ) : (
              <DialogueBox
                key={dialogueKey}
                speaker="Pico"
                kicker={t(`kind.${step.kind}`)}
                tone={step.kind === "predict" && prediction && picked !== undefined && !revealing ? (String(picked) === String(prediction.answer) ? "good" : "bad") : undefined}
                pages={dialoguePages}
                canAdvance={step.kind === "task" && !taskDone ? stageReady : canAdvance}
                onAdvance={dialogueAdvance}
                advanceLabel={dialogueLabel}
                onLastPage={() => step.kind === "predict" && setQuestionRead(true)}
                footer={step.kind === "predict" && picked === undefined ? <span className="text-sm font-semibold text-ink-2">{t("chooseAbove")}</span> : undefined}
              />
            )}
          </div>
        </>
      )}

      {/* Recall check: the stage is hidden on purpose (testing effect) */}
      {phase === "check" && questions.length > 0 && (
        <div className="absolute inset-0 flex flex-col pt-16">
          <RecallQuiz key={seed} questions={questions} title={t("checkTitle")} onFinish={finishCheck} />
        </div>
      )}

      {phase === "result" && (
        <div className="absolute inset-0 flex items-center justify-center px-4 pb-6 pt-20">
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card w-full max-w-md p-8 text-center">
            <PicoPortrait className="mx-auto size-24" face={stars > 0 ? "happy" : "wow"} />
            <div className="mt-2 flex justify-center gap-1.5" aria-label={t("stars", { n: stars })}>
              {[1, 2, 3].map((n) => (
                <motion.span key={n} initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.15 * n, type: "spring", stiffness: 400, damping: 12 }}>
                  <Star size={44} weight="fill" className={n <= stars ? "text-amber" : "text-ink/15"} />
                </motion.span>
              ))}
            </div>
            <h2 className="mt-3 font-display text-3xl font-extrabold">{stars > 0 ? t("passed") : t("almost")}</h2>
            <p className="mt-1 text-lg text-ink-2">{t("score", { correct: correctCount, total: questions.length })}</p>
            {stars === 0 && <p className="mt-3 text-base text-ink-2">{t("remedial")}</p>}
            <div className="mt-6 grid gap-2.5">
              {stars > 0 && upNext ? (
                <Link href={`/level/${upNext.id}`} className={gameButtonClass({ variant: "primary", size: "lg" })}>
                  {t("nextLevel")}: {tl(upNext.title.key)}
                  <ArrowRight weight="bold" />
                </Link>
              ) : stars === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const s = seed + 1;
                    setSeed(s);
                    startCheck(s);
                  }}
                  className={gameButtonClass({ variant: "primary", size: "lg" })}
                >
                  <ArrowCounterClockwise weight="bold" />
                  {t("retryCheck")}
                </button>
              ) : null}
              <Link href="/world" className={gameButtonClass({ size: "lg" })}>
                <MapTrifold weight="bold" />
                {t("map")}
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </main>
  );
}
