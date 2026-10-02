import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Part, QueryResult, Table } from "@/sim/table";
import { materialsOf, model } from "./models";
import { Pico, type Face } from "./pico";
import { COLORS, COLUMN_COLORS } from "./theme";
import { Tweens, easeInOutCubic, easeOutBack, easeOutCubic, wait } from "./tweens";

// The warehouse (GDD → Verbos del almacén). World units: 1 shelf cell = 1 box.
// Column layout: one aisle (rack line) per column, one box per granule.
// Row layout (World 1's "before"): a single long rack where each granule's boxes sit side by side,
// one per column — every box of a row block is stored together.
// Sections (parts) are ordered by partition, then block number; partitions are separate "halls".
// Racks run along +x; each rack has a walkway in front of it (towards the camera) for Pico.
const AISLE = 2.25; // distance between racks
const WALK = 1.12; // walkway offset in front of a rack (centre of the gap, clear of uprights)
const START_X = 0; // first shelf cell
const SECTION_GAP = 0.55; // space between parts (sections)
const PARTITION_GAP = 1.9; // space between partitions (halls)
const RACK_Y = 0.42; // top of the rollers
const DRIVE_SPEED = 4.2; // Pico, units per second
const FOV = 35;
const READ = new THREE.Color(COLORS.read);
const SKIPPED = new THREE.Color(0x4b4d58);
const MASKED = new THREE.Color(0xc0525b);
const WHITE = new THREE.Color(0xffffff);
const HALL_TINTS = [0x2c2f45, 0x23383a, 0x3a3226, 0x26372b, 0x3a2735];
/** Floor tint per disk (tiered storage): hot SSD warm, cold HDD teal, S3 blue. */
const DISK_TINTS: Record<string, number> = { hot: 0x4a3a1c, cold: 0x1f3d40, s3: 0x2a2f55 };
/** General shot: from the front, a little to the right and above. */
const GENERAL_DIR = new THREE.Vector3(0.24, 0.74, 1).normalize();

export type Layout = "rows" | "columns";

export type StageLabels = {
  column: (name: string, type: string) => string;
  part: (name: string) => string;
  dock: string;
  /** Tag of the single rack in the row layout. */
  rows: string;
  /** Partition hall sign (with the disk, for tiered storage). */
  hall?: (partition: string, disk?: string) => string;
  /** Halls in this order (partitions that stand for tables: source first, target last). */
  hallOrder?: string[];
  rejected?: string;
  duplicate?: string;
  /** Stamp when the hot disk has no room (tiered storage). */
  full?: string;
  /** Stamps for replicated inserts: quorum not reached, Keeper read-only. */
  quorum?: string;
  readonly?: string;
  buffer?: (rows: number) => string;
};

export type BoxSound = "read" | "skip" | "seal" | "land" | "truck" | "merge" | "reject" | "drop";

export type StageOptions = {
  /** Called for every box Pico opens or skips, and other stage-timed sounds. */
  onSound?: (sound: BoxSound, index?: number) => void;
};

type BoxState = "idle" | "read" | "skipped" | "masked";
type Box = {
  granule: number;
  column: number;
  obj: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[];
  maps: (THREE.Texture | null)[];
  state: BoxState;
  /** Visual size (compression), applied on top of squash animations. */
  size: number;
  /** Value label (tables with logical rows: one box = one row's value). */
  label?: HTMLElement;
};
type Section = { part: Part; x0: number; width: number; boxes: Box[]; tag: CSS2DObject; racks: THREE.Object3D[]; masked?: boolean; maskedRows?: Set<number> };
type Hall = { tag: CSS2DObject; floor: THREE.Mesh };

type Shot = { pos: THREE.Vector3; look: THREE.Vector3; off: { x: number; y: number } };

function label(className: string, html: string) {
  const outer = document.createElement("div");
  const inner = document.createElement("div");
  inner.className = className;
  inner.innerHTML = html;
  outer.appendChild(inner);
  return { outer, inner, obj: new CSS2DObject(outer) };
}

export class DepotStage {
  private renderer: THREE.WebGLRenderer;
  private labels2d: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  private tweens = new Tweens();
  private pico = new Pico();
  /** Extra Picos for parallel reads (max_threads > 1). */
  private helpers: Pico[] = [];
  private sections: Section[] = [];
  private halls = new Map<string, Hall>();
  private aisleTags: HTMLElement[] = [];
  private aisleProps: THREE.Object3D[] = [];
  private rowTag: { obj: CSS2DObject; inner: HTMLElement } | null = null;
  private bufferTag: { obj: CSS2DObject; inner: HTMLElement } | null = null;
  private truckStamp: { obj: CSS2DObject; inner: HTMLElement } | null = null;
  private truck: THREE.Object3D | null = null;
  private press: THREE.Object3D | null = null;
  private frame = 0;
  private last = performance.now();
  private resizeObs: ResizeObserver;
  private disposed = false;
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Where the camera is and where it is heading. */
  private cam: Shot = { pos: new THREE.Vector3(10, 10, 14), look: new THREE.Vector3(), off: { x: 0, y: 0 } };
  private camTarget: Shot | null = null;
  private follow = false;
  private busy = Promise.resolve();
  private deliveries = new Map<string, Promise<void>>();
  private layout: Layout;
  /** prefers-reduced-motion: no follow camera, shorter flights. */
  private reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  readonly ready: Promise<void>;

