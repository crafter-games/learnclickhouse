// Themed backdrop for every screen (GDD → Art direction): a logistics park at sunset — a warm sky
// with a hazy sun and drifting clouds, a far row of warehouses with gantry cranes, a near row with
// roll-up doors and lit windows, chimneys puffing, and delivery trucks driving along the road.
// Pure SVG + CSS; the 3D canvas is transparent and floats on top of it.
import { seeded } from "@/lib/rng";

const W = 1600;
const H = 600;

type Shape = { d: string; windows: { x: number; y: number; lit: boolean }[]; doors: { x: number; y: number; w: number }[]; chimney?: { x: number; y: number } };

/** Deterministic row of warehouses: gable roofs, flat halls with roll-up doors, a few chimneys. */
function warehouses(seed: number, minH: number, maxH: number, detail: boolean): Shape[] {
  const rng = seeded(seed);
  const out: Shape[] = [];
  let x = -20;
  while (x < W + 20) {
    const kind = rng();
    const w = 110 + rng() * 150;
    const h = minH + rng() * (maxH - minH);
    const top = H - h;
    const windows: Shape["windows"] = [];
    const doors: Shape["doors"] = [];
    let d: string;
    let chimney: Shape["chimney"];
    if (kind < 0.5) {
      // Gable-roofed warehouse
      d = `M${x},${H} L${x},${top} L${x + w / 2},${top - w * 0.16} L${x + w},${top} L${x + w},${H} Z`;
    } else if (kind < 0.8) {
      // Flat hall with a parapet
      d = `M${x},${H} L${x},${top} L${x + w},${top} L${x + w},${H} Z M${x - 4},${top} L${x + w + 4},${top} L${x + w + 4},${top - 8} L${x - 4},${top - 8} Z`;
      if (rng() < 0.45) chimney = { x: x + w * (0.2 + rng() * 0.6), y: top - 8 };
    } else {
      // Silo pair
      const r = 26 + rng() * 10;
      d = `M${x},${H} L${x},${top + r} A${r},${r} 0 0 1 ${x + 2 * r},${top + r} L${x + 2 * r},${H} Z M${x + 2 * r + 6},${H} L${x + 2 * r + 6},${top + r + 30} A${r},${r} 0 0 1 ${x + 4 * r + 6},${top + r + 30} L${x + 4 * r + 6},${H} Z`;
    }
    if (chimney) {
      const cw = 14 + rng() * 6;
      const ch = 60 + rng() * 70;
      d += ` M${chimney.x - cw / 2},${chimney.y + 10} L${chimney.x - cw / 2},${chimney.y - ch} L${chimney.x + cw / 2},${chimney.y - ch} L${chimney.x + cw / 2},${chimney.y + 10} Z`;
      chimney = { x: chimney.x, y: chimney.y - ch };
    }
    if (detail && kind < 0.8) {
      const doorCount = Math.max(1, Math.floor(w / 70));
      for (let i = 0; i < doorCount; i++) doors.push({ x: x + 16 + i * ((w - 32) / doorCount), y: H - 46, w: Math.min(44, (w - 32) / doorCount - 10) });
      for (let wx = x + 14; wx < x + w - 20; wx += 24) if (rng() < 0.6) windows.push({ x: wx, y: top + 14, lit: rng() < 0.3 });
    }
    out.push({ d, windows, doors, chimney });
    x += w + 8 + rng() * 50;
  }
  return out;
}

const FAR = warehouses(11, 110, 220, false);
const NEAR = warehouses(29, 80, 170, true);
const CRANES = [
  { x: 260, h: 300 },
  { x: 1180, h: 340 },
];
const TRUCKS = [
  { dur: 38, delay: 0, back: false, color: "#3f9f62" },
  { dur: 46, delay: -21, back: true, color: "#e07a5f" },
  { dur: 41, delay: -9, back: false, color: "#f5b324" },
];

