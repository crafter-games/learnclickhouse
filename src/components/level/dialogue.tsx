"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { ArrowRight, CaretDown, Check, X } from "@phosphor-icons/react";
import { audioBus } from "@/audio/audioBus";
import type { Msg } from "@/levels/types";
import { gameButtonClass } from "../ui/GameButton";
import { PicoPortrait } from "../ui/PicoPortrait";

// A game dialogue box (visual-novel style): short pages, big type, typewriter text with blips.
// Learning-science: segmenting (one idea per page, learner-paced) + signaling (big focused text).

export type Page = { kind: "text"; markup: string; heading?: string } | { kind: "node"; node: ReactNode; heading?: string };

const CHARS_PER_SECOND = 70;
const PAGE_CHARS = 150;

/** Resolve a level message to HTML-ish markup with only <b> and <code> tags. */
export function useMarkup() {
  const t = useTranslations("levels");
  return useCallback(
    (m: Msg) =>
      t.markup(m.key, {
        ...m.values,
        b: (c) => `<b>${c}</b>`,
        code: (c) => `<code>${c}</code>`,
      }),
    [t],
  );
}

type Token = { text: string; tag: "b" | "code" | null };

function tokenize(markup: string): Token[] {
  const out: Token[] = [];
  const re = /<(b|code)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  for (const m of markup.matchAll(re)) {
    if (m.index! > last) out.push({ text: markup.slice(last, m.index), tag: null });
    out.push({ text: m[2], tag: m[1] as "b" | "code" });
    last = m.index! + m[0].length;
  }
  if (last < markup.length) out.push({ text: markup.slice(last), tag: null });
  return out;
}

const plainLength = (markup: string) => tokenize(markup).reduce((n, t) => n + t.text.length, 0);