  constructor(
    private host: HTMLElement,
    private table: Table,
    private text: StageLabels,
    private options: StageOptions = {},
  ) {
    this.layout = table.storage === "row" ? "rows" : "columns";
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    this.renderer.domElement.style.display = "block";
    host.appendChild(this.renderer.domElement);

    this.labels2d = new CSS2DRenderer();
    Object.assign(this.labels2d.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    host.appendChild(this.labels2d.domElement);

    this.lights();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.ready = this.build().then(() => {
      this.resize();
      this.snapCamera();
      this.loop();
    });
  }

  /** Run one animation at a time, in order (deliveries, queries, merges, layout changes). */
  private queue(run: () => Promise<void>) {
    const next = this.busy.then(async () => {
      await this.ready;
      if (!this.disposed) await run();
    });
    this.busy = next.catch(() => {});
    return next;
  }

  // ------------------------------------------------------------------ layout

  private get columns() {
    return this.table.columns;
  }
  /** Sticker colour of a column: a projection's hidden column wears its base column's colour. */
  private colorOf(c: number) {
    const col = this.columns[c];
    const base = col?.projection ? this.columns.findIndex((x) => x.name === col.name.slice(col.projection!.length + 1)) : c;
    return COLUMN_COLORS[Math.max(0, base) % COLUMN_COLORS.length];
  }
  /** Whether a part has a box in this column (patch parts: changed columns; projections: once built). */
  private hasBox(part: Part, g: number, c: number) {
    const col = this.columns[c];
    // Parts of logical rows (and patch parts) only have boxes for the columns their rows carry
    if (part.data) return part.data[g]?.[col.name] !== undefined;
    if (col.projection) return !!part.projections?.[col.projection];
    if (col.only) return col.only.includes(part.partition);
    return true;
  }
  private rackZ(c: number) {
    return c * AISLE;
  }
  /** The rack line the row layout uses: a middle aisle. */
  private get rowLine() {
    return Math.floor((this.columns.length - 1) / 2);
  }
  private walkZ(line: number) {
    return this.rackZ(line) + WALK;
  }
  private get frontZ() {
    return this.rackZ(this.columns.length - 1) + WALK + 1.4;
  }
  private get homePos() {
    return new THREE.Vector3(this.leftAisleX, 0, this.walkZ(this.columns.length - 1));
  }
  private get dockPos() {
    return new THREE.Vector3(START_X - 5.2, 0, this.frontZ + 0.4);
  }
  /** Cross aisles: Pico only changes walkway along these, never across the racks. */
  private get leftAisleX() {
    return START_X - 1.9;
  }
  private get endX() {
    const last = this.sections[this.sections.length - 1];
    return last ? last.x0 + last.width : START_X;
  }
  private get rightAisleX() {
    return this.endX + 0.9;
  }
  private sectionWidth(part: Part, layout = this.layout) {
    return Math.max(1, part.granules.length) * (layout === "rows" ? this.columns.length : 1);
  }
  /** Rack line and x of a box in a layout. */
  private slot(x0: number, granule: number, column: number, layout = this.layout) {
    if (layout === "rows") return { line: this.rowLine, x: x0 + granule * this.columns.length + column + 0.5 };
    return { line: column, x: x0 + granule + 0.5 };
  }
  private boxPos(x0: number, b: Box, layout = this.layout) {
    const { line, x } = this.slot(x0, b.granule, b.column, layout);
    return new THREE.Vector3(x, RACK_Y, this.rackZ(line));
  }
  private partitioned() {
    return this.sections.some((s) => s.part.partition !== "all");
  }
  /** Sections in shelf order: by partition, then by block number. */
  private sortSections() {
    const order = this.text.hallOrder ?? [];
    const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length);
    this.sections.sort((a, b) => {
      const pa = a.part.partition;
      const pb = b.part.partition;
      if (pa !== pb) return rank(pa) - rank(pb) || (pa < pb ? -1 : 1);
      return a.part.minBlock - b.part.minBlock;
    });
  }
  /** Where every section starts, with a wider gap between partitions. */
  private computeLayout() {
    const out = new Map<Section, { x0: number; width: number }>();
    let x = START_X;
    let prev: string | null = null;
    for (const s of this.sections) {
      if (prev !== null) x += prev === s.part.partition ? SECTION_GAP : PARTITION_GAP;
      const width = this.sectionWidth(s.part);
      out.set(s, { x0: x, width });
      x += width;
      prev = s.part.partition;
    }
    return out;
  }
  /** World-space bounds of what the general shot must show. */
  private contentBounds() {
    const maxX = Math.max(this.endX + 1.4, START_X + 7);
    return new THREE.Box3(new THREE.Vector3(this.dockPos.x - 0.6, 0, this.rackZ(0) - 0.9), new THREE.Vector3(maxX, 1.3, this.frontZ + (this.partitioned() ? 1.3 : 0)));
  }

  // ------------------------------------------------------------------ build

