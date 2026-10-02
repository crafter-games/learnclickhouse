"use client";

import { useEffect, useRef } from "react";
import type { Table } from "@/sim/table";
import type { DepotStage, StageLabels, StageOptions } from "@/stage/depotStage";

type Props = {
  table: Table;
  labels: StageLabels;
  /** Floating UI covering the canvas (px), so the warehouse is framed in the free area. */
  insets?: { top?: number; right?: number; bottom?: number; left?: number };
  onSound?: StageOptions["onSound"];
  onReady?: (stage: DepotStage) => void;
  className?: string;
};

/** Mounts the Three.js warehouse for a table; new parts arrive by truck as the sim emits them. */
export function DepotCanvas({ table, labels, insets, onSound, onReady, className = "absolute inset-0" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stageRef = useRef<DepotStage | null>(null);
  const insetKey = JSON.stringify(insets ?? {});
  useEffect(() => {
    stageRef.current?.setInsets(JSON.parse(insetKey));
  }, [insetKey]);
  const latest = useRef({ labels, onSound, onReady, insets });
  useEffect(() => {
    latest.current = { labels, onSound, onReady, insets };
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let stage: DepotStage | null = null;
    let unsubscribe = () => {};
    let cancelled = false;

    // three.js is client-only and heavy: load it after first paint
    void import("@/stage/depotStage").then(({ DepotStage }) => {
      if (cancelled) return;
      const s = new DepotStage(el, table, latest.current.labels, { onSound: (sound, i) => latest.current.onSound?.(sound, i) });
      stage = s;
      stageRef.current = s;
      s.setInsets(JSON.parse(JSON.stringify(latest.current.insets ?? {})));
      unsubscribe = table.events.on((e) => {
        if (e.type === "partCreated") void s.deliver(e.part);
      });
      void s.ready.then(() => {
        if (cancelled) return;
        el.setAttribute("data-ready", "true");
        latest.current.onReady?.(s);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stage?.dispose();
    };
  }, [table]);

  return <div ref={host} className={className} />;
}
