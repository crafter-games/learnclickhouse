import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Concept } from "@/levels/types";
import { ALL_LEVELS } from "@/levels";

const DAY = 86_400_000;
const UNLOCK_CODES = ["CRAFTER100"];
/** Leitner intervals per box (days). Box 1 = due now. */
const INTERVALS = [0, 1, 2, 4, 8, 16];

type LevelResult = { stars: number; attempts: number };
type ConceptState = { box: number; due: number };

type Answer = { concept: Concept; correct: boolean };

type Progress = {
  levels: Record<string, LevelResult>;
  concepts: Partial<Record<Concept, ConceptState>>;
  /** Days (YYYY-MM-DD) on which a morning shift was completed. */
  shifts: string[];
  /** Best final-exam result. */
  exam: { best: number; total: number; passed: boolean; at: string } | null;
  /** Name printed on the certificate. */
  name: string;
  recordExam: (answers: Answer[]) => void;
  setName: (name: string) => void;
  recordCheck: (levelId: string, stars: number, answers: Answer[]) => void;
  recordReview: (answers: Answer[]) => void;
  /** Redeem an unlock code; returns whether it was valid. */
  redeem: (code: string) => boolean;
  reset: () => void;
};

/** Leitner update: right → next box (longer interval), wrong → back to box 1 (due now). */
function updateConcepts(concepts: Progress["concepts"], answers: Answer[]) {
  const next = { ...concepts };
  const now = Date.now();
  for (const a of answers) {
    const c = next[a.concept] ?? { box: 1, due: now };
    const box = a.correct ? Math.min(5, c.box + 1) : 1;
    next[a.concept] = { box, due: now + INTERVALS[box] * DAY };
  }
  return next;
}

const today = () => new Date().toISOString().slice(0, 10);

export const useProgress = create<Progress>()(
  persist(
    (set) => ({
      levels: {},
      concepts: {},
      shifts: [],
      exam: null,
      name: "",
      recordExam: (answers) =>
        set((s) => {
          const correct = answers.filter((a) => a.correct).length;
          const passed = correct / answers.length >= 0.8;
          const better = !s.exam || correct > s.exam.best;
          return { concepts: updateConcepts(s.concepts, answers), exam: better ? { best: correct, total: answers.length, passed: passed || !!s.exam?.passed, at: today() } : { ...s.exam!, passed: s.exam!.passed || passed } };
        }),
      setName: (name) => set({ name: name.slice(0, 40) }),
      recordCheck: (levelId, stars, answers) =>
        set((s) => {
          const prev = s.levels[levelId];
          return {
            concepts: updateConcepts(s.concepts, answers),
            levels: { ...s.levels, [levelId]: { stars: Math.max(stars, prev?.stars ?? 0), attempts: (prev?.attempts ?? 0) + 1 } },
          };
        }),
      recordReview: (answers) =>
        set((s) => ({ concepts: updateConcepts(s.concepts, answers), shifts: s.shifts.includes(today()) ? s.shifts : [...s.shifts, today()] })),
      redeem: (code) => {
        if (!UNLOCK_CODES.includes(code.trim().toUpperCase())) return false;
        // CRAFTER100: every level complete with full marks
        set((s) => ({
          levels: Object.fromEntries(ALL_LEVELS.map((l) => [l.id, { stars: 3, attempts: Math.max(1, s.levels[l.id]?.attempts ?? 0) }])),
        }));
        return true;
      },
      reset: () => set({ levels: {}, concepts: {}, shifts: [], exam: null }),
    }),
    { name: "column-depot:progress", version: 1 },
  ),
);

/** Concepts due for review now, weakest (lowest box) first. */
export function dueConcepts(concepts: Progress["concepts"], now = Date.now()): Concept[] {
  return (Object.entries(concepts) as [Concept, ConceptState][])
    .filter(([, c]) => c.due <= now)
    .sort((a, b) => a[1].box - b[1].box || a[1].due - b[1].due)
    .map(([k]) => k);
}

/** Consecutive days with a completed morning shift, ending today or yesterday. */
export function shiftStreak(shifts: string[]): number {
  const set = new Set(shifts);
  const d = new Date();
  if (!set.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(d.toISOString().slice(0, 10))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** A level is unlocked when it's the first one or the previous level was passed (≥1 star). */
export function isUnlocked(levels: Progress["levels"], id: string) {
  const i = ALL_LEVELS.findIndex((l) => l.id === id);
  if (i <= 0) return true;
  return (levels[ALL_LEVELS[i - 1].id]?.stars ?? 0) > 0;
}

/** Every level has at least one star. */
export const allComplete = (levels: Progress["levels"]) => ALL_LEVELS.every((l) => (levels[l.id]?.stars ?? 0) > 0);
