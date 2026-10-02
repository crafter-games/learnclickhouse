"use client";

import { useLocale, useTranslations } from "next-intl";
import { MusicNotes, SpeakerHigh, SpeakerSlash, Translate } from "@phosphor-icons/react";
import { Link, usePathname } from "@/i18n/navigation";
import { useSettings } from "@/store/settings";
import { gameButtonClass } from "./ui/GameButton";

/** Top-right controls: music, sound effects, language. Always visible (GDD → HUD). */
export function Hud() {
  const t = useTranslations("hud");
  const locale = useLocale();
  const pathname = usePathname();
  const { musicMuted, sfxMuted, toggleMusic, toggleSfx } = useSettings();
  const other = locale === "en" ? "es" : "en";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggleMusic}
        aria-pressed={!musicMuted}
        aria-label={musicMuted ? t("musicOn") : t("musicOff")}
        title={`${musicMuted ? t("musicOn") : t("musicOff")} (M)`}
        className={`${gameButtonClass({ size: "icon" })} ${musicMuted ? "text-ink-2/60" : "text-indigo"}`}
      >
        <MusicNotes weight={musicMuted ? "regular" : "fill"} />
        {musicMuted && <span aria-hidden className="absolute h-0.5 w-6 rotate-45 rounded bg-current" />}
      </button>
      <button
        type="button"
        onClick={toggleSfx}
        aria-pressed={!sfxMuted}
        aria-label={sfxMuted ? t("sfxOn") : t("sfxOff")}
        title={`${sfxMuted ? t("sfxOn") : t("sfxOff")} (Shift+M)`}
        className={`${gameButtonClass({ size: "icon" })} ${sfxMuted ? "text-ink-2/60" : "text-indigo"}`}
      >
        {sfxMuted ? <SpeakerSlash /> : <SpeakerHigh weight="fill" />}
      </button>
      <Link
        href={pathname}
        locale={other}
        lang={other}
        className={`${gameButtonClass({ size: "sm" })} uppercase`}
        aria-label={t("language")}
      >
        <Translate size={18} />
        {other}
      </Link>
    </div>
  );
}
