// Generative, adaptive background music (Tone.js) — an ORIGINAL composition for Column Depot
// (GDD → Audio): a bright, heroic "warehouse at work" groove in G major — marimba arpeggios, a
// funky octave-popping bass, claps and shaker, brass stabs, and a heroic lead for the pursuit layer.
// No existing melody is reproduced; no sad chords (no iv, no diminished).
//
// Intensity layers:  0 = base (marimba + bass + pad)  ·  1 = + drums & brass & quiet lead  ·  2 = pursuit
// (lead up front, faster, a whole tone higher). Every 8 bars the key climbs a semitone and resets
// after four lifts, so the loop keeps building. Ducks under explanations (learning-science §3).
type ToneNS = typeof import("tone");

export type Intensity = 0 | 1 | 2;

const BPM: Record<Intensity, number> = { 0: 118, 1: 126, 2: 146 };
const OFF_DB = -60;
const INTENSITY_LIFT: Record<Intensity, number> = { 0: 0, 1: 0, 2: 2 };
const MODULATIONS = [0, 1, 2, 3];

// G major, 8 bars: I – V – vi – IV | I – iii – IV – V7 (MIDI)
const ROOTS = [43, 38, 40, 36, 43, 35, 36, 38];
const CHORDS = [
  [67, 71, 74],
  [62, 66, 69],
  [64, 67, 71],
  [60, 64, 67],
  [67, 71, 74],
  [59, 62, 66],
  [60, 64, 67],
  [62, 66, 69, 72],
];
// Funky bass per 16th step: semitones above the root (null = rest); octave pops on the offbeats
const BASS: (number | null)[] = [0, null, null, 12, null, 0, null, 7, 0, null, 12, null, null, 7, 12, null];
// Marimba hits (16th steps) cycling through the chord an octave up
const MARIMBA_STEPS = [0, 2, 3, 5, 6, 8, 10, 11, 13, 14];
// Brass stabs, syncopated
const STABS = [2, 7, 10, 14];
const _ = 0;
const LEAD: number[][] = [
  [79, _, _, 74, _, 79, _, 81, 83, _, 81, _, 79, _, 74, _],
  [78, _, _, 74, _, 78, _, 81, 81, _, _, _, 78, _, _, _],
  [79, _, _, 76, _, 79, _, 83, 83, _, 86, _, 83, _, 79, _],
  [81, _, _, _, 79, _, 76, _, 72, _, 76, _, 79, _, 81, _],
  [83, _, _, 79, _, 83, _, 86, 86, _, 88, _, 86, _, 83, _],
  [86, _, _, 83, _, 78, _, 83, 86, _, _, _, 83, _, 81, _],
  [79, _, _, 76, _, 72, _, 76, 79, _, 81, _, 84, _, 83, _],
  [81, _, _, _, _, _, 78, _, 74, _, 78, _, 81, _, 84, _],
];
const LAYER_DB = { bass: -12, pad: -27, marimba: -15, drums: -14, brass: -21 } as const;
const LEAD_DB: Record<Intensity, number> = { 0: OFF_DB, 1: -27, 2: -15 };

type Layers = {
  bus: InstanceType<ToneNS["Volume"]>;
  duck: InstanceType<ToneNS["Gain"]>;
  drums: InstanceType<ToneNS["Volume"]>;
  brass: InstanceType<ToneNS["Volume"]>;
  lead: InstanceType<ToneNS["Volume"]>;
};

class Music {
  private tone: ToneNS | null = null;
  private layers: Layers | null = null;
  private starting: Promise<void> | null = null;
  private intensity: Intensity = 0;
  private muted = false;
  private ducked = false;

  get started() {
    return this.layers !== null;
  }