export function Backdrop() {
  return (
    <div aria-hidden className="backdrop pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Sky */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#f7d6bd_0%,#efd7e6_36%,#dbd2ef_68%,#cdc5e7_100%)]" />
      <div className="absolute -right-[8vmax] -top-[12vmax] size-[44vmax] rounded-full bg-[radial-gradient(circle,rgba(255,222,160,0.95)_0%,rgba(255,190,130,0.45)_35%,transparent_70%)]" />
      {/* Clouds */}
      {[
        { top: "8%", scale: 1, delay: "0s", dur: "150s" },
        { top: "19%", scale: 0.7, delay: "-70s", dur: "180s" },
        { top: "3%", scale: 0.55, delay: "-120s", dur: "210s" },
      ].map((c, i) => (
        <div key={i} className="cloud absolute left-0" style={{ top: c.top, animationDuration: c.dur, animationDelay: c.delay }}>
          <svg width={320 * c.scale} height={110 * c.scale} viewBox="0 0 320 110" className="blur-[1px]">
            <g fill="rgba(255,255,255,0.75)">
              <ellipse cx="90" cy="70" rx="80" ry="34" />
              <ellipse cx="170" cy="52" rx="70" ry="44" />
              <ellipse cx="240" cy="72" rx="70" ry="30" />
            </g>
          </svg>
        </div>
      ))}

      {/* Far warehouses and gantry cranes: pale and blurred */}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-x-0 bottom-[13%] h-[62%] w-full blur-[1.5px]">
        <g fill="#c8bfe3">
          {FAR.map((s, i) => (
            <path key={i} d={s.d} />
          ))}
          {CRANES.map((c, i) => (
            <g key={i}>
              <path d={`M${c.x - 40},${H} L${c.x - 30},${H - c.h} L${c.x - 18},${H - c.h} L${c.x - 22},${H} Z M${c.x + 30},${H} L${c.x + 26},${H - c.h} L${c.x + 38},${H - c.h} L${c.x + 48},${H} Z`} />
              <rect x={c.x - 40} y={H - c.h - 14} width={100} height={16} />
              <g className="crane-arm" style={{ animationDelay: `${-i * 7}s` }}>
                <rect x={c.x - 60} y={H - c.h - 30} width={260} height={12} />
                <line x1={c.x + 150} y1={H - c.h - 18} x2={c.x + 150} y2={H - c.h + 70} stroke="#c8bfe3" strokeWidth={3} />
                <rect x={c.x + 132} y={H - c.h + 70} width={36} height={22} rx={2} />
              </g>
            </g>
          ))}
        </g>
        {FAR.filter((s) => s.chimney).map((s, i) => (
          <g key={i}>
            {[0, 1, 2].map((k) => (
              <circle key={k} cx={s.chimney!.x} cy={s.chimney!.y} r={8} fill="rgba(255,255,255,0.5)" className="puff" style={{ animationDelay: `${-(i * 1.3 + k * 2.4)}s` }} />
            ))}
          </g>
        ))}
      </svg>

      {/* Near warehouses: darker, sharper, with roll-up doors and lit windows */}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-x-0 bottom-[7%] h-[44%] w-full blur-[0.5px]">
        <g fill="#b3aad7">
          {NEAR.map((s, i) => (
            <path key={i} d={s.d} />
          ))}
        </g>
        {NEAR.flatMap((s, i) => s.doors.map((d, k) => <rect key={`d${i}-${k}`} x={d.x} y={d.y} width={d.w} height={46} rx={2} fill="#a39ac9" />))}
        {NEAR.flatMap((s, i) =>
          s.windows.map((w, k) => <rect key={`${i}-${k}`} x={w.x} y={w.y} width={14} height={8} rx={2} fill={w.lit ? "#ffd68a" : "#c3bbe1"} className={w.lit && k % 3 === 0 ? "blink" : undefined} style={w.lit ? { animationDelay: `${-(i + k) * 0.9}s` } : undefined} />),
        )}
        {NEAR.filter((s) => s.chimney).map((s, i) => (
          <g key={i}>
            {[0, 1, 2].map((k) => (
              <circle key={k} cx={s.chimney!.x} cy={s.chimney!.y} r={9} fill="rgba(255,255,255,0.6)" className="puff" style={{ animationDelay: `${-(i * 1.1 + k * 2.4)}s` }} />
            ))}
          </g>
        ))}
      </svg>

      {/* Road with trucks */}
      <div className="absolute inset-x-0 bottom-[5%] h-[3%] bg-[#a69dcb]/70" />
      <div className="absolute inset-x-0 bottom-[6.4%] h-px bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.7)_0_18px,transparent_18px_40px)]" />
      {TRUCKS.map((t, i) => (
        <div key={i} className={`truck absolute ${t.back ? "is-back bottom-[6.6%]" : "bottom-[5.6%]"}`} style={{ animationDuration: `${t.dur}s`, animationDelay: `${t.delay}s` }}>
          <svg width="58" height="26" viewBox="0 0 58 26">
            <rect x="0" y="2" width="38" height="17" rx="2" fill={t.color} opacity="0.85" />
            <path d="M38,7 L49,7 L56,13 L56,19 L38,19 Z" fill="#8f86ba" />
            <rect x="44" y="9" width="7" height="5" rx="1" fill="#e9e4f7" />
            <circle cx="10" cy="21" r="4" fill="#5d5585" />
            <circle cx="46" cy="21" r="4" fill="#5d5585" />
          </svg>
        </div>
      ))}
      {/* Ground haze so the 3D floor sits on something soft */}
      <div className="absolute inset-x-0 bottom-0 h-[26%] bg-[linear-gradient(180deg,transparent,rgba(214,207,236,0.9))]" />
    </div>
  );
}
