import { seeded, shuffle } from "@/lib/rng";
import type { Level, Question } from "./types";
import { WORLD1 } from "./world1";
import { WORLD2 } from "./world2";
import { WORLD3 } from "./world3";
import { WORLD4 } from "./world4";
import { WORLD5 } from "./world5";

/** Worlds in the map; `levels` empty = "coming soon" building. */
export const WORLDS: { id: number; levels: Level[] }[] = [
  { id: 1, levels: WORLD1 },
  { id: 2, levels: WORLD2 },
  { id: 3, levels: WORLD3 },
  { id: 4, levels: WORLD4 },
  { id: 5, levels: WORLD5 },
];
export const ALL_LEVELS: Level[] = WORLDS.flatMap((w) => w.levels);

export const getLevel = (id: string) => ALL_LEVELS.find((l) => l.id === id);

export function nextLevel(id: string): Level | undefined {
  const i = ALL_LEVELS.findIndex((l) => l.id === id);
  return i >= 0 ? ALL_LEVELS[i + 1] : undefined;
}

export type BuiltQuestion = ReturnType<Question["build"]> & { concept: Question["concept"]; review: boolean };

/**
 * The recall check: the level's own questions plus one review question from an earlier level
 * (spacing + interleaving). A new seed gives new numbers and order.
 */
export function buildCheck(level: Level, seed: number): BuiltQuestion[] {
  const rng = seeded(seed);
  const own = level.check.map((q) => ({ ...q.build(rng), concept: q.concept, review: false }));
  const earlier = ALL_LEVELS.slice(0, ALL_LEVELS.findIndex((l) => l.id === level.id)).flatMap((l) => l.check);
  if (!earlier.length) return own;
  const pick = earlier[Math.floor(rng() * earlier.length)];
  return [...own, { ...pick.build(rng), concept: pick.concept, review: true }];
}

export const PASS_RATIO = 0.8;

/** Stars from the recall check: < 80% = 0, ≥ 80% = 1, ≥ 90% = 2, 100% = 3. */
export function starsFor(correct: number, total: number): 0 | 1 | 2 | 3 {
  const r = correct / total;
  if (r < PASS_RATIO) return 0;
  if (r === 1) return 3;
  return r >= 0.9 ? 2 : 1;
}

/** Morning shift: one question per due concept (weakest first), interleaved, 3–5 questions. */
export function buildReview(concepts: Question["concept"][], seed: number): BuiltQuestion[] {
  const rng = seeded(seed);
  const pool = ALL_LEVELS.flatMap((l) => l.check);
  const picked = concepts.slice(0, 5).map((c) => {
    const options = pool.filter((q) => q.concept === c);
    return options[Math.floor(rng() * options.length)];
  });
  return shuffle(rng, picked.filter(Boolean)).map((q) => ({ ...q.build(rng), concept: q.concept, review: false }));
}

export const EXAM_SIZE = 20;

/**
 * The final exam: questions from the given levels, spread round-robin across worlds so every world
 * is covered (interleaving), each built with fresh numbers. Returns the world of each question.
 */
export function buildExam(levelIds: string[], seed: number, size = EXAM_SIZE): { questions: BuiltQuestion[]; worlds: number[] } {
  const rng = seeded(seed);
  const byWorld = new Map<number, { q: Question; world: number }[]>();
  for (const l of ALL_LEVELS.filter((x) => levelIds.includes(x.id))) for (const q of l.check) byWorld.set(l.world, [...(byWorld.get(l.world) ?? []), { q, world: l.world }]);
  const queues = [...byWorld.values()].map((list) => shuffle(rng, list));
  const picked: { q: Question; world: number }[] = [];
  while (picked.length < size && queues.some((q) => q.length)) for (const q of queues) if (q.length && picked.length < size) picked.push(q.shift()!);
  const order = shuffle(rng, picked);
  return { questions: order.map(({ q }) => ({ ...q.build(rng), concept: q.concept, review: false })), worlds: order.map((p) => p.world) };
}
