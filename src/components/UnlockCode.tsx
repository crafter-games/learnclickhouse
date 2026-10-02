"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { Key, X } from "@phosphor-icons/react";
import { audioBus } from "@/audio/audioBus";
import { useProgress } from "@/learning/progress";
import { gameButtonClass } from "./ui/GameButton";

/** "Code" button + dialog for unlock codes (e.g. CRAFTER100 completes every level with 3 stars). */
export function UnlockCode() {
  const t = useTranslations("code");
  const redeem = useProgress((s) => s.redeem);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "ok" | "bad">("idle");

  const submit = () => {
    if (redeem(value)) {
      setState("ok");
      audioBus().play("unlock", { bus: "ui", rate: 1 });
      setTimeout(() => {
        setOpen(false);
        setState("idle");
        setValue("");
      }, 1600);
    } else {
      setState("bad");
      audioBus().play("wrong", { bus: "ui", rate: 1 });
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={gameButtonClass({ size: "sm" })} aria-label={t("open")}>
        <Key size={18} weight="fill" className="text-ink-2" />
        <span className="hidden sm:inline">{t("button")}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.form
              role="dialog"
              aria-modal="true"
              aria-labelledby="code-title"
              initial={{ scale: 0.92, y: 10 }}
              animate={{ scale: 1, y: 0, x: state === "bad" ? [0, -8, 8, -5, 5, 0] : 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="card w-full max-w-sm p-6"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="flex items-center justify-between">
                <h2 id="code-title" className="font-display text-xl font-extrabold">
                  {t("title")}
                </h2>
                <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className={gameButtonClass({ variant: "ghost", size: "icon" })}>
                  <X weight="bold" />
                </button>
              </div>
              <p className="mt-1 text-sm text-ink-2">{t("body")}</p>
              <label htmlFor="unlock-code" className="sr-only">
                {t("label")}
              </label>
              <input
                id="unlock-code"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setState("idle");
                }}
                placeholder="XXXXXXXX"
                className="mt-4 h-12 w-full rounded-xl border border-line bg-paper-2 px-4 text-center font-mono text-lg font-bold uppercase tracking-[0.2em] text-ink outline-none focus:border-indigo focus:bg-black/40"
              />
              {state === "bad" && <p className="mt-2 text-sm font-semibold text-danger">{t("bad")}</p>}
              {state === "ok" && <p className="mt-2 text-sm font-semibold text-read-dark">{t("ok")}</p>}
              <button type="submit" disabled={!value.trim()} className={`${gameButtonClass({ variant: "primary", size: "md" })} mt-4 w-full`}>
                {t("redeem")}
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
