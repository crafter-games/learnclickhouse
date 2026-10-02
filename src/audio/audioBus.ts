import { Howl, Howler } from "howler";

// Every SFX key maps to a ClickHouse event (GDD → Audio). Music lives in ./music.ts.
export const SFX = {
  truck: "/audio/sfx/truck.wav", // an INSERT arrives
  land: "/audio/sfx/land.wav", // a box lands on its shelf
  seal: "/audio/sfx/seal.wav", // the part is sealed (immutable)
  read: "/audio/sfx/read.wav", // a granule is read
  skip: "/audio/sfx/skip.wav", // a granule (or a whole column) is skipped
  done: "/audio/sfx/done.wav", // query finished
  merge: "/audio/sfx/merge.wav", // background merge (the press)
  reject: "/audio/sfx/reject.wav", // insert rejected: too many parts / partitions
  drop: "/audio/sfx/drop.wav", // parts dropped, duplicate sent away
  click: "/audio/sfx/click.wav",
  blip: "/audio/sfx/blip.wav",
  unlock: "/audio/sfx/unlock.wav",
  correct: "/audio/sfx/correct.wav",
  wrong: "/audio/sfx/wrong.wav",
} as const;

export type SfxKey = keyof typeof SFX;

const BUS_VOLUME = { sfx: 0.8, ui: 0.5 } as const;

class AudioBus {
  private sounds = new Map<SfxKey, Howl>();
  private lastPlayed = new Map<SfxKey, number>();

  private get(key: SfxKey): Howl {
    let h = this.sounds.get(key);
    if (!h) {
      h = new Howl({ src: [SFX[key]], preload: true });
      this.sounds.set(key, h);
    }
    return h;
  }

  preload() {
    (Object.keys(SFX) as SfxKey[]).forEach((k) => this.get(k));
  }

  /**
   * `rate` sets the pitch (1 = original); without it, ±6% variation keeps repeats from sounding
   * mechanical. `minGapMs` drops a sound fired again too soon (dozens of boxes in a row).
   */
  play(key: SfxKey, opts: { bus?: keyof typeof BUS_VOLUME; rate?: number; volume?: number; minGapMs?: number } = {}) {
    const now = performance.now();
    if (opts.minGapMs && now - (this.lastPlayed.get(key) ?? 0) < opts.minGapMs) return;
    this.lastPlayed.set(key, now);
    const h = this.get(key);
    const id = h.play();
    h.volume((opts.volume ?? 1) * BUS_VOLUME[opts.bus ?? "sfx"], id);
    h.rate(opts.rate ?? 0.94 + Math.random() * 0.12, id);
  }

  setMuted(muted: boolean) {
    Howler.mute(muted);
  }
}

let bus: AudioBus | null = null;
export function audioBus(): AudioBus {
  if (!bus) bus = new AudioBus();
  return bus;
}
