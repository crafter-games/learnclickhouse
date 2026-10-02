"use client";

import { useEffect } from "react";
import { audioBus } from "@/audio/audioBus";
import { backgroundMusic, type Intensity } from "@/audio/music";
import { useSettings } from "@/store/settings";

/** Starts music on the first gesture, applies mute settings and the screen's music intensity. */
export function AudioDirector({ intensity }: { intensity: Intensity }) {
  const { musicMuted, sfxMuted, toggleMusic, toggleSfx } = useSettings();

  useEffect(() => {
    const unlock = () => void backgroundMusic().start();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => backgroundMusic().setMuted(musicMuted), [musicMuted]);
  useEffect(() => audioBus().setMuted(sfxMuted), [sfxMuted]);
  useEffect(() => backgroundMusic().setIntensity(intensity), [intensity]);
  // QA hook: lets the playtest harness record the mix
  useEffect(() => {
    (window as unknown as { __music?: unknown }).__music = backgroundMusic();
  }, []);

  // M toggles music, Shift+M toggles sound effects (GDD → Controls)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || e.key.toLowerCase() !== "m") return;
      if (e.shiftKey) toggleSfx();
      else toggleMusic();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMusic, toggleSfx]);

  return null;
}
