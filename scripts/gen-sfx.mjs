// Synthesizes the sound effects as 16-bit mono WAVs (original, CC0).
// Run: node scripts/gen-sfx.mjs  → public/audio/sfx/*.wav
// Every sound is a ClickHouse event (GDD → Audio).
import { writeFileSync, mkdirSync } from "node:fs";

const RATE = 44100;
const OUT = new URL("../public/audio/sfx/", import.meta.url);

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function render(seconds, fn) {
  const n = Math.floor(seconds * RATE);
  const out = new Float32Array(n);
  const phases = [0, 0, 0, 0];
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const p = i / n;
    // osc(hz, voice): independent phase per voice so chords don't share a phase accumulator
    const osc = (hz, v = 0) => ((phases[v] += (2 * Math.PI * hz) / RATE), Math.sin(phases[v]));
    const noise = (a) => ((lp += a * (Math.random() * 2 - 1 - lp)), lp);
    out[i] = fn({ t, p, osc, noise });
  }
  // 3 ms fade-in/out to avoid clicks
  const f = Math.floor(0.003 * RATE);
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[n - 1 - i] *= i / f; }
  return out;
}

const sfx = {
  // INSERT: a delivery truck rolls in — low engine rumble with a short horn toot at the end
  truck: render(0.7, ({ t, p, osc, noise }) => {
    const rumble = (0.25 * noise(0.05) + 0.12 * osc(55 + 8 * Math.sin(t * 30))) * Math.sin(Math.PI * Math.min(1, p * 1.3));
    const horn = t > 0.5 ? Math.exp(-(t - 0.5) * 18) * (0.16 * osc(392, 1) + 0.1 * osc(494, 2)) : 0;
    return rumble + horn;
  }),
  // box lands on its shelf: soft cardboard thump
  land: render(0.12, ({ t, p, osc, noise }) => Math.exp(-t * 38) * (0.7 * osc(130 - 60 * p) + 0.35 * noise(0.3))),
  // part sealed: a rubber stamp — thunk + tape squeak
  seal: render(0.32, ({ t, p, osc, noise }) => {
    const thunk = Math.exp(-t * 30) * osc(180 - 90 * Math.min(1, p * 3)) * 0.8;
    const click = t < 0.008 ? noise(0.9) * 0.7 : 0;
    const tape = t > 0.1 ? Math.exp(-(t - 0.1) * 14) * osc(1500 + 900 * p, 1) * 0.06 : 0;
    return thunk + click + tape;
  }),
  // granule read: a bright scanner "bip"
  read: render(0.09, ({ t, osc }) => Math.exp(-t * 30) * (0.28 * osc(1320) + 0.1 * osc(2640, 1))),
  // granule skipped: a soft tick that falls in pitch
  skip: render(0.07, ({ t, p, osc }) => Math.exp(-t * 60) * osc(700 - 300 * p) * 0.22),
  // query done: major arpeggio (C E G C); the app raises its pitch the less was read
  done: render(0.6, ({ t, osc }) => {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    let s = 0;
    notes.forEach((hz, i) => {
      const local = t - i * 0.07;
      if (local >= 0) s += Math.exp(-local * 6) * osc(hz, i) * 0.16;
    });
    return s * (1 - t / 0.6);
  }),
  // merge: the press comes down — heavy clunk, then a short hiss as parts fuse
  merge: render(0.55, ({ t, p, osc, noise }) => {
    const clunk = Math.exp(-t * 22) * (0.8 * osc(90 - 40 * Math.min(1, p * 4)) + 0.4 * noise(0.5));
    const hiss = t > 0.12 ? Math.exp(-(t - 0.12) * 7) * noise(0.9) * 0.14 : 0;
    return clunk + hiss;
  }),
  // insert rejected (TOO_MANY_PARTS): two low buzzes
  reject: render(0.45, ({ t, osc }) => {
    const on = t < 0.18 || (t > 0.24 && t < 0.42);
    return on ? Math.sign(osc(110)) * 0.16 + osc(220, 1) * 0.08 : 0;
  }),
  // parts dropped / truck sent away: a falling whoosh
  drop: render(0.4, ({ p, osc, noise }) => Math.sin(Math.PI * p) * (0.25 * noise(0.2 + 0.3 * (1 - p)) + 0.12 * osc(600 - 450 * p))),
  // objective complete: rising major arpeggio sparkle (A C# E A)
  unlock: render(0.5, ({ t, osc }) => {
    const notes = [880, 1108.7, 1318.5, 1760];
    const i = Math.min(3, Math.floor(t / 0.08));
    const local = t - i * 0.08;
    return Math.exp(-local * 9) * osc(notes[i]) * 0.28 * (1 - t / 0.5);
  }),
  // correct prediction: two-note rising chime (E5 → B5)
  correct: render(0.32, ({ t, osc }) => {
    const hz = t < 0.09 ? 659.3 : 987.8;
    const local = t < 0.09 ? t : t - 0.09;
    return Math.exp(-local * 10) * osc(hz) * 0.3;
  }),
  // wrong prediction: soft low "bwomp", not punishing
  wrong: render(0.28, ({ p, osc }) => Math.exp(-p * 4) * osc(220 - 70 * p) * 0.3),
  // dialogue text blip (typewriter), very short and soft
  blip: render(0.035, ({ t, osc }) => Math.exp(-t * 90) * osc(1180) * 0.22),
  // generic UI click
  click: render(0.05, ({ t, osc }) => Math.exp(-t * 120) * osc(1600) * 0.35),
};

mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(sfx)) {
  writeFileSync(new URL(`${name}.wav`, OUT), wav(samples));
  console.log(`wrote ${name}.wav (${samples.length} samples)`);
}
