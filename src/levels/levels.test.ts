import { describe, expect, it } from "vitest";
import { ALL_LEVELS, buildCheck, buildReview, starsFor } from ".";
import { LevelSession } from "./session";

describe("levels", () => {
  it("every level has a brief first and a 4-question check", () => {
    expect(ALL_LEVELS.length).toBeGreaterThanOrEqual(4);
    for (const l of ALL_LEVELS) {
      expect(l.steps[0].kind).toBe("brief");
      expect(l.check).toHaveLength(4);
    }
  });

  it("adds one review question from an earlier level after the first", () => {
    expect(buildCheck(ALL_LEVELS[0], 1)).toHaveLength(4);
    const c = buildCheck(ALL_LEVELS[1], 1);
    expect(c).toHaveLength(5);
    expect(c.filter((q) => q.review)).toHaveLength(1);
  });

  it("a seed regenerates questions deterministically", () => {
    const a = buildCheck(ALL_LEVELS[2], 7).map((q) => q.answer);
    expect(buildCheck(ALL_LEVELS[2], 7).map((q) => q.answer)).toEqual(a);
  });

  it("every choice answer is one of its options", () => {
    for (const l of ALL_LEVELS)
      for (let seed = 0; seed < 5; seed++)
        for (const q of buildCheck(l, seed)) if (q.input.type === "choice") expect(q.input.options.map((o) => o.id)).toContain(q.answer);
  });

  it("every prediction's answer is one of its options", () => {
    for (const l of ALL_LEVELS) {
      const s = new LevelSession(l);
      for (const step of l.steps)
        if (step.kind === "predict") {
          const p = step.build(s.ctx);
          if (p.input.type === "choice") expect(p.input.options.map((o) => o.id)).toContain(p.answer);
        }
    }
  });

  it("mastery gate at 80%", () => {
    expect(starsFor(3, 4)).toBe(0);
    expect(starsFor(4, 5)).toBe(1);
    expect(starsFor(5, 5)).toBe(3);
  });

  it("morning shift builds one question per concept, max 5", () => {
    expect(buildReview(["columnar", "column-read", "compression", "olap"], 4)).toHaveLength(4);
  });
});

describe("world 1 facts", () => {
  it("1-1: a row store reads every box; by column only the total aisle", () => {
    const s = new LevelSession(ALL_LEVELS[0]);
    const before = s.table.plan({ columns: ["total"] });
    expect(before.boxesRead).toBe(before.boxesTotal);
    s.table.setStorage("column");
    expect(s.table.plan({ columns: ["total"] }).boxesRead).toBe(before.boxesTotal / 4);
  });

  it("1-4: only date + city read under 10% of the bytes", () => {
    const s = new LevelSession(ALL_LEVELS.find((l) => l.id === "1-4")!);
    const cols = ["date", "customer_id", "city", "total"];
    const light: string[] = [];
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) {
        const r = s.table.plan({ columns: [cols[i], cols[j]] });
        if (r.bytesRead / r.bytesTotal < 0.1) light.push(`${cols[i]}+${cols[j]}`);
      }
    expect(light).toEqual(["date+city"]);
  });
});

describe("final exam", () => {
  it("draws 20 questions spread across every completed world", async () => {
    const { buildExam } = await import(".");
    const { questions, worlds } = buildExam(ALL_LEVELS.map((l) => l.id), 7);
    expect(questions).toHaveLength(20);
    expect(new Set(worlds).size).toBe(4);
    for (const w of [1, 2, 3, 4]) expect(worlds.filter((x) => x === w).length).toBeGreaterThanOrEqual(4);
  });
  it("only asks about played levels", async () => {
    const { buildExam } = await import(".");
    const { worlds } = buildExam(["1-1", "1-2"], 3);
    expect(worlds.every((w) => w === 1)).toBe(true);
    expect(worlds.length).toBe(8);
  });
});
