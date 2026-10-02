// Background music: three CC0 loops by Juhani Junkala (JRPG Music Packs, see CREDITS.md), all in
// major keys. One track per intensity, crossfaded:
//   0 = reading / explanations → "Home Town" (calm)
//   1 = menus, map, results     → "Sunshine Coast" (bright)
//   2 = hands-on tasks          → "Preparing For Battle" (heroic, driving)
// Music ducks under explanations (GDD → Audio; learning-science §3).
import { Howl } from "howler";

export type Intensity = 0 | 1 | 2;

const TRACKS: Record<Intensity, { src: string[]; volume: number }> = {
  0: { src: ["/audio/music/home-town.ogg", "/audio/music/home-town.mp3"], volume: 0.42 },
  1: { src: ["/audio/music/sunshine-coast.ogg", "/audio/music/sunshine-coast.mp3"], volume: 0.34 },
  2: { src: ["/audio/music/preparing-for-battle.ogg", "/audio/music/preparing-for-battle.mp3"], volume: 0.4 },
};
const FADE_MS = 1200;
const DUCK = 0.35;

class Music {
  private howls = new Map<Intensity, Howl>();
  private current: Intensity | null = null;
  private intensity: Intensity = 1;
  private muted = false;
  private ducked = false;
  private booted = false;

  get started() {
    return this.booted;
  }

  private howl(i: Intensity) {
    let h = this.howls.get(i);
    if (!h) {
      // Web Audio (not html5) so the loop is gapless
      h = new Howl({ src: TRACKS[i].src, loop: true, volume: 0, preload: true });
      this.howls.set(i, h);
    }
    return h;
  }

  private target(i: Intensity) {
    if (this.muted) return 0;
    return TRACKS[i].volume * (this.ducked ? DUCK : 1);
  }

  /** Must be called from a user gesture (autoplay policy). Safe to call repeatedly. */
  async start() {
    if (this.booted) return;
    this.booted = true;
    this.play(this.intensity);
  }

  private play(i: Intensity) {
    if (this.current === i) return;
    const prev = this.current;
    this.current = i;
    const next = this.howl(i);
    if (!next.playing()) next.play();
    next.fade(next.volume(), this.target(i), FADE_MS);
    if (prev !== null) {
      const old = this.howl(prev);
      old.fade(old.volume(), 0, FADE_MS);
      setTimeout(() => {
        if (this.current !== prev) old.pause();
      }, FADE_MS + 50);
    }
  }

  setIntensity(level: Intensity) {
    this.intensity = level;
    if (this.booted) this.play(level);
  }

  /** Music dips while the player reads an explanation. */
  duck(active: boolean) {
    this.ducked = active;
    this.refresh(active ? 250 : 800);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.refresh(400);
  }

  private refresh(ms: number) {
    if (this.current === null) return;
    const h = this.howl(this.current);
    h.fade(h.volume(), this.target(this.current), ms);
  }
}

let music: Music | null = null;
export function backgroundMusic(): Music {
  if (!music) music = new Music();
  return music;
}
