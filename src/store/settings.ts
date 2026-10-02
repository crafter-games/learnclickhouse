import { create } from "zustand";
import { persist } from "zustand/middleware";

type Settings = {
  musicMuted: boolean;
  sfxMuted: boolean;
  toggleMusic: () => void;
  toggleSfx: () => void;
};

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      musicMuted: false,
      sfxMuted: false,
      toggleMusic: () => set((s) => ({ musicMuted: !s.musicMuted })),
      toggleSfx: () => set((s) => ({ sfxMuted: !s.sfxMuted })),
    }),
    { name: "column-depot:settings", version: 1 },
  ),
);