  /** Must be called from a user gesture (autoplay policy). Safe to call repeatedly. */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.boot();
    return this.starting;
  }

  private async boot() {
    const Tone = await import("tone");
    this.tone = Tone;
    await Tone.start();
    // Scheduling headroom so a busy main thread (3D scenes) doesn't collapse note times
    Tone.getContext().lookAhead = 0.2;

    const bus = new Tone.Volume(-60).toDestination();
    const limiter = new Tone.Limiter(-1).connect(bus);
    const duck = new Tone.Gain(this.ducked ? 0.3 : 1).connect(limiter);
    const room = new Tone.Reverb({ decay: 1.6, wet: 0.16 }).connect(duck);

    // Base: funky bass, warm pad, marimba
    const bassVol = new Tone.Volume(LAYER_DB.bass).connect(duck);
    const bass = new Tone.MonoSynth({
      oscillator: { type: "square" },
      filter: { Q: 3, type: "lowpass", rolloff: -24 },
      envelope: { attack: 0.003, decay: 0.16, sustain: 0.2, release: 0.05 },
      filterEnvelope: { attack: 0.003, decay: 0.12, sustain: 0.15, baseFrequency: 140, octaves: 3.6 },
    }).connect(bassVol);
    const padVol = new Tone.Volume(LAYER_DB.pad).connect(room);
    const padFilter = new Tone.Filter(2200, "lowpass").connect(padVol);
    const pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 18 },
      envelope: { attack: 0.4, decay: 0.3, sustain: 0.6, release: 1 },
    }).connect(padFilter);
    const marimbaVol = new Tone.Volume(LAYER_DB.marimba).connect(room);
    const marimba = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.01,
      modulationIndex: 1.6,
      oscillator: { type: "sine" },
      modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.32, sustain: 0, release: 0.2 },
      modulationEnvelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.05 },
    }).connect(marimbaVol);

    // Drums: kick, clap, shaker
    const drums = new Tone.Volume(OFF_DB).connect(duck);
    const kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.26, sustain: 0 } }).connect(drums);
    const clapFilter = new Tone.Filter(1700, "bandpass").connect(drums);
    const clap = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.002, decay: 0.12, sustain: 0 } }).connect(clapFilter);
    const shakerFilter = new Tone.Filter(7000, "highpass").connect(drums);
    const shaker = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.004, decay: 0.04, sustain: 0 } }).connect(shakerFilter);

    // Brass stabs
    const brass = new Tone.Volume(OFF_DB).connect(room);
    const brassFilter = new Tone.Filter(2600, "lowpass").connect(brass);
    const horns = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.01, decay: 0.12, sustain: 0.2, release: 0.08 },
    }).connect(brassFilter);

    // Lead: bright square with vibrato and a short echo
    const lead = new Tone.Volume(OFF_DB).connect(room);
    const echo = new Tone.FeedbackDelay("8n", 0.2).connect(lead);
    const vibrato = new Tone.Vibrato(5.5, 0.07).connect(echo);
    const leadSynth = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.55, release: 0.12 },
    }).connect(vibrato);
    leadSynth.volume.value = -4;

    const transport = Tone.getTransport();
    transport.bpm.value = BPM[this.intensity];
    const n = (midi: number, shift: number) => Tone.Frequency(midi + shift, "midi").toFrequency();

    // One 16th-note grid over 8 bars drives every part, so modulations land together
    let lastTime = 0;
    let section = 0;
    const steps = Array.from({ length: 128 }, (_, i) => i);
    new Tone.Sequence(
      (time, step) => {
        // Under heavy load two steps can land on the same time; monophonic synths reject that
        if (time <= lastTime) return;
        lastTime = time;
        if (step === 0) section++;
        const shift = MODULATIONS[(section - 1) % MODULATIONS.length] + INTENSITY_LIFT[this.intensity];
        try {
          const bar = Math.floor(step / 16);
          const s16 = step % 16;
          const chord = CHORDS[bar];
          if (s16 === 0) pad.triggerAttackRelease(chord.map((m) => n(m - 12, shift)), "1m", time, 0.3);
          const b = BASS[s16];
          if (b !== null) bass.triggerAttackRelease(n(ROOTS[bar] + b, shift), "16n", time, s16 % 4 === 0 ? 0.95 : 0.72);
          const mi = MARIMBA_STEPS.indexOf(s16);
          if (mi >= 0) marimba.triggerAttackRelease(n(chord[mi % chord.length] + 12, shift), "16n", time, mi % 3 === 0 ? 0.7 : 0.45);
          if (STABS.includes(s16)) horns.triggerAttackRelease(chord.map((m) => n(m, shift)), "32n", time, 0.6);
          if ([0, 8, 10].includes(s16)) kick.triggerAttackRelease("C1", "8n", time, 0.85);
          if (s16 === 4 || s16 === 12) clap.triggerAttackRelease("16n", time, 0.75);
          // A clap fill into every new 8-bar section
          if (bar === 7 && (s16 === 13 || s16 === 14 || s16 === 15)) clap.triggerAttackRelease("32n", time, 0.4 + (s16 - 13) * 0.15);
          shaker.triggerAttackRelease("32n", time, s16 % 2 ? 0.16 : 0.3);
          const note = LEAD[bar][s16];
          if (note) leadSynth.triggerAttackRelease(n(note, shift), s16 % 4 === 0 ? "8n" : "16n", time, 0.75);
        } catch {
          // A dropped note is better than a crashed music loop
        }
      },
      steps,
      "16n",
    ).start(0);

    transport.start("+0.05");
    this.layers = { bus, duck, drums, brass, lead };
    if (!this.muted) bus.volume.rampTo(-1, 1.5);
    this.applyIntensity(0.1);
  }

  private applyIntensity(seconds: number) {
    if (!this.layers || !this.tone) return;
    this.layers.drums.volume.rampTo(this.intensity >= 1 ? LAYER_DB.drums : OFF_DB, seconds);
    this.layers.brass.volume.rampTo(this.intensity >= 1 ? LAYER_DB.brass : OFF_DB, seconds);
    this.layers.lead.volume.rampTo(LEAD_DB[this.intensity], seconds);
    this.tone.getTransport().bpm.rampTo(BPM[this.intensity], seconds * 2);
  }

  setIntensity(level: Intensity) {
    if (level === this.intensity) return;
    this.intensity = level;
    this.applyIntensity(1.2);
  }

  /** Dev/QA helper: record `ms` of the live mix (webm/opus), returned as a data URL. */
  async record(ms: number): Promise<string> {
    await this.start();
    const Tone = this.tone!;
    const rec = new Tone.Recorder();
    Tone.getDestination().connect(rec);
    rec.start();
    await new Promise((r) => setTimeout(r, ms));
    const blob = await rec.stop();
    Tone.getDestination().disconnect(rec);
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsDataURL(blob);
    });
  }

  /** Music dips ~10 dB while the player reads an explanation. */
  duck(active: boolean) {
    this.ducked = active;
    this.layers?.duck.gain.rampTo(active ? 0.3 : 1, active ? 0.25 : 0.8);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.layers) return;
    this.layers.bus.volume.cancelScheduledValues(this.tone!.now());
    this.layers.bus.volume.rampTo(muted ? -60 : -1, 0.4);
  }
}

let music: Music | null = null;
export function backgroundMusic(): Music {
  if (!music) music = new Music();
  return music;
}
