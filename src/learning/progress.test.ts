import { describe, expect, it } from "vitest";
import { ALL_LEVELS } from "@/levels";
import { isUnlocked, useProgress } from "./progress";

describe("unlock code", () => {
  it("rejects a wrong code", () => {
    expect(useProgress.getState().redeem("NOPE")).toBe(false);
  });

  it("CRAFTER100 (any case) completes every level with 3 stars", () => {
    expect(useProgress.getState().redeem(" crafter100 ")).toBe(true);
    const { levels } = useProgress.getState();
    expect(ALL_LEVELS.every((l) => levels[l.id]?.stars === 3)).toBe(true);
    expect(isUnlocked(levels, ALL_LEVELS.at(-1)!.id)).toBe(true);
  });
});
