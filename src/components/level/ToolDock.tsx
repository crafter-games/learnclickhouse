"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowsDownUp, ArrowsClockwise, Eraser, PencilSimple, Play, Stack, Trash, Truck, type Icon } from "@phosphor-icons/react";
import type { Setting, Tool } from "@/levels/types";
import { Text } from "./parts";
import type { ColumnSpec, Where } from "@/sim/table";
import { COLUMN_COLORS } from "@/stage/theme";
import { GameButton } from "../ui/GameButton";

export type ToolHandlers = {
  insert: (granules: number) => void;
  query: (columns: string[], where?: Where) => void;
  orderBy: (column: string) => void;
  currentOrderBy: () => string | undefined;
  setting: (field: string, value: Setting) => void;
  currentSetting: (field: string) => Setting | undefined;
  action: (tool: Extract<Tool, { type: "action" }>) => void;
  /** An animation is running: actions wait. */
  busy: boolean;
};

/** The dock during a task: only the tools the level hands out (GDD → Controls). */
const ACTION_ICONS: Record<string, Icon> = { truck: Truck, repeat: ArrowsClockwise, trash: Trash, eraser: Eraser, pencil: PencilSimple, press: Stack, play: Play };

export function ToolDock({ tools, columns, on }: { tools: Tool[]; columns: ColumnSpec[]; on: ToolHandlers }) {
  const t = useTranslations("tools");
  const tl = useTranslations("levels");
  const queryTool = tools.find((x) => x.type === "query");
  const chipColumns = queryTool?.columns ?? columns.map((c) => c.name);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (c: string) => setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : chipColumns.filter((x) => x === c || s.includes(x))));
  const run = () => queryTool && selected.length && on.query(selected, queryTool.where);

  // Keyboard: 1–9 toggle columns, R runs, I inserts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (queryTool && /^[1-9]$/.test(k) && chipColumns[Number(k) - 1]) toggle(chipColumns[Number(k) - 1]);
      else if (queryTool && k === "r" && !on.busy) run();
      else if (k === "i" && !on.busy) {
        const ins = tools.find((x) => x.type === "insert");
        if (ins?.type === "insert") on.insert(ins.granules);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sql = queryTool && `SELECT ${selected.length ? selected.join(", ") : "…"} FROM orders${queryTool.where ? ` WHERE ${queryTool.where.column} = ${queryTool.where.label ?? queryTool.where.min}` : ""}`;

  return (
    <div className="card mx-auto flex w-fit max-w-full flex-col items-center gap-2.5 p-2.5 sm:p-3" data-dock>
      {queryTool && (
        <p className="max-w-full rounded-lg border border-white/10 bg-black/55 text-ink px-3 py-1.5 font-mono text-sm sm:text-base">
          {queryTool.select && <span className="block truncate text-amber">{`-- ${t("goal")}: SELECT ${queryTool.select}`}</span>}
          <span className="block truncate">{sql}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {tools.map((tool, i) => {
          if (tool.type === "insert")
            return (
              <GameButton key={i} variant="accent" size="lg" disabled={on.busy} onClick={() => on.insert(tool.granules)} title={`${t("insert")} (I)`} data-action="insert">
                <Truck weight="fill" size={22} />
                {t("insert")}
              </GameButton>
            );
          if (tool.type === "action") {
            const I = ACTION_ICONS[tool.icon ?? "play"] ?? Play;
            return (
              <GameButton
                key={i}
                variant={tool.tone === "danger" ? "secondary" : (tool.tone ?? "secondary")}
                size="lg"
                disabled={on.busy}
                onClick={() => on.action(tool)}
                data-action={tool.id}
                className={tool.tone === "danger" ? "!border-danger/40 !text-danger" : ""}
              >
                <I weight="fill" size={22} />
                <Text m={tool.label} />
              </GameButton>
            );
          }
          if (tool.type === "setting")
            return (
              <div key={i} className="flex flex-wrap items-center justify-center gap-1.5" role="radiogroup">
                <span className="font-display text-sm font-bold text-ink-2">
                  <Text m={tool.label} />
                </span>
                {tool.options.map((o) => {
                  const picked = on.currentSetting(tool.field) === o;
                  return (
                    <button
                      key={String(o)}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      data-setting={`${tool.field}=${o}`}
                      disabled={on.busy && tool.field !== "async"}
                      onClick={() => on.setting(tool.field, o)}
                      className={`h-12 rounded-xl border-2 px-3.5 font-display text-base font-bold transition-colors disabled:opacity-60 ${picked ? "border-indigo-dark !bg-indigo text-on-amber" : "border-line bg-paper text-ink-2 hover:border-amber/40 hover:bg-paper-2"}`}
                    >
                      {tl(`${tool.labels}.${String(o)}`)}
                    </button>
                  );
                })}
              </div>
            );
          if (tool.type === "orderBy")
            return (
              <div key={i} className="flex flex-wrap items-center justify-center gap-1.5" role="radiogroup" aria-label="ORDER BY">
                <span className="flex items-center gap-1 font-mono text-sm font-bold text-ink-2">
                  <ArrowsDownUp weight="bold" /> ORDER BY
                </span>
                {tool.options.map((c) => {
                  const on_ = on.currentOrderBy() === c;
                  const ci = columns.findIndex((x) => x.name === c.split(",")[0].trim());
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={on_}
                      disabled={on.busy}
                      onClick={() => on.orderBy(c)}
                      className={`flex h-12 items-center gap-1.5 rounded-xl border-2 px-3 font-mono text-base font-bold transition-colors disabled:opacity-60 ${on_ ? "border-indigo-dark !bg-indigo text-on-amber" : "border-line bg-paper text-ink-2 hover:border-amber/40 hover:bg-paper-2"}`}
                    >
                      <span className="size-3 rounded-[3px]" style={{ background: COLUMN_COLORS[ci] }} />
                      {c}
                    </button>
                  );
                })}
              </div>
            );
          return (
            <div key={i} className="flex flex-wrap items-center justify-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label={t("columns")}>
                {chipColumns.map((c, k) => {
                  const picked = selected.includes(c);
                  const ci = columns.findIndex((x) => x.name === c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={picked}
                      data-column={c}
                      title={`${c} (${k + 1})`}
                      onClick={() => toggle(c)}
                      className={`flex h-12 items-center gap-1.5 rounded-xl border-2 px-3 font-mono text-base font-bold transition-colors max-sm:h-11 max-sm:px-2 max-sm:text-sm ${picked ? "border-read-dark !bg-read text-on-amber" : "border-line bg-paper text-ink-2 hover:border-amber/40 hover:bg-paper-2"}`}
                    >
                      <span className="size-3 rounded-[3px]" style={{ background: COLUMN_COLORS[ci] }} />
                      {c}
                    </button>
                  );
                })}
              </div>
              <GameButton variant="primary" size="lg" disabled={on.busy || !selected.length} onClick={run} title={`${t("run")} (R)`} data-run>
                <Play weight="fill" size={22} />
                {t("run")}
              </GameButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