  private lights() {
    this.scene.add(new THREE.HemisphereLight(0xe4e8ff, 0x2a2b33, 2.1));
    // Moonlight from the front-left, plus the warm depot lamps
    const sun = new THREE.DirectionalLight(0xf2f4ff, 2.2);
    sun.position.set(-6, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0008;
    Object.assign(sun.shadow.camera, { left: -16, right: 44, top: 16, bottom: -12, near: 1, far: 60 });
    sun.target.position.set(12, 0, 3);
    this.scene.add(sun, sun.target);
    const lamp = new THREE.PointLight(0xfff3b0, 30, 30, 1.6);
    lamp.position.set(6, 7, 4);
    this.scene.add(lamp);
  }

  private async build() {
    const n = this.columns.length;
    // Floor: a soft platform with painted tile joints
    const x0 = -9, x1 = 47, z0 = -2.2, z1 = this.frontZ + 3;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.3, z1 - z0), new THREE.MeshStandardMaterial({ color: 0x2a2c34, roughness: 0.9 }));
    slab.position.set((x0 + x1) / 2, -0.15, (z0 + z1) / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);
    const joints: number[] = [];
    for (let x = x0 + 2; x < x1; x += 2) joints.push(x, 0.002, z0, x, 0.002, z1);
    for (let z = z0 + 2; z < z1; z += 2) joints.push(x0, 0.002, z, x1, 0.002, z);
    const jointGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(joints, 3));
    this.scene.add(new THREE.LineSegments(jointGeo, new THREE.LineBasicMaterial({ color: 0x373a45 })));

    // Warm up every model this scene uses in one parallel batch
    const [wall, windowWide, post, hopper] = await Promise.all([
      model("factory", "structure-wall"),
      model("factory", "structure-window-wide"),
      model("factory", "structure-yellow-medium"),
      model("factory", "hopper-high-square"),
      model("factory", "box-small"),
      model("factory", "conveyor-bars-high"),
      model("factory", "structure-yellow-short"),
      model("factory", "piston-square"),
      model("car", "delivery"),
    ]);
    // Back wall with windows, behind the first rack
    for (let x = x0 + 1; x < x1; x += 2) {
      if (Math.round((x - x0) / 2) % 3 === 1) {
        const w = windowWide.clone();
        w.position.set(x, 0, z0 + 0.1);
        this.scene.add(w);
      } else
        for (const dx of [-0.5, 0.5]) {
          const w = wall.clone();
          w.position.set(x + dx, 0, z0 + 0.1);
          this.scene.add(w);
        }
    }

    // Walkway stripes in front of each rack line
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc9cd45, emissive: 0xfaff69, emissiveIntensity: 0.12, roughness: 0.8 });
    for (let c = 0; c < n; c++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(x1 - START_X - 1, 0.01, 0.05), stripeMat);
      stripe.position.set((START_X - 0.6 + x1) / 2, 0.012, this.walkZ(c) + 0.5);
      this.scene.add(stripe);
    }

    // Aisle signs: a yellow post with the column name (hidden in the row layout)
    this.columns.forEach((col, c) => {
      const p = post.clone();
      p.position.set(START_X - 1.0, 0, this.rackZ(c));
      this.scene.add(p);
      this.aisleProps.push(p);
      const tag = label(col.projection ? "aisle-tag aisle-tag--proj" : "aisle-tag", `<b style="background:${this.colorOf(c)}"></b>${this.text.column(col.name, col.type)}`);
      tag.obj.position.set(START_X - 1.0, 1.25, this.rackZ(c));
      this.scene.add(tag.obj);
      this.aisleTags.push(tag.inner);
    });
    const stripes = this.columns.map((_, c) => `<i style="background:${this.colorOf(c)}"></i>`).join("");
    const row = label("aisle-tag aisle-tag--rows", `<span class="stripes">${stripes}</span>${this.text.rows}`);
    row.obj.position.set(START_X - 1.0, 1.25, this.rackZ(this.rowLine));
    this.scene.add(row.obj);
    this.rowTag = { obj: row.obj, inner: row.inner };
    this.applyAisleSigns(false);

    // Dock: hopper (the async-insert buffer) + a sign; trucks park next to it
    const h = hopper.clone();
    h.position.copy(this.dockPos).add(new THREE.Vector3(1.6, 0, -0.9));
    this.scene.add(h);
    const dockTag = label("stage-tag stage-tag--dock", this.text.dock);
    dockTag.obj.position.copy(h.position).add(new THREE.Vector3(0, 1.9, 0));
    this.scene.add(dockTag.obj);
    const buf = label("buffer-tag", "");
    buf.obj.position.copy(h.position).add(new THREE.Vector3(0, 2.6, 0));
    buf.outer.style.visibility = "hidden";
    this.scene.add(buf.obj);
    this.bufferTag = { obj: buf.obj, inner: buf.inner };
    const stamp = label("truck-stamp", "");
    stamp.outer.style.visibility = "hidden";
    this.scene.add(stamp.obj);
    this.truckStamp = { obj: stamp.obj, inner: stamp.inner };

    // Pico waits at the entrance
    this.pico.root.position.copy(this.homePos);
    this.pico.root.rotation.y = Math.PI / 2;
    this.scene.add(this.pico.root);

    // Parts that already exist (a level that starts with data)
    for (const part of this.table.activeParts) this.sections.push(await this.makeSection(part));
    this.sortSections();
    await this.applyLayout(false);
  }

  /** Column signs in the column layout, one "rows" sign in the row layout. */
  private applyAisleSigns(animate: boolean) {
    const rows = this.layout === "rows";
    this.aisleTags.forEach((t) => (t.parentElement!.style.visibility = rows ? "hidden" : "visible"));
    if (this.rowTag) (this.rowTag.obj.element as HTMLElement).style.visibility = rows ? "visible" : "hidden";
    this.aisleProps.forEach((p, c) => {
      const show = !rows || c === this.rowLine;
      if (!animate) p.scale.setScalar(show ? 1 : 0.001);
      else void this.tweens.to(p.scale, { x: show ? 1 : 0.001, y: show ? 1 : 0.001, z: show ? 1 : 0.001 }, 300, show ? easeOutBack : easeInOutCubic);
    });
  }

  // ------------------------------------------------------------------ sections (parts)

  /** Rollers + uprights for a section in the current layout. */
  private async buildRacks(x0: number, width: number) {
    const [rollers, upright] = await Promise.all([model("factory", "conveyor-bars-high"), model("factory", "structure-yellow-short")]);
    const lines = this.layout === "rows" ? [this.rowLine] : this.columns.map((_, c) => c);
    const racks: THREE.Object3D[] = [];
    for (const line of lines) {
      for (let i = 0; i < width; i++) {
        const r = rollers.clone();
        r.position.set(x0 + i + 0.5, 0, this.rackZ(line));
        racks.push(r);
      }
      // Section uprights at both ends: the part is sealed
      for (const ux of [x0 + 0.02, x0 + width - 0.02]) {
        const u = upright.clone();
        u.position.set(ux, 0, this.rackZ(line));
        racks.push(u);
      }
    }
    for (const r of racks) this.scene.add(r);
    return racks;
  }

  private formatValue(v: unknown, column: string): string {
    if (v === null || v === undefined) return "NULL";
    if (Array.isArray(v)) return `[${v.join(",")}]`;
    if (column === "sign" && typeof v === "number") return v > 0 ? "+1" : "−1";
    return String(v);
  }

  /** Write (or rewrite) the value labels of a section's boxes from its part's rows. */
  private labelBoxes(section: { part: Part; boxes: Box[] }) {
    const data = section.part.data;
    if (!data) return;
    for (const b of section.boxes) {
      const v = data[b.granule]?.[this.columns[b.column].name];
      if (!b.label) {
        const l = label("box-val", "");
        l.obj.position.set(0, 0.78, 0.1);
        b.obj.add(l.obj);
        b.label = l.inner;
      }
      b.label.textContent = this.formatValue(v, this.columns[b.column].name);
    }
  }

  private removeBox(b: Box) {
    this.scene.remove(b.obj);
    b.label?.parentElement?.remove();
  }

  private async makeBox(g: number, c: number): Promise<Box> {
    const obj = (await model("factory", "box-small")).clone(true);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = (mesh.material as THREE.Material).clone();
    });
    // A sticker in the column's colour on the front face: which column this box holds
    const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.18), new THREE.MeshStandardMaterial({ color: this.colorOf(c), roughness: 0.6 }));
    sticker.position.set(0, 0.3, 0.256);
    obj.add(sticker);
    obj.rotation.y = (((g * 7 + c * 3) % 5) - 2) * 0.03;
    const mats = materialsOf(obj).filter((m) => m !== sticker.material);
    this.scene.add(obj);
    return { granule: g, column: c, obj, mats, maps: mats.map((m) => m.map), state: "idle", size: 1 };
  }

  /** A section for a part: boxes and a name tag (racks and positions come from applyLayout). */
  private async makeSection(part: Part, boxes?: Box[]): Promise<Section> {
    const all = boxes ?? [];
    if (!boxes)
      for (let g = 0; g < part.granules.length; g++)
        for (let c = 0; c < this.columns.length; c++) if (this.hasBox(part, g, c)) all.push(await this.makeBox(g, c));
    const tag = label(part.patch ? "part-tag part-tag--patch" : "part-tag", this.text.part(part.name));
    this.scene.add(tag.obj);
    const section: Section = { part, x0: NaN, width: this.sectionWidth(part), boxes: all, tag: tag.obj, racks: [] };
    this.labelBoxes(section);
    return section;
  }

  private removeSectionObjects(s: Section, keepBoxes = false) {
    for (const r of s.racks) this.scene.remove(r);
    s.racks = [];
    this.scene.remove(s.tag);
    (s.tag.element as HTMLElement).remove();
    if (!keepBoxes) for (const b of s.boxes) this.removeBox(b);
  }

  /**
   * Move every section to its computed place: rebuild the racks of sections that moved, glide their
   * boxes and tags, and redraw the partition halls.
   */
  private async applyLayout(animate: boolean, skipBoxes = new Set<Box>()) {
    const layout = this.computeLayout();
    const moves: Promise<void>[] = [];
    for (const s of this.sections) {
      const { x0, width } = layout.get(s)!;
      const moved = s.x0 !== x0 || s.width !== width || !s.racks.length;
      s.x0 = x0;
      s.width = width;
      if (moved) {
        for (const r of s.racks) this.scene.remove(r);
        s.racks = await this.buildRacks(x0, width);
        if (animate) for (const r of s.racks) {
          r.scale.setScalar(0.001);
          moves.push(this.tweens.to(r.scale, { x: 1, y: 1, z: 1 }, 260, easeOutBack));
        }
      }
      s.tag.position.set(x0 + width / 2, 0.05, this.frontZ - 0.55);
      for (const b of s.boxes) {
        if (skipBoxes.has(b)) continue;
        const to = this.boxPos(x0, b);
        if (!animate || b.obj.position.distanceTo(to) < 0.001) b.obj.position.copy(to);
        else moves.push(this.tweens.to(b.obj.position, { x: to.x, y: to.y, z: to.z }, 420, easeInOutCubic));
      }
    }
    this.updateHalls();
    this.refit();
    await Promise.all(moves);
  }

  /** One sign and a tinted floor per partition (only when the table is partitioned). */
  private updateHalls() {
    const groups = new Map<string, { x0: number; x1: number }>();
    if (this.partitioned())
      for (const s of this.sections) {
        const g = groups.get(s.part.partition);
        groups.set(s.part.partition, g ? { x0: g.x0, x1: s.x0 + s.width } : { x0: s.x0, x1: s.x0 + s.width });
      }
    for (const [p, hall] of this.halls)
      if (!groups.has(p)) {
        this.scene.remove(hall.tag, hall.floor);
        (hall.tag.element as HTMLElement).remove();
        this.halls.delete(p);
      }
    [...groups.entries()].forEach(([p, { x0, x1 }], i) => {
      let hall = this.halls.get(p);
      const disk = this.sections.find((s) => s.part.partition === p)?.part.disk;
      if (!hall) {
        const tag = label("hall-tag", this.text.hall?.(p, disk) ?? p);
        const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshStandardMaterial({ color: HALL_TINTS[i % HALL_TINTS.length], roughness: 1 }));
        floor.receiveShadow = true;
        this.scene.add(tag.obj, floor);
        hall = { tag: tag.obj, floor };
        this.halls.set(p, hall);
      }
      const tagEl = (hall.tag.element as HTMLElement).firstElementChild as HTMLElement;
      tagEl.textContent = this.text.hall?.(p, disk) ?? p;
      tagEl.dataset.disk = disk ?? "";
      (hall.floor.material as THREE.MeshStandardMaterial).color.setHex(disk ? (DISK_TINTS[disk] ?? HALL_TINTS[i % HALL_TINTS.length]) : HALL_TINTS[i % HALL_TINTS.length]);
      const w = x1 - x0 + 0.9;
      const depth = this.frontZ - this.rackZ(0) + 1.8;
      hall.floor.scale.set(w, 1, depth);
      hall.floor.position.set((x0 + x1) / 2, 0.01, this.rackZ(0) - 0.8 + depth / 2);
      hall.tag.position.set((x0 + x1) / 2, 0.05, this.frontZ + 0.7);
    });
  }

  /** A part arrives: by truck (fly from the dock) or `quick` (drops straight onto the shelf). */
  deliver(part: Part, opts: { quick?: boolean } = {}): Promise<void> {
    // The canvas (sim event) and a level script (await) can both ask for the same delivery
    const pending = this.deliveries.get(part.name);
    if (pending) return pending;
    const next = this.queue(async () => {
      const section = await this.makeSection(part);
      for (const b of section.boxes) b.obj.visible = false;
      (section.tag.element as HTMLElement).style.visibility = "hidden";
      this.sections.push(section);
      this.sortSections();
      await this.applyLayout(true, new Set(section.boxes));
      if (opts.quick) {
        await Promise.all(
          section.boxes.map((b, i) =>
            wait(i * 12).then(async () => {
              const to = this.boxPos(section.x0, b);
              b.obj.visible = true;
              await this.fly(b, to.clone().add(new THREE.Vector3(0, 2.2, 0)), to, 220, 0);
              void this.squash(b);
            }),
          ),
        );
        this.options.onSound?.("land", 0);
      } else {
        const truck = await this.driveTruckIn();
        const from = truck.position.clone().add(new THREE.Vector3(0.6, 1.1, 0));
        await Promise.all(
          section.boxes.map((b, i) =>
            wait(i * 55).then(async () => {
              b.obj.visible = true;
              await this.fly(b, from, this.boxPos(section.x0, b));
              this.options.onSound?.("land", i);
              void this.squash(b);
            }),
          ),
        );
        void this.driveTruckOut(truck);
      }
      const tagEl = section.tag.element as HTMLElement;
      tagEl.style.visibility = "visible";
      tagEl.firstElementChild?.classList.add("is-new");
      this.options.onSound?.("seal");
    });
    this.deliveries.set(part.name, next);
    return next;
  }

  /** A truck comes in, gets a stamp (rejected / duplicate) and drives away with its load. */
  turnAway(kind: "rejected" | "duplicate" | "full" | "quorum" | "readonly"): Promise<void> {
    return this.queue(async () => {
      const truck = await this.driveTruckIn();
      const st = this.truckStamp!;
      st.inner.className = `truck-stamp truck-stamp--${kind === "duplicate" ? "duplicate" : "rejected"}`;
      st.inner.textContent = this.text[kind] ?? kind;
      st.obj.position.copy(truck.position).add(new THREE.Vector3(0, 2.1, 0));
      (st.obj.element as HTMLElement).style.visibility = "visible";
      this.options.onSound?.(kind === "duplicate" ? "drop" : "reject");
      await wait(900);
      (st.obj.element as HTMLElement).style.visibility = "hidden";
      await this.driveTruckOut(truck);
    });
  }

  /** The async-insert buffer above the hopper (rows waiting to become one part). */
  setBuffer(rows: number | null) {
    if (!this.bufferTag) return;
    const el = this.bufferTag.obj.element as HTMLElement;
    el.style.visibility = rows === null ? "hidden" : "visible";
    if (rows !== null) this.bufferTag.inner.textContent = this.text.buffer?.(rows) ?? String(rows);
  }

  /**
   * A background merge: the press comes down over the source sections, their boxes slide together
   * into one new section (fewer boxes if partial granules combined), the old tags fade.
   */
  merge(sources: string[], part: Part): Promise<void> {
    return this.queue(async () => {
      const src = this.sections.filter((s) => sources.includes(s.part.name));
      if (!src.length) return;
      const x0 = Math.min(...src.map((s) => s.x0));
      const x1 = Math.max(...src.map((s) => s.x0 + s.width));
      // Press down
      if (!this.press) {
        this.press = await model("factory", "piston-square");
        this.press.scale.set(1.4, 1.2, 1.4);
        this.scene.add(this.press);
      }
      const press = this.press;
      press.visible = true;
      press.position.set((x0 + x1) / 2, 4, this.rackZ(this.layout === "rows" ? this.rowLine : this.columns.length - 1) + 0.2);
      await this.tweens.to(press.position, { y: 1.05 }, 260, (t) => t * t);
      this.options.onSound?.("merge");
      // Reuse source boxes for the new part, column by column; extras leave
      const keep: Box[] = [];
      const extras: Box[] = [];
      for (let c = 0; c < this.columns.length; c++) {
        const col = src.flatMap((s) => s.boxes.filter((b) => b.column === c).sort((a, b) => a.granule - b.granule));
        col.forEach((b, i) => {
          if (i < part.granules.length) {
            b.granule = i;
            keep.push(b);
          } else extras.push(b);
        });
      }
      for (const s of src) this.removeSectionObjects(s, true);
      this.sections = this.sections.filter((s) => !src.includes(s));
      const merged = await this.makeSection(part, keep);
      if (src.some((s) => s.masked)) for (const b of keep) this.setBox(b, "idle");
      this.sections.push(merged);
      this.sortSections();
      for (const b of extras)
        void this.tweens.to(b.obj.scale, { x: 0.001, y: 0.001, z: 0.001 }, 220).then(() => this.removeBox(b));
      const tagEl = merged.tag.element as HTMLElement;
      tagEl.firstElementChild?.classList.add("is-new");
      await Promise.all([this.applyLayout(true), this.tweens.to(press.position, { y: 4 }, 380, easeOutCubic)]);
      press.visible = false;
    });
  }

  /** DROP PARTITION: the sections are lifted away at once. */
  dropParts(names: string[]): Promise<void> {
    return this.queue(async () => {
      const gone = this.sections.filter((s) => names.includes(s.part.name));
      this.options.onSound?.("drop");
      await Promise.all(gone.flatMap((s) => s.boxes.map((b, i) => wait(i * 8).then(() => this.tweens.to(b.obj.position, { y: b.obj.position.y + 6 }, 450, (t) => t * t)))));
      for (const s of gone) this.removeSectionObjects(s);
      this.sections = this.sections.filter((s) => !gone.includes(s));
      await this.applyLayout(true);
    });
  }

  /** ALTER … DELETE: every box of every affected part is rewritten, one by one (that's the cost). */
  mutateParts(names: string[]): Promise<void> {
    return this.queue(async () => {
      const hit = this.sections.filter((s) => names.includes(s.part.name));
      for (const s of hit)
        for (const b of s.boxes) {
          this.setBox(b, "read");
          b.obj.rotation.y += Math.PI;
          await this.tweens.to(b.obj.rotation, { y: b.obj.rotation.y - Math.PI }, 120, easeInOutCubic);
          this.options.onSound?.("land", 0);
        }
      for (const s of hit) this.removeSectionObjects(s);
      this.sections = this.sections.filter((s) => !hit.includes(s));
      await this.applyLayout(true);
    });
  }

  /** Lightweight DELETE: the rows are masked in place; the boxes stay until a merge. */
  maskParts(names: string[]): Promise<void> {
    return this.queue(async () => {
      for (const s of this.sections.filter((x) => names.includes(x.part.name))) {
        s.masked = true;
        s.boxes.forEach((b) => this.setBox(b, "masked"));
      }
      this.options.onSound?.("skip");
    });
  }

  /**
   * A mutation or TTL merge: every box of each affected part is rewritten one by one (that's the
   * cost), then the section becomes the new part (or disappears when nothing is left).
   */
  rewriteParts(changes: { from: string; to: Part | null }[]): Promise<void> {
    return this.queue(async () => {
      for (const { from, to } of changes) {
        const s = this.sections.find((x) => x.part.name === from);
        if (!s) continue;
        for (const b of s.boxes) {
          this.setBox(b, "read");
          b.obj.rotation.y += Math.PI;
          await this.tweens.to(b.obj.rotation, { y: b.obj.rotation.y - Math.PI }, this.reduced ? 40 : 110, easeInOutCubic);
          this.options.onSound?.("land", 0);
        }
        this.removeSectionObjects(s);
        this.sections = this.sections.filter((x) => x !== s);
        if (to) {
          const fresh = await this.makeSection(to);
          (fresh.tag.element as HTMLElement).firstElementChild?.classList.add("is-new");
          this.sections.push(fresh);
          this.sortSections();
          this.options.onSound?.("seal");
        } else this.options.onSound?.("drop");
        await this.applyLayout(true);
      }
    });
  }

  /** MATERIALIZE PROJECTION: the boxes a part now has (its projection aisles) drop onto the shelf. */
  fillParts(names: string[]): Promise<void> {
    return this.queue(async () => {
      for (const s of this.sections.filter((x) => names.includes(x.part.name))) {
        const fresh: Box[] = [];
        for (let g = 0; g < s.part.granules.length; g++)
          for (let c = 0; c < this.columns.length; c++)
            if (this.hasBox(s.part, g, c) && !s.boxes.some((b) => b.granule === g && b.column === c)) fresh.push(await this.makeBox(g, c));
        s.boxes.push(...fresh);
        await Promise.all(
          fresh.map((b, i) =>
            wait(i * 25).then(async () => {
              const to = this.boxPos(s.x0, b);
              await this.fly(b, to.clone().add(new THREE.Vector3(0, 2.2, 0)), to, 260, 0);
              void this.squash(b);
            }),
          ),
        );
        if (fresh.length) this.options.onSound?.("seal");
      }
    });
  }

  /** Lightweight DELETE on rows: those rows' boxes turn pink in place. */
  maskRows(partName: string, rows: number[]): Promise<void> {
    return this.queue(async () => {
      const s = this.sections.find((x) => x.part.name === partName);
      if (!s) return;
      s.maskedRows = new Set([...(s.maskedRows ?? []), ...rows]);
      for (const b of s.boxes) if (s.maskedRows.has(b.granule)) this.setBox(b, "masked");
      this.options.onSound?.("skip");
    });
  }

  /** Tiered storage: parts slide to another disk (their hall retints and its sign changes). */
  moveParts(names: string[]): Promise<void> {
    return this.queue(async () => {
      const moving = this.sections.filter((s) => names.includes(s.part.name));
      if (!moving.length) return;
      this.options.onSound?.("drop");
      await Promise.all(moving.flatMap((s) => s.boxes.map((b) => this.tweens.to(b.obj.position, { y: b.obj.position.y + 0.8 }, 220, easeOutCubic))));
      this.updateHalls();
      await Promise.all(moving.flatMap((s) => s.boxes.map((b) => this.tweens.to(b.obj.position, { y: RACK_Y }, 300, easeOutBack))));
    });
  }

  private async fly(b: Box, from: THREE.Vector3, to: THREE.Vector3, ms = 520, arc = 1.6) {
    if (this.reduced) {
      ms *= 0.4;
      arc = 0;
    }
    await this.tweens.progress(ms, (p) => {
      b.obj.position.lerpVectors(from, to, p);
      b.obj.position.y += Math.sin(Math.PI * p) * arc;
    });
    b.obj.position.copy(to);
  }

  private async driveTruckIn() {
    if (!this.truck) {
      this.truck = await model("car", "delivery");
      this.truck.scale.setScalar(0.62);
      this.scene.add(this.truck);
    }
    const truck = this.truck;
    const park = this.dockPos.clone();
    truck.visible = true;
    truck.rotation.y = Math.PI / 2; // nose towards +x
    truck.position.set(park.x - 14, 0, park.z);
    this.options.onSound?.("truck");
    await this.tweens.to(truck.position, { x: park.x }, 900, easeOutCubic);
    return truck;
  }

  private async driveTruckOut(truck: THREE.Object3D) {
    await wait(250);
    await this.tweens.to(truck.position, { x: truck.position.x - 16 }, 900, (t) => t * t);
    truck.visible = false;
  }

  private async squash(b: Box) {
    const s = b.size;
    b.obj.scale.set(1.15 * s, 0.85 * s, 1.15 * s);
    await this.tweens.to(b.obj.scale, { x: s, y: s, z: s }, 160, easeOutBack);
  }

  /**
   * "Rotate the table": every box flies to its slot in the other layout, racks are rebuilt and the
   * signs swap (World 1-1's cinematic).
   */
  setLayout(layout: Layout, animate = true): Promise<void> {
    return this.queue(async () => {
      if (layout === this.layout) return;
      this.layout = layout;
      this.resetBoxStates();
      // Racks shrink away; the new ones grow in while every box flies, column by column
      for (const s of this.sections) {
        for (const r of s.racks) void this.tweens.to(r.scale, { x: 0.001, y: 0.001, z: 0.001 }, animate ? 260 : 1).then(() => this.scene.remove(r));
        s.racks = [];
      }
      const all = new Set(this.sections.flatMap((s) => s.boxes));
      await this.applyLayout(animate, all);
      this.applyAisleSigns(animate);
      if (!animate) {
        for (const s of this.sections) for (const b of s.boxes) b.obj.position.copy(this.boxPos(s.x0, b));
        return;
      }
      await wait(200);
      let i = 0;
      const flights: Promise<void>[] = [];
      for (let c = 0; c < this.columns.length; c++)
        for (const s of this.sections)
          for (const b of s.boxes.filter((bx) => bx.column === c)) {
            const delay = i++ * 110;
            flights.push(
              wait(delay).then(async () => {
                await this.fly(b, b.obj.position.clone(), this.boxPos(s.x0, b), 950, 1.8);
                this.options.onSound?.("land", i);
                void this.squash(b);
              }),
            );
          }
      await Promise.all(flights);
    });
  }

  /** Box size per column (e.g. compressed / uncompressed), animated. 1 = full size. */
  /** Rewrite the aisle signs (a column changed type: ALTER TABLE … MODIFY COLUMN). */
  relabelColumns() {
    this.columns.forEach((col, c) => {
      const tag = this.aisleTags[c];
      if (tag) tag.innerHTML = `<b style="background:${this.colorOf(c)}"></b>${this.text.column(col.name, col.type)}`;
    });
  }

  setColumnSizes(sizes: Record<string, number>) {
    return this.queue(async () => {
      const all: Promise<void>[] = [];
      for (const s of this.sections)
        for (const b of s.boxes) {
          const size = sizes[this.columns[b.column].name];
          if (size === undefined || Math.abs(size - b.size) < 0.001) continue;
          b.size = size;
          all.push(this.tweens.to(b.obj.scale, { x: size, y: size, z: size }, 450, easeOutBack));
        }
      await Promise.all(all);
    });
  }

  // ------------------------------------------------------------------ reading (queries)

  private setBox(b: Box, state: BoxState) {
    if (b.state === state) return;
    b.state = state;
    // The Kenney box is textured (colour map), so tinting can't grey it out: read, skipped and
    // masked boxes drop the texture for a flat, unmistakable colour
    b.mats.forEach((m, i) => {
      m.map = state === "idle" ? b.maps[i] : null;
      m.color.copy(state === "read" ? READ : state === "skipped" ? SKIPPED : state === "masked" ? MASKED : WHITE);
      m.emissive.setHex(state === "read" ? COLORS.read : 0x000000);
      m.emissiveIntensity = state === "read" ? 0.18 : 0;
      m.needsUpdate = true;
    });
  }

  private resetBoxStates() {
    for (const s of this.sections) for (const b of s.boxes) this.setBox(b, s.masked || s.maskedRows?.has(b.granule) ? "masked" : "idle");
    for (const t of this.aisleTags) t.classList.remove("is-dim", "is-on");
    this.rowTag?.inner.classList.remove("is-on");
  }

  /** Back to the idle look (every box closed and coloured). */
  resetBoxes() {
    return this.queue(async () => this.resetBoxStates());
  }

  /**
   * Pico walks only the racks holding boxes the query reads. In each aisle the boxes the index
   * rules out grey out in a sweep, and Pico drives straight to the ones it must open.
   */
  playQuery(result: QueryResult, opts: { threads?: number } = {}): Promise<void> {
    if ((opts.threads ?? 1) > 1) return this.playParallel(result, opts.threads!);
    return this.queue(async () => {
      this.resetBoxStates();
      const isRead = new Set(result.boxes.filter((b) => b.read).map((b) => `${b.part}/${b.granule}/${b.column}`));
      const readOf = (s: Section, b: Box) => isRead.has(`${s.part.name}/${b.granule}/${this.columns[b.column].name}`);
      // Rack lines with something to read, in front-to-back order
      const lines = [...new Set(this.sections.flatMap((s) => s.boxes.filter((b) => readOf(s, b)).map((b) => this.slot(s.x0, b.granule, b.column).line)))].sort((a, b) => a - b);
      if (this.layout === "columns")
        this.columns.forEach((_, c) => {
          const visited = lines.includes(c);
          this.aisleTags[c].classList.toggle("is-dim", !visited);
          this.aisleTags[c].classList.toggle("is-on", visited);
          // Aisles nobody visits fade out at once: a whole column file is never opened
          if (!visited) for (const s of this.sections) for (const b of s.boxes) if (b.column === c) this.setBox(b, "skipped");
        });
      else this.rowTag?.inner.classList.add("is-on");
      if (this.layout === "columns" && lines.length < this.columns.length) this.options.onSound?.("skip");
      this.pico.setFace("focus");
      this.follow = !this.reduced;
      await wait(250);

      // Zig-zag like a real picker: one aisle left → right, the next one back
      let forward = true;
      for (const line of lines) {
        const cells = this.sections
          .flatMap((s) => s.boxes.map((b) => ({ s, b, ...this.slot(s.x0, b.granule, b.column) })))
          .filter((x) => x.line === line)
          .sort((a, b) => a.x - b.x);
        if (!forward) cells.reverse();
        await this.travel(new THREE.Vector3(forward ? START_X - 0.6 : this.rightAisleX - 0.5, 0, this.walkZ(line)));
        // The index rules boxes out before Pico moves: they grey out in a sweep
        const skipped = cells.filter(({ s, b }) => !readOf(s, b));
        skipped.forEach(({ b }, i) =>
          void wait(i * 18).then(() => {
            this.setBox(b, "skipped");
            this.options.onSound?.("skip", i);
          }),
        );
        let k = 0;
        for (const { s, b, x } of cells) {
          if (!readOf(s, b)) continue;
          await this.driveTo(new THREE.Vector3(x, 0, this.walkZ(line)), true);
          this.setBox(b, "read");
          this.pico.flash(true);
          this.options.onSound?.("read", k++);
          const y = b.obj.position.y;
          void this.tweens.to(b.obj.position, { y: y + 0.22 }, 110, easeOutCubic).then(() => this.tweens.to(b.obj.position, { y }, 180, easeOutBack));
          await wait(140);
          this.pico.flash(false);
        }
        await this.driveTo(new THREE.Vector3(forward ? this.rightAisleX : this.leftAisleX, 0, this.walkZ(line)), true);
        forward = !forward;
      }
      this.pico.setFace(result.boxesRead <= result.boxesTotal / 4 ? "happy" : "wow");
      await this.travel(this.homePos);
      await this.tweens.to(this.pico.root.rotation, { y: Math.PI / 2 }, 200, easeInOutCubic);
      this.follow = false;
      this.refit();
    });
  }

  /**
   * max_threads > 1: the granules to read are split into contiguous ranges, one per thread, and a
   * Pico per thread reads its range aisle by aisle, all at once.
   */
  private playParallel(result: QueryResult, threads: number): Promise<void> {
    return this.queue(async () => {
      this.resetBoxStates();
      const isRead = new Set(result.boxes.filter((b) => b.read).map((b) => `${b.part}/${b.granule}/${b.column}`));
      const cells = this.sections.flatMap((s) => s.boxes.map((b) => ({ s, b, read: isRead.has(`${s.part.name}/${b.granule}/${this.columns[b.column].name}`), ...this.slot(s.x0, b.granule, b.column) })));
      const lines = new Set(cells.filter((c) => c.read).map((c) => c.line));
      this.columns.forEach((_, c) => {
        this.aisleTags[c].classList.toggle("is-dim", !lines.has(c));
        this.aisleTags[c].classList.toggle("is-on", lines.has(c));
      });
      cells.filter((c) => !c.read).forEach((c, i) => void wait(i * 6).then(() => this.setBox(c.b, "skipped")));
      if (cells.some((c) => !c.read)) this.options.onSound?.("skip");
      // Contiguous granule ranges (by shelf position), one per thread
      const xs = [...new Set(cells.filter((c) => c.read).map((c) => c.x))].sort((a, b) => a - b);
      const per = Math.ceil(xs.length / threads);
      const zones = Array.from({ length: threads }, (_, k) => new Set(xs.slice(k * per, (k + 1) * per))).filter((z) => z.size);
      while (this.helpers.length < zones.length - 1) {
        const h = new Pico();
        h.root.scale.setScalar(0.001);
        this.scene.add(h.root);
        this.helpers.push(h);
      }
      const workers = [this.pico, ...this.helpers.slice(0, zones.length - 1)];
      await Promise.all(
        workers.map(async (who, k) => {
          const mine = cells.filter((c) => c.read && zones[k].has(c.x));
          const myLines = [...new Set(mine.map((c) => c.line))].sort((a, b) => a - b);
          who.setFace("focus");
          let n = 0;
          for (const line of myLines) {
            const run = mine.filter((c) => c.line === line).sort((a, b) => a.x - b.x);
            const start = new THREE.Vector3(run[0].x - 0.5, 0, this.walkZ(line));
            if (who === this.pico) await this.travel(start);
            else {
              // Helpers pop in where their range starts and out when done with an aisle
              who.root.position.copy(start);
              who.root.rotation.y = Math.PI / 2;
              await this.tweens.to(who.root.scale, { x: 0.85, y: 0.85, z: 0.85 }, 180, easeOutBack);
            }
            for (const c of run) {
              await this.driveTo(new THREE.Vector3(c.x, 0, this.walkZ(line)), true, who);
              this.setBox(c.b, "read");
              who.flash(true);
              this.options.onSound?.("read", n++);
              await wait(140);
              who.flash(false);
            }
            if (who !== this.pico) await this.tweens.to(who.root.scale, { x: 0.001, y: 0.001, z: 0.001 }, 160, easeInOutCubic);
          }
        }),
      );
      this.pico.setFace("happy");
      await this.travel(this.homePos);
      await this.tweens.to(this.pico.root.rotation, { y: Math.PI / 2 }, 200, easeInOutCubic);
      this.refit();
    });
  }

  setFace(face: Face) {
    this.pico.setFace(face);
  }

  /**
   * Drive along the warehouse's aisles only: to change walkway, go to the nearer cross aisle,
   * along it, then into the target walkway — never diagonally through racks.
   */
  private async travel(to: THREE.Vector3, who = this.pico) {
    const p = who.root.position.clone();
    if (Math.abs(p.z - to.z) > 0.05) {
      const cost = (x: number) => Math.abs(p.x - x) + Math.abs(to.x - x);
      const cross = cost(this.leftAisleX) <= cost(this.rightAisleX) ? this.leftAisleX : this.rightAisleX;
      await this.driveTo(new THREE.Vector3(cross, 0, p.z), false, who);
      await this.driveTo(new THREE.Vector3(cross, 0, to.z), false, who);
    }
    await this.driveTo(to, false, who);
  }

  /** Drive Pico to a point (turning first). `straight` skips the turn for runs along an aisle. */
  private async driveTo(to: THREE.Vector3, straight = false, who = this.pico) {
    const from = who.root.position.clone();
    const d = from.distanceTo(to);
    if (d < 0.01) return;
    const heading = Math.atan2(to.x - from.x, to.z - from.z);
    if (!straight) {
      let delta = heading - who.root.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      await this.tweens.to(who.root.rotation, { y: who.root.rotation.y + delta }, 160, easeInOutCubic);
    } else who.root.rotation.y = heading;
    const ms = (d / DRIVE_SPEED) * 1000;
    who.speed = DRIVE_SPEED;
    await this.tweens.progress(ms, (p) => who.root.position.lerpVectors(from, to, p), straight ? (t) => t : easeInOutCubic);
    who.speed = 0;
  }


  // ------------------------------------------------------------------ camera

  setInsets(insets: Partial<typeof this.insets>) {
    this.insets = { ...this.insets, ...insets };
    this.refit();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels2d.setSize(w, h);
    this.refit();
  }

  /** The general shot: frame the content bounds inside the free area (outside floating UI). */
  private generalShot(): Shot {
    const { clientWidth: w, clientHeight: h } = this.host;
    const { top, right, left } = this.insets;
    const bottom = w >= 1000 ? this.insets.bottom * 0.8 : this.insets.bottom;
    const aw = Math.max(160, w - left - right);
    const ah = Math.max(160, h - top - bottom);
    const box = this.contentBounds();
    const center = box.getCenter(new THREE.Vector3());
    // Find the distance at which every corner fits the free area's frustum
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (ah / h);
    const tanH = tanV * (aw / ah);
    const cam = new THREE.PerspectiveCamera(FOV, w / h);
    const fits = (dist: number) => {
      cam.position.copy(center).addScaledVector(GENERAL_DIR, dist);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      const inv = cam.matrixWorldInverse;
      for (let i = 0; i < 8; i++) {
        const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
        const depth = -p.z;
        if (depth <= 0.1 || Math.abs(p.x) / depth > tanH * 0.96 || Math.abs(p.y) / depth > tanV * 0.96) return false;
      }
      return true;
    };
    let lo = 2, hi = 200;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return {
      pos: center.clone().addScaledVector(GENERAL_DIR, hi),
      look: center,
      // Shift the projection so the frame's centre sits in the middle of the free area
      off: { x: -(left - right) / 2, y: -(top - bottom) / 2 },
    };
  }

  /** Close shot behind Pico, looking down the aisle. */
  private followShot(): Shot {
    const p = this.pico.root.position;
    const { left, right, top } = this.insets;
    const bottom = this.host.clientWidth >= 1000 ? this.insets.bottom * 0.8 : this.insets.bottom;
    return {
      pos: new THREE.Vector3(p.x - 2.6, 4.6, p.z + 7.4),
      look: new THREE.Vector3(p.x + 2.4, 0.4, p.z - 1.8),
      off: { x: -(left - right) / 2, y: -(top - bottom) / 2 },
    };
  }

  private refit() {
    if (!this.host.clientWidth) return;
    this.camTarget = this.generalShot();
    const dist = this.camTarget.pos.distanceTo(this.camTarget.look);
    // Labels scale with how close the general shot is
    const zoom = Math.min(1.2, Math.max(0.7, 22 / dist));
    this.host.style.setProperty("--stage-zoom", String(zoom));
    this.host.toggleAttribute("data-compact", this.host.clientWidth < 640);
  }

  private snapCamera() {
    if (this.camTarget) this.cam = { pos: this.camTarget.pos.clone(), look: this.camTarget.look.clone(), off: { ...this.camTarget.off } };
  }

  private applyCamera() {
    const { clientWidth: w, clientHeight: h } = this.host;
    this.camera.aspect = w / h;
    this.camera.position.copy(this.cam.pos);
    this.camera.lookAt(this.cam.look);
    this.camera.setViewOffset(w, h, this.cam.off.x, this.cam.off.y, w, h);
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(64, now - this.last);
    this.last = now;
    this.tweens.update(dt);
    this.pico.update(dt / 1000);
    for (const h of this.helpers) h.update(dt / 1000);
    // Smoothly ease the camera toward the current shot (never snaps)
    const target = this.follow ? this.followShot() : this.camTarget;
    if (target) {
      const k = 1 - Math.exp(-(dt / 1000) * (this.follow ? 3.2 : 4.5));
      this.cam.pos.lerp(target.pos, k);
      this.cam.look.lerp(target.look, k);
      this.cam.off.x += (target.off.x - this.cam.off.x) * k;
      this.cam.off.y += (target.off.y - this.cam.off.y) * k;
    }
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
    this.labels2d.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.loop);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObs.disconnect();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.renderer.domElement.remove();
    this.labels2d.domElement.remove();
  }
}