/** Split markup into pages of a few sentences each (never inside a tag). */
export function splitPages(markup: string, max = PAGE_CHARS): string[] {
  // Sentence ends: . ! ? … followed by space and an uppercase/opening char (EN + ES)
  const sentences = markup.split(/(?<=[.!?…:])\s+(?=[A-ZÁÉÍÓÚÑ¿¡<"“(0-9])/u);
  const pages: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && plainLength(cur) + plainLength(s) > max) {
      pages.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) pages.push(cur);
  return pages;
}

/** Render markup, revealing only the first `visible` characters (typewriter). */
export function Rich({ markup, visible = Infinity }: { markup: string; visible?: number }) {
  const tokens = tokenize(markup);
  const starts = tokens.map((_, i) => tokens.slice(0, i).reduce((n, t) => n + t.text.length, 0));
  return (
    <>
      {tokens.map((tok, i) => {
        const left = visible - starts[i];
        if (left <= 0) return null;
        const text = tok.text.slice(0, left);
        if (tok.tag === "b") return <strong key={i} className="font-extrabold text-ink">{text}</strong>;
        if (tok.tag === "code")
          return (
            <code key={i} className="rounded-md bg-paper-2 px-1.5 py-0.5 font-mono text-[0.85em] text-indigo-dark">
              {text}
            </code>
          );
        return <span key={i}>{text}</span>;
      })}
    </>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Bottom-centre dialogue box. Pages advance with click / Space / Enter. On the last page the
 * `footer` (answers, Next…) is shown and `onAdvance` fires on Enter if `canAdvance`.
 */
export function DialogueBox({
  speaker,
  kicker,
  pages,
  footer,
  canAdvance,
  onAdvance,
  advanceLabel,
  onLastPage,
  tone,
}: {
  /** Colours the box after an answer: good = green, bad = red. */
  tone?: "good" | "bad";
  speaker: string;
  kicker: string;
  pages: Page[];
  footer?: ReactNode;
  canAdvance: boolean;
  onAdvance: () => void;
  advanceLabel: string;
  onLastPage?: () => void;
}) {
  const [page, setPage] = useState(0);
  // Typed characters, tagged with the page they belong to (a new page starts at 0)
  const [typedState, setTypedState] = useState({ page: 0, n: 0 });
  const current = pages[Math.min(page, pages.length - 1)];
  const total = current?.kind === "text" ? plainLength(current.markup) : 0;
  const instant = current?.kind !== "text" || reducedMotion();
  const typed = instant ? Infinity : typedState.page === page ? typedState.n : 0;
  const skipped = typedState.page === page && typedState.n === Infinity;
  const done = typed >= total;
  const last = page >= pages.length - 1;
  const lastNotified = useRef(false);

  // Typewriter with blips
  useEffect(() => {
    if (instant || skipped) return;
    let n = 0;
    const id = setInterval(() => {
      n += 2;
      setTypedState((s) => (s.page === page && s.n > n ? s : { page, n }));
      if (n % 6 === 0) audioBus().play("blip", { bus: "ui", rate: 0.92 + Math.random() * 0.16 });
      if (n >= total) clearInterval(id);
    }, 2000 / CHARS_PER_SECOND);
    return () => clearInterval(id);
  }, [instant, skipped, page, total]);

  useEffect(() => {
    if (last && done && !lastNotified.current) {
      lastNotified.current = true;
      onLastPage?.();
    }
  }, [last, done, onLastPage]);

  const step = useCallback(() => {
    if (!done) {
      setTypedState({ page, n: Infinity });
      return;
    }
    if (!last) {
      audioBus().play("click", { bus: "ui", rate: 1.3 });
      setPage((p) => p + 1);
      return;
    }
    if (canAdvance) onAdvance();
  }, [done, last, canAdvance, onAdvance, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "BUTTON" || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      step();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const heading = current?.heading;

  return (
    <div className="relative mx-auto w-full max-w-[980px]">
      {/* Speaker portrait + name plate, visual-novel style */}
      <div className="pointer-events-none absolute -top-9 left-4 z-10 flex items-end gap-2 sm:left-6">
        <PicoPortrait className="size-16 drop-shadow-md sm:size-[88px]" />
        <span className="mb-2 rounded-lg border border-white/15 bg-paper-2 px-2.5 py-1 font-display text-sm font-bold text-ink shadow-[0_2px_0_rgba(0,0,0,0.4)]">{speaker}</span>
        <span className="mb-2 rounded-lg bg-amber px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-on-amber">{kicker}</span>
      </div>

      <div
        role="dialog"
        aria-live="polite"
        data-dialogue={last ? "last" : "more"}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input, a, form")) return;
          step();
        }}
        className={`card relative cursor-pointer select-none px-5 pb-4 pt-9 sm:px-8 sm:pb-5 sm:pt-14 ${tone === "bad" ? "outline-4 outline-danger" : tone === "good" ? "outline-4 outline-read" : ""}`}
      >
        {heading &&
          (tone ? (
            <p className={`mb-2 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 font-display text-base font-extrabold sm:text-lg ${tone === "bad" ? "bg-danger text-white" : "bg-read text-on-amber"}`}>
              {tone === "bad" ? <X weight="bold" /> : <Check weight="bold" />}
              {heading}
            </p>
          ) : (
            <p className="mb-1 font-display text-base font-extrabold text-indigo-dark sm:text-lg">{heading}</p>
          ))}
        <motion.div key={page} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="min-h-[3.2em] text-[1.25rem] leading-snug text-ink sm:text-[1.5rem] xl:text-[1.75rem]">
          {current?.kind === "text" ? <Rich markup={current.markup} visible={typed} /> : current?.node}
        </motion.div>

        <div className="mt-3 flex min-h-11 items-center justify-between gap-3">
          <span className="flex gap-1" aria-hidden>
            {pages.length > 1 &&
              pages.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === page ? "w-5 bg-indigo" : i < page ? "w-1.5 bg-indigo/40" : "w-1.5 bg-ink/15"}`} />)}
          </span>
          {!last || !done ? (
            <motion.span animate={{ y: [0, 4, 0] }} transition={{ repeat: Infinity, duration: 0.9 }} className="text-2xl text-indigo" aria-hidden>
              <CaretDown weight="fill" />
            </motion.span>
          ) : (
            footer ?? (
              <button type="button" onClick={onAdvance} disabled={!canAdvance} className={gameButtonClass({ variant: "primary", size: "md" })}>
                {advanceLabel}
                <ArrowRight weight="bold" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** Build pages for a message: split into short chunks; the first page carries the heading. */
export function usePages() {
  const markup = useMarkup();
  return useMemo(
    () => ({
      text: (m: Msg, heading?: string): Page[] => splitPages(markup(m)).map((p, i) => ({ kind: "text", markup: p, heading: i === 0 ? heading : undefined })),
      markup,
    }),
    [markup],
  );
}
