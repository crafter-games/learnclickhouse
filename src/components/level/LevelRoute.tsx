"use client";

import { useState } from "react";
import { getLevel } from "@/levels";
import { LevelPlayer } from "./LevelPlayer";

/** Level definitions hold functions, so they're resolved on the client by id. */
export function LevelRoute({ id }: { id: string }) {
  const level = getLevel(id)!;
  const [run, setRun] = useState(0);
  return <LevelPlayer key={`${id}-${run}`} level={level} onRestart={() => setRun((r) => r + 1)} />;
}
